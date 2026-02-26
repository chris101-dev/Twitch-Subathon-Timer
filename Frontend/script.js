const DEFAULT_SECONDS_PER_SUB = 300;

const timerElement = document.getElementById('timer');
const timerWrap = document.getElementById('timer-wrap');
const timerInput = document.getElementById('timerInput');
const subsElement = document.getElementById('subs');
const bitsElement = document.getElementById('bits');
const secondsPerSubElement = document.getElementById('seconds-per-sub');
const happyHourBtn = document.getElementById('happyHourBtn');
const connectionStatus = document.getElementById('connection-status');
const runStatus = document.getElementById('run-status');

const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resetBtn = document.getElementById('resetBtn');
const addSubBtn = document.getElementById('addSubBtn');
const settingsBtn = document.getElementById('settingsBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const settingsOverlay = document.getElementById('settingsOverlay');
const settingsPanel = document.getElementById('settingsPanel');
const settingsNumberInputs = document.querySelectorAll('.settings-grid input[type="number"]');
const settingsInputMap = {
    settingBits: 'bits',
    settingPrimeT1: 'primeT1',
    settingT2: 't2',
    settingT3: 't3',
    settingBomb10: 'bomb10',
    settingBomb20: 'bomb20',
    settingBomb50: 'bomb50',
    settingBomb100: 'bomb100'
};

let state = {
    remainingSeconds: 0,
    isRunning: false,
    subs: 0,
    bits: 0,
    happyHour: false,
    eventSeconds: {
        bits: 0,
        primeT1: DEFAULT_SECONDS_PER_SUB,
        t2: DEFAULT_SECONDS_PER_SUB,
        t3: DEFAULT_SECONDS_PER_SUB,
        bomb10: 0,
        bomb20: 0,
        bomb50: 0,
        bomb100: 0
    },
    stateVersion: 0,
    secondsPerSub: DEFAULT_SECONDS_PER_SUB
};

let isTimerEditing = false;
let latestStateVersion = -1;

function formatTime(totalSeconds) {
    const safeValue = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(safeValue / 3600);
    const minutes = Math.floor((safeValue % 3600) / 60);
    const seconds = safeValue % 60;

    const hourText = String(hours);
    const minuteText = String(minutes).padStart(2, '0');
    const secondText = String(seconds).padStart(2, '0');
    return `${hourText}:${minuteText}:${secondText}`;
}

function formatTimeForInput(totalSeconds) {
    const safeValue = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(safeValue / 3600);
    const minutes = Math.floor((safeValue % 3600) / 60);
    const seconds = safeValue % 60;

    const hourText = String(hours).padStart(3, '0').slice(-3);
    const minuteText = String(minutes).padStart(2, '0');
    const secondText = String(seconds).padStart(2, '0');
    return `${hourText}:${minuteText}:${secondText}`;
}

function maskTimerInputFromDigits(rawValue) {
    const digits = rawValue.replace(/\D/g, '').slice(0, 7);
    const hourDigits = digits.slice(0, 3);
    const minuteDigits = digits.slice(3, 5);
    const secondDigits = digits.slice(5, 7);

    let masked = hourDigits;
    if (digits.length > 3) {
        masked += `:${minuteDigits}`;
    }
    if (digits.length > 5) {
        masked += `:${secondDigits}`;
    }

    return masked;
}

function parseTimerInput(value) {
    const digitsOnly = value.replace(/\D/g, '');
    if (digitsOnly.length !== 7) {
        return null;
    }

    const hours = Number(digitsOnly.slice(0, 3));
    const minutes = Number(digitsOnly.slice(3, 5));
    const seconds = Number(digitsOnly.slice(5, 7));

    if (minutes > 59 || seconds > 59) {
        return null;
    }

    return (hours * 3600) + (minutes * 60) + seconds;
}

function setTimerEditing(isEditing) {
    isTimerEditing = isEditing;
    timerWrap.classList.toggle('editing', isEditing);

    if (isEditing) {
        timerInput.value = formatTimeForInput(state.remainingSeconds);
        timerInput.focus();
        timerInput.select();
    }
}

function syncSettingsInputs() {
    Object.entries(settingsInputMap).forEach(([inputId, settingKey]) => {
        const inputElement = document.getElementById(inputId);
        if (!inputElement || document.activeElement === inputElement) {
            return;
        }

        const value = state.eventSeconds?.[settingKey];
        inputElement.value = Number.isFinite(value) && value > 0 ? String(value) : '';
    });
}

function updateRunStatus(isRunning) {
    runStatus.textContent = isRunning ? 'Läuft' : 'Pausiert';
    runStatus.classList.toggle('running', isRunning);
    runStatus.classList.toggle('paused', !isRunning);
}

function render(nextState) {
    if (typeof nextState?.stateVersion === 'number') {
        if (nextState.stateVersion < latestStateVersion) {
            return;
        }
        latestStateVersion = nextState.stateVersion;
    }

    state = {
        ...state,
        ...nextState,
        eventSeconds: {
            ...state.eventSeconds,
            ...(nextState?.eventSeconds ?? {})
        }
    };

    timerElement.textContent = formatTime(state.remainingSeconds);
    subsElement.textContent = String(state.subs);
    bitsElement.textContent = String(state.bits);
    secondsPerSubElement.textContent = `${state.eventSeconds.primeT1}s`;
    happyHourBtn.classList.toggle('on', Boolean(state.happyHour));
    happyHourBtn.setAttribute('aria-pressed', String(Boolean(state.happyHour)));
    updateRunStatus(state.isRunning);
    timerElement.classList.toggle('editable', !state.isRunning);
    syncSettingsInputs();

    if (state.isRunning && isTimerEditing) {
        setTimerEditing(false);
    }
}

function setConnectionBadge(isOnline) {
    connectionStatus.textContent = isOnline ? 'Online' : 'Offline';
    connectionStatus.classList.toggle('online', isOnline);
    connectionStatus.classList.toggle('offline', !isOnline);
}

function setSettingsOpen(isOpen) {
    settingsOverlay.classList.toggle('hidden', !isOpen);
    settingsOverlay.setAttribute('aria-hidden', String(!isOpen));
    settingsBtn.setAttribute('aria-expanded', String(isOpen));
}

settingsBtn.addEventListener('click', () => {
    setSettingsOpen(true);
});

closeSettingsBtn.addEventListener('click', () => {
    setSettingsOpen(false);
});

settingsOverlay.addEventListener('click', (event) => {
    if (event.target === settingsOverlay) {
        setSettingsOpen(false);
    }
});

settingsPanel.addEventListener('click', (event) => {
    event.stopPropagation();
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        setSettingsOpen(false);
    }
});

