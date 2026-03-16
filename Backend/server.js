import 'dotenv/config';
import { createServer } from 'node:http';
import { extname } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { Server } from 'socket.io';
import { io as streamlabsClient } from 'socket.io-client';

const PORT = 3000;
const DEFAULT_SECONDS_PER_SUB = 600;
const DEFAULT_SECONDS_PER_100_BITS = 120;
const DEFAULT_T2_SECONDS = 900;
const DEFAULT_T3_SECONDS = 1800;
const DEFAULT_BOMB10_SECONDS = 1800;
const DEFAULT_BOMB20_SECONDS = 3600;
const DEFAULT_BOMB50_SECONDS = 7200;
const DEFAULT_BOMB100_SECONDS = 14400;
const DEFAULT_EVENT_SECONDS = {
    bits: DEFAULT_SECONDS_PER_100_BITS,
    primeT1: DEFAULT_SECONDS_PER_SUB,
    t2: DEFAULT_T2_SECONDS,
    t3: DEFAULT_T3_SECONDS,
    bomb10: DEFAULT_BOMB10_SECONDS,
    bomb20: DEFAULT_BOMB20_SECONDS,
    bomb50: DEFAULT_BOMB50_SECONDS,
    bomb100: DEFAULT_BOMB100_SECONDS
};
const EVENT_SECONDS_KEYS = Object.keys(DEFAULT_EVENT_SECONDS);
const DEDUPE_ID_TTL_MS = 24 * 60 * 60 * 1000;
const DEDUPE_FINGERPRINT_TTL_MS = 15 * 1000;
const DEDUPE_CLEANUP_MS = 60 * 1000;
const MYSTERY_GIFT_LINK_TTL_MS = 120 * 1000;
const STATE_FILE_URL = new URL('./timer-state.json', import.meta.url);
const TIMER_TEXT_URL = new URL('./timer.txt', import.meta.url);
const FRONTEND_ROOT_URL = new URL('../Frontend/', import.meta.url);
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon'
};

const ANSI = {
    reset: '\x1b[0m',
    orange: '\x1b[38;5;208m',
    white: '\x1b[97m',
    gray: '\x1b[37m',
    green: '\x1b[92m',
    yellow: '\x1b[93m',
    red: '\x1b[91m',
    cyan: '\x1b[96m'
};

const USE_COLOR_LOGS = process.env.NO_COLOR !== '1';

function colorize(colorName, text) {
    const safeText = String(text ?? '');
    if (!USE_COLOR_LOGS) {
        return safeText;
    }

    const colorCode = ANSI[colorName] ?? ANSI.gray;
    return `${colorCode}${safeText}${ANSI.reset}`;
}

function getLogTimestamp() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

function colorizeTextWithNumbers(text, baseColor = 'gray') {
    return String(text ?? '')
        .split(/(\d+)/)
        .filter((part) => part.length > 0)
        .map((part) => (/^\d+$/.test(part) ? colorize('green', part) : colorize(baseColor, part)))
        .join('');
}

function formatLogPrefix(tag) {
    return `${colorize('orange', `[${getLogTimestamp()}]`)} ${colorize('white', `[${String(tag ?? 'LOG').toUpperCase()}]`)}`;
}

function logLine(tag, message) {
    console.log(`${formatLogPrefix(tag)} ${colorizeTextWithNumbers(message, 'gray')}`);
}

function logWarn(tag, message) {
    console.warn(`${formatLogPrefix(tag)} ${colorizeTextWithNumbers(message, 'yellow')}`);
}

function logError(tag, message, error) {
    const details = error ? ` ${colorizeTextWithNumbers(error?.message ?? error, 'gray')}` : '';
    console.error(`${formatLogPrefix(tag)} ${colorize('red', String(message ?? 'Fehler'))}${details}`);
}

function getFieldBaseColor(key, valueText) {
    const normalizedKey = String(key ?? '').toLowerCase();
    const normalizedValue = String(valueText ?? '').toLowerCase();

    if (normalizedKey === 'status') {
        if (normalizedValue.includes('error') || normalizedValue.includes('failed')) {
            return 'red';
        }

        if (normalizedValue.includes('ignored') || normalizedValue.includes('ack')) {
            return 'yellow';
        }

        return 'cyan';
    }

    if (normalizedKey === 'action' || normalizedKey === 'event' || normalizedKey === 'type' || normalizedKey === 'subtype') {
        return 'cyan';
    }

    return 'gray';
}

function formatLogField(key, value) {
    const rawValue = String(value ?? '-').replace(/\s+/g, '_');
    const baseColor = getFieldBaseColor(key, rawValue);
    return `${colorize('gray', key)}=${colorizeTextWithNumbers(rawValue, baseColor)}`;
}

function getMimeType(pathname) {
    return MIME_TYPES[extname(pathname).toLowerCase()] ?? 'application/octet-stream';
}

