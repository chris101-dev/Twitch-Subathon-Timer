import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { Server } from 'socket.io';
import { io as streamlabsClient } from 'socket.io-client';

const PORT = 3000;
const DEFAULT_SECONDS_PER_SUB = 300;
const DEFAULT_EVENT_SECONDS = {
    bits: 0,
    primeT1: DEFAULT_SECONDS_PER_SUB,
    t2: DEFAULT_SECONDS_PER_SUB,
    t3: DEFAULT_SECONDS_PER_SUB,
    bomb10: 0,
    bomb20: 0,
    bomb50: 0,
    bomb100: 0
};
const EVENT_SECONDS_KEYS = Object.keys(DEFAULT_EVENT_SECONDS);
const DEDUPE_ID_TTL_MS = 24 * 60 * 60 * 1000;
const DEDUPE_FINGERPRINT_TTL_MS = 15 * 1000;
const DEDUPE_CLEANUP_MS = 60 * 1000;
const MYSTERY_GIFT_LINK_TTL_MS = 120 * 1000;
const STATE_FILE_URL = new URL('./timer-state.json', import.meta.url);

// 1. Lokaler Socket.io Server für dein Frontend (Port 3000)
const io = new Server(PORT, {
    cors: { origin: "*" } // Erlaubt Zugriff vom Browser
});

console.log(`Lokaler Server läuft auf Port ${PORT}...`);

const timerState = {
    remainingSeconds: 0,
    isRunning: false,
    subs: 0,
    bits: 0,
    happyHour: false,
    eventSeconds: { ...DEFAULT_EVENT_SECONDS },
    secondsPerSub: DEFAULT_SECONDS_PER_SUB,
    stateVersion: 0,
    updatedAt: Date.now()
};

let persistTimer = null;
let isPersisting = false;
let pendingPersist = false;

const seenEventKeys = new Map();
const pendingMysteryGifts = [];

function emitState() {
    timerState.stateVersion += 1;
    timerState.updatedAt = Date.now();
    io.emit('timer-update', timerState);
    schedulePersistState();
}

async function persistStateNow() {
    if (isPersisting) {
        pendingPersist = true;
        return;
    }

    isPersisting = true;
    try {
        await writeFile(STATE_FILE_URL, JSON.stringify(timerState, null, 2), 'utf8');
    } catch (error) {
        console.error('Fehler beim Speichern des Timer-Status:', error);
    } finally {
        isPersisting = false;
    }

    if (pendingPersist) {
        pendingPersist = false;
        await persistStateNow();
    }
}

function schedulePersistState() {
    if (persistTimer) {
        return;
    }

    persistTimer = setTimeout(async () => {
        persistTimer = null;
        await persistStateNow();
    }, 120);
}

function applyLoadedState(loadedState) {
    if (!loadedState || typeof loadedState !== 'object') {
        return;
    }

    timerState.remainingSeconds = Math.max(0, Math.floor(toNumber(loadedState.remainingSeconds, 0)));
    timerState.subs = Math.max(0, Math.floor(toNumber(loadedState.subs, 0)));
    timerState.bits = Math.max(0, Math.floor(toNumber(loadedState.bits, 0)));
    timerState.happyHour = Boolean(loadedState.happyHour);
    timerState.eventSeconds = sanitizeEventSeconds(loadedState.eventSeconds);
    timerState.secondsPerSub = timerState.eventSeconds.primeT1;
    timerState.stateVersion = Math.max(0, Math.floor(toNumber(loadedState.stateVersion, 0)));
    timerState.isRunning = Boolean(loadedState.isRunning);
    timerState.updatedAt = Math.floor(toNumber(loadedState.updatedAt, Date.now()));

    if (timerState.isRunning) {
        const now = Date.now();
        const elapsedSeconds = Math.max(0, Math.floor((now - timerState.updatedAt) / 1000));
        timerState.remainingSeconds = Math.max(0, timerState.remainingSeconds - elapsedSeconds);
        if (timerState.remainingSeconds === 0) {
            timerState.isRunning = false;
        }
    }

    timerState.updatedAt = Date.now();
}

async function loadPersistedState() {
    try {
        const raw = await readFile(STATE_FILE_URL, 'utf8');
        const parsed = JSON.parse(raw);
        applyLoadedState(parsed);
        console.log('Timer-Status aus Datei geladen.');
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            console.error('Fehler beim Laden des Timer-Status:', error);
        }
    }
}

