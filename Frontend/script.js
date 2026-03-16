const DEFAULT_SECONDS_PER_SUB = 600;

const timerElement = document.getElementById('timer');
const timerWrap = document.getElementById('timer-wrap');
const timerInput = document.getElementById('timerInput');
const subsElement = document.getElementById('subs');
const bitsElement = document.getElementById('bits');
const subBombsElement = document.getElementById('sub-bombs');
const secondsPerSubElement = document.getElementById('seconds-per-sub');
const happyHourBtn = document.getElementById('happyHourBtn');
const connectionStatus = document.getElementById('connection-status');
const streamlabsStatus = document.getElementById('streamlabs-status');
const runStatus = document.getElementById('run-status');

const runToggleBtn = document.getElementById('runToggleBtn');
const manualTimeAddInput = document.getElementById('manualTimeAddInput');
const resetBtn = document.getElementById('resetBtn');
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
    subBombs: 0,
    streamlabsConnected: false,
    happyHour: false,
    eventSeconds: {
        bits: 120,
        primeT1: DEFAULT_SECONDS_PER_SUB,
        t2: 900,
        t3: 1800,
        bomb10: 1800,
        bomb20: 3600,
        bomb50: 7200,
        bomb100: 14400
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

function maskManualAddInputFromDigits(rawValue) {
    const digits = rawValue.replace(/\D/g, '').slice(0, 5);
    if (digits.length === 0) {
        return '';
    }

    let masked = digits.slice(0, 1);

    if (digits.length > 1) {
        masked += `:${digits.slice(1, Math.min(3, digits.length))}`;
    }

    if (digits.length > 3) {
        masked += `:${digits.slice(3, 5)}`;
    }

    return masked;
}

function parseManualAddInput(value) {
    const match = /^(\d):(\d{2}):(\d{2})$/.exec(value.trim());
    if (!match) {
        return null;
    }

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);

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
    subBombsElement.textContent = String(state.subBombs);
    secondsPerSubElement.textContent = `${state.eventSeconds.primeT1}s`;
    happyHourBtn.classList.toggle('on', Boolean(state.happyHour));
    happyHourBtn.setAttribute('aria-pressed', String(Boolean(state.happyHour)));
    streamlabsStatus.classList.toggle('online', Boolean(state.streamlabsConnected));
    streamlabsStatus.classList.toggle('offline', !state.streamlabsConnected);
    runToggleBtn.textContent = state.isRunning ? 'Pause' : 'Start';
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
    socket = window.io();

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

runToggleBtn.addEventListener('click', () => {
    const nextAction = state.isRunning ? 'pause' : 'start';
    socket?.emit('timer-control', { action: nextAction });

    if (!socket) {
        render({ isRunning: !state.isRunning });
    }
});

resetBtn.addEventListener('click', () => {
    const confirmed = window.confirm('Moechtest du wirklich alles zuruecksetzen? Timer, Subs, Bits, Sub-Bombs und Happy Hour werden zurueckgesetzt.');
    if (!confirmed) {
        return;
    }

    socket?.emit('timer-control', { action: 'reset' });

    if (!socket) {
        render({
            isRunning: false,
            remainingSeconds: 0,
            subs: 0,
            bits: 0,
            subBombs: 0,
            happyHour: false
        });
    }
});

manualTimeAddInput.addEventListener('input', () => {
    manualTimeAddInput.value = maskManualAddInputFromDigits(manualTimeAddInput.value);
    manualTimeAddInput.classList.remove('input-error');
});

function setManualAddInputError() {
    manualTimeAddInput.classList.add('input-error');
    manualTimeAddInput.value = '';
    manualTimeAddInput.focus();
}

function submitManualAddTime() {
    const parsedSeconds = parseManualAddInput(manualTimeAddInput.value);
    if (parsedSeconds === null || parsedSeconds <= 0) {
        setManualAddInputError();
        return;
    }

    manualTimeAddInput.classList.remove('input-error');

    socket?.emit('manual-adjust', {
        reason: 'manual-time-add',
        addSeconds: parsedSeconds
    });

    if (!socket) {
        render({ remainingSeconds: state.remainingSeconds + parsedSeconds });
    }

    manualTimeAddInput.value = '';
}

manualTimeAddInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        submitManualAddTime();
    }
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