async function handleHttpRequest(req, res) {
    try {
        const requestUrl = new URL(req.url ?? '/', 'http://localhost');
        const pathname = decodeURIComponent(requestUrl.pathname);

        // Socket.io verarbeitet seinen eigenen Request-Pfad.
        if (pathname.startsWith('/socket.io/')) {
            return;
        }

        let frontendPath = pathname;
        if (frontendPath === '/') {
            frontendPath = '/index.html';
        }

        if (frontendPath.includes('..') || frontendPath.includes('\0')) {
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Bad request');
            return;
        }

        const fileUrl = new URL(`.${frontendPath}`, FRONTEND_ROOT_URL);
        if (!fileUrl.href.startsWith(FRONTEND_ROOT_URL.href)) {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Forbidden');
            return;
        }

        const fileBuffer = await readFile(fileUrl);
        res.writeHead(200, {
            'Content-Type': getMimeType(frontendPath),
            'Cache-Control': 'no-cache'
        });
        res.end(fileBuffer);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not found');
            return;
        }

        logError('HTTP', 'Fehler beim Ausliefern des Frontends', error);
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Internal server error');
    }
}

const httpServer = createServer((req, res) => {
    void handleHttpRequest(req, res);
});

// 1. Lokaler Socket.io Server für dein Frontend (Port 3000)
const io = new Server(httpServer, {
    cors: { origin: "*" } // Erlaubt Zugriff vom Browser
});

httpServer.listen(PORT, () => {
    logLine('SERVER', `Lokaler Server läuft auf Port ${PORT}`);
});