function applyAdjustment({ addSeconds = 0, addSubs = 0, addBits = 0, reason = 'unknown', debug = null }) {
    const safeSeconds = Number.isFinite(addSeconds) ? Math.max(0, Math.floor(addSeconds)) : 0;
    const safeSubs = Number.isFinite(addSubs) ? Math.max(0, Math.floor(addSubs)) : 0;
    const safeBits = Number.isFinite(addBits) ? Math.max(0, Math.floor(addBits)) : 0;

    timerState.remainingSeconds += safeSeconds;
    timerState.subs += safeSubs;
    timerState.bits += safeBits;

    if (safeSeconds > 0) {
        console.log(`Timer +${safeSeconds}s (${reason})`);
    }

    if (safeBits > 0) {
        console.log(`Bits +${safeBits} (${reason})`);
    }

    if (debug && typeof debug === 'object') {
        const eventLabel = normalizeKeyPart(debug.eventLabel || reason || 'event');
        const subSeconds = Math.max(0, Math.floor(toNumber(debug.subSeconds, 0)));
        const bombBonus = Math.max(0, Math.floor(toNumber(debug.bombBonus, 0)));
        const totalAdded = Math.max(0, Math.floor(toNumber(debug.totalAdded, safeSeconds)));

        console.log(`[DEBUG] ${eventLabel} | subSeconds=${subSeconds} | bombBonus=${bombBonus} | totalAdded=${totalAdded}`);
    }

    emitState();
}

setInterval(() => {
    if (!timerState.isRunning || timerState.remainingSeconds <= 0) {
        if (timerState.isRunning && timerState.remainingSeconds <= 0) {
            timerState.isRunning = false;
            timerState.remainingSeconds = 0;
            emitState();
        }
        return;
    }

    timerState.remainingSeconds -= 1;
    emitState();
}, 1000);

// 2. Verbindung zur Streamlabs API (Socket API)
const streamlabsToken = process.env.STREAMLABS_TOKEN;
const hasStreamlabsToken = typeof streamlabsToken === 'string' && streamlabsToken.trim().length > 0;

let slSocket;
if (hasStreamlabsToken) {
    slSocket = streamlabsClient(`https://sockets.streamlabs.com?token=${streamlabsToken}`, {
        transports: ['websocket']
    });
} else {
    console.warn('Kein STREAMLABS_TOKEN gesetzt: Streamlabs-Verbindung wird übersprungen.');
}

if (slSocket) {
    slSocket.on('connect', () => {
        console.log('Verbunden mit Streamlabs!');
    });
}

function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeEventSeconds(rawSettings) {
    const nextSettings = { ...DEFAULT_EVENT_SECONDS };

    for (const key of EVENT_SECONDS_KEYS) {
        nextSettings[key] = Math.max(0, Math.floor(toNumber(rawSettings?.[key], DEFAULT_EVENT_SECONDS[key])));
    }

    return nextSettings;
}

await loadPersistedState();
schedulePersistState();

function normalizeKeyPart(value) {
    if (value === undefined || value === null) {
        return '';
    }

    return String(value).trim();
}

function firstNonEmptyString(values) {
    for (const value of values) {
        const normalized = normalizeKeyPart(value);
        if (normalized.length > 0) {
            return normalized;
        }
    }

    return '';
}

function cleanupSeenEventKeys(now = Date.now()) {
    for (const [key, expiresAt] of seenEventKeys.entries()) {
        if (expiresAt <= now) {
            seenEventKeys.delete(key);
        }
    }
}

function cleanupMysteryGiftLinks(now = Date.now()) {
    for (let index = pendingMysteryGifts.length - 1; index >= 0; index -= 1) {
        const entry = pendingMysteryGifts[index];
        if (!entry || entry.expiresAt <= now || entry.remaining <= 0) {
            pendingMysteryGifts.splice(index, 1);
        }
    }
}

setInterval(() => {
    cleanupSeenEventKeys();
    cleanupMysteryGiftLinks();
}, DEDUPE_CLEANUP_MS);

function normalizeGifter(value) {
    return normalizeKeyPart(value).toLowerCase();
}

function rememberMysteryGift(gifter, amount) {
    const safeAmount = Math.max(1, Math.floor(toNumber(amount, 1)));
    const normalizedGifter = normalizeGifter(gifter);

    if (!normalizedGifter) {
        return;
    }

    pendingMysteryGifts.push({
        gifter: normalizedGifter,
        remaining: safeAmount,
        expiresAt: Date.now() + MYSTERY_GIFT_LINK_TTL_MS
    });
}

function consumeMysteryGiftChildSub(message) {
    const normalizedGifter = normalizeGifter(message?.gifter ?? message?.name);
    if (!normalizedGifter) {
        return false;
    }

    const now = Date.now();
    cleanupMysteryGiftLinks(now);

    const entry = pendingMysteryGifts.find((item) => item.gifter === normalizedGifter && item.remaining > 0 && item.expiresAt > now);
    if (!entry) {
        return false;
    }

    entry.remaining -= 1;
    return true;
}