settingsNumberInputs.forEach((input) => {
    input.addEventListener('input', () => {
        input.value = input.value.replace(/[^0-9]/g, '');
    });

    input.addEventListener('change', () => {
        const settingKey = settingsInputMap[input.id];
        if (!settingKey) {
            return;
        }

        const safeValue = Math.max(0, Math.floor(Number(input.value || '0')));

        socket?.emit('settings-update', {
            key: settingKey,
            value: safeValue
        });

        if (!socket) {
            render({
                eventSeconds: {
                    [settingKey]: safeValue
                }
            });
        }
    });
});

timerElement.addEventListener('click', () => {
    if (!state.isRunning) {
        setTimerEditing(true);
    }
});

timerInput.addEventListener('input', () => {
    timerInput.value = maskTimerInputFromDigits(timerInput.value);
});

function submitTimerInput() {
    const parsedSeconds = parseTimerInput(timerInput.value);
    if (parsedSeconds === null || state.isRunning) {
        timerInput.value = formatTimeForInput(state.remainingSeconds);
        setTimerEditing(false);
        return;
    }

    socket?.emit('timer-control', {
        action: 'set-time',
        remainingSeconds: parsedSeconds
    });

    if (!socket) {
        render({ remainingSeconds: parsedSeconds });
    }

    setTimerEditing(false);
}

timerInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        submitTimerInput();
        return;
    }

    if (event.key === 'Escape') {
        timerInput.value = formatTimeForInput(state.remainingSeconds);
        setTimerEditing(false);
    }
});

timerInput.addEventListener('blur', () => {
    if (isTimerEditing) {
        submitTimerInput();
    }
});

const canUseSocket = typeof window.io === 'function';
let socket = null;

if (canUseSocket) {
    socket = window.io('http://localhost:3000');

    socket.on('connect', () => {
        setConnectionBadge(true);
        socket.emit('request-state');
    });

    socket.on('disconnect', () => {
        setConnectionBadge(false);
    });

    socket.on('timer-update', (payload) => {
        render(payload);
    });
} else {
    console.warn('Socket.io-Client nicht verfügbar. Frontend läuft im Standalone-Modus.');
    setConnectionBadge(false);
}

startBtn.addEventListener('click', () => {
    socket?.emit('timer-control', { action: 'start' });
});

pauseBtn.addEventListener('click', () => {
    socket?.emit('timer-control', { action: 'pause' });
});

resetBtn.addEventListener('click', () => {
    socket?.emit('timer-control', { action: 'reset' });
});

addSubBtn.addEventListener('click', () => {
    socket?.emit('manual-adjust', {
        reason: 'manual-test-sub',
        addSeconds: state.eventSeconds.primeT1,
        addSubs: 1
    });
});

happyHourBtn.addEventListener('click', () => {
    const nextHappyHour = !Boolean(state.happyHour);

    socket?.emit('timer-control', {
        action: 'set-happy-hour',
        happyHour: nextHappyHour
    });

    if (!socket) {
        render({ happyHour: nextHappyHour });
    }
});

render(state);
setSettingsOpen(false);