const timerState = {
    remainingSeconds: 0,
    isRunning: false,
    subs: 0,
    bits: 0,
    subBombs: 0,
    streamlabsConnected: false,
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

function formatTimerValue(totalSeconds) {
    const safeValue = Math.max(0, Math.floor(toNumber(totalSeconds, 0)));
    const hours = Math.floor(safeValue / 3600);
    const minutes = Math.floor((safeValue % 3600) / 60);
    const seconds = safeValue % 60;
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function logEventLine(scope, fields = {}) {
    const payload = Object.entries(fields)
        .map(([key, value]) => formatLogField(key, value))
        .join(' ');

    if (payload.length > 0) {
        console.log(`${formatLogPrefix(scope)} ${payload}`);
        return;
    }

    console.log(formatLogPrefix(scope));
}

async function writeTimerTextFile() {
    try {
        await writeFile(TIMER_TEXT_URL, `${formatTimerValue(timerState.remainingSeconds)}\n`, 'utf8');
    } catch (error) {
        logError('FILE', 'Fehler beim Schreiben von timer.txt', error);
    }
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
        logError('STATE', 'Fehler beim Speichern des Timer-Status', error);
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
    timerState.subBombs = Math.max(0, Math.floor(toNumber(loadedState.subBombs, 0)));
    timerState.streamlabsConnected = false;
    timerState.happyHour = Boolean(loadedState.happyHour);
    timerState.eventSeconds = sanitizeEventSeconds(loadedState.eventSeconds);
    timerState.secondsPerSub = timerState.eventSeconds.primeT1;
    timerState.stateVersion = Math.max(0, Math.floor(toNumber(loadedState.stateVersion, 0)));
    timerState.isRunning = false;
    timerState.updatedAt = Math.floor(toNumber(loadedState.updatedAt, Date.now()));

    timerState.updatedAt = Date.now();
}

async function loadPersistedState() {
    try {
        const raw = await readFile(STATE_FILE_URL, 'utf8');
        const parsed = JSON.parse(raw);
        applyLoadedState(parsed);
        logLine('STATE', 'Timer-Status aus Datei geladen');
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            logError('STATE', 'Fehler beim Laden des Timer-Status', error);
        }
    }
}

function applyAdjustment({ addSeconds = 0, addSubs = 0, addBits = 0, addSubBombs = 0, reason = 'unknown', debug = null }) {
    const safeSeconds = Number.isFinite(addSeconds) ? Math.max(0, Math.floor(addSeconds)) : 0;
    const safeSubs = Number.isFinite(addSubs) ? Math.max(0, Math.floor(addSubs)) : 0;
    const safeBits = Number.isFinite(addBits) ? Math.max(0, Math.floor(addBits)) : 0;
    const safeSubBombs = Number.isFinite(addSubBombs) ? Math.max(0, Math.floor(addSubBombs)) : 0;

    timerState.remainingSeconds += safeSeconds;
    timerState.subs += safeSubs;
    timerState.bits += safeBits;
    timerState.subBombs += safeSubBombs;

    const eventLabel = normalizeKeyPart(debug?.eventLabel || reason || 'event') || 'event';
    const subSeconds = Math.max(0, Math.floor(toNumber(debug?.subSeconds, safeSeconds)));
    const bombBonus = Math.max(0, Math.floor(toNumber(debug?.bombBonus, 0)));
    const totalAdded = Math.max(0, Math.floor(toNumber(debug?.totalAdded, safeSeconds)));

    logEventLine('ADD', {
        event: eventLabel,
        sec: safeSeconds,
        subs: safeSubs,
        bits: safeBits,
        bombs: safeSubBombs,
        subSeconds,
        bombBonus,
        totalAdded,
        timer: formatTimerValue(timerState.remainingSeconds)
    });

    emitState();
}

setInterval(() => {
    if (!timerState.isRunning || timerState.remainingSeconds <= 0) {
        if (timerState.isRunning && timerState.remainingSeconds <= 0) {
            timerState.isRunning = false;
            timerState.remainingSeconds = 0;
            void writeTimerTextFile();
            emitState();
        }
        return;
    }

    timerState.remainingSeconds -= 1;
    void writeTimerTextFile();
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
    logWarn('STREAMLABS', 'Kein STREAMLABS_TOKEN gesetzt: Streamlabs-Verbindung wird übersprungen');
}

if (slSocket) {
    slSocket.on('connect', () => {
        timerState.streamlabsConnected = true;
        logLine('STREAMLABS', 'Verbunden mit Streamlabs');
        emitState();
    });

    slSocket.on('disconnect', () => {
        timerState.streamlabsConnected = false;
        logWarn('STREAMLABS', 'Verbindung zu Streamlabs getrennt');
        emitState();
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
                addSubBombs: 1,
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
            addSubBombs: 1,
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
            const bitsSecondsPerHundred = getSecondsForCategory('bits');
            const wholeHundreds = Math.floor(bitsAmount / 100);
            const totalBitsSeconds = bitsSecondsPerHundred * wholeHundreds;

            return {
                addSeconds: totalBitsSeconds,
                addBits: bitsAmount,
                reason: 'bits',
                debug: {
                    eventLabel: 'bits',
                    subSeconds: totalBitsSeconds,
                    bombBonus: 0,
                    totalAdded: totalBitsSeconds
                }
            };
        }
    }

    return null;
}

// 3. Auf Events von Streamlabs reagieren
if (slSocket) {
    slSocket.on('event', (eventData) => {
        const eventType = normalizeKeyPart(eventData?.type) || 'unknown';
        const subType = normalizeKeyPart(eventData?.message?.[0]?.type ?? eventData?.message?.[0]?.sub_type) || '-';

        if (isDuplicateStreamlabsEvent(eventData)) {
            logEventLine('STREAMLABS', { status: 'duplicate_ignored', type: eventType, subType });
            return;
        }

        const adjustment = mapStreamlabsEvent(eventData);

        if (adjustment) {
            applyAdjustment(adjustment);
            return;
        }

        logEventLine('STREAMLABS', { status: 'ack_unmapped', type: eventType, subType });
    });
}

// Optional: Nachrichten vom Frontend empfangen (z.B. manuelles Hinzufügen von Zeit)
io.on('connection', (socket) => {
    logLine('SOCKET', 'Frontend verbunden');

    socket.emit('timer-update', timerState);

    socket.on('request-state', () => {
        socket.emit('timer-update', timerState);
    });

    socket.on('timer-control', (payload) => {
        const action = payload?.action;

        logEventLine('CONTROL', { action: normalizeKeyPart(action) || 'unknown' });

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
            timerState.subs = 0;
            timerState.bits = 0;
            timerState.subBombs = 0;
            timerState.happyHour = false;
            void writeTimerTextFile();
            emitState();
            return;
        }

        if (action === 'set-time') {
            if (timerState.isRunning) {
                return;
            }

            const requestedSeconds = Math.max(0, Math.floor(toNumber(payload?.remainingSeconds, timerState.remainingSeconds)));
            timerState.remainingSeconds = requestedSeconds;
            void writeTimerTextFile();
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
            logEventLine('SETTINGS', { status: 'ignored_invalid_key' });
            return;
        }

        const settingValue = Math.max(0, Math.floor(toNumber(payload?.value, timerState.eventSeconds[settingKey])));
        timerState.eventSeconds[settingKey] = settingValue;
        timerState.secondsPerSub = timerState.eventSeconds.primeT1;
        logEventLine('SETTINGS', { key: settingKey, value: settingValue });
        emitState();
    });

    socket.on('manual-adjust', (data) => {
        const safeReason = normalizeKeyPart(data?.reason) || 'manual-adjust';
        const safeSeconds = Math.max(0, Math.floor(toNumber(data?.addSeconds, 0)));
        const safeSubs = Math.max(0, Math.floor(toNumber(data?.addSubs, 0)));
        const safeBits = Math.max(0, Math.floor(toNumber(data?.addBits, 0)));
        const safeBombs = Math.max(0, Math.floor(toNumber(data?.addSubBombs, 0)));

        logEventLine('MANUAL', {
            reason: safeReason,
            sec: safeSeconds,
            subs: safeSubs,
            bits: safeBits,
            bombs: safeBombs
        });

        applyAdjustment({
            addSeconds: safeSeconds,
            addSubs: safeSubs,
            addBits: safeBits,
            addSubBombs: safeBombs,
            reason: safeReason
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