function getTierCategory(message) {
    const rawPlan = normalizeKeyPart(message?.sub_plan ?? message?.subPlan).toLowerCase();
    const rawPlanName = normalizeKeyPart(message?.sub_plan_name ?? message?.subPlanName).toLowerCase();

    if (rawPlan === '3000' || rawPlanName.includes('tier 3') || rawPlanName.includes('tier3')) {
        return 't3';
    }

    if (rawPlan === '2000' || rawPlanName.includes('tier 2') || rawPlanName.includes('tier2')) {
        return 't2';
    }

    return 'primeT1';
}

function getSecondsForCategory(category) {
    const value = timerState.eventSeconds?.[category];
    const baseSeconds = Math.max(0, Math.floor(toNumber(value, 0)));
    const multiplier = timerState.happyHour ? 2 : 1;
    return baseSeconds * multiplier;
}

function getBombCategory(amount) {
    const safeAmount = Math.max(0, Math.floor(toNumber(amount, 0)));

    if (safeAmount === 10) {
        return 'bomb10';
    }
    if (safeAmount === 20) {
        return 'bomb20';
    }
    if (safeAmount === 50) {
        return 'bomb50';
    }
    if (safeAmount === 100) {
        return 'bomb100';
    }

    return null;
}

function normalizeSettingKey(value) {
    const normalized = normalizeKeyPart(value);
    return EVENT_SECONDS_KEYS.includes(normalized) ? normalized : null;
}

function buildDedupeInfo(eventData) {
    const message = eventData?.message?.[0] ?? {};

    const idKey = firstNonEmptyString([
        eventData?.event_id,
        message?.event_id,
        message?._id,
        eventData?._id
    ]);

    if (idKey) {
        return {
            key: `id:${idKey}`,
            ttlMs: DEDUPE_ID_TTL_MS
        };
    }

    const fingerprint = [
        normalizeKeyPart(eventData?.type),
        normalizeKeyPart(message?.type ?? message?.sub_type),
        normalizeKeyPart(message?.name),
        normalizeKeyPart(message?.gifter),
        normalizeKeyPart(message?.receiver),
        normalizeKeyPart(message?.amount),
        normalizeKeyPart(message?.months),
        normalizeKeyPart(message?.sub_plan)
    ].join('|');

    if (fingerprint.replace(/\|/g, '').length === 0) {
        return null;
    }

    return {
        key: `fp:${fingerprint}`,
        ttlMs: DEDUPE_FINGERPRINT_TTL_MS
    };
}

function isDuplicateStreamlabsEvent(eventData) {
    const dedupeInfo = buildDedupeInfo(eventData);
    if (!dedupeInfo) {
        return false;
    }

    const now = Date.now();
    const existingExpiresAt = seenEventKeys.get(dedupeInfo.key);

    if (existingExpiresAt && existingExpiresAt > now) {
        return true;
    }

    seenEventKeys.set(dedupeInfo.key, now + dedupeInfo.ttlMs);
    return false;
}

function mapStreamlabsEvent(eventData) {
    const message = eventData?.message?.[0] ?? {};
    const eventType = eventData?.type;
    const subType = message.type ?? message.sub_type;

    if (eventType === 'subscription') {
        const tierCategory = getTierCategory(message);
        const tierSeconds = getSecondsForCategory(tierCategory);

        if (subType === 'sub' || subType === 'resub') {
            return {
                addSeconds: tierSeconds,
                addSubs: 1,
                reason: `sub:${tierCategory}`,
                debug: {
                    eventLabel: `subscription:${subType}:${tierCategory}`,
                    subSeconds: tierSeconds,
                    bombBonus: 0,
                    totalAdded: tierSeconds
                }
            };
        }

        if (subType === 'subgift' || subType === 'gift_sub') {
            if (consumeMysteryGiftChildSub(message)) {
                return null;
            }

            return {
                addSeconds: tierSeconds,
                addSubs: 1,
                reason: `sub:${tierCategory}`,
                debug: {
                    eventLabel: `subscription:${subType}:${tierCategory}`,
                    subSeconds: tierSeconds,
                    bombBonus: 0,
                    totalAdded: tierSeconds
                }
            };
        }

        if (subType === 'community_gift') {
            const giftCount = Math.max(1, toNumber(message.repeat, 1));
            const bombCategory = getBombCategory(giftCount);
            const bombSeconds = bombCategory ? getSecondsForCategory(bombCategory) : 0;
            const totalSubSeconds = tierSeconds * giftCount;
            rememberMysteryGift(message?.gifter ?? message?.name, giftCount);

            return {
                addSeconds: totalSubSeconds + bombSeconds,
                addSubs: giftCount,
                reason: bombCategory ? `community_gift:${tierCategory}+${bombCategory}` : `community_gift:${tierCategory}`,
                debug: {
                    eventLabel: bombCategory ? `subscription:community_gift:${tierCategory}+${bombCategory}` : `subscription:community_gift:${tierCategory}`,
                    subSeconds: totalSubSeconds,
                    bombBonus: bombSeconds,
                    totalAdded: totalSubSeconds + bombSeconds
                }
            };
        }
    }

    if (eventType === 'subMysteryGift') {
        const amount = Math.max(1, toNumber(message.amount, 1));
        const tierCategory = getTierCategory(message);
        const tierSeconds = getSecondsForCategory(tierCategory);
        const bombCategory = getBombCategory(amount);
        const bombSeconds = bombCategory ? getSecondsForCategory(bombCategory) : 0;
        const totalSubSeconds = tierSeconds * amount;
        rememberMysteryGift(message?.gifter ?? message?.name, amount);

        return {
            addSeconds: totalSubSeconds + bombSeconds,
            addSubs: amount,
            reason: bombCategory ? `subMysteryGift:${tierCategory}+${bombCategory}` : `subMysteryGift:${tierCategory}`,
            debug: {
                eventLabel: bombCategory ? `subMysteryGift:${tierCategory}+${bombCategory}` : `subMysteryGift:${tierCategory}`,
                subSeconds: totalSubSeconds,
                bombBonus: bombSeconds,
                totalAdded: totalSubSeconds + bombSeconds
            }
        };
    }

    if (eventType === 'bits') {
        const bitsAmount = Math.max(0, Math.floor(toNumber(message.amount, 0)));
        if (bitsAmount > 0) {
            const bitsSeconds = getSecondsForCategory('bits');
            return {
                addSeconds: bitsSeconds,
                addBits: bitsAmount,
                reason: 'bits',
                debug: {
                    eventLabel: 'bits',
                    subSeconds: bitsSeconds,
                    bombBonus: 0,
                    totalAdded: bitsSeconds
                }
            };
        }
    }

    return null;
}

// 3. Auf Events von Streamlabs reagieren
if (slSocket) {
    slSocket.on('event', (eventData) => {
        if (isDuplicateStreamlabsEvent(eventData)) {
            console.log('Doppeltes Streamlabs-Event ignoriert.');
            return;
        }

        const adjustment = mapStreamlabsEvent(eventData);

        if (adjustment) {
            applyAdjustment(adjustment);
            return;
        }

        console.log('Nicht gemapptes Streamlabs-Event:', eventData?.type);
    });
}

// Optional: Nachrichten vom Frontend empfangen (z.B. manuelles Hinzufügen von Zeit)
io.on('connection', (socket) => {
    console.log('Frontend verbunden');

    socket.emit('timer-update', timerState);

    socket.on('request-state', () => {
        socket.emit('timer-update', timerState);
    });

    socket.on('timer-control', (payload) => {
        const action = payload?.action;

        if (action === 'start') {
            timerState.isRunning = true;
            emitState();
            return;
        }

        if (action === 'pause') {
            timerState.isRunning = false;
            emitState();
            return;
        }

        if (action === 'reset') {
            timerState.isRunning = false;
            timerState.remainingSeconds = 0;
            emitState();
            return;
        }

        if (action === 'set-time') {
            if (timerState.isRunning) {
                return;
            }

            const requestedSeconds = Math.max(0, Math.floor(toNumber(payload?.remainingSeconds, timerState.remainingSeconds)));
            timerState.remainingSeconds = requestedSeconds;
            emitState();
            return;
        }

        if (action === 'set-happy-hour') {
            timerState.happyHour = Boolean(payload?.happyHour);
            emitState();
            return;
        }
    });

    socket.on('settings-update', (payload) => {
        const settingKey = normalizeSettingKey(payload?.key);
        if (!settingKey) {
            return;
        }

        const settingValue = Math.max(0, Math.floor(toNumber(payload?.value, timerState.eventSeconds[settingKey])));
        timerState.eventSeconds[settingKey] = settingValue;
        timerState.secondsPerSub = timerState.eventSeconds.primeT1;
        emitState();
    });

    socket.on('manual-adjust', (data) => {
        console.log('Manuelle Korrektur:', data);
        applyAdjustment({
            addSeconds: data?.addSeconds,
            addSubs: data?.addSubs,
            addBits: data?.addBits,
            reason: data?.reason ?? 'manual-adjust'
        });
    });
});

async function shutdown() {
    if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
    }

    await persistStateNow();
    process.exit(0);
}

process.on('SIGINT', () => {
    void shutdown();
});

process.on('SIGTERM', () => {
    void shutdown();
});