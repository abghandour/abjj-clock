
/**
 * Converts a non-negative integer of total seconds to a MM:SS zero-padded string.
 * @param {number} totalSeconds - Non-negative integer (0–5999)
 * @returns {string} Formatted time string in MM:SS format
 */
function formatTime(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Converts minutes and seconds to total seconds.
 * @param {number} minutes - Number of minutes
 * @param {number} seconds - Number of seconds
 * @returns {number} Total seconds
 */
function parseTimeInput(minutes, seconds) {
  return (minutes * 60) + seconds;
}

/**
 * Validates whether a string contains only digit characters.
 * @param {string} str - The string to validate
 * @returns {boolean} True if the string is non-empty and contains only digits 0-9
 */
function isNumeric(str) {
  return /^\d+$/.test(str);
}

/**
 * Generate an array of round durations (in seconds) for training presets.
 * @param {'pyramid'|'ladder_up'|'ladder_down'} mode
 * @param {number} numRounds - Number of rounds (>= 2 for meaningful variation)
 * @param {number} totalTrainingSec - Total training time available for rounds
 * @returns {number[]} Array of round durations in seconds, each >= 1
 */
function generateRoundDurations(mode, numRounds, totalTrainingSec) {
  if (numRounds <= 0) return [];
  if (numRounds === 1) {
    const snapped = Math.round(Math.max(totalTrainingSec, 30) / 30) * 30;
    return [Math.max(snapped, 30)];
  }

  const n = numRounds;
  // Weights determine proportional distribution
  let weights;

  if (mode === 'ladder_down') {
    // Longest first, shortest last: n, n-1, ..., 1
    weights = [];
    for (let i = 0; i < n; i++) weights.push(n - i);
  } else if (mode === 'ladder_up') {
    // Shortest first, longest last: 1, 2, ..., n
    weights = [];
    for (let i = 0; i < n; i++) weights.push(i + 1);
  } else if (mode === 'inv_pyramid') {
    // Inverted pyramid: longest at edges, shortest in center
    weights = [];
    for (let i = 0; i < n; i++) {
      const distFromCenter = Math.abs(i - (n - 1) / 2);
      weights.push(distFromCenter + 1);
    }
  } else {
    // Pyramid: 1, 2, ..., peak, ..., 2, 1
    weights = [];
    for (let i = 0; i < n; i++) {
      const distFromEdge = Math.min(i, n - 1 - i);
      weights.push(distFromEdge + 1);
    }
  }

  const totalWeight = weights.reduce((a, b) => a + b, 0);

  // Snap each duration to the nearest 30-second boundary (minimum 30s).
  // This may cause the total to drift slightly from totalTrainingSec — that's intentional.
  const durations = weights.map(w => {
    const raw = (w / totalWeight) * totalTrainingSec;
    const snapped = Math.round(raw / 30) * 30;
    return Math.max(snapped, 30);
  });

  return durations;
}

// --- Constants ---

const STORAGE_KEY = 'bjj-timer-config';

const DEFAULT_CONFIG = {
  roundDurationSec: 300,
  restDurationSec: 60,
  numRounds: 0,
  prepDurationSec: 0
};

// App-wide configurable settings (overridden by config.json at runtime)
const APP_SETTINGS = {
  scheduleEnabled: localStorage.getItem('bjj-timer-schedule-enabled') !== 'false',
  alertThresholdSec: 5,
  audio: {
    countdownBeepFrequency: 800,
    countdownBeepDuration: 0.3,
    prepBeepBaseFrequency: 500,
    prepBeepFrequencyStep: 100,
    prepBeepDuration: 0.15,
    endOfRoundFrequency: 400,
    endOfRoundDuration: 0.5,
    endOfRestFrequency: 600,
    endOfRestDuration: 0.5,
    fanfareNotes: [523, 659, 784],
    fanfareNoteDuration: 0.3,
    fanfareNoteGap: 0.12,
    volume: 1.0
  },
  competitionPresets: {
    'Kids (under 15)': { roundDurationSec: 240, restDurationSec: 60, numRounds: 0 },
    'White Belt': { roundDurationSec: 300, restDurationSec: 60, numRounds: 0 },
    'Blue Belt': { roundDurationSec: 360, restDurationSec: 60, numRounds: 0 },
    'Purple Belt': { roundDurationSec: 420, restDurationSec: 60, numRounds: 0 },
    'Brown Belt': { roundDurationSec: 480, restDurationSec: 60, numRounds: 0 },
    'Black Belt': { roundDurationSec: 600, restDurationSec: 60, numRounds: 0 }
  },
  weather: {
    enabled: true,
    latitude: 38.9187,
    longitude: -77.2311,
    units: 'fahrenheit',
    pollIntervalMin: 10
  }
};

/**
 * Applies config.json settings onto APP_SETTINGS and DEFAULT_CONFIG.
 * @param {Object} data - Parsed config.json object
 */
function applyConfigSettings(data) {
  if (!data || typeof data !== 'object') return;

  // Override default timer config
  if (data.defaults && typeof data.defaults === 'object') {
    const d = data.defaults;
    if (typeof d.roundDurationSec === 'number') DEFAULT_CONFIG.roundDurationSec = d.roundDurationSec;
    if (typeof d.restDurationSec === 'number') DEFAULT_CONFIG.restDurationSec = d.restDurationSec;
    if (typeof d.numRounds === 'number') DEFAULT_CONFIG.numRounds = d.numRounds;
    if (typeof d.prepDurationSec === 'number') DEFAULT_CONFIG.prepDurationSec = d.prepDurationSec;
    if (typeof d.alertThresholdSec === 'number') APP_SETTINGS.alertThresholdSec = d.alertThresholdSec;
  }

  // Override audio settings
  if (data.audio && typeof data.audio === 'object') {
    const a = data.audio;
    const s = APP_SETTINGS.audio;
    if (typeof a.countdownBeepFrequency === 'number') s.countdownBeepFrequency = a.countdownBeepFrequency;
    if (typeof a.countdownBeepDuration === 'number') s.countdownBeepDuration = a.countdownBeepDuration;
    if (typeof a.prepBeepBaseFrequency === 'number') s.prepBeepBaseFrequency = a.prepBeepBaseFrequency;
    if (typeof a.prepBeepFrequencyStep === 'number') s.prepBeepFrequencyStep = a.prepBeepFrequencyStep;
    if (typeof a.prepBeepDuration === 'number') s.prepBeepDuration = a.prepBeepDuration;
    if (typeof a.endOfRoundFrequency === 'number') s.endOfRoundFrequency = a.endOfRoundFrequency;
    if (typeof a.endOfRoundDuration === 'number') s.endOfRoundDuration = a.endOfRoundDuration;
    if (typeof a.endOfRestFrequency === 'number') s.endOfRestFrequency = a.endOfRestFrequency;
    if (typeof a.endOfRestDuration === 'number') s.endOfRestDuration = a.endOfRestDuration;
    if (Array.isArray(a.fanfareNotes)) s.fanfareNotes = a.fanfareNotes;
    if (typeof a.fanfareNoteDuration === 'number') s.fanfareNoteDuration = a.fanfareNoteDuration;
    if (typeof a.fanfareNoteGap === 'number') s.fanfareNoteGap = a.fanfareNoteGap;
    if (typeof a.volume === 'number') s.volume = a.volume;
  }

  // Override competition presets
  if (data.competitionPresets && typeof data.competitionPresets === 'object') {
    APP_SETTINGS.competitionPresets = {};
    for (const [name, preset] of Object.entries(data.competitionPresets)) {
      if (preset && typeof preset === 'object') {
        APP_SETTINGS.competitionPresets[name] = {
          roundDurationSec: typeof preset.roundDurationSec === 'number' ? preset.roundDurationSec : 300,
          restDurationSec: typeof preset.restDurationSec === 'number' ? preset.restDurationSec : 60,
          numRounds: typeof preset.numRounds === 'number' ? preset.numRounds : 1
        };
      }
    }
  }

  // Override weather settings
  if (data.weather && typeof data.weather === 'object') {
    const w = data.weather;
    const s = APP_SETTINGS.weather;
    if (typeof w.enabled === 'boolean') s.enabled = w.enabled;
    if (typeof w.latitude === 'number') s.latitude = w.latitude;
    if (typeof w.longitude === 'number') s.longitude = w.longitude;
    if (typeof w.units === 'string' && (w.units === 'fahrenheit' || w.units === 'celsius')) s.units = w.units;
    if (typeof w.pollIntervalMin === 'number') s.pollIntervalMin = w.pollIntervalMin;
  }
}

const PHASES = {
  IDLE: 'IDLE',
  PREP: 'PREP',
  ROUND: 'ROUND',
  REST: 'REST'
};

// --- StorageManager ---

class StorageManager {
  /**
   * Saves a TimerConfig object to localStorage.
   * @param {Object} config - The TimerConfig to persist
   */
  static save(config) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (e) {
      // localStorage unavailable (private browsing, storage full, etc.)
      // Silently continue with in-memory only
    }
  }

  /**
   * Loads a TimerConfig from localStorage.
   * Returns defaults if data is missing, corrupted, or localStorage is unavailable.
   * @returns {Object} A valid TimerConfig object
   */
  static load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) {
        return { ...DEFAULT_CONFIG };
      }
      const parsed = JSON.parse(raw);
      return {
        roundDurationSec: typeof parsed.roundDurationSec === 'number' ? parsed.roundDurationSec : DEFAULT_CONFIG.roundDurationSec,
        restDurationSec: typeof parsed.restDurationSec === 'number' ? parsed.restDurationSec : DEFAULT_CONFIG.restDurationSec,
        numRounds: typeof parsed.numRounds === 'number' ? parsed.numRounds : DEFAULT_CONFIG.numRounds,
        prepDurationSec: typeof parsed.prepDurationSec === 'number' ? parsed.prepDurationSec : DEFAULT_CONFIG.prepDurationSec
      };
    } catch (e) {
      // JSON.parse failed (corrupted data) or localStorage unavailable
      return { ...DEFAULT_CONFIG };
    }
  }
}

// --- TimerState ---

/**
 * Creates a new TimerState object, initialized from StorageManager or defaults.
 * @param {Object} [config] - Optional config override. If omitted, loads from StorageManager.
 * @returns {Object} A TimerState object
 */
function createTimerState(config) {
  const cfg = config || StorageManager.load();
  return {
    config: { ...cfg },
    phase: PHASES.IDLE,
    remainingSec: cfg.roundDurationSec,
    currentRound: 0,
    intervalId: null,
    roundDurations: null, // Array of per-round durations for training presets, or null for uniform
    restDurations: null, // Array of per-round rest durations for chainsaw preset, or null for uniform
    paused: false
  };
}

// --- TimerEngine ---

/**
 * Manages the tick loop and state machine transitions for the BJJ timer.
 * @param {Object} state - A TimerState object
 * @param {function} onTick - Called every second with the current state
 * @param {function} onPhaseChange - Called on phase transitions with (state, oldPhase, newPhase)
 */
class TimerEngine {
  constructor(state, onTick, onPhaseChange) {
    this.state = state;
    this.onTick = onTick || function() {};
    this.onPhaseChange = onPhaseChange || function() {};
  }

  /**
   * Begin a session. Always starts with a 5-second prep countdown with audio cues,
   * then transitions to ROUND with an uplifting fanfare.
   * If prepDurationSec is configured to a higher value, that value is used instead.
   * If already running (not IDLE), the call is ignored.
   */
  start() {
    if (this.state.phase !== PHASES.IDLE) {
      return;
    }

    const oldPhase = this.state.phase;
    const prepDuration = this.state.config.prepDurationSec;

    if (prepDuration > 0) {
      // Start with prep countdown
      this.state.phase = PHASES.PREP;
      this.state.remainingSec = prepDuration;
      this.state.currentRound = 0;
      this.onPhaseChange(this.state, oldPhase, this.state.phase);
    } else {
      // Skip prep, go straight to round
      this.state.phase = PHASES.ROUND;
      const rd = this.state.roundDurations;
      this.state.remainingSec = rd ? Math.max(rd[0], 1) : Math.max(this.state.config.roundDurationSec, 1);
      this.state.currentRound = 1;
      this.onPhaseChange(this.state, oldPhase, this.state.phase);
    }

    this.state.intervalId = setInterval(() => {
      this.tick();
    }, 1000);
  }

  /**
   * Stop the session. Transitions any phase → IDLE, clears the interval,
   * resets remainingSec to config.roundDurationSec and currentRound to 0.
   */
  stop() {
    if (this.state.intervalId !== null) {
      clearInterval(this.state.intervalId);
      this.state.intervalId = null;
    }

    const oldPhase = this.state.phase;
    this.state.phase = PHASES.IDLE;
    // Reset remaining to first round duration (or config default)
    const rd = this.state.roundDurations;
    this.state.remainingSec = rd ? rd[0] : this.state.config.roundDurationSec;
    this.state.currentRound = 0;
    this.state.paused = false;

    if (oldPhase !== PHASES.IDLE) {
      this.onPhaseChange(this.state, oldPhase, this.state.phase);
    }
  }

  /**
   * Pause the running timer. Clears the interval but preserves all state.
   * No-op if IDLE or already paused.
   */
  pause() {
    if (this.state.phase === PHASES.IDLE || this.state.paused) return;
    if (this.state.intervalId !== null) {
      clearInterval(this.state.intervalId);
      this.state.intervalId = null;
    }
    this.state.paused = true;
  }

  /**
   * Resume a paused timer. Restarts the interval.
   * No-op if not paused.
   */
  resume() {
    if (!this.state.paused) return;
    this.state.paused = false;
    this.state.intervalId = setInterval(() => {
      this.tick();
    }, 1000);
  }

  /**
   * Decrement remainingSec by 1. At 0, handle state machine transitions.
   * Returns an alert signal object for the caller to trigger audio/visual alerts.
   * @returns {{ type: 'none'|'countdown'|'end_round'|'end_rest', remainingSec: number }}
   */
  tick() {
    if (this.state.phase === PHASES.IDLE) {
      return { type: 'none', remainingSec: this.state.remainingSec };
    }

    this.state.remainingSec--;

    const phase = this.state.phase;
    let alertType = 'none';

    // Alert logic: only for ROUND and REST phases
    if (phase === PHASES.ROUND || phase === PHASES.REST) {
      if (this.state.remainingSec >= 1 && this.state.remainingSec <= APP_SETTINGS.alertThresholdSec) {
        alertType = 'countdown';
      } else if (this.state.remainingSec === 0) {
        alertType = phase === PHASES.ROUND ? 'end_round' : 'end_rest';
      }
    }

    const alert = { type: alertType, remainingSec: this.state.remainingSec };

    // Handle transitions when remainingSec reaches 0
    if (this.state.remainingSec === 0) {
      const oldPhase = this.state.phase;

      if (oldPhase === PHASES.PREP) {
        // PREP → ROUND
        this.state.phase = PHASES.ROUND;
        const rd = this.state.roundDurations;
        this.state.remainingSec = rd ? Math.max(rd[0], 1) : Math.max(this.state.config.roundDurationSec, 1);
        this.state.currentRound = 1;
        this.onPhaseChange(this.state, oldPhase, this.state.phase);

      } else if (oldPhase === PHASES.ROUND) {
        const numRounds = this.state.roundDurations ? this.state.roundDurations.length : this.state.config.numRounds;
        const isLastRound = numRounds > 0 && this.state.currentRound >= numRounds;

        if (isLastRound) {
          // Last round in limited mode — skip rest, go straight to IDLE
          this.stop();
        } else {
0          // Check if rest duration is 0 — skip rest, go directly to next round
          const restIdx = this.state.currentRound - 1;
          const rd = this.state.restDurations;
          const restSec = rd ? rd[restIdx % rd.length] : this.state.config.restDurationSec;

          if (restSec <= 0) {
            // Skip REST, go straight to next ROUND (no beep)
            alert.type = 'none';
            this.state.phase = PHASES.ROUND;
            const roundDurations = this.state.roundDurations;
            const nextRoundIdx = this.state.currentRound;
            this.state.remainingSec = roundDurations ? Math.max(roundDurations[nextRoundIdx % roundDurations.length], 1) : Math.max(this.state.config.roundDurationSec, 1);
            this.state.currentRound++;
            this.onPhaseChange(this.state, oldPhase, this.state.phase);
          } else {
            // ROUND → REST
            this.state.phase = PHASES.REST;
            this.state.remainingSec = Math.max(restSec, 1);
            this.onPhaseChange(this.state, oldPhase, this.state.phase);
          }
        }

      } else if (oldPhase === PHASES.REST) {
        const numRounds = this.state.roundDurations ? this.state.roundDurations.length : this.state.config.numRounds;
        if (numRounds === 0 || this.state.currentRound < numRounds) {
          // REST → ROUND (more rounds remain or unlimited)
          this.state.phase = PHASES.ROUND;
          const rd = this.state.roundDurations;
          const nextRoundIdx = this.state.currentRound; // 0-based index for next round
          this.state.remainingSec = rd ? Math.max(rd[nextRoundIdx % rd.length], 1) : Math.max(this.state.config.roundDurationSec, 1);
          this.state.currentRound++;
          this.onPhaseChange(this.state, oldPhase, this.state.phase);
        } else {
          // REST → IDLE (all rounds done)
          this.stop();
        }
      }
    }

    this.onTick(this.state);

    return alert;
  }
}

// --- AudioManager ---

/**
 * Generates beep tones using the Web Audio API.
 * Lazy-initializes AudioContext on first user gesture.
 * All oscillator calls are wrapped in try/catch — audio is disabled silently on failure.
 */
class AudioManager {
  constructor() {
    this.audioCtx = null;
    this.disabled = false;
  }

  /**
   * Lazily initializes the AudioContext. Call on first user gesture.
   * If creation fails, disables audio silently.
   */
  _ensureContext() {
    if (this.disabled) return false;
    if (!this.audioCtx) {
      try {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        this.disabled = true;
        return false;
      }
    }
    // Resume suspended context (may have been created before user gesture)
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return true;
  }

  /**
   * Plays a tone with the given frequency and duration.
   * @param {number} frequency - Frequency in Hz
   * @param {number} duration - Duration in seconds
   */
  _playTone(frequency, duration) {
    try {
      if (!this._ensureContext()) return;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      const vol = APP_SETTINGS.audio.volume;
      const now = this.audioCtx.currentTime;
      osc.type = 'sine';
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(vol, now);
      gain.gain.setValueAtTime(vol, now + Math.max(0, duration - 0.05));
      gain.gain.linearRampToValueAtTime(0, now + duration);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(now);
      osc.stop(now + duration);
    } catch (e) {
      this.disabled = true;
    }
  }

  /**
   * Short beep for countdown (configurable frequency/duration).
   */
  playCountdownBeep() {
    this._playTone(APP_SETTINGS.audio.countdownBeepFrequency, APP_SETTINGS.audio.countdownBeepDuration);
  }

  /**
   * Beep during prep countdown (rising pitch based on seconds remaining).
   * @param {number} remainingSec - Seconds left in prep (1-5)
   */
  playPrepBeep(remainingSec, totalPrepSec) {
    const freq = APP_SETTINGS.audio.prepBeepBaseFrequency + (totalPrepSec - remainingSec) * APP_SETTINGS.audio.prepBeepFrequencyStep;
    this._playTone(freq, APP_SETTINGS.audio.prepBeepDuration);
  }

  /**
   * Boxing ring bell to signal round start — 3 quick strikes.
   */
  playRoundStartFanfare() {
    try {
      const audio = new Audio('boxing-bell-single-loud.mp3');
      audio.volume = APP_SETTINGS.audio.volume;
      audio.play();
    } catch (e) {
      // Silently disable on failure
    }
  }

  /**
   * Boxing ring bell to signal end of round — single strike.
   */
  playEndOfRoundBeep() {
    try {
      const audio = new Audio('boxing-bell-loud.mp3');
      audio.volume = APP_SETTINGS.audio.volume;
      audio.play().catch(e => console.warn('End-of-round audio play failed:', e));
    } catch (e) {
      console.warn('End-of-round audio error:', e);
    }
  }

  /**
   * Synthesize a single boxing bell strike using layered oscillators.
   * @param {number} startTime - AudioContext time to start
   * @param {number} vol - Volume (0-1)
   * @param {number} duration - Decay duration in seconds
   */
  _playBellStrike(startTime, vol, duration) {
    if (!this.audioCtx) return;
    // Layer two detuned oscillators for a metallic bell timbre
    const freqs = [1200, 1500];
    freqs.forEach(freq => {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, startTime);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(startTime);
      osc.stop(startTime + duration);
    });
    // Add a short high-frequency click for attack
    const click = this.audioCtx.createOscillator();
    const clickGain = this.audioCtx.createGain();
    click.type = 'square';
    click.frequency.value = 3000;
    clickGain.gain.setValueAtTime(vol * 0.3, startTime);
    clickGain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.03);
    click.connect(clickGain);
    clickGain.connect(this.audioCtx.destination);
    click.start(startTime);
    click.stop(startTime + 0.05);
  }

  /**
   * Tone for rest end (configurable frequency/duration).
   */
  playEndOfRestBeep() {
    this._playTone(APP_SETTINGS.audio.endOfRestFrequency, APP_SETTINGS.audio.endOfRestDuration);
  }

  /**
   * Loud, repeating descending ring to signal end of class.
   * Plays G5 → E5 → C5 pattern three times so it's unmissable.
   */
  playEndOfClassRing() {
    try {
      const audio = new Audio('boxing-bell-single-loud.mp3');
      audio.volume = APP_SETTINGS.audio.volume;
      audio.play().catch(e => console.warn('End-of-class audio play failed:', e));
    } catch (e) {
      console.warn('End-of-class audio error:', e);
    }
  }

  /**
   * Play a short muffled thud sound for pause/resume transitions.
   */
  playMuffle() {
    try {
      if (!this._ensureContext()) return;
      const ctx = this.audioCtx;
      const now = ctx.currentTime;
      const vol = APP_SETTINGS.audio.volume;

      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.value = 150;

      filter.type = 'lowpass';
      filter.frequency.value = 300;
      filter.Q.value = 1;

      gain.gain.setValueAtTime(vol * 1.5, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.15);
    } catch (e) {
      // Silently disable on failure
    }
  }

  /**
   * Play a short descending tone for stop/reset actions.
   */
  playCancel() {
    try {
      if (!this._ensureContext()) return;
      const ctx = this.audioCtx;
      const now = ctx.currentTime;
      const vol = APP_SETTINGS.audio.volume;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, now);
      osc.frequency.exponentialRampToValueAtTime(150, now + 0.2);

      gain.gain.setValueAtTime(vol * 1.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.25);
    } catch (e) {
      // Silently disable on failure
    }
  }
}

// --- Renderer ---

/**
 * Updates the DOM based on current timer state.
 * References DOM elements by ID (expected to exist in the HTML).
 */
class Renderer {
  constructor() {
    this.clockEl = document.getElementById('clock');
    this.dayOfWeekEl = document.getElementById('day-of-week');
    this.temperatureEl = document.getElementById('temperature');
    this.roundTimerEl = document.getElementById('round-timer');
    this.restTimerEl = document.getElementById('rest-timer');
    this.roundLabelEl = document.getElementById('round-label');
    this.restLabelEl = document.getElementById('rest-label');
    this.roundCounterEl = document.getElementById('round-counter');
    this.prepOverlayEl = document.getElementById('prep-overlay');
    this.prepCountdownEl = document.getElementById('prep-countdown');
    this.screenFlashEl = document.getElementById('screen-flash');
    this.pauseOverlayEl = document.getElementById('pause-overlay');
    this.roundsOverEl = document.getElementById('rounds-over');
    this.scheduleDisplayEl = document.getElementById('schedule-display');
    this.roundListEl = document.getElementById('round-list');
    this.nextClassDisplayEl = document.getElementById('next-class-display');
    this.restSectionEl = document.getElementById('rest-section');
    this.clockAreaEl = document.getElementById('top-right-bar');
    this.roundSectionEl = document.getElementById('round-section');
    this.presetLabelEl = document.getElementById('preset-label');
    this.stealth = false;
  }

  /**
   * Update the round timer text and active styling.
   * @param {number} remainingSec - Seconds remaining
   * @param {boolean} isActive - Whether the round phase is currently active
   */
  updateRoundDisplay(remainingSec, isActive) {
    if (this.roundTimerEl) {
      const mins = String(Math.floor(remainingSec / 60)).padStart(2, '0');
      const secs = String(remainingSec % 60).padStart(2, '0');
      this.roundTimerEl.innerHTML =
        `<span class="ts-minutes">${mins}</span>:<span class="ts-seconds">${secs}</span>`;
    }
    if (this.roundLabelEl) {
      this.roundLabelEl.style.opacity = isActive ? '1' : '0.5';
    }
    if (this.roundTimerEl) {
      this.roundTimerEl.style.opacity = isActive ? '1' : '0.4';
    }
    if (this.roundSectionEl) {
      this.roundSectionEl.classList.toggle('active', isActive);
      const spans = this.roundTimerEl ? this.roundTimerEl.querySelectorAll('.ts-minutes, .ts-seconds') : [];
      if (isActive && remainingSec <= 10) {
        this.roundTimerEl.style.backgroundColor = 'var(--accent-yellow)';
        this.roundTimerEl.style.borderColor = 'var(--accent-yellow)';
        spans.forEach(s => s.style.borderColor = 'var(--accent-yellow)');
      } else {
        this.roundTimerEl.style.backgroundColor = '';
        this.roundTimerEl.style.borderColor = '';
        spans.forEach(s => s.style.borderColor = '');
      }
    }
  }

  /**
   * Update the rest timer text and active styling.
   * @param {number} remainingSec - Seconds remaining
   * @param {boolean} isActive - Whether the rest phase is currently active
   */
  updateRestDisplay(remainingSec, isActive) {
    if (this.restTimerEl) {
      const mins = String(Math.floor(remainingSec / 60)).padStart(2, '0');
      const secs = String(remainingSec % 60).padStart(2, '0');
      this.restTimerEl.innerHTML =
        `<span class="ts-minutes">${mins}</span>:<span class="ts-seconds">${secs}</span>`;
    }
    if (this.restLabelEl) {
      this.restLabelEl.style.opacity = isActive ? '1' : '0.5';
    }
    if (this.restTimerEl) {
      this.restTimerEl.style.opacity = isActive ? '1' : '0.4';
    }
    if (this.restSectionEl) {
      this.restSectionEl.classList.toggle('active', isActive);
    }
  }

  /**
   * Update the wall clock display in HH:MM:SS format with day of week.
   */
  updateClockDisplay() {
    const now = new Date();
    if (this.clockEl) {
      const time = now.toLocaleTimeString('en-US', { hour12: true });
      const match = time.match(/^(.*\s?)(AM|PM)$/i);
      if (match) {
        const timePart = match[1].trim();
        const lastColon = timePart.lastIndexOf(':');
        const hhmm = timePart.substring(0, lastColon);
        const ss = timePart.substring(lastColon);
        this.clockEl.innerHTML = `${hhmm}<span class="clock-seconds">${ss}</span> <span class="clock-ampm">${match[2]}</span>`;
      } else {
        this.clockEl.textContent = time;
      }
    }
    if (this.dayOfWeekEl) {
      this.dayOfWeekEl.textContent = now.toLocaleDateString('en-US', { weekday: 'long' });
    }
  }

  /**
   * Update the temperature display.
   * @param {string} text - Temperature text to display (e.g. "72°F")
   */
  updateTemperature(text) {
    if (this.temperatureEl) {
      this.temperatureEl.textContent = text;
      this.temperatureEl.style.display = text ? '' : 'none';
    }
  }

  /**
   * Show the prep countdown overlay with the given remaining seconds.
   * @param {number} remainingSec - Seconds remaining in prep
   */
  showPrepCountdown(remainingSec) {
    if (this.prepOverlayEl) {
      this.prepOverlayEl.classList.add('active');
    }
    if (this.prepCountdownEl) {
      this.prepCountdownEl.textContent = remainingSec;
    }
  }

  /**
   * Hide the prep countdown overlay.
   */
  hidePrepCountdown() {
    if (this.prepOverlayEl) {
      this.prepOverlayEl.classList.remove('active');
    }
  }

  /**
   * Apply a CSS flash animation on a timer element (for last 5 seconds).
   * @param {HTMLElement} element - The DOM element to flash
   */
  applyFlash(element) {
    if (!element) return;
    element.classList.remove('flashing');
    // Force reflow to restart animation
    void element.offsetWidth;
    element.classList.add('flashing');
  }

  /**
   * Trigger a full-screen flash at 0:00 transitions.
   */
  applyScreenFlash() {
    if (!this.screenFlashEl) return;
    this.screenFlashEl.classList.remove('active');
    void this.screenFlashEl.offsetWidth;
    this.screenFlashEl.classList.add('active');
  }

  /**
   * Show the translucent pause overlay with pause icon.
   */
  showPauseOverlay() {
    if (this.pauseOverlayEl) this.pauseOverlayEl.classList.add('active');
  }

  /**
   * Hide the pause overlay.
   */
  hidePauseOverlay() {
    if (this.pauseOverlayEl) this.pauseOverlayEl.classList.remove('active');
  }

  /**
   * Show end-of-session announcement. Auto-hides after 3 seconds.
   * @param {string} [message] - Custom message text (defaults to "Rounds Over")
   */
  showRoundsOver(message) {
    if (!this.roundsOverEl) return;
    const textEl = this.roundsOverEl.querySelector('.rounds-over-text');
    if (textEl) textEl.textContent = message || 'Rounds Over';
    this.roundsOverEl.classList.add('active');
    setTimeout(() => {
      this.hideRoundsOver();
    }, 3000);
  }

  /**
   * Hide the "Rounds Over" announcement.
   */
  hideRoundsOver() {
    if (this.roundsOverEl) this.roundsOverEl.classList.remove('active');
  }

  /**
   * Enter quick timer mode: hide rest section and round counter, change label to "Timer".
   */
  setQuickTimerMode() {
    if (this.restSectionEl) this.restSectionEl.style.visibility = 'hidden';
    if (this.roundCounterEl) this.roundCounterEl.style.visibility = 'hidden';
    if (this.roundLabelEl) this.roundLabelEl.textContent = 'Timer';
  }

  /**
   * Exit quick timer mode: restore rest section, round counter, and label.
   */
  clearQuickTimerMode() {
    if (this.restSectionEl) this.restSectionEl.style.visibility = '';
    if (this.roundCounterEl) this.roundCounterEl.style.visibility = '';
    if (this.roundLabelEl) this.roundLabelEl.textContent = 'Round';
  }

  /**
   * Toggle stealth mode. Hides all clocks and timers except the rest timer during REST.
   */
  toggleStealth() {
    this.stealth = !this.stealth;
    this.applyStealth();
  }

  /**
   * Apply current stealth visibility state to DOM elements.
   * @param {string} [phase] - Current timer phase (optional, used to show rest during REST)
   */
  applyStealth(phase) {
    const hidden = this.stealth ? 'hidden' : '';
    if (this.clockAreaEl) this.clockAreaEl.style.visibility = hidden;
    const topCenterBar = document.getElementById('top-center-bar');
    if (topCenterBar) topCenterBar.style.visibility = hidden;
    if (this.roundSectionEl) this.roundSectionEl.style.visibility = hidden;
    if (this.roundCounterEl) this.roundCounterEl.style.visibility = hidden;
    if (this.prepCountdownEl) this.prepCountdownEl.style.visibility = hidden;
    if (this.presetLabelEl) this.presetLabelEl.style.visibility = hidden;
    // Hide class time and class progress
    const classTimeEl = this.scheduleDisplayEl ? this.scheduleDisplayEl.querySelector('.class-time') : null;
    if (classTimeEl) classTimeEl.style.visibility = hidden;
    const classProgressEl = document.getElementById('class-progress');
    if (classProgressEl) classProgressEl.style.visibility = hidden;
    // Hide round list, next class display, and bottom-left info
    if (this.roundListEl) this.roundListEl.style.visibility = hidden;
    if (this.nextClassDisplayEl) this.nextClassDisplayEl.style.visibility = hidden;
    const bottomLeftInfo = document.getElementById('bottom-left-info');
    if (bottomLeftInfo) bottomLeftInfo.style.visibility = hidden;
    // Rest section: visible during REST phase even in stealth
    if (this.restSectionEl) {
      this.restSectionEl.style.visibility = (this.stealth && phase !== PHASES.REST) ? 'hidden' : '';
    }
    // Stealth hint message
    const stealthHint = document.getElementById('stealth-hint');
    if (stealthHint) stealthHint.style.display = this.stealth ? 'block' : 'none';
    // Highlight stealth label in help menu
    const stealthLabel = document.getElementById('stealth-label');
    if (stealthLabel) {
      stealthLabel.style.color = this.stealth ? 'var(--accent-green)' : '';
    }
  }

  /**
   * Update the Start/Stop label based on timer phase.
   * @param {boolean} running - True if timer is running (not IDLE)
   */
  updateStartStopLabel(running) {
    const enterLabel = document.getElementById('start-stop-label');
    if (enterLabel) enterLabel.textContent = running ? 'Pause' : 'Start';
    const helpMenu = document.getElementById('help-menu');
    if (helpMenu) {
      if (running) {
        helpMenu.classList.add('timer-running');
      } else {
        helpMenu.classList.remove('timer-running');
      }
    }
  }

  /**
   * Display current round / total rounds.
   * Shows "Round 3 / 5" for limited rounds, "Round 3" for unlimited (total === 0).
   * Shows empty string when currentRound is 0 (IDLE state).
   * @param {number} current - Current round number (1-based, 0 when idle)
   * @param {number} total - Total rounds (0 = unlimited)
   */
  updateRoundCounter(current, total) {
    if (!this.roundCounterEl) return;
    if (current === 0) {
      // Idle state: show repeat icon if unlimited, or round count if set
      if (total === 0) {
        this.roundCounterEl.innerHTML =
          `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-0.15em;margin-right:0.3em;"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>Repeat`;
      } else {
        this.roundCounterEl.textContent = `${total} round${total > 1 ? 's' : ''}`;
      }
      return;
    }
    if (total === 0) {
      this.roundCounterEl.textContent = `Round ${current}`;
    } else {
      this.roundCounterEl.textContent = `Round ${current} / ${total}`;
    }
  }

  /**
   * Update the preset label above the round timer.
   * Shows the preset name with an icon, or "Custom" with a gear icon.
   * @param {string|null} name - Preset name or null for custom
   */
  updatePresetLabel(name) {
    if (!this.presetLabelEl) return;
    const _s = 'width="1.2em" height="1.2em" viewBox="0 0 24 24"';

    if (!name) {
      // Custom gear icon
      const gear = `<svg ${_s} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
      this.presetLabelEl.innerHTML = `${gear}Custom`;
      return;
    }

    const lower = name.toLowerCase();

    // Belt icon helper
    const beltIcon = (color) =>
      `<svg ${_s} fill="none"><rect x="1" y="9" width="22" height="6" rx="1" fill="${color}" stroke="${color === '#ffffff' ? '#888' : color}" stroke-width="0.5"/><rect x="10" y="7" width="4" height="10" rx="1" fill="${color}" stroke="${color === '#ffffff' ? '#888' : 'rgba(0,0,0,0.3)'}" stroke-width="0.5"/><line x1="12" y1="17" x2="11" y2="21" stroke="${color === '#ffffff' ? '#888' : color}" stroke-width="1.5" stroke-linecap="round"/><line x1="12" y1="17" x2="13" y2="21" stroke="${color === '#ffffff' ? '#888' : color}" stroke-width="1.5" stroke-linecap="round"/></svg>`;
    const kidsIcon = `<svg ${_s} fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="3"/><path d="M12 8v6"/><path d="M9 21l3-7 3 7"/><path d="M7 13l5 2 5-2"/></svg>`;

    // Training icons
    const chainsawIcon = `<svg ${_s} fill="currentColor"><rect x="2" y="14" width="3" height="8" rx="0.5"/><rect x="7" y="6" width="3" height="16" rx="0.5"/><rect x="12" y="14" width="3" height="8" rx="0.5"/><rect x="17" y="6" width="3" height="16" rx="0.5"/></svg>`;
    const pyramidIcon = `<svg ${_s} fill="currentColor"><rect x="1" y="16" width="3" height="6" rx="0.5"/><rect x="5.5" y="11" width="3" height="11" rx="0.5"/><rect x="10" y="5" width="3" height="17" rx="0.5"/><rect x="14.5" y="11" width="3" height="11" rx="0.5"/><rect x="19" y="16" width="3" height="6" rx="0.5"/></svg>`;
    const invPyramidIcon = `<svg ${_s} fill="currentColor"><rect x="1" y="5" width="3" height="17" rx="0.5"/><rect x="5.5" y="11" width="3" height="11" rx="0.5"/><rect x="10" y="16" width="3" height="6" rx="0.5"/><rect x="14.5" y="11" width="3" height="11" rx="0.5"/><rect x="19" y="5" width="3" height="17" rx="0.5"/></svg>`;
    const ladderUpIcon = `<svg ${_s} fill="currentColor"><rect x="2" y="18" width="3" height="4" rx="0.5"/><rect x="7" y="14" width="3" height="8" rx="0.5"/><rect x="12" y="9" width="3" height="13" rx="0.5"/><rect x="17" y="4" width="3" height="18" rx="0.5"/></svg>`;
    const ladderDownIcon = `<svg ${_s} fill="currentColor"><rect x="2" y="4" width="3" height="18" rx="0.5"/><rect x="7" y="9" width="3" height="13" rx="0.5"/><rect x="12" y="14" width="3" height="8" rx="0.5"/><rect x="17" y="18" width="3" height="4" rx="0.5"/></svg>`;

    let icon = '';
    if (lower === 'quick timer') icon = `<svg ${_s} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    else if (lower.includes('kid') || lower.includes('child')) icon = kidsIcon;
    else if (lower.includes('white')) icon = beltIcon('#ffffff');
    else if (lower.includes('blue')) icon = beltIcon('#1e90ff');
    else if (lower.includes('purple')) icon = beltIcon('#9b30ff');
    else if (lower.includes('brown')) icon = beltIcon('#8B4513');
    else if (lower.includes('black')) icon = beltIcon('#222222');
    else if (lower === 'chainsaw') icon = chainsawIcon;
    else if (lower === 'pyramid') icon = pyramidIcon;
    else if (lower.includes('inv')) icon = invPyramidIcon;
    else if (lower.includes('ladder up')) icon = ladderUpIcon;
    else if (lower.includes('ladder down')) icon = ladderDownIcon;
    else if (lower === 'tabata') icon = `<svg ${_s} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`;
    else icon = '';

    this.presetLabelEl.innerHTML = `${icon}${name}`;
  }

  /**
   * Show the round list panel with per-round durations.
   * Highlights the current round and dims past rounds.
   * @param {number[]} durations - Array of round durations in seconds
   * @param {number} currentRound - Current round (1-based, 0 = idle/prep)
   * @param {string} [presetName] - Optional preset name to show as header
   */
  updateRoundList(durations, currentRound, presetName, restDurations, restDurationSec, remainingClassSec) {
    if (!this.roundListEl) return;
    if (!durations || durations.length === 0) {
      this.roundListEl.classList.remove('active');
      this.roundListEl.innerHTML = '';
      return;
    }
    this.roundListEl.classList.add('active');
    let html = '';
    if (presetName) {
      const _s = 'width="1.2em" height="1.2em" viewBox="0 0 24 24" style="vertical-align:-0.2em;margin-right:0.4em;"';
      let icon = '';
      const lower = presetName.toLowerCase();
      if (lower === 'pyramid') {
        icon = `<svg ${_s} fill="currentColor"><rect x="1" y="16" width="3" height="6" rx="0.5"/><rect x="5.5" y="11" width="3" height="11" rx="0.5"/><rect x="10" y="5" width="3" height="17" rx="0.5"/><rect x="14.5" y="11" width="3" height="11" rx="0.5"/><rect x="19" y="16" width="3" height="6" rx="0.5"/></svg>`;
      } else if (lower === 'ladder up') {
        icon = `<svg ${_s} fill="currentColor"><rect x="2" y="18" width="3" height="4" rx="0.5"/><rect x="7" y="14" width="3" height="8" rx="0.5"/><rect x="12" y="9" width="3" height="13" rx="0.5"/><rect x="17" y="4" width="3" height="18" rx="0.5"/></svg>`;
      } else if (lower === 'ladder down') {
        icon = `<svg ${_s} fill="currentColor"><rect x="2" y="4" width="3" height="18" rx="0.5"/><rect x="7" y="9" width="3" height="13" rx="0.5"/><rect x="12" y="14" width="3" height="8" rx="0.5"/><rect x="17" y="18" width="3" height="4" rx="0.5"/></svg>`;
      } else if (lower === 'chainsaw') {
        icon = `<svg ${_s} fill="currentColor"><rect x="2" y="14" width="3" height="8" rx="0.5"/><rect x="7" y="6" width="3" height="16" rx="0.5"/><rect x="12" y="14" width="3" height="8" rx="0.5"/><rect x="17" y="6" width="3" height="16" rx="0.5"/></svg>`;
      } else if (lower === 'inv. pyramid') {
        icon = `<svg ${_s} fill="currentColor"><rect x="1" y="5" width="3" height="17" rx="0.5"/><rect x="5.5" y="11" width="3" height="11" rx="0.5"/><rect x="10" y="16" width="3" height="6" rx="0.5"/><rect x="14.5" y="11" width="3" height="11" rx="0.5"/><rect x="19" y="5" width="3" height="17" rx="0.5"/></svg>`;
      }
      const totalSec = durations.reduce((a, b) => a + b, 0);
      const totalMin = Math.round(totalSec / 60);
      html += `<div style="color:var(--accent-green);font-weight:700;margin-bottom:0.5em;">${icon}${presetName} <span style="font-weight:400;color:var(--text-muted);font-size:0.8em;">${totalMin}m</span></div>`;
    }

    // Calculate cumulative end time for each round to find overtime
    let overtimeMinutes = []; // per-round: 0 if not overtime, else minutes over
    if (remainingClassSec > 0) {
      let cumulative = 0;
      for (let i = 0; i < durations.length; i++) {
        if (i > 0) {
          const restIdx = i - 1;
          cumulative += restDurations ? restDurations[restIdx % restDurations.length] : (restDurationSec || 0);
        }
        cumulative += durations[i];
        if (cumulative > remainingClassSec) {
          overtimeMinutes.push(Math.ceil((cumulative - remainingClassSec) / 60));
        } else {
          overtimeMinutes.push(0);
        }
      }
    }

    durations.forEach((dur, i) => {
      const roundNum = i + 1;
      let cls = 'round-item';
      if (roundNum < currentRound) cls += ' past';
      else if (roundNum === currentRound) cls += ' current';
      const ot = overtimeMinutes[i] || 0;
      const overtimeTag = ot > 0 ? ` <span class="overtime-badge">${ot}m overtime</span>` : '';
      html += `<div class="${cls}"><span class="round-num">R${roundNum}</span> ${formatTime(dur)}${overtimeTag}</div>`;
    });
    this.roundListEl.innerHTML = html;
  }

  /**
   * Get remaining seconds in the current active class from the schedule display.
   * @returns {number} Remaining seconds, or 0 if no active class.
   */
  getRemainingClassSec() {
    const scheduleEl = document.getElementById('schedule-display');
    const classTimeEl = scheduleEl ? scheduleEl.querySelector('.class-time') : null;
    if (!classTimeEl) return 0;
    const text = classTimeEl.textContent;
    const hMatch = text.match(/(\d+)h/);
    const mMatch = text.match(/(\d+)m/);
    if (!hMatch && !mMatch) return 0;
    return ((hMatch ? parseInt(hMatch[1], 10) : 0) * 60 + (mMatch ? parseInt(mMatch[1], 10) : 0)) * 60;
  }

  /**
   * Hide the round list panel.
   */
  hideRoundList() {
    if (!this.roundListEl) return;
    this.roundListEl.classList.remove('active');
    this.roundListEl.innerHTML = '';
  }

  /**
   * Update the next class display in the bottom-left corner.
   * Shows title, start time, and countdown until it starts.
   * @param {Object|null} nextClass - The next upcoming ClassEntry or null
   */
  updateNextClassDisplay(nextClass) {
    if (!this.nextClassDisplayEl) return;
    if (!nextClass) {
      this.nextClassDisplayEl.innerHTML = '';
      return;
    }

    const now = new Date();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const todayName = dayNames[now.getDay()];
    const [startH, startM] = nextClass.startTime.split(':').map(Number);

    // Calculate minutes until class starts
    let minutesUntil = 0;
    if (nextClass.dayOfWeek === todayName) {
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const startMin = startH * 60 + startM;
      minutesUntil = startMin - nowMin;
      if (minutesUntil < 0) minutesUntil += 7 * 24 * 60; // next week
    } else {
      const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      const todayIdx = dayOrder.indexOf(todayName);
      const classIdx = dayOrder.indexOf(nextClass.dayOfWeek);
      let daysAhead = classIdx - todayIdx;
      if (daysAhead <= 0) daysAhead += 7;
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const startMin = startH * 60 + startM;
      minutesUntil = daysAhead * 24 * 60 + (startMin - nowMin);
    }

    const hours = Math.floor(minutesUntil / 60);
    const mins = minutesUntil % 60;
    let countdownStr;
    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      const remH = hours % 24;
      countdownStr = `in ${days}d ${remH}h`;
    } else if (hours > 0) {
      countdownStr = `in ${hours}h ${mins}m`;
    } else {
      countdownStr = `in ${mins}m`;
    }

    // Show day only if not today
    const isToday = nextClass.dayOfWeek === todayName;
    const dayLabel = isToday ? '' : `${nextClass.dayOfWeek} `;
    const countdownPart = isToday ? ` <span class="next-countdown">(${countdownStr})</span>` : '';

    const fmtTime = (t) => {
      const [h, m] = t.split(':').map(Number);
      const suffix = h >= 12 ? 'PM' : 'AM';
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const time = m === 0 ? `${h12}` : `${h12}:${m.toString().padStart(2, '0')}`;
      return `${time}<span class="clock-ampm">${suffix}</span>`;
    };

    this.nextClassDisplayEl.innerHTML =
      `<span class="next-title">Next: ${nextClass.title}</span><br>` +
      `<span class="next-time">${dayLabel}${fmtTime(nextClass.startTime)}</span>` +
      countdownPart;
  }

  /**
   * Update the schedule display section.
   * Shows active class info, next class info, empty schedule message, or error message.
   * @param {Object|null} activeClass - The currently active ClassEntry or null
   * @param {Object|null} nextClass - The next upcoming ClassEntry or null
   * @param {string|null} errorMsg - Error message to display on config load failure
   */
  updateScheduleDisplay(activeClass, nextClass, errorMsg) {
    if (!this.scheduleDisplayEl) return;

    // Error message takes priority
    if (errorMsg) {
      this.scheduleDisplayEl.innerHTML =
        `<span class="class-title" style="color: var(--accent-red);">${errorMsg}</span>`;
      return;
    }

    // Active class: show title, classType, remaining time
    if (activeClass) {
      const now = new Date();
      const [endH, endM] = activeClass.endTime.split(':').map(Number);
      const endMinutes = endH * 60 + endM;
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      const remainingMin = Math.max(0, endMinutes - nowMinutes);
      const remainH = Math.floor(remainingMin / 60);
      const remainM = remainingMin % 60;
      const remainStr = remainH > 0
        ? `${remainH}h ${remainM}m remaining`
        : `${remainM}m remaining`;

      this.scheduleDisplayEl.innerHTML =
        `<span class="class-title">${activeClass.title}</span> ` +
        `<span class="class-type">${activeClass.classType}</span><br>` +
        `<span class="class-time">${remainStr}</span>`;
      return;
    }

    // Next class: show title, classType, day, start time
    if (nextClass) {
      const fmtTime = (t) => {
        const [h, m] = t.split(':').map(Number);
        const suffix = h >= 12 ? 'PM' : 'AM';
        const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
        const time = m === 0 ? `${h12}` : `${h12}:${m.toString().padStart(2, '0')}`;
        return `${time}<span class="clock-ampm">${suffix}</span>`;
      };
      this.scheduleDisplayEl.innerHTML =
        `<span class="class-title">Next: ${nextClass.title}</span> ` +
        `<span class="class-type">${nextClass.classType}</span><br>` +
        `<span class="class-time">${nextClass.dayOfWeek} at ${fmtTime(nextClass.startTime)}</span>`;
      return;
    }

    // No classes scheduled
    this.scheduleDisplayEl.innerHTML =
      `<span class="class-time">No classes scheduled</span>`;
  }
}

// --- ClassProgressRenderer ---

/**
 * Draws a pie-chart circle representing class duration in 5-minute slices.
 * Starts as a full circle; slices disappear as time elapses.
 */
class ClassProgressRenderer {
  constructor() {
    this.canvas = document.getElementById('class-progress');
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this._activeClass = null;
    this._logoImg = null;
    this._logoScale = 1.0; // 1.0 = full size, 0.0 = center size
    this._targetLogoScale = 1.0;
    this._animating = false;
    const img = new Image();
    img.src = 'logo.png';
    img.onload = () => {
      this._logoImg = img;
      this.draw();
    };
  }

  setActiveClass(activeClass) {
    const wasActive = !!this._activeClass;
    this._activeClass = activeClass;
    if (!activeClass) {
      if (this.canvas) this.canvas.classList.remove('active');
      // Animate logo to full size
      this._targetLogoScale = 1.0;
      this._startAnimation();
      return;
    }
    if (this.canvas) this.canvas.classList.add('active');
    // Animate logo to center size
    this._targetLogoScale = 0.0;
    this._startAnimation();
  }

  _startAnimation() {
    if (this._animating) return;
    this._animating = true;
    const animate = () => {
      const diff = this._targetLogoScale - this._logoScale;
      if (Math.abs(diff) < 0.01) {
        this._logoScale = this._targetLogoScale;
        this._animating = false;
        this.draw();
        return;
      }
      this._logoScale += diff * 0.08;
      this.draw();
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }

  draw() {
    if (!this.ctx) return;

    const canvas = this.canvas;
    const ctx = this.ctx;
    const size = canvas.width;
    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - 4;

    ctx.clearRect(0, 0, size, size);

    // Logo size: interpolate between center size (1.8) and full size (2.0)
    const logoMinScale = 1.8; // center/donut mode
    const logoMaxScale = 2.1; // full canvas mode
    const logoScale = logoMinScale + (logoMaxScale - logoMinScale) * this._logoScale;

    // No active class or animating toward full — skip donut if fully expanded
    if (!this._activeClass && this._logoScale >= 1.0) {
      if (this._logoImg) {
        const logoSize = radius * 2.1;
        ctx.drawImage(this._logoImg, cx - logoSize / 2, cy - logoSize / 2, logoSize, logoSize);
      }
      return;
    }

    if (this._activeClass) {
      const [startH, startM] = this._activeClass.startTime.split(':').map(Number);
      const [endH, endM] = this._activeClass.endTime.split(':').map(Number);
      const startMin = startH * 60 + startM;
      const endMin = endH * 60 + endM;
      const totalMin = endMin - startMin;

      if (totalMin > 0) {
        const totalSlices = totalMin;
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const elapsed = Math.max(0, nowMin - startMin);
        const slicesGone = Math.floor(elapsed);
        const slicesRemaining = Math.max(0, totalSlices - slicesGone);

        if (slicesRemaining > 0) {
          const sliceAngle = (2 * Math.PI) / totalSlices;
          const startAngle = -Math.PI / 2;

          const elapsedFraction = elapsed / totalMin;
          let fillColor;
          if (elapsedFraction >= 0.9) fillColor = '#ff4444';
          else if (elapsedFraction >= 0.5) fillColor = '#ffcc00';
          else fillColor = '#00ff88';

          // Fade in slices based on animation progress (1.0 = hidden, 0.0 = fully visible)
          const sliceOpacity = 1.0 - this._logoScale;

          ctx.globalAlpha = sliceOpacity;
          for (let i = slicesGone; i < totalSlices; i++) {
            const a1 = startAngle + i * sliceAngle;
            const a2 = a1 + sliceAngle - 0.02;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, radius, a1, a2);
            ctx.closePath();
            ctx.fillStyle = fillColor;
            ctx.fill();
          }
          ctx.globalAlpha = 1.0;
        }
      }
    }

    // Center hole — interpolate size (larger when logo is full, smaller when in donut mode)
    const holeRadius = radius * (0.725 + (1.0 - 0.725) * this._logoScale);
    if (this._logoScale < 1.0) {
      ctx.beginPath();
      ctx.arc(cx, cy, holeRadius, 0, 2 * Math.PI);
      ctx.fillStyle = '#1a1a2e';
      ctx.fill();
    }

    // Draw logo
    if (this._logoImg) {
      const logoSize = radius * logoScale;
      ctx.drawImage(this._logoImg, cx - logoSize / 2, cy - logoSize / 2, logoSize, logoSize);
    }
  }
}

// --- OverlayManager ---

/**
 * Handles customization overlays and the advanced menu.
 * Uses the existing #overlay div — sets innerHTML and toggles the 'active' class.
 * All interaction is via numpad keys routed from InputHandler.
 */
class OverlayManager {
  constructor() {
    this.overlayEl = document.getElementById('overlay');
    this.inlineEditBarEl = document.getElementById('inline-edit-bar');
    this._open = false;
    this._mode = null; // 'time-entry' | 'inline-time' | 'competition' | 'training' | etc.
    this._inputBuffer = '';
    this._timeEntryStep = null; // 'minutes' | 'seconds'
    this._timeEntryLabel = '';
    this._timeEntryMinutes = 0;
    this._timeEntryCallback = null;
    this._advancedCallback = null;
    this._inlineTargetEl = null; // The timer element being edited inline
    this._inlineOriginalValue = ''; // Original value to restore on cancel
    this._advancedConfig = null;
    this._trainingMode = null; // 'pyramid' | 'ladder_up' | 'ladder_down'
    this._trainingRounds = 0;
    this._lastTrainingRestSec = 30;
    this._chainsawOddRoundSec = 0;
    this._chainsawOddRestSec = 0;
    this._chainsawEvenRoundSec = 0;
    this._roundsEntryCurrentRounds = 0;
  }

  /**
   * Returns true if any overlay is currently active.
   * @returns {boolean}
   */
  isOpen() {
    return this._open;
  }

  /**
   * Close the active overlay and reset internal state.
   */
  closeOverlay() {
    this._open = false;
    this._mode = null;
    this._inputBuffer = '';
    this._timeEntryStep = null;
    this._timeEntryLabel = '';
    this._timeEntryMinutes = 0;
    this._timeEntryCallback = null;
    this._advancedCallback = null;
    this._advancedConfig = null;
    this._trainingMode = null;
    this._trainingRounds = 0;
    if (this._inlineTargetEl) {
      this._inlineTargetEl.classList.remove('editing');
      this._inlineTargetEl = null;
    }
    if (this.overlayEl) {
      this.overlayEl.classList.remove('active');
      this.overlayEl.innerHTML = '';
    }
    if (this.inlineEditBarEl) {
      this.inlineEditBarEl.classList.remove('active');
      this.inlineEditBarEl.innerHTML = '';
    }
  }

  /**
   * Two-step time entry modal: prompt for minutes first, then seconds.
   * Validates numeric input with isNumeric(), shows error and re-prompts on invalid input.
   * @param {string} label - Label for the time entry (e.g. "ROUND" or "REST")
   * @param {function} callback - Called with (totalSeconds) when complete
   */
  showTimeEntry(label, callback, currentSec) {
    this._open = true;
    this._mode = 'time-entry';
    this._timeEntryLabel = label;
    this._timeEntryCallback = callback;
    this._timeEntryCurrentSec = currentSec || 0;
    this._inputBuffer = '';
    this._renderTimeEntry('');
  }

  /**
   * Inline time entry — edits the timer value in-place with a top instruction bar.
   * @param {string} label - 'ROUND' or 'REST'
   * @param {function} callback - Called with (totalSeconds) when confirmed
   * @param {number} currentSec - Current value in seconds
   * @param {HTMLElement} targetEl - The timer element to edit inline
   */
  showInlineTimeEntry(label, callback, currentSec, targetEl) {
    this._open = true;
    this._mode = 'inline-time';
    this._timeEntryLabel = label;
    this._timeEntryCallback = callback;
    this._timeEntryCurrentSec = currentSec || 0;
    this._inputBuffer = '';
    this._inlineTargetEl = targetEl;
    this._inlineOriginalValue = targetEl ? targetEl.textContent : '';
    if (targetEl) targetEl.classList.add('editing');
    this._renderInlineTimeEntry('');
  }

  /**
   * Render the inline time entry instruction bar.
   */
  _renderInlineTimeEntry(errorMsg) {
    if (!this.inlineEditBarEl) return;
    const raw = this._inputBuffer;
    let preview = '';
    if (raw.length > 0 && isNumeric(raw)) {
      if (raw.charAt(0) === '0') {
        const sec = parseInt(raw.substring(1) || '0', 10);
        preview = formatTime(sec);
      } else {
        const val = parseInt(raw, 10);
        if (val < 60) {
          preview = formatTime(val * 60);
        } else {
          const s = val % 100;
          const m = Math.floor(val / 100);
          preview = s <= 59 ? formatTime(m * 60 + s) : '';
        }
      }
    }
    if (!preview) {
      preview = formatTime(this._timeEntryCurrentSec || 0);
    }
    // Update the timer element directly
    if (this._inlineTargetEl) {
      this._inlineTargetEl.textContent = preview;
    }
    // Show instruction bar
    const errorHtml = errorMsg ? `<div class="edit-error">${errorMsg}</div>` : '';
    this.inlineEditBarEl.innerHTML =
      `<div>Editing ${this._timeEntryLabel} duration: <strong>${this._inputBuffer || '_'}</strong></div>` +
      `<div class="edit-hint"><div style="padding:12px">"1" → 1:00 &nbsp;&nbsp; "12" → 12:00 &nbsp;&nbsp; "123" → 1:23 &nbsp;&nbsp; "1234" → 12:34 &nbsp;&nbsp; "030" → 0:30</div> <span class="key-badge">Enter</span> confirm &nbsp; <span class="key-badge">*</span> cancel</div>` +
      errorHtml;
    this.inlineEditBarEl.classList.add('active');
  }

  /**
   * Handle key input for inline time entry.
   */
  _handleInlineTimeKey(key) {
    if (key === 'Enter') {
      this._confirmInlineTimeEntry();
    } else if (key === '*' || key === 'Backspace') {
      if (key === 'Backspace' && this._inputBuffer.length > 0) {
        this._inputBuffer = this._inputBuffer.slice(0, -1);
        this._renderInlineTimeEntry('');
      } else if (key === '*') {
        // Cancel — restore original value
        if (this._inlineTargetEl) {
          this._inlineTargetEl.textContent = this._inlineOriginalValue;
          this._inlineTargetEl.classList.remove('editing');
        }
        this.closeOverlay();
      }
    } else if (isNumeric(key) && this._inputBuffer.length < 4) {
      this._inputBuffer += key;
      this._renderInlineTimeEntry('');
    }
  }

  /**
   * Confirm inline time entry.
   */
  _confirmInlineTimeEntry() {
    const raw = this._inputBuffer;
    if (!raw || !isNumeric(raw)) {
      this._renderInlineTimeEntry('Enter a valid number');
      return;
    }
    let totalSeconds;
    if (raw.charAt(0) === '0') {
      totalSeconds = parseInt(raw.substring(1) || '0', 10);
    } else {
      const val = parseInt(raw, 10);
      if (val < 60) {
        totalSeconds = val * 60;
      } else {
        const s = val % 100;
        const m = Math.floor(val / 100);
        if (s > 59) {
          this._renderInlineTimeEntry('Invalid seconds (max 59)');
          return;
        }
        totalSeconds = m * 60 + s;
      }
    }
    if (totalSeconds < 1) {
      this._renderInlineTimeEntry('Duration must be at least 1 second');
      return;
    }
    if (this._inlineTargetEl) {
      this._inlineTargetEl.classList.remove('editing');
    }
    if (this._timeEntryCallback) {
      this._timeEntryCallback(totalSeconds);
    }
    this.closeOverlay();
  }

  /**
   * Single-step rounds entry overlay.
   * @param {number} currentRounds - Current numRounds value
   * @param {function} callback - Called with (numRounds) when confirmed
   */
  showRoundsEntry(currentRounds, callback) {
    this._open = true;
    this._mode = 'rounds-entry';
    this._inputBuffer = '';
    this._roundsEntryCallback = callback;
    this._roundsEntryCurrentRounds = currentRounds;
    this._renderRoundsEntry('', currentRounds);
  }

  /**
   * Display the competition presets overlay.
   * @param {Object} config - Current TimerConfig
   * @param {function} callback - Called with (updatedConfig) when a preset is selected
   */
  showCompetitionMenu(config, callback) {
    this._open = true;
    this._mode = 'competition';
    this._advancedConfig = config;
    this._advancedCallback = callback;
    this._renderCompetitionMenu();
  }

  /**
   * Display the training presets overlay.
   * @param {Object} config - Current TimerConfig
   * @param {function} callback - Called with (updatedConfig) when a preset is configured
   */
  showTrainingMenu(config, callback) {
    this._open = true;
    this._mode = 'training';
    this._advancedConfig = config;
    this._advancedCallback = callback;
    this._renderTrainingMenu();
  }

  /**
   * Handle a numpad key press while the overlay is open.
   * Routes to the appropriate handler based on current mode.
   * @param {string} key - The key value (e.g. '0'-'9', 'Enter', 'Backspace')
   */
  handleKey(key) {
    if (!this._open) return;

    // Schedule overlay: +/- toggle, / refresh, any other key closes
    if (this._mode === 'schedule') {
      if (key === '-') {
        APP_SETTINGS.scheduleEnabled = false;
        localStorage.setItem('bjj-timer-schedule-enabled', 'false');
        if (this._onScheduleToggle) this._onScheduleToggle(false);
        this._renderSchedule();
        return;
      }
      if (key === '+') {
        APP_SETTINGS.scheduleEnabled = true;
        localStorage.setItem('bjj-timer-schedule-enabled', 'true');
        if (this._onScheduleToggle) this._onScheduleToggle(true);
        this._renderSchedule();
        return;
      }
      if (key === '/') {
        this.closeOverlay();
        return;
      }
      this.closeOverlay();
      return;
    }

    // * or / closes any overlay (except inline-time which handles * specially)
    if ((key === '*' || key === '/') && this._mode !== 'inline-time') {
      this.closeOverlay();
      return;
    }

    if (this._mode === 'inline-time') {
      this._handleInlineTimeKey(key);
    } else if (this._mode === 'time-entry') {
      this._handleTimeEntryKey(key);
    } else if (this._mode === 'rounds-entry') {
      this._handleRoundsEntryKey(key);
    } else if (this._mode === 'competition') {
      this._handleCompetitionKey(key);
    } else if (this._mode === 'training') {
      this._handleTrainingKey(key);
    } else if (this._mode === 'advanced-sub') {
      this._handleAdvancedSubKey(key);
    } else if (this._mode === 'training-minutes' || this._mode === 'training-rounds' || this._mode === 'training-rest') {
      this._handleTrainingSubKey(key);
    } else if (this._mode && this._mode.startsWith('chainsaw-')) {
      this._handleChainsawKey(key);
    }
  }

  // --- Time Entry internals ---

  _handleTimeEntryKey(key) {
    if (key === 'Enter') {
      this._confirmTimeEntry();
    } else if (key === 'Clear') {
      this._inputBuffer = '';
      this._renderTimeEntry('');
    } else if (key === 'Backspace') {
      this._inputBuffer = this._inputBuffer.slice(0, -1);
      this._renderTimeEntry('');
    } else if (key >= '0' && key <= '9') {
      this._inputBuffer += key;
      this._renderTimeEntry('');
    }
  }

  /**
   * Parse the input buffer into total seconds using quick-entry rules:
   * - Starts with '0': rest is seconds (e.g. "045" → 45s)
   * - Value < 60: pure minutes (e.g. "5" → 5:00)
   * - Value >= 60: last 2 digits = seconds, left digits = minutes (e.g. "530" → 5:30)
   */
  _confirmTimeEntry() {
    const raw = this._inputBuffer;

    if (!isNumeric(raw) || raw === '') {
      this._renderTimeEntry('Enter a number');
      this._inputBuffer = '';
      return;
    }

    let totalSeconds;

    if (raw.charAt(0) === '0') {
      // Seconds-only mode: everything after the leading 0
      const secStr = raw.substring(1) || '0';
      totalSeconds = parseInt(secStr, 10);
    } else {
      const value = parseInt(raw, 10);
      if (value < 60) {
        // Pure minutes
        totalSeconds = value * 60;
      } else {
        // Last two digits are seconds, rest is minutes
        const seconds = value % 100;
        const minutes = Math.floor(value / 100);
        if (seconds > 59) {
          this._renderTimeEntry('Seconds part must be 0-59');
          this._inputBuffer = '';
          return;
        }
        totalSeconds = minutes * 60 + seconds;
      }
    }

    const cb = this._timeEntryCallback;
    this.closeOverlay();
    if (cb) cb(totalSeconds);
  }

  _renderTimeEntry(errorMsg) {
    if (!this.overlayEl) return;
    // Show a live preview of what the input means — default to current configured time
    const raw = this._inputBuffer;
    let preview = '';
    if (raw.length > 0 && isNumeric(raw)) {
      if (raw.charAt(0) === '0') {
        const sec = parseInt(raw.substring(1) || '0', 10);
        preview = formatTime(sec);
      } else {
        const val = parseInt(raw, 10);
        if (val < 60) {
          preview = formatTime(val * 60);
        } else {
          const s = val % 100;
          const m = Math.floor(val / 100);
          preview = s <= 59 ? formatTime(m * 60 + s) : '';
        }
      }
    }
    if (!preview) {
      preview = formatTime(this._timeEntryCurrentSec || 0);
    }
    const display = this._inputBuffer || '_';
    this.overlayEl.innerHTML =
      `<div class="overlay-content">` +
      `<div class="overlay-prompt">Enter ${this._timeEntryLabel} duration:</div>` +
      `<div class="overlay-input">${display}</div>` +
      `<div class="overlay-error">${errorMsg}</div>` +
      `<div style="margin-top:1vh;font-size:clamp(2rem,5vw,5rem);color:var(--text-muted);text-align:center;">${preview}</div>` +
      `<div class="overlay-hint">0XX = seconds · &lt;60 = minutes · 530 = 5:30</div>` +
      `</div>` +
      `<div style="position:absolute;bottom:2vh;right:3vw;color:var(--text-help);font-size:clamp(0.6rem,1.2vw,1.2rem);">* <svg width="0.8em" height="0.8em" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-0.1em;margin:0 0.3em;"><path d="M4 2l4 4-4 4"/></svg> Cancel</div>`;
    this.overlayEl.classList.add('active');
  }

  // --- Rounds Entry internals ---

  _handleRoundsEntryKey(key) {
    if (key === 'Enter') {
      const raw = this._inputBuffer;
      if (!isNumeric(raw) || raw === '') {
        this._renderRoundsEntry('Enter a number', this._roundsEntryCurrentRounds);
        this._inputBuffer = '';
        return;
      }
      const value = parseInt(raw, 10);
      const cb = this._roundsEntryCallback;
      this.closeOverlay();
      if (cb) cb(value);
    } else if (key === 'Clear') {
      this._inputBuffer = '';
      this._renderRoundsEntry('', this._roundsEntryCurrentRounds);
    } else if (key === 'Backspace') {
      this._inputBuffer = this._inputBuffer.slice(0, -1);
      this._renderRoundsEntry('', this._roundsEntryCurrentRounds);
    } else if (key >= '0' && key <= '9') {
      this._inputBuffer += key;
      this._renderRoundsEntry('', this._roundsEntryCurrentRounds);
    }
  }

  _renderRoundsEntry(errorMsg, currentRounds) {
    if (!this.overlayEl) return;
    const display = this._inputBuffer || '_';
    // Show default value preview when input is empty
    let defaultPreview = '';
    if (!this._inputBuffer && currentRounds !== undefined) {
      const label = currentRounds === 0 ? '∞ repeat' : String(currentRounds);
      defaultPreview = `<div style="margin-top:1vh;font-size:clamp(1.5rem,4vw,4rem);color:var(--text-muted);text-align:center;">${label}</div>`;
    }
    this.overlayEl.innerHTML =
      `<div class="overlay-content">` +
      `<div class="overlay-prompt">Number of rounds (0 = repeat):</div>` +
      `<div class="overlay-input">${display}</div>` +
      defaultPreview +
      `<div class="overlay-error">${errorMsg}</div>` +
      `<div class="overlay-hint">Type digits, then press Enter</div>` +
      `</div>` +
      `<div style="position:absolute;bottom:2vh;right:3vw;color:var(--text-help);font-size:clamp(0.6rem,1.2vw,1.2rem);">* <svg width="0.8em" height="0.8em" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-0.1em;margin:0 0.3em;"><path d="M4 2l4 4-4 4"/></svg> Cancel</div>`;
    this.overlayEl.classList.add('active');
  }

  // --- Advanced Menu internals ---

  _handleCompetitionKey(key) {
    const presetIndex = parseInt(key, 10);
    if (isNaN(presetIndex)) return;
    const presetNames = Object.keys(APP_SETTINGS.competitionPresets);
    if (presetIndex >= 0 && presetIndex < presetNames.length) {
      const name = presetNames[presetIndex];
      const preset = APP_SETTINGS.competitionPresets[name];
      this._applyPreset(preset.roundDurationSec, preset.restDurationSec, preset.numRounds, name);
    }
  }

  _handleTrainingKey(key) {
    switch (key) {
      case '0':
        this._startChainsaw();
        break;
      case '1':
        this._startTrainingPreset('ladder_up');
        break;
      case '2':
        this._startTrainingPreset('ladder_down');
        break;
      case '3':
        this._startTrainingPreset('pyramid');
        break;
      case '4':
        this._startTrainingPreset('inv_pyramid');
        break;
      case '5':
        this._applyPreset(20, 10, 8, 'Tabata');
        break;
      case '6':
        if (this._dualTimerCallback) {
          this.closeOverlay();
          this._dualTimerCallback();
        }
        break;
      default:
        break;
    }
  }

  _applyPreset(roundDurationSec, restDurationSec, numRounds, presetName) {
    this._advancedConfig.roundDurationSec = roundDurationSec;
    this._advancedConfig.restDurationSec = restDurationSec;
    this._advancedConfig.numRounds = numRounds;
    this._advancedConfig.presetName = presetName || null;
    const cb = this._advancedCallback;
    const cfg = { ...this._advancedConfig };
    this.closeOverlay();
    if (cb) cb(cfg);
  }

  _startAdvancedSubEntry(prompt, onConfirm) {
    this._mode = 'advanced-sub';
    this._inputBuffer = '';
    this._advancedSubPrompt = prompt;
    this._advancedSubCallback = onConfirm;
    this._renderAdvancedSubEntry('');
  }

  _renderAdvancedSubEntry(errorMsg) {
    if (!this.overlayEl) return;
    const display = this._inputBuffer || '_';
    this.overlayEl.innerHTML =
      `<div class="overlay-content">` +
      `<div class="overlay-prompt">${this._advancedSubPrompt}</div>` +
      `<div class="overlay-input">${display}</div>` +
      `<div class="overlay-error">${errorMsg}</div>` +
      `<div class="overlay-hint">Type digits, then press Enter to confirm</div>` +
      `</div>` +
      `<div style="position:absolute;bottom:2vh;right:3vw;color:var(--text-help);font-size:clamp(0.6rem,1.2vw,1.2rem);">* <svg width="0.8em" height="0.8em" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-0.1em;margin:0 0.3em;"><path d="M4 2l4 4-4 4"/></svg> Cancel</div>`;
    this.overlayEl.classList.add('active');
  }

  _handleAdvancedSubKey(key) {
    if (key === 'Enter') {
      const raw = this._inputBuffer;
      if (!isNumeric(raw) || raw === '') {
        this._renderAdvancedSubEntry('Please enter a number');
        this._inputBuffer = '';
        return;
      }
      const value = parseInt(raw, 10);
      const cb = this._advancedSubCallback;
      this._mode = 'advanced';
      this._inputBuffer = '';
      if (cb) cb(value);
    } else if (key === 'Clear') {
      this._inputBuffer = '';
      this._renderAdvancedSubEntry('');
    } else if (key === 'Backspace') {
      this._inputBuffer = this._inputBuffer.slice(0, -1);
      this._renderAdvancedSubEntry('');
    } else if (key >= '0' && key <= '9') {
      this._inputBuffer += key;
      this._renderAdvancedSubEntry('');
    }
  }

  // --- Training Preset internals ---

  _startTrainingPreset(mode) {
    this._trainingMode = mode;
    this._trainingTotalMinutes = 0;
    // Calculate default minutes from remaining class time (nearest multiple of 5, rounded down)
    const remainingSec = this._getRemainingClassSec();
    this._trainingDefaultMinutes = remainingSec > 0 ? Math.floor(remainingSec / 60 / 5) * 5 : 0;
    this._mode = 'training-minutes';
    this._inputBuffer = '';
    const defaultHint = this._trainingDefaultMinutes > 0 ? ` (default ${this._trainingDefaultMinutes})` : '';
    this._renderTrainingSubEntry(`Total minutes${defaultHint}:`, '');
  }

  _handleTrainingSubKey(key) {
    if (key === 'Enter') {
      const raw = this._inputBuffer;
      // Allow empty input on minutes step to accept default
      if (this._mode === 'training-minutes' && raw === '' && this._trainingDefaultMinutes > 0) {
        this._trainingTotalMinutes = this._trainingDefaultMinutes;
        this._mode = 'training-rounds';
        this._inputBuffer = '';
        this._renderTrainingSubEntry('How many rounds?', '');
        return;
      }
      // Allow empty input on rest step to accept default
      if (this._mode === 'training-rest' && raw === '') {
        this._finishTrainingPreset(this._lastTrainingRestSec);
        return;
      }
      if (!isNumeric(raw) || raw === '') {
        this._renderTrainingSubEntry(this._trainingPrompt(), 'Please enter a number');
        this._inputBuffer = '';
        return;
      }
      const value = parseInt(raw, 10);

      if (this._mode === 'training-minutes') {
        if (value < 1) {
          this._renderTrainingSubEntry(this._trainingPrompt(), 'Need at least 1 minute');
          this._inputBuffer = '';
          return;
        }
        this._trainingTotalMinutes = value;
        this._mode = 'training-rounds';
        this._inputBuffer = '';
        this._renderTrainingSubEntry('How many rounds?', '');
      } else if (this._mode === 'training-rounds') {
        if (value < 2) {
          this._renderTrainingSubEntry('How many rounds?', 'Need at least 2 rounds');
          this._inputBuffer = '';
          return;
        }
        this._trainingRounds = value;
        this._mode = 'training-rest';
        this._inputBuffer = '';
        this._renderTrainingSubEntry(`Rest between rounds (seconds, default ${this._lastTrainingRestSec}):`, '');
      } else if (this._mode === 'training-rest') {
        this._lastTrainingRestSec = value;
        this._finishTrainingPreset(value);
      }
    } else if (key === 'Clear') {
      this._inputBuffer = '';
      this._renderTrainingSubEntry(this._trainingPrompt(), '');
    } else if (key === 'Backspace') {
      this._inputBuffer = this._inputBuffer.slice(0, -1);
      this._renderTrainingSubEntry(this._trainingPrompt(), '');
    } else if (key >= '0' && key <= '9') {
      this._inputBuffer += key;
      this._renderTrainingSubEntry(this._trainingPrompt(), '');
    }
  }

  _renderTrainingSubEntry(prompt, errorMsg) {
    if (!this.overlayEl) return;
    const modeLabel = this._trainingMode === 'pyramid' ? 'Pyramid' :
                      this._trainingMode === 'inv_pyramid' ? 'Inv. Pyramid' :
                      this._trainingMode === 'ladder_up' ? 'Ladder Up' : 'Ladder Down';
    const _s = 'width="1.5em" height="1.5em" viewBox="0 0 24 24" style="vertical-align:-0.25em;margin-right:0.4em;"';
    let icon = '';
    if (this._trainingMode === 'pyramid') {
      icon = `<svg ${_s} fill="currentColor"><rect x="1" y="16" width="3" height="6" rx="0.5"/><rect x="5.5" y="11" width="3" height="11" rx="0.5"/><rect x="10" y="5" width="3" height="17" rx="0.5"/><rect x="14.5" y="11" width="3" height="11" rx="0.5"/><rect x="19" y="16" width="3" height="6" rx="0.5"/></svg>`;
    } else if (this._trainingMode === 'inv_pyramid') {
      icon = `<svg ${_s} fill="currentColor"><rect x="1" y="5" width="3" height="17" rx="0.5"/><rect x="5.5" y="11" width="3" height="11" rx="0.5"/><rect x="10" y="16" width="3" height="6" rx="0.5"/><rect x="14.5" y="11" width="3" height="11" rx="0.5"/><rect x="19" y="5" width="3" height="17" rx="0.5"/></svg>`;
    } else if (this._trainingMode === 'ladder_up') {
      icon = `<svg ${_s} fill="currentColor"><rect x="2" y="18" width="3" height="4" rx="0.5"/><rect x="7" y="14" width="3" height="8" rx="0.5"/><rect x="12" y="9" width="3" height="13" rx="0.5"/><rect x="17" y="4" width="3" height="18" rx="0.5"/></svg>`;
    } else {
      icon = `<svg ${_s} fill="currentColor"><rect x="2" y="4" width="3" height="18" rx="0.5"/><rect x="7" y="9" width="3" height="13" rx="0.5"/><rect x="12" y="14" width="3" height="8" rx="0.5"/><rect x="17" y="18" width="3" height="4" rx="0.5"/></svg>`;
    }
    const display = this._inputBuffer || '_';
    // Show default value preview when input is empty
    let defaultPreview = '';
    if (!this._inputBuffer) {
      if (this._mode === 'training-minutes' && this._trainingDefaultMinutes > 0) {
        defaultPreview = `<div style="margin-top:1vh;font-size:clamp(1.5rem,4vw,4rem);color:var(--text-muted);text-align:center;">${this._trainingDefaultMinutes}m</div>`;
      } else if (this._mode === 'training-rest') {
        defaultPreview = `<div style="margin-top:1vh;font-size:clamp(1.5rem,4vw,4rem);color:var(--text-muted);text-align:center;">${formatTime(this._lastTrainingRestSec)}</div>`;
      }
    }
    this.overlayEl.innerHTML =
      `<div class="overlay-content">` +
      `<div style="font-size:clamp(2rem,5vw,5rem);color:var(--text-primary);margin-bottom:1vh;">${icon}${modeLabel}</div>` +
      `<div class="overlay-prompt">${prompt}</div>` +
      `<div class="overlay-input">${display}</div>` +
      defaultPreview +
      `<div class="overlay-error">${errorMsg}</div>` +
      `<div class="overlay-hint">Type digits, then press Enter to confirm</div>` +
      `</div>` +
      `<div style="position:absolute;bottom:2vh;right:3vw;color:var(--text-help);font-size:clamp(0.6rem,1.2vw,1.2rem);">* <svg width="0.8em" height="0.8em" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-0.1em;margin:0 0.3em;"><path d="M4 2l4 4-4 4"/></svg> Cancel</div>`;
    this.overlayEl.classList.add('active');
  }

  _trainingPrompt() {
    if (this._mode === 'training-minutes') {
      const defaultHint = this._trainingDefaultMinutes > 0 ? ` (default ${this._trainingDefaultMinutes})` : '';
      return `Total minutes${defaultHint}:`;
    }
    if (this._mode === 'training-rounds') return 'How many rounds?';
    return `Rest between rounds (seconds, default ${this._lastTrainingRestSec}):`;
  }

  _finishTrainingPreset(restSec) {
    const availableSec = this._trainingTotalMinutes * 60;

    const totalRestSec = (this._trainingRounds - 1) * restSec;
    const totalTrainingSec = Math.max(availableSec - totalRestSec, this._trainingRounds); // at least 1s per round

    const durations = generateRoundDurations(this._trainingMode, this._trainingRounds, totalTrainingSec);

    // Build config update with training data
    const cfg = { ...this._advancedConfig };
    cfg.restDurationSec = restSec;
    cfg.numRounds = this._trainingRounds;
    cfg.roundDurations = durations;
    cfg.presetName = this._trainingMode === 'pyramid' ? 'Pyramid' :
                     this._trainingMode === 'inv_pyramid' ? 'Inv. Pyramid' :
                     this._trainingMode === 'ladder_up' ? 'Ladder Up' : 'Ladder Down';

    const cb = this._advancedCallback;
    this.closeOverlay();
    if (cb) cb(cfg);
  }

  // --- Chainsaw Preset internals ---

  _startChainsaw() {
    this._mode = 'chainsaw-odd-round';
    this._inputBuffer = '';
    this._chainsawOddRoundSec = 0;
    this._chainsawOddRestSec = 0;
    this._chainsawEvenRoundSec = 0;
    this._chainsawEvenRestSec = 0;
    this._chainsawDefaultRounds = 0;
    this._renderChainsawEntry('Odd round duration:', '');
  }

  _handleChainsawKey(key) {
    if (key === 'Enter') {
      const raw = this._inputBuffer;
      // Allow empty input on even rest step to accept default
      if (this._mode === 'chainsaw-even-rest' && raw === '') {
        this._chainsawEvenRestSec = this._chainsawOddRestSec;
        this._chainsawDefaultRounds = this._calcChainsawDefaultRounds();
        this._mode = 'chainsaw-rounds';
        this._inputBuffer = '';
        const defaultHint = this._chainsawDefaultRounds > 0 ? ` (default ${this._chainsawDefaultRounds})` : '';
        this._renderChainsawEntry(`How many rounds${defaultHint}:`, '');
        return;
      }
      // Allow empty input on rounds step to accept default
      if (this._mode === 'chainsaw-rounds' && raw === '' && this._chainsawDefaultRounds > 0) {
        this._finishChainsaw(this._chainsawEvenRestSec, this._chainsawDefaultRounds);
        return;
      }
      if (!isNumeric(raw) || raw === '') {
        this._renderChainsawEntry(this._chainsawPrompt(), 'Enter a number');
        this._inputBuffer = '';
        return;
      }
      const totalSeconds = this._parseChainsawTime(raw);
      if (totalSeconds === null) {
        this._renderChainsawEntry(this._chainsawPrompt(), 'Seconds part must be 0-59');
        this._inputBuffer = '';
        return;
      }

      if (this._mode === 'chainsaw-odd-round') {
        this._chainsawOddRoundSec = totalSeconds;
        this._mode = 'chainsaw-odd-rest';
        this._inputBuffer = '';
        this._renderChainsawEntry('Odd round rest (seconds):', '');
      } else if (this._mode === 'chainsaw-odd-rest') {
        this._chainsawOddRestSec = totalSeconds;
        this._mode = 'chainsaw-even-round';
        this._inputBuffer = '';
        this._renderChainsawEntry('Even round duration:', '');
      } else if (this._mode === 'chainsaw-even-round') {
        this._chainsawEvenRoundSec = totalSeconds;
        this._mode = 'chainsaw-even-rest';
        this._inputBuffer = '';
        this._renderChainsawEntry(`Even round rest (seconds, default ${this._chainsawOddRestSec}):`, '');
      } else if (this._mode === 'chainsaw-even-rest') {
        // Default to odd rest if user enters 0
        const restVal = totalSeconds === 0 ? this._chainsawOddRestSec : totalSeconds;
        this._chainsawEvenRestSec = restVal;
        // Calculate default rounds from remaining class time
        this._chainsawDefaultRounds = this._calcChainsawDefaultRounds();
        this._mode = 'chainsaw-rounds';
        this._inputBuffer = '';
        const defaultHint = this._chainsawDefaultRounds > 0 ? ` (default ${this._chainsawDefaultRounds})` : '';
        this._renderChainsawEntry(`How many rounds${defaultHint}:`, '');
      } else if (this._mode === 'chainsaw-rounds') {
        const rounds = totalSeconds; // reusing totalSeconds as plain int here
        if (rounds < 1) {
          this._renderChainsawEntry(this._chainsawPrompt(), 'Need at least 1 round');
          this._inputBuffer = '';
          return;
        }
        this._finishChainsaw(this._chainsawEvenRestSec, rounds);
      }
    } else if (key === 'Clear') {
      this._inputBuffer = '';
      this._renderChainsawEntry(this._chainsawPrompt(), '');
    } else if (key === 'Backspace') {
      this._inputBuffer = this._inputBuffer.slice(0, -1);
      this._renderChainsawEntry(this._chainsawPrompt(), '');
    } else if (key >= '0' && key <= '9') {
      this._inputBuffer += key;
      this._renderChainsawEntry(this._chainsawPrompt(), '');
    }
  }

  _chainsawPrompt() {
    if (this._mode === 'chainsaw-odd-round') return 'Odd round duration:';
    if (this._mode === 'chainsaw-odd-rest') return 'Odd round rest (seconds):';
    if (this._mode === 'chainsaw-even-round') return 'Even round duration:';
    if (this._mode === 'chainsaw-rounds') {
      const defaultHint = this._chainsawDefaultRounds > 0 ? ` (default ${this._chainsawDefaultRounds})` : '';
      return `How many rounds${defaultHint}:`;
    }
    return `Even round rest (seconds, default ${this._chainsawOddRestSec}):`;
  }

  _parseChainsawTime(raw) {
    // For rest and rounds steps, treat as plain integer
    if (this._mode === 'chainsaw-odd-rest' || this._mode === 'chainsaw-even-rest' || this._mode === 'chainsaw-rounds') {
      return parseInt(raw, 10);
    }
    // For round time steps, use the same quick-entry rules as time entry
    if (raw.charAt(0) === '0') {
      return parseInt(raw.substring(1) || '0', 10);
    }
    const value = parseInt(raw, 10);
    if (value < 60) return value * 60;
    const seconds = value % 100;
    const minutes = Math.floor(value / 100);
    if (seconds > 59) return null;
    return minutes * 60 + seconds;
  }

  _renderChainsawEntry(prompt, errorMsg) {
    if (!this.overlayEl) return;
    const display = this._inputBuffer || '_';
    // Show live preview for round time steps
    let previewLine = '';
    if ((this._mode === 'chainsaw-odd-round' || this._mode === 'chainsaw-even-round') && this._inputBuffer.length > 0 && isNumeric(this._inputBuffer)) {
      const parsed = this._parseChainsawTime(this._inputBuffer);
      if (parsed !== null) {
        previewLine = `<div class="overlay-hint" style="margin-top:1vh;font-size:clamp(1.2rem,3vw,3rem);color:var(--text-muted);">= ${formatTime(parsed)}</div>`;
      }
    }
    const isRoundStep = this._mode === 'chainsaw-odd-round' || this._mode === 'chainsaw-even-round';
    const hint = isRoundStep ? '0XX = seconds · &lt;60 = minutes · 530 = 5:30' : 'Type digits, then press Enter';
    // Show default value preview when input is empty
    let defaultPreview = '';
    if (!this._inputBuffer) {
      if (this._mode === 'chainsaw-even-rest' && this._chainsawOddRestSec > 0) {
        defaultPreview = `<div style="margin-top:1vh;font-size:clamp(1.5rem,4vw,4rem);color:var(--text-muted);text-align:center;">${formatTime(this._chainsawOddRestSec)}</div>`;
      } else if (this._mode === 'chainsaw-rounds' && this._chainsawDefaultRounds > 0) {
        defaultPreview = `<div style="margin-top:1vh;font-size:clamp(1.5rem,4vw,4rem);color:var(--text-muted);text-align:center;">${this._chainsawDefaultRounds}</div>`;
      }
    }
    const chainsawSvg = '<svg width="1.5em" height="1.5em" viewBox="0 0 24 24" style="vertical-align:-0.25em;margin-right:0.4em;" fill="currentColor"><rect x="2" y="14" width="3" height="8" rx="0.5"/><rect x="7" y="6" width="3" height="16" rx="0.5"/><rect x="12" y="14" width="3" height="8" rx="0.5"/><rect x="17" y="6" width="3" height="16" rx="0.5"/></svg>';
    this.overlayEl.innerHTML =
      `<div class="overlay-content">` +
      `<div style="font-size:clamp(2rem,5vw,5rem);color:var(--text-primary);margin-bottom:1vh;">${chainsawSvg}Chainsaw</div>` +
      `<div class="overlay-prompt">${prompt}</div>` +
      `<div class="overlay-input">${display}</div>` +
      defaultPreview +
      `<div class="overlay-error">${errorMsg}</div>` +
      previewLine +
      `<div class="overlay-hint">${hint}</div>` +
      `</div>` +
      `<div style="position:absolute;bottom:2vh;right:3vw;color:var(--text-help);font-size:clamp(0.6rem,1.2vw,1.2rem);">* <svg width="0.8em" height="0.8em" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-0.1em;margin:0 0.3em;"><path d="M4 2l4 4-4 4"/></svg> Cancel</div>`;
    this.overlayEl.classList.add('active');
  }

  _finishChainsaw(evenRestSec, numRounds) {
    const cfg = { ...this._advancedConfig };
    cfg.roundDurationSec = this._chainsawOddRoundSec;
    cfg.restDurationSec = this._chainsawOddRestSec;
    cfg.numRounds = numRounds;
    // Build full round/rest duration arrays for the specified number of rounds
    const roundDurs = [];
    const restDurs = [];
    for (let i = 0; i < numRounds; i++) {
      roundDurs.push(i % 2 === 0 ? this._chainsawOddRoundSec : this._chainsawEvenRoundSec);
      restDurs.push(i % 2 === 0 ? this._chainsawOddRestSec : evenRestSec);
    }
    cfg.roundDurations = roundDurs;
    cfg.restDurations = restDurs;
    cfg.presetName = 'Chainsaw';

    const cb = this._advancedCallback;
    this.closeOverlay();
    if (cb) cb(cfg);
  }

  /**
   * Get remaining class time in seconds from the schedule display.
   * Returns 0 if no active class.
   */
  _getRemainingClassSec() {
    const scheduleEl = document.getElementById('schedule-display');
    const classTimeEl = scheduleEl ? scheduleEl.querySelector('.class-time') : null;
    if (!classTimeEl) return 0;
    const text = classTimeEl.textContent;
    const hMatch = text.match(/(\d+)h/);
    const mMatch = text.match(/(\d+)m/);
    if (!hMatch && !mMatch) return 0;
    return ((hMatch ? parseInt(hMatch[1], 10) : 0) * 60 + (mMatch ? parseInt(mMatch[1], 10) : 0)) * 60;
  }

  /**
   * Calculate how many complete chainsaw rounds fit in remaining class time.
   * A "pair" is odd round + odd rest + even round + even rest.
   * Returns the max rounds that fit without cutting any round short.
   */
  _calcChainsawDefaultRounds() {
    const availableSec = this._getRemainingClassSec();
    if (availableSec <= 0) return 0;
    const oddCycle = this._chainsawOddRoundSec + this._chainsawOddRestSec;
    const evenCycle = this._chainsawEvenRoundSec + this._chainsawEvenRestSec;
    const pairSec = oddCycle + evenCycle;
    if (pairSec <= 0) return 0;
    // Count how many full rounds fit
    let rounds = 0;
    let used = 0;
    while (true) {
      const isOdd = rounds % 2 === 0;
      const roundSec = isOdd ? this._chainsawOddRoundSec : this._chainsawEvenRoundSec;
      const restSec = isOdd ? this._chainsawOddRestSec : this._chainsawEvenRestSec;
      const needed = roundSec + (rounds > 0 ? 0 : 0); // round time is always needed
      if (used + roundSec > availableSec) break;
      used += roundSec;
      rounds++;
      // Add rest only if there's room for at least one more round after
      if (used + restSec > availableSec) break;
      used += restSec;
    }
    return rounds;
  }

  _renderCompetitionMenu() {
    if (!this.overlayEl) return;

    const _s = 'width="1.5em" height="1.5em" viewBox="0 0 24 24" style="vertical-align:-0.2em;"';

    const beltIcon = (color) =>
      `<svg ${_s} fill="none"><rect x="1" y="9" width="22" height="6" rx="1" fill="${color}" stroke="${color === '#ffffff' ? '#888' : color}" stroke-width="0.5"/><rect x="10" y="7" width="4" height="10" rx="1" fill="${color}" stroke="${color === '#ffffff' ? '#888' : 'rgba(0,0,0,0.3)'}" stroke-width="0.5"/><line x1="12" y1="17" x2="11" y2="21" stroke="${color === '#ffffff' ? '#888' : color}" stroke-width="1.5" stroke-linecap="round"/><line x1="12" y1="17" x2="13" y2="21" stroke="${color === '#ffffff' ? '#888' : color}" stroke-width="1.5" stroke-linecap="round"/></svg>`;

    const kidsIcon =
      `<svg ${_s} fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="3"/><path d="M12 8v6"/><path d="M9 21l3-7 3 7"/><path d="M7 13l5 2 5-2"/></svg>`;

    const beltColorMap = {
      'white': '#ffffff', 'blue': '#1e90ff', 'purple': '#8b5cf6',
      'brown': '#8B4513', 'black': '#333333'
    };
    const getBeltColor = (name) => {
      const lower = name.toLowerCase();
      if (lower.includes('white')) return beltColorMap['white'];
      if (lower.includes('blue')) return beltColorMap['blue'];
      if (lower.includes('purple')) return beltColorMap['purple'];
      if (lower.includes('brown')) return beltColorMap['brown'];
      if (lower.includes('black')) return beltColorMap['black'];
      if (lower.includes('kid') || lower.includes('child') || lower.includes('youth')) return null;
      return '#aaa';
    };

    const presetNames = Object.keys(APP_SETTINGS.competitionPresets);
    let rows = '';
    // Header row
    rows += `<span></span><span></span><span></span>` +
            `<span class="mg-note" style="color:var(--text-round);font-weight:700;">Round</span>` +
            `<span class="mg-note" style="color:var(--text-rest);font-weight:700;">Rest</span>`;
    presetNames.forEach((name, i) => {
      const p = APP_SETTINGS.competitionPresets[name];
      const roundStr = formatTime(p.roundDurationSec);
      const restStr = formatTime(p.restDurationSec);
      const color = getBeltColor(name);
      const icon = color === null ? kidsIcon : beltIcon(color);
      rows += `<span class="mg-key">${i}</span>` +
              `<span class="mg-icon">${icon}</span>` +
              `<span class="mg-name">${name}</span>` +
              `<span class="mg-note" style="color:var(--text-round);">${roundStr}</span>` +
              `<span class="mg-note" style="color:var(--text-rest);">${restStr}</span>`;
    });

    const _arrow = '<svg width="0.8em" height="0.8em" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-0.1em;margin:0 0.3em;"><path d="M4 2l4 4-4 4"/></svg>';

    this.overlayEl.innerHTML =
      `<div class="advanced-menu overlay-content">` +
        `<div class="menu-title">Competition Presets</div>` +
        `<div class="menu-grid-5">${rows}</div>` +
        `<div class="menu-close"><span class="menu-key">/</span> ${_arrow} Close</div>` +
      `</div>`;
    this.overlayEl.classList.add('active');
  }

  _renderTrainingMenu() {
    if (!this.overlayEl) return;

    const _s = 'width="1.5em" height="1.5em" viewBox="0 0 24 24" style="vertical-align:-0.2em;"';

    const chainsawIcon =
      `<svg ${_s} fill="currentColor"><rect x="2" y="14" width="3" height="8" rx="0.5"/><rect x="7" y="6" width="3" height="16" rx="0.5"/><rect x="12" y="14" width="3" height="8" rx="0.5"/><rect x="17" y="6" width="3" height="16" rx="0.5"/></svg>`;
    const ladderUpIcon =
      `<svg ${_s} fill="currentColor"><rect x="2" y="18" width="3" height="4" rx="0.5"/><rect x="7" y="14" width="3" height="8" rx="0.5"/><rect x="12" y="9" width="3" height="13" rx="0.5"/><rect x="17" y="4" width="3" height="18" rx="0.5"/></svg>`;
    const ladderDownIcon =
      `<svg ${_s} fill="currentColor"><rect x="2" y="4" width="3" height="18" rx="0.5"/><rect x="7" y="9" width="3" height="13" rx="0.5"/><rect x="12" y="14" width="3" height="8" rx="0.5"/><rect x="17" y="18" width="3" height="4" rx="0.5"/></svg>`;
    const pyramidIcon =
      `<svg ${_s} fill="currentColor"><rect x="1" y="16" width="3" height="6" rx="0.5"/><rect x="5.5" y="11" width="3" height="11" rx="0.5"/><rect x="10" y="5" width="3" height="17" rx="0.5"/><rect x="14.5" y="11" width="3" height="11" rx="0.5"/><rect x="19" y="16" width="3" height="6" rx="0.5"/></svg>`;
    const invPyramidIcon =
      `<svg ${_s} fill="currentColor"><rect x="1" y="5" width="3" height="17" rx="0.5"/><rect x="5.5" y="11" width="3" height="11" rx="0.5"/><rect x="10" y="16" width="3" height="6" rx="0.5"/><rect x="14.5" y="11" width="3" height="11" rx="0.5"/><rect x="19" y="5" width="3" height="17" rx="0.5"/></svg>`;
    const tabataIcon =
      `<svg ${_s} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`;

    const items = [
      { key: '0', icon: chainsawIcon, name: 'Chainsaw', note: 'Alternating round/rest' },
      { key: '1', icon: ladderUpIcon, name: 'Ladder Up', note: 'Short → long' },
      { key: '2', icon: ladderDownIcon, name: 'Ladder Down', note: 'Long → short' },
      { key: '3', icon: pyramidIcon, name: 'Pyramid', note: 'Short → long → short' },
      { key: '4', icon: invPyramidIcon, name: 'Inv. Pyramid', note: 'Long → short → long' },
      { key: '5', icon: tabataIcon, name: 'Tabata', note: '20s on / 10s off × 8' },
      { key: '6', icon: `<svg ${_s} fill="currentColor"><rect x="1" y="6" width="9" height="16" rx="1" opacity="0.8"/><rect x="14" y="6" width="9" height="16" rx="1" opacity="0.8"/></svg>`, name: 'Dual Timer', note: 'Two independent timers' }
    ];

    let rows = '';
    items.forEach(it => {
      rows += `<span class="mg-key">${it.key}</span>` +
              `<span class="mg-icon">${it.icon}</span>` +
              `<span class="mg-name">${it.name}</span>` +
              `<span class="mg-note">${it.note}</span>`;
    });

    const _arrow = '<svg width="0.8em" height="0.8em" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-0.1em;margin:0 0.3em;"><path d="M4 2l4 4-4 4"/></svg>';

    this.overlayEl.innerHTML =
      `<div class="advanced-menu overlay-content">` +
        `<div class="menu-title">Training Presets</div>` +
        `<div class="menu-grid">${rows}</div>` +
        `<div class="menu-close"><span class="menu-key">*</span> ${_arrow} Close</div>` +
      `</div>`;
    this.overlayEl.classList.add('active');
  }

  showSchedule(schedule) {
    this._open = true;
    this._mode = 'schedule';
    this._scheduleData = schedule;
    this._renderSchedule();
  }

  _renderSchedule() {
    if (!this.overlayEl) return;
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const dayAbbr = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun' };
    const byDay = {};
    days.forEach(d => byDay[d] = []);
    (this._scheduleData || []).forEach(e => {
      if (byDay[e.dayOfWeek]) byDay[e.dayOfWeek].push(e);
    });
    // Sort each day by startTime
    days.forEach(d => byDay[d].sort((a, b) => a.startTime.localeCompare(b.startTime)));

    const fmt = (t) => {
      const [h, m] = t.split(':').map(Number);
      const suffix = h >= 12 ? 'pm' : 'am';
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const time = m === 0 ? `${h12}` : `${h12}:${m.toString().padStart(2, '0')}`;
      return `${time}<span class="clock-ampm">${suffix}</span>`;
    };

    let cols = '';
    days.forEach(d => {
      let cells = '';
      byDay[d].forEach(e => {
        cells += `<div class="sched-class">`
          + `<span class="sched-time">${fmt(e.startTime)}–${fmt(e.endTime)}</span>`
          + `<span class="sched-title">${e.title}</span>`
          + `</div>`;
      });
      if (!byDay[d].length) cells = '<div class="sched-class sched-empty">—</div>';
      cols += `<div class="sched-day"><div class="sched-day-name">${dayAbbr[d]}</div>${cells}</div>`;
    });

    const enabled = APP_SETTINGS.scheduleEnabled;
    const statusColor = enabled ? 'var(--accent-green)' : 'var(--accent-red)';
    const statusText = enabled ? 'ON' : 'OFF';
    const toggleHint = enabled
      ? '<span style="color:var(--accent-red);">−</span> Disable'
      : '<span style="color:var(--accent-green);">+</span> Enable';

    this.overlayEl.innerHTML =
      `<div class="schedule-overlay overlay-content">`
      + `<div class="schedule-title">Weekly Schedule <span style="color:${statusColor};font-size:0.6em;">${statusText}</span></div>`
      + `<div class="schedule-grid">${cols}</div>`
      + `<div class="schedule-hint">${toggleHint} schedule features &nbsp;·&nbsp; Any other key to close</div>`
      + `</div>`;
    this.overlayEl.classList.add('active');
  }



}

// --- InputHandler ---

/**
 * Listens for keydown events on document and routes numpad input.
 * When overlay is open, ALL numpad input goes to the overlay.
 * When overlay is closed, recognized keys trigger timer controls.
 */
class InputHandler {
  /**
   * @param {TimerEngine} engine
   * @param {OverlayManager} overlayManager
   * @param {Renderer} renderer
   * @param {AudioManager} audioManager
   * @param {Object} state - TimerState object
   */
  constructor(engine, overlayManager, renderer, audioManager, state) {
    this.engine = engine;
    this.overlayManager = overlayManager;
    this.renderer = renderer;
    this.audioManager = audioManager;
    this.state = state;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._resetCallback = null; // Set externally for key 9 reset
    this._pausedAt = 0; // Timestamp when paused via key 0
    this._enterDownTime = 0; // Timestamp when Enter was pressed
    this._enterLongPressTimer = null; // Timer for long-press detection
    this._enterHandledAsLong = false; // Whether current Enter press was handled as long-press
    this._enterDownHandled = false; // Whether Enter keydown was handled by main handler
    this._timeSettingMode = false; // Whether we're in arrow-key time setting mode
    this._timeSettingField = null; // 'round-min' | 'round-sec' | 'rest-min' | 'rest-sec'
    // Dual timer support
    this._dualMode = false;
    this._dualState = null;
    this._dualEngine = null;
    this._dualRendererEls = null;
    this.overlayManager._dualTimerCallback = () => this._activateDualMode();
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
  }

  /**
   * Normalize a KeyboardEvent into a simple key string.
   * Returns null for unrecognized keys.
   * @param {KeyboardEvent} event
   * @returns {string|null}
   */
  _normalizeKey(event) {
    const code = event.code;
    const key = event.key;

    // Numpad digit keys
    if (code && code.startsWith('Numpad')) {
      // When NumLock is off, numpad keys send arrow/navigation key values — honour those first
      if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') return key;
      const suffix = code.slice(6); // e.g. '0', '1', ..., '9', 'Multiply', 'Enter', 'Decimal', 'Subtract', 'Add', 'Divide'
      if (suffix >= '0' && suffix <= '9') return suffix;
      if (suffix === 'Multiply') return '*';
      if (suffix === 'Divide') return '/';
      if (suffix === 'Enter') return 'Enter';
      if (suffix === 'Decimal') return '.';
      if (suffix === 'Clear') return 'Clear';
      if (suffix === 'Add') return '+';
      if (suffix === 'Subtract') return '-';
      return null;
    }

    // Also accept regular number keys and * for non-numpad keyboards
    if (key >= '0' && key <= '9') return key;
    if (key === '*') return '*';
    if (key === '/') return '/';
    if (key === '+') return '+';
    if (key === '-') return '-';
    if (key === 'Enter') return 'Enter';
    if (key === 'Backspace') return 'Backspace';
    if (key === 'Clear' || key === 'Delete') return 'Clear';
    if (key === 'ArrowUp') return 'ArrowUp';
    if (key === 'ArrowDown') return 'ArrowDown';
    if (key === 'ArrowLeft') return 'ArrowLeft';
    if (key === 'ArrowRight') return 'ArrowRight';
    if (key === '.') return '.';

    return null;
  }

  /**
   * Handle keydown events.
   * @param {KeyboardEvent} event
   */
  _onKeyDown(event) {
    const key = this._normalizeKey(event);
    if (key === null) return; // Unrecognized key — ignore

    // Alias numpad digits 8/6/2/4 as arrow keys when not inside an overlay
    const DIGIT_ARROW_MAP = { '8': 'ArrowUp', '6': 'ArrowRight', '2': 'ArrowDown', '4': 'ArrowLeft' };
    const effectiveKey = (!this.overlayManager.isOpen() && DIGIT_ARROW_MAP[key])
      ? DIGIT_ARROW_MAP[key] : key;

    // Ensure AudioContext is initialized on first user gesture
    if (this.audioManager) {
      this.audioManager._ensureContext();
    }

    // Stealth mode: any key exits stealth, no other action
    if (this.renderer.stealth) {
      event.preventDefault();
      this.renderer.toggleStealth();
      this.renderer.applyStealth(this.state.phase);
      return;
    }

    // When overlay is open, route ALL input to overlay
    if (this.overlayManager.isOpen()) {
      event.preventDefault();
      this.overlayManager.handleKey(effectiveKey);
      return;
    }

    // --- Time-setting mode ---
    if (this._timeSettingMode) {
      event.preventDefault();
      this._handleTimeSettingKey(effectiveKey);
      return;
    }

    // Arrow keys enter time-setting mode (only when idle)
    if ((effectiveKey === 'ArrowUp' || effectiveKey === 'ArrowDown' || effectiveKey === 'ArrowLeft' || effectiveKey === 'ArrowRight') &&
        this.state.phase === PHASES.IDLE) {
      // Block if a training/competition preset with custom round durations is active
      // (user must long-press Enter to cancel first)
      if (this.state.roundDurations) return;
      event.preventDefault();
      this._enterTimeSetting();
      return;
    }

    // Overlay is closed — handle main controls
    event.preventDefault();
    switch (effectiveKey) {
      case 'Enter':
        // Long-press detection: defer action until keyup or 800ms timeout
        if (event.repeat) break; // Ignore key repeat events
        this._enterDownTime = Date.now();
        this._enterHandledAsLong = false;
        this._enterDownHandled = true;
        this._enterLongPressTimer = setTimeout(() => {
          this._enterHandledAsLong = true;
          this._handleEnterLongPress();
        }, 800);
        break;
      case '0':
        // Shortcut for long-press Enter (stop/cancel/reset)
        this._handleEnterLongPress();
        break;
      case 'Clear':
        // Disabled — reset is now handled via long-press Enter when idle
        break;
      case '/':
        // Toggle competition presets menu (only when idle)
        if (this.state.phase !== PHASES.IDLE) break;
        if (this.overlayManager.isOpen()) {
          this.overlayManager.closeOverlay();
        } else {
          this.overlayManager.showCompetitionMenu({ ...this.state.config }, (updatedConfig) => {
            this._applyMenuConfig(updatedConfig);
          });
        }
        break;
      case '*':
        // Toggle training presets menu (only when idle)
        if (this.state.phase !== PHASES.IDLE) break;
        if (this.overlayManager.isOpen()) {
          this.overlayManager.closeOverlay();
        } else {
          this.overlayManager.showTrainingMenu({ ...this.state.config }, (updatedConfig) => {
            this._applyMenuConfig(updatedConfig);
          });
        }
        break;
      default:
        // '.' toggles stealth mode
        if (effectiveKey === '.') {
          this.renderer.toggleStealth();
          this.renderer.applyStealth(this.state.phase);
        }
        break;
    }
  }

  /**
   * Activate dual timer mode.
   */
  _activateDualMode() {
    if (this._dualMode) return;
    this._dualMode = true;

    const config2 = { ...StorageManager.load() };
    this._dualState = createTimerState(config2);
    this._dualState.config.numRounds = 0;
    this.state.config.numRounds = 0;
    this.state._presetName = 'Dual Timer';

    const panel2 = document.getElementById('timer-panel-2');
    if (panel2) panel2.style.display = '';
    const container = document.getElementById('dual-timer-container');
    if (container) container.classList.add('dual-mode');

    this._dualRendererEls = {
      roundTimerEl: document.getElementById('round-timer-2'),
      restTimerEl: document.getElementById('rest-timer-2'),
    };

    const dualState = this._dualState;
    this._dualEngine = new TimerEngine(dualState,
      (s) => {
        if (s.phase === PHASES.ROUND) {
          this._updateTimer2Display(this._dualRendererEls.roundTimerEl, s.remainingSec, true);
          this._updateTimer2Display(this._dualRendererEls.restTimerEl, s.config.restDurationSec, false);
        } else if (s.phase === PHASES.REST) {
          this._updateTimer2Display(this._dualRendererEls.roundTimerEl, s.config.roundDurationSec, false);
          this._updateTimer2Display(this._dualRendererEls.restTimerEl, s.remainingSec, true);
        }
      },
      (s, oldPhase, newPhase) => {
        if (newPhase === PHASES.ROUND) this.audioManager.playRoundStartFanfare();
      }
    );

    const origTick2 = this._dualEngine.tick.bind(this._dualEngine);
    this._dualEngine.tick = () => {
      const alert = origTick2();
      if (alert.type === 'end_round') this.audioManager.playEndOfRoundBeep();
      else if (alert.type === 'end_rest') this.audioManager.playEndOfRestBeep();
      else if (alert.type === 'countdown') this.audioManager.playCountdownBeep();
      return alert;
    };

    this._updateTimer2Display(this._dualRendererEls.roundTimerEl, this._dualState.config.roundDurationSec, false);
    this._updateTimer2Display(this._dualRendererEls.restTimerEl, this._dualState.config.restDurationSec, false);
    this.renderer.updatePresetLabel('Dual Timer');
    this.renderer.updateRoundCounter(0, 0);
    this.renderer.updateRoundDisplay(this.state.config.roundDurationSec, false);
    this.renderer.updateRestDisplay(this.state.config.restDurationSec, false);
  }

  _deactivateDualMode() {
    if (!this._dualMode) return;
    this._dualMode = false;
    if (this._dualEngine) { this._dualEngine.stop(); this._dualEngine = null; }
    this._dualState = null;
    const panel2 = document.getElementById('timer-panel-2');
    if (panel2) panel2.style.display = 'none';
    const container = document.getElementById('dual-timer-container');
    if (container) container.classList.remove('dual-mode');
    this._dualRendererEls = null;
  }

  _updateTimer2Display(el, remainingSec, isActive) {
    if (!el) return;
    const mins = String(Math.floor(remainingSec / 60)).padStart(2, '0');
    const secs = String(remainingSec % 60).padStart(2, '0');
    el.innerHTML = `<span class="ts-minutes">${mins}</span>:<span class="ts-seconds">${secs}</span>`;
    el.style.opacity = isActive ? '1' : '0.4';
  }

  /**
   * Enter time-setting mode, starting at round minutes.
   */
  _enterTimeSetting() {
    this._timeSettingMode = true;
    this._timeSettingField = 'round-min';
    const timerArea = document.getElementById('timer-area');
    if (timerArea) timerArea.classList.add('time-setting-active');
    document.body.classList.add('time-setting');
    this._renderTimeSettingDisplay();
    this._updateTimeSettingBar();
  }

  /**
   * Exit time-setting mode and clean up blinking.
   */
  _exitTimeSetting() {
    this._timeSettingMode = false;
    this._timeSettingField = null;
    this.renderer.roundTimerEl.classList.remove('time-setting-minutes', 'time-setting-seconds');
    this.renderer.restTimerEl.classList.remove('time-setting-minutes', 'time-setting-seconds');
    if (this._dualRendererEls) {
      const rt2 = this._dualRendererEls.roundTimerEl;
      const xt2 = this._dualRendererEls.restTimerEl;
      if (rt2) rt2.classList.remove('time-setting-minutes', 'time-setting-seconds');
      if (xt2) xt2.classList.remove('time-setting-minutes', 'time-setting-seconds');
    }
    const timerArea = document.getElementById('timer-area');
    if (timerArea) timerArea.classList.remove('time-setting-active');
    document.body.classList.remove('time-setting');
    const bar = document.getElementById('edit-instruction-bar');
    if (bar) { bar.classList.remove('active'); bar.innerHTML = ''; }
  }

  /**
   * Render the timer display with span-wrapped digit groups for selective blinking.
   */
  _renderTimeSettingDisplay() {
    this.renderer.updateRoundDisplay(this.state.config.roundDurationSec, false);
    this.renderer.updateRestDisplay(this.state.config.restDurationSec, false);

    this.renderer.roundTimerEl.classList.remove('time-setting-minutes', 'time-setting-seconds');
    this.renderer.restTimerEl.classList.remove('time-setting-minutes', 'time-setting-seconds');

    if (this._dualMode && this._dualState && this._dualRendererEls) {
      this._updateTimer2Display(this._dualRendererEls.roundTimerEl, this._dualState.config.roundDurationSec, false);
      this._updateTimer2Display(this._dualRendererEls.restTimerEl, this._dualState.config.restDurationSec, false);
      const rt2 = this._dualRendererEls.roundTimerEl;
      const xt2 = this._dualRendererEls.restTimerEl;
      if (rt2) rt2.classList.remove('time-setting-minutes', 'time-setting-seconds');
      if (xt2) xt2.classList.remove('time-setting-minutes', 'time-setting-seconds');
    }

    const field = this._timeSettingField;
    if (field === 'round-min') this.renderer.roundTimerEl.classList.add('time-setting-minutes');
    else if (field === 'round-sec') this.renderer.roundTimerEl.classList.add('time-setting-seconds');
    else if (field === 'rest-min') this.renderer.restTimerEl.classList.add('time-setting-minutes');
    else if (field === 'rest-sec') this.renderer.restTimerEl.classList.add('time-setting-seconds');
    else if (this._dualRendererEls) {
      const rt2 = this._dualRendererEls.roundTimerEl;
      const xt2 = this._dualRendererEls.restTimerEl;
      if (field === 't2-round-min' && rt2) rt2.classList.add('time-setting-minutes');
      else if (field === 't2-round-sec' && rt2) rt2.classList.add('time-setting-seconds');
      else if (field === 't2-rest-min' && xt2) xt2.classList.add('time-setting-minutes');
      else if (field === 't2-rest-sec' && xt2) xt2.classList.add('time-setting-seconds');
    }
  }

  /**
   * Show the instruction bar for time-setting mode.
   */
  _updateTimeSettingBar() {
    const bar = document.getElementById('edit-instruction-bar');
    if (!bar) return;
    const fieldLabels = this._dualMode ? {
      'round-min': 'T1 Round Min', 'round-sec': 'T1 Round Sec',
      'rest-min': 'T1 Rest Min', 'rest-sec': 'T1 Rest Sec',
      't2-round-min': 'T2 Round Min', 't2-round-sec': 'T2 Round Sec',
      't2-rest-min': 'T2 Rest Min', 't2-rest-sec': 'T2 Rest Sec'
    } : {
      'round-min': 'Round Minutes', 'round-sec': 'Round Seconds',
      'rest-min': 'Rest Minutes', 'rest-sec': 'Rest Seconds'
    };
    const label = fieldLabels[this._timeSettingField] || '';
    bar.innerHTML =
      `<div>Editing: ${label}</div>` +
      `<div class="edit-hint">` +
      `<span class="key-badge">+</span> / <span class="key-badge">−</span> adjust &nbsp; ` +
      `<span class="key-badge">◀▶</span> switch digits &nbsp; ` +
      `<span class="key-badge">▲▼</span> switch timer &nbsp; ` +
      `<span class="key-badge">Enter</span> <span class="key-badge">*</span> <span class="key-badge">/</span> exit` +
      `</div>`;
    bar.classList.add('active');
  }

  /**
   * Handle a key press while in time-setting mode.
   */
  _handleTimeSettingKey(key) {
    const field = this._timeSettingField;
    const dual = this._dualMode;

    // Navigation with dual mode support
    if (key === 'ArrowRight') {
      const nav = { 'round-min': 'round-sec', 'rest-min': 'rest-sec',
        'round-sec': dual ? 't2-round-min' : 'round-sec',
        'rest-sec': dual ? 't2-rest-min' : 'rest-sec',
        't2-round-min': 't2-round-sec', 't2-round-sec': 't2-round-sec',
        't2-rest-min': 't2-rest-sec', 't2-rest-sec': 't2-rest-sec' };
      this._timeSettingField = nav[field] || field;
      this._renderTimeSettingDisplay(); this._updateTimeSettingBar(); return;
    }
    if (key === 'ArrowLeft') {
      const nav = { 'round-min': 'round-min', 'round-sec': 'round-min',
        'rest-min': 'rest-min', 'rest-sec': 'rest-min',
        't2-round-min': 'round-sec', 't2-round-sec': 't2-round-min',
        't2-rest-min': 'rest-sec', 't2-rest-sec': 't2-rest-min' };
      this._timeSettingField = nav[field] || field;
      this._renderTimeSettingDisplay(); this._updateTimeSettingBar(); return;
    }
    if (key === 'ArrowDown') {
      const nav = { 'round-min': 'rest-min', 'round-sec': 'rest-sec',
        't2-round-min': 't2-rest-min', 't2-round-sec': 't2-rest-sec' };
      this._timeSettingField = nav[field] || field;
      this._renderTimeSettingDisplay(); this._updateTimeSettingBar(); return;
    }
    if (key === 'ArrowUp') {
      const nav = { 'rest-min': 'round-min', 'rest-sec': 'round-sec',
        't2-rest-min': 't2-round-min', 't2-rest-sec': 't2-round-sec' };
      this._timeSettingField = nav[field] || field;
      this._renderTimeSettingDisplay(); this._updateTimeSettingBar(); return;
    }

    if (key === '+' || key === '-') {
      this._adjustTimeSettingValue(key === '+' ? 1 : -1);
      return;
    }

    if (key === 'Enter' || key === '*' || key === '/' || key === '0') {
      StorageManager.save(this.state.config);
      this.state.remainingSec = this.state.config.roundDurationSec;
      if (this._dualMode && this._dualState) {
        this._dualState.remainingSec = this._dualState.config.roundDurationSec;
      }
      this._exitTimeSetting();

      if (key === 'Enter') {
        if (this.state.config.roundDurationSec === 0) {
          this.audioManager.playMuffle();
        } else {
          this.engine.start();
          if (this._dualMode && this._dualEngine) this._dualEngine.start();
        }
      } else if (key === '*') {
        this.overlayManager.showTrainingMenu({ ...this.state.config }, (updatedConfig) => {
          this._applyMenuConfig(updatedConfig);
        });
      } else if (key === '/') {
        this.overlayManager.showCompetitionMenu({ ...this.state.config }, (updatedConfig) => {
          this._applyMenuConfig(updatedConfig);
        });
      }
      return;
    }
  }

  /**
   * Adjust the value of the currently selected time-setting field.
   * @param {number} direction - +1 or -1
   */
  _adjustTimeSettingValue(direction) {
    const field = this._timeSettingField;
    const isTimer2 = field.startsWith('t2-');
    const baseField = isTimer2 ? field.substring(3) : field;
    const isRound = baseField === 'round-min' || baseField === 'round-sec';
    const configKey = isRound ? 'roundDurationSec' : 'restDurationSec';
    const targetState = isTimer2 ? this._dualState : this.state;
    if (!targetState) return;

    const totalSec = targetState.config[configKey];
    let mins = Math.floor(totalSec / 60);
    let secs = totalSec % 60;

    if (baseField === 'round-min' || baseField === 'rest-min') {
      mins += direction;
      if (mins < 0) mins = 0;
      if (mins > 30) mins = 30;
    } else {
      secs += direction * 5;
      if (secs > 55) secs = 0;
      if (secs < 0) secs = 55;
    }

    targetState.config[configKey] = mins * 60 + secs;
    if (!isTimer2) this._cancelPreset();
    this._renderTimeSettingDisplay();
  }

  /**
   * Apply config from a competition or training preset menu callback.
   * @param {Object} updatedConfig
   */
  _applyMenuConfig(updatedConfig) {
    this.state.config.roundDurationSec = updatedConfig.roundDurationSec;
    this.state.config.restDurationSec = updatedConfig.restDurationSec;
    this.state.config.numRounds = updatedConfig.numRounds;
    this.state.config.prepDurationSec = updatedConfig.prepDurationSec;
    if (updatedConfig.roundDurations) {
      this.state.roundDurations = updatedConfig.roundDurations;
      this.state.config.roundDurationSec = updatedConfig.roundDurations[0];
    } else {
      this.state.roundDurations = null;
    }
    if (updatedConfig.restDurations) {
      this.state.restDurations = updatedConfig.restDurations;
    } else {
      this.state.restDurations = null;
    }
    this.state._presetName = updatedConfig.presetName || null;
    this.renderer.updatePresetLabel(this.state._presetName);
    StorageManager.save(this.state.config);
    if (this.state.phase === PHASES.IDLE) {
      this.state.remainingSec = this.state.config.roundDurationSec;
      this.renderer.updateRoundDisplay(this.state.config.roundDurationSec, false);
      this.renderer.updateRestDisplay(this.state.config.restDurationSec, false);
      this.renderer.updateRoundCounter(0, this.state.config.numRounds);
      if (this.state.roundDurations) {
        this.renderer.updateRoundList(this.state.roundDurations, 0, this.state._presetName, this.state.restDurations, this.state.config.restDurationSec, this.renderer.getRemainingClassSec());
      } else {
        this.renderer.hideRoundList();
      }
    }
  }
  _cancelPreset() {
    this.state._presetName = null;
    this.state.roundDurations = null;
    this.state.restDurations = null;
    this.renderer.updatePresetLabel(null);
    this.renderer.hideRoundList();
  }



  /**
   * Remove the keydown listener (for cleanup/testing).
   */
  /**
   * Handle keyup events for Enter long-press detection.
   * @param {KeyboardEvent} event
   */
  _onKeyUp(event) {
    const key = event.key;
    if (key !== 'Enter') return;
    if (this._enterLongPressTimer) {
      clearTimeout(this._enterLongPressTimer);
      this._enterLongPressTimer = null;
    }
    // Ignore if the keydown was consumed by an overlay
    if (!this._enterDownHandled) return;
    this._enterDownHandled = false;
    if (!this._enterHandledAsLong) {
      this._handleEnterShortPress();
    }
    this._enterHandledAsLong = false;
  }

  /**
   * Short press Enter: start / pause / resume.
   */
  _handleEnterShortPress() {
    if (this.overlayManager.isOpen()) return;
    if (this.state.phase === PHASES.IDLE) {
      // Don't start if round duration is 0
      if (this.state.config.roundDurationSec === 0) {
        this.audioManager.playMuffle();
        return;
      }
      this.engine.start();
      if (this._dualMode && this._dualEngine) this._dualEngine.start();
    } else if (this.state.paused) {
      this.engine.resume();
      if (this._dualMode && this._dualEngine) this._dualEngine.resume();
      this.renderer.hidePauseOverlay();
      this.audioManager.playMuffle();
    } else {
      this.engine.pause();
      if (this._dualMode && this._dualEngine) this._dualEngine.pause();
      this.renderer.showPauseOverlay();
      this.audioManager.playMuffle();
    }
  }

  /**
   * Long press Enter: reset (when idle) or cancel/stop (when running/paused).
   */
  _handleEnterLongPress() {
    if (this.overlayManager.isOpen()) return;
    if (this.state.phase === PHASES.IDLE) {
      // Same as Clear/Reset — also deactivate dual mode
      this._deactivateDualMode();
      this.state.roundDurations = null;
      this.state.restDurations = null;
      this.state._presetName = null;
      this.state._quickTimerRestore = null;
      this.state.paused = false;
      if (this._resetCallback) {
        this._resetCallback();
      } else {
        this.state.config.roundDurationSec = DEFAULT_CONFIG.roundDurationSec;
        this.state.config.restDurationSec = DEFAULT_CONFIG.restDurationSec;
        this.state.config.numRounds = DEFAULT_CONFIG.numRounds;
        this.state.remainingSec = DEFAULT_CONFIG.roundDurationSec;
        StorageManager.save(this.state.config);
      }
      this.renderer.clearQuickTimerMode();
      this.renderer.updateRoundDisplay(this.state.config.roundDurationSec, false);
      this.renderer.updateRestDisplay(this.state.config.restDurationSec, false);
      this.renderer.updateRoundCounter(0, this.state.config.numRounds);
      this.renderer.updatePresetLabel(this.state._presetName);
      this.renderer.hidePrepCountdown();
      this.renderer.hideRoundList();
      this.renderer.hidePauseOverlay();
      this.renderer.hideRoundsOver();
      this.audioManager.playCancel();
    } else {
      // Same as Stop (key 0)
      if (this.state.paused) {
        this.renderer.hidePauseOverlay();
      }
      this.state._cancelledByUser = true;
      this.engine.stop();
      if (this._dualMode && this._dualEngine) {
        this._dualState._cancelledByUser = true;
        this._dualEngine.stop();
      }
      this.audioManager.playCancel();
      const rd = this.state.roundDurations;
      this.renderer.updateRoundDisplay(rd ? rd[0] : this.state.config.roundDurationSec, false);
      this.renderer.updateRestDisplay(this.state.config.restDurationSec, false);
      this.renderer.updateRoundCounter(0, rd ? rd.length : this.state.config.numRounds);
    }
  }

  destroy() {
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
  }
}

// --- WeatherManager ---

/**
 * Fetches current temperature from the Open-Meteo API.
 * Polls at a configurable interval. No API key required.
 */
class WeatherManager {
  /**
   * @param {function} onUpdate - Called with (temperatureStr) e.g. "72°F"
   */
  constructor(onUpdate) {
    this.onUpdate = onUpdate || function() {};
    this._pollingId = null;
  }

  /**
   * Fetch current temperature and start polling.
   */
  start() {
    if (!APP_SETTINGS.weather.enabled) return;
    this._fetchTemperature();
    const intervalMs = (APP_SETTINGS.weather.pollIntervalMin || 10) * 60 * 1000;
    this._pollingId = setInterval(() => this._fetchTemperature(), intervalMs);
  }

  /**
   * Stop polling.
   */
  stop() {
    if (this._pollingId !== null) {
      clearInterval(this._pollingId);
      this._pollingId = null;
    }
  }

  /**
   * Fetch temperature from Open-Meteo.
   * @private
   */
  async _fetchTemperature() {
    try {
      const w = APP_SETTINGS.weather;
      const unit = w.units === 'celsius' ? 'celsius' : 'fahrenheit';
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${w.latitude}&longitude=${w.longitude}&current=temperature_2m&temperature_unit=${unit}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!resp.ok) return;
      const data = await resp.json();
      if (data && data.current && typeof data.current.temperature_2m === 'number') {
        const temp = Math.round(data.current.temperature_2m);
        const symbol = unit === 'fahrenheit' ? '°F' : '°C';
        this.onUpdate(`${temp}${symbol}`);
      }
    } catch (e) {
      // Silently fail — temperature display just stays hidden or stale
    }
  }
}

// --- Schedule Constants ---

const VALID_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const VALID_CLASS_TYPES = ['kids', 'kids_advanced', 'kids_nogi', 'adult_basics', 'adult_all_levels', 'adult_advanced', 'drill', 'marathon_roll', 'open_mat'];
const SCHEDULE_STORAGE_KEY = 'bjj-timer-schedule';

// --- ClassPresetManager ---

/**
 * Maps class types to their default timer presets.
 * Supports overrides loaded from config.json.
 */
class ClassPresetManager {
  constructor() {
    this._presets = {
      kids:            { roundDurationSec: 180, restDurationSec: 30, numRounds: 0 },
      kids_advanced:   { roundDurationSec: 180, restDurationSec: 30, numRounds: 0 },
      kids_nogi:       { roundDurationSec: 180, restDurationSec: 30, numRounds: 0 },
      adult_basics:    { roundDurationSec: 300, restDurationSec: 60, numRounds: 0 },
      adult_all_levels:{ roundDurationSec: 300, restDurationSec: 60, numRounds: 0 },
      adult_advanced:  { roundDurationSec: 360, restDurationSec: 60, numRounds: 0 },
      drill:           { roundDurationSec: 300, restDurationSec: 60, numRounds: 0 },
      marathon_roll:   { roundDurationSec: 600, restDurationSec: 30, numRounds: 0 },
      open_mat:        { roundDurationSec: 300, restDurationSec: 60, numRounds: 0 }
    };
  }

  /**
   * Return TimerPreset for the given classType.
   * Returns a copy to prevent external mutation.
   * @param {string} classType - One of the valid class types
   * @returns {Object|null} TimerPreset or null if classType is unknown
   */
  getPreset(classType) {
    const preset = this._presets[classType];
    if (!preset) return null;
    return { ...preset };
  }

  /**
   * Merge partial overrides from config.json into the preset map.
   * Only overrides for known class types and known fields are applied.
   * @param {Object} overrides - Object keyed by classType with partial TimerPreset fields
   */
  applyOverrides(overrides) {
    if (!overrides || typeof overrides !== 'object') return;
    for (const classType of Object.keys(overrides)) {
      if (!this._presets[classType]) continue;
      const override = overrides[classType];
      if (!override || typeof override !== 'object') continue;
      if (typeof override.roundDurationSec === 'number') {
        this._presets[classType].roundDurationSec = override.roundDurationSec;
      }
      if (typeof override.restDurationSec === 'number') {
        this._presets[classType].restDurationSec = override.restDurationSec;
      }
      if (typeof override.numRounds === 'number') {
        this._presets[classType].numRounds = override.numRounds;
      }
    }
  }

  /**
   * Return the full default preset map (copies of all presets).
   * @returns {Object} Map of classType → TimerPreset
   */
  getDefaultPresets() {
    const result = {};
    for (const key of Object.keys(this._presets)) {
      result[key] = { ...this._presets[key] };
    }
    return result;
  }
}

// --- ScheduleManager ---

/**
 * Loads the class schedule from config.json, validates entries,
 * determines the active class, and triggers preset loading on class transitions.
 * Polls every 30 seconds.
 */
class ScheduleManager {
  /**
   * @param {ClassPresetManager} presetManager
   * @param {function} onActiveClassChange - Called with (activeClass) when active class changes
   * @param {function} onError - Called with (errorMsg) on config load failure
   */
  constructor(presetManager, onActiveClassChange, onError) {
    this.presetManager = presetManager;
    this.onActiveClassChange = onActiveClassChange || function() {};
    this.onError = onError || function() {};
    this._schedule = [];
    this._lastActiveClassTitle = null;
    this._pollingId = null;
  }

  /**
   * Fetch config.json via HTTP GET, parse JSON, validate entries,
   * cache to localStorage, and apply preset overrides.
   * Falls back to cached schedule on failure.
   */
  async loadConfig() {
    try {
      const response = await fetch('config.json');
      if (!response.ok) {
        throw new Error('Could not load schedule');
      }

      let data;
      try {
        data = await response.json();
      } catch (e) {
        throw new Error('Invalid config.json format');
      }

      if (!data || !Array.isArray(data.schedule)) {
        throw new Error('config.json missing schedule data');
      }

      // Validate entries
      const validEntries = [];
      data.schedule.forEach((entry, index) => {
        const result = this.validateEntry(entry);
        if (result.valid) {
          validEntries.push(entry);
        } else {
          console.warn(`Class entry ${index}: ${result.errors.join(', ')}`);
        }
      });

      this._schedule = validEntries;

      // Apply app-wide settings from config.json (defaults, audio, competition presets)
      applyConfigSettings(data);

      // Apply preset overrides if present
      if (data.presetOverrides && typeof data.presetOverrides === 'object') {
        this.presetManager.applyOverrides(data.presetOverrides);
      }

      // Cache to localStorage
      try {
        localStorage.setItem(SCHEDULE_STORAGE_KEY, JSON.stringify({
          schedule: validEntries,
          presetOverrides: data.presetOverrides || {},
          lastLoaded: new Date().toISOString()
        }));
      } catch (e) {
        // localStorage unavailable — continue without caching
      }

    } catch (err) {
      // Fall back to cached schedule
      this._loadFromCache();
      this.onError(err.message);
    }
  }

  /**
   * Load schedule from localStorage cache.
   * @private
   */
  _loadFromCache() {
    try {
      const raw = localStorage.getItem(SCHEDULE_STORAGE_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached && Array.isArray(cached.schedule)) {
          this._schedule = cached.schedule;
          if (cached.presetOverrides) {
            this.presetManager.applyOverrides(cached.presetOverrides);
          }
          return;
        }
      }
    } catch (e) {
      // Corrupted cache — ignore
    }
    this._schedule = [];
  }

  /**
   * Validate a single ClassEntry object.
   * @param {Object} entry - The entry to validate
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validateEntry(entry) {
    const errors = [];

    if (!entry || typeof entry !== 'object') {
      return { valid: false, errors: ['Entry is not an object'] };
    }

    // dayOfWeek
    if (typeof entry.dayOfWeek !== 'string' || !VALID_DAYS.includes(entry.dayOfWeek)) {
      errors.push(`invalid dayOfWeek '${entry.dayOfWeek}'`);
    }

    // startTime
    if (!this._isValidTime(entry.startTime)) {
      errors.push(`invalid startTime '${entry.startTime}'`);
    }

    // endTime
    if (!this._isValidTime(entry.endTime)) {
      errors.push(`invalid endTime '${entry.endTime}'`);
    }

    // startTime must be before endTime
    if (this._isValidTime(entry.startTime) && this._isValidTime(entry.endTime)) {
      if (entry.startTime >= entry.endTime) {
        errors.push('startTime must be before endTime');
      }
    }

    // title
    if (typeof entry.title !== 'string' || entry.title.trim() === '') {
      errors.push('title must be a non-empty string');
    }

    // classType
    if (typeof entry.classType !== 'string' || !VALID_CLASS_TYPES.includes(entry.classType)) {
      errors.push(`invalid classType '${entry.classType}'`);
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate a time string in HH:MM format.
   * @param {string} time
   * @returns {boolean}
   * @private
   */
  _isValidTime(time) {
    if (typeof time !== 'string') return false;
    const match = time.match(/^(\d{2}):(\d{2})$/);
    if (!match) return false;
    const h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    return h >= 0 && h <= 23 && m >= 0 && m <= 59;
  }

  /**
   * Return the ClassEntry matching the current day/time, or null.
   * Uses first match on overlap.
   * @param {Date} now
   * @returns {Object|null}
   */
  getActiveClass(now) {
    const dayName = VALID_DAYS[now.getDay() === 0 ? 6 : now.getDay() - 1];
    const nowTime = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

    for (const entry of this._schedule) {
      if (entry.dayOfWeek === dayName && nowTime >= entry.startTime && nowTime < entry.endTime) {
        return entry;
      }
    }
    return null;
  }

  /**
   * Return the chronologically next ClassEntry relative to now, or null.
   * Wraps around to next week if needed.
   * @param {Date} now
   * @returns {Object|null}
   */
  getNextClass(now) {
    if (this._schedule.length === 0) return null;

    const currentDayIndex = now.getDay() === 0 ? 6 : now.getDay() - 1;
    const nowTime = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

    let bestEntry = null;
    let bestDaysAhead = Infinity;
    let bestStartTime = '';

    for (const entry of this._schedule) {
      const entryDayIndex = VALID_DAYS.indexOf(entry.dayOfWeek);
      if (entryDayIndex === -1) continue;

      let daysAhead = entryDayIndex - currentDayIndex;
      if (daysAhead < 0) daysAhead += 7;

      // Same day: only consider if start time is in the future
      if (daysAhead === 0 && entry.startTime <= nowTime) {
        daysAhead = 7; // Wrap to next week
      }

      if (daysAhead < bestDaysAhead || (daysAhead === bestDaysAhead && entry.startTime < bestStartTime)) {
        bestDaysAhead = daysAhead;
        bestStartTime = entry.startTime;
        bestEntry = entry;
      }
    }

    return bestEntry;
  }

  /**
   * Start 30-second polling interval to check for active class changes.
   */
  startPolling() {
    this.stopPolling();
    this._pollingId = setInterval(() => {
      this._checkActiveClass();
    }, 30000);
    // Also check immediately
    this._checkActiveClass();
  }

  /**
   * Stop the polling interval.
   */
  stopPolling() {
    if (this._pollingId !== null) {
      clearInterval(this._pollingId);
      this._pollingId = null;
    }
  }

  /**
   * Check if the active class has changed and fire callback if so.
   * @private
   */
  _checkActiveClass() {
    const now = new Date();
    const active = this.getActiveClass(now);
    const activeTitle = active ? active.title + active.startTime : null;

    if (activeTitle !== this._lastActiveClassTitle) {
      this._lastActiveClassTitle = activeTitle;
      this.onActiveClassChange(active);
    }
  }
}

// Export for testing (Node.js / Vitest)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { formatTime, parseTimeInput, isNumeric, generateRoundDurations, DEFAULT_CONFIG, APP_SETTINGS, applyConfigSettings, PHASES, STORAGE_KEY, StorageManager, createTimerState, TimerEngine, AudioManager, Renderer, ClassProgressRenderer, OverlayManager, InputHandler, ClassPresetManager, ScheduleManager, WeatherManager, VALID_DAYS, VALID_CLASS_TYPES, SCHEDULE_STORAGE_KEY };
}

// --- Application Initialization ---
// Only run in browser (not in Node.js test environment)
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    // --- Debug mode ---
    const urlParams = new URLSearchParams(window.location.search);
    const isDebug = urlParams.get('debug') === 'true';
    let debugScheduleEntry = null;

    if (isDebug) {
      const title = prompt('Class title:', 'Adult Basics') || 'Adult Basics';
      const minInput = parseInt(prompt('Minutes before class end (negative = minutes before class starts):', '15'), 10) || 15;

      const now = new Date();
      const dayOfWeek = VALID_DAYS[now.getDay() === 0 ? 6 : now.getDay() - 1];

      // Map title to a classType (best guess)
      const titleLower = title.toLowerCase();
      let classType = 'adult_basics';
      if (titleLower.includes('kid') && titleLower.includes('advanced')) classType = 'kids_advanced';
      else if (titleLower.includes('kid') && titleLower.includes('no-gi')) classType = 'kids_nogi';
      else if (titleLower.includes('kid')) classType = 'kids';
      else if (titleLower.includes('advanced')) classType = 'adult_advanced';
      else if (titleLower.includes('all level')) classType = 'adult_all_levels';
      else if (titleLower.includes('drill')) classType = 'drill';
      else if (titleLower.includes('marathon')) classType = 'marathon_roll';
      else if (titleLower.includes('open')) classType = 'open_mat';

      if (minInput < 0) {
        // Negative: class starts in |minInput| minutes from now
        const minUntilStart = Math.abs(minInput);
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const startMin = nowMin + minUntilStart;
        const startH = Math.floor(startMin / 60) % 24;
        const startM = startMin % 60;
        const startTime = String(startH).padStart(2, '0') + ':' + String(startM).padStart(2, '0');
        const endMin = startMin + 60; // 60 minute class
        const endH = Math.floor(endMin / 60) % 24;
        const endM = endMin % 60;
        const endTime = String(endH).padStart(2, '0') + ':' + String(endM).padStart(2, '0');

        debugScheduleEntry = { dayOfWeek, startTime, endTime, title, classType };
        console.log('[DEBUG] Injected future schedule entry (starts in ' + minUntilStart + 'm):', debugScheduleEntry);
      } else {
        // Positive: class ends in minInput minutes from now (already in class)
        const minBefore = minInput;
        const endMin = now.getHours() * 60 + now.getMinutes() + minBefore;
        const endH = Math.floor(endMin / 60) % 24;
        const endM = endMin % 60;
        const endTime = String(endH).padStart(2, '0') + ':' + String(endM).padStart(2, '0');

        const classDurationMin = Math.max(minBefore + 15, 60);
        const startMin = endMin - classDurationMin;
        const startH = Math.floor(((startMin % 1440) + 1440) % 1440 / 60);
        const startM = ((startMin % 60) + 60) % 60;
        const startTime = String(startH).padStart(2, '0') + ':' + String(startM).padStart(2, '0');

        debugScheduleEntry = { dayOfWeek, startTime, endTime, title, classType };
        console.log('[DEBUG] Injected active schedule entry (ends in ' + minBefore + 'm):', debugScheduleEntry);
      }
    }

    // 1. Load persisted config
    const config = StorageManager.load();

    // 2. Create timer state from config
    const state = createTimerState(config);

    // 3. Create UI and audio components
    const renderer = new Renderer();
    const audioManager = new AudioManager();
    // Eagerly create AudioContext so it's ready for end-of-class ring
    audioManager._ensureContext();
    const presetManager = new ClassPresetManager();
    const classProgress = new ClassProgressRenderer();

    // Set initial idle state for layout
    document.body.classList.add('timer-idle');

    // 4. Pending class type for deferred preset loading (Req 19.3, 19.4)
    let pendingClassType = null;
    let hadActiveClass = false; // Track for end-of-class ring

    // 5. Create TimerEngine with tick and phase-change callbacks
    const engine = new TimerEngine(state,
      // onTick — update displays each second
      (s) => {
        renderer.updateClockDisplay();
        if (s.phase === PHASES.ROUND) {
          renderer.updateRoundDisplay(s.remainingSec, true);
          const restIdx = s.currentRound - 1;
          const inactiveRest = s.restDurations ? s.restDurations[restIdx % s.restDurations.length] : s.config.restDurationSec;
          renderer.updateRestDisplay(inactiveRest, false);
        } else if (s.phase === PHASES.REST) {
          const nextRoundIdx = s.currentRound; // 0-based for next round
          const inactiveRound = s.roundDurations ? s.roundDurations[nextRoundIdx % s.roundDurations.length] : s.config.roundDurationSec;
          renderer.updateRoundDisplay(inactiveRound, false);
          renderer.updateRestDisplay(s.remainingSec, true);
        } else if (s.phase === PHASES.PREP) {
          renderer.showPrepCountdown(s.remainingSec);
        }
        renderer.updateRoundCounter(s.currentRound, s.roundDurations ? s.roundDurations.length : s.config.numRounds);
        // Update round list if training preset is active
        if (s.roundDurations) {
          renderer.updateRoundList(s.roundDurations, s.currentRound, s._presetName, s.restDurations, s.config.restDurationSec, renderer.getRemainingClassSec());
        }
        // Re-apply stealth visibility each tick (rest shows/hides based on phase)
        if (renderer.stealth) renderer.applyStealth(s.phase);
      },
      // onPhaseChange — handle transitions and deferred preset loading
      (s, oldPhase, newPhase) => {
        if (newPhase === PHASES.ROUND) {
          audioManager.playRoundStartFanfare();
        }
        if (oldPhase === PHASES.PREP && newPhase === PHASES.ROUND) {
          renderer.hidePrepCountdown();
        }
        // Hide rounds-over overlay when starting a new session
        if (oldPhase === PHASES.IDLE && newPhase === PHASES.PREP) {
          renderer.hideRoundsOver();
        }
        // "Rounds Over" announcement when last round ends naturally (ROUND → IDLE via stop())
        if (newPhase === PHASES.IDLE && oldPhase === PHASES.ROUND && !s._cancelledByUser) {
          const msg = s._quickTimerRestore ? "Time's Up" : 'Rounds Over';
          renderer.showRoundsOver(msg);
          const rd = s.roundDurations;
          renderer.updateRoundDisplay(rd ? rd[0] : s.config.roundDurationSec, false);
          renderer.updateRestDisplay(s.config.restDurationSec, false);
          renderer.updateRoundCounter(0, rd ? rd.length : s.config.numRounds);
        }
        s._cancelledByUser = false;
        // Restore config after quick timer ends
        if (newPhase === PHASES.IDLE && s._quickTimerRestore) {
          const r = s._quickTimerRestore;
          s.config.roundDurationSec = r.roundDurationSec;
          s.config.restDurationSec = r.restDurationSec;
          s.config.numRounds = r.numRounds;
          s.config.prepDurationSec = r.prepDurationSec;
          s.remainingSec = r.roundDurationSec;
          s.roundDurations = r.roundDurations;
          s.restDurations = r.restDurations;
          s._presetName = r.presetName || null;
          s._quickTimerRestore = null;
          renderer.clearQuickTimerMode();
          renderer.updatePresetLabel(s._presetName);
          renderer.updateRoundDisplay(s.config.roundDurationSec, false);
          renderer.updateRestDisplay(s.config.restDurationSec, false);
          renderer.updateRoundCounter(0, s.config.numRounds);
        }
        // When session stops and there's a pending class preset, apply it (Req 19.3, 19.4)
        if (newPhase === PHASES.IDLE && pendingClassType) {
          const preset = presetManager.getPreset(pendingClassType);
          if (preset) {
            s.config.roundDurationSec = preset.roundDurationSec;
            s.config.restDurationSec = preset.restDurationSec;
            s.config.numRounds = preset.numRounds;
            s.remainingSec = preset.roundDurationSec;
            StorageManager.save(s.config);
            renderer.updateRoundDisplay(s.config.roundDurationSec, false);
            renderer.updateRestDisplay(s.config.restDurationSec, false);
            renderer.updateRoundCounter(0, s.config.numRounds);
          }
          pendingClassType = null;
        }
        // Reset round list to preview when session ends (preserve if preset active)
        if (newPhase === PHASES.IDLE) {
          if (s.roundDurations) {
            renderer.updateRoundList(s.roundDurations, 0, s._presetName, s.restDurations, s.config.restDurationSec, renderer.getRemainingClassSec());
          } else {
            renderer.hideRoundList();
          }
        }
        // Update Start/Stop label and idle state
        renderer.updateStartStopLabel(newPhase !== PHASES.IDLE);
        // Toggle idle class for layout animation
        document.body.classList.toggle('timer-idle', newPhase === PHASES.IDLE && !state.paused);
      }
    );

    // 6. Wrap tick to integrate alert-driven audio and visual feedback
    const originalTick = engine.tick.bind(engine);
    engine.tick = function() {
      const currentPhase = state.phase;
      const alert = originalTick();

      // Prep countdown beeps
      if (currentPhase === PHASES.PREP && alert.remainingSec >= 0 && alert.remainingSec <= state.config.prepDurationSec - 1) {
        audioManager.playPrepBeep(alert.remainingSec + 1, state.config.prepDurationSec);
      }

      // Round/rest countdown alerts
      if (alert.type === 'countdown') {
        audioManager.playCountdownBeep();
        if (state.phase === PHASES.ROUND) renderer.applyFlash(renderer.roundTimerEl);
        if (state.phase === PHASES.REST) renderer.applyFlash(renderer.restTimerEl);
      } else if (alert.type === 'end_round') {
        console.log('[AUDIO] end_round alert — playing bell');
        audioManager.playEndOfRoundBeep();
        renderer.applyScreenFlash();
      } else if (alert.type === 'end_rest') {
        audioManager.playEndOfRestBeep();
        renderer.applyScreenFlash();
      }

      // Uplifting fanfare when transitioning from PREP to ROUND — handled in onPhaseChange

      return alert;
    };

    // 7. Create overlay and input handler
    const overlayManager = new OverlayManager();
    const inputHandler = new InputHandler(engine, overlayManager, renderer, audioManager, state);

    // 8. Create ScheduleManager with automatic preset loading (Req 19.1–19.4)
    const scheduleManager = new ScheduleManager(
      presetManager,
      // onActiveClassChange
      (activeClass) => {
        if (!APP_SETTINGS.scheduleEnabled) {
          renderer.updateScheduleDisplay(null, null, null);
          renderer.updateNextClassDisplay(null);
          classProgress.setActiveClass(null);
          return;
        }
        const now = new Date();
        const nextClass = scheduleManager.getNextClass(now);
        renderer.updateScheduleDisplay(activeClass, nextClass, null);
        renderer.updateNextClassDisplay(activeClass ? nextClass : null);
        classProgress.setActiveClass(activeClass);

        if (activeClass) {
          hadActiveClass = true;
          if (state.phase === PHASES.IDLE) {
            // Open Mat: use Blue Belt competition preset and auto-start
            if (activeClass.classType === 'open_mat') {
              const blueBelt = APP_SETTINGS.competitionPresets['Blue Belt'];
              if (blueBelt) {
                state.config.roundDurationSec = blueBelt.roundDurationSec;
                state.config.restDurationSec = blueBelt.restDurationSec;
                state.config.numRounds = blueBelt.numRounds;
                state.remainingSec = blueBelt.roundDurationSec;
                StorageManager.save(state.config);
                renderer.updateRoundDisplay(state.config.roundDurationSec, false);
                renderer.updateRestDisplay(state.config.restDurationSec, false);
                renderer.updateRoundCounter(0, state.config.numRounds);
              }
              state._presetName = activeClass.title;
              renderer.updatePresetLabel(activeClass.title);
              engine.start();
            } else {
              // Apply preset immediately (Req 19.4)
              const preset = presetManager.getPreset(activeClass.classType);
              if (preset) {
                state.config.roundDurationSec = preset.roundDurationSec;
                state.config.restDurationSec = preset.restDurationSec;
                state.config.numRounds = preset.numRounds;
                state.remainingSec = preset.roundDurationSec;
                StorageManager.save(state.config);
                renderer.updateRoundDisplay(state.config.roundDurationSec, false);
                renderer.updateRestDisplay(state.config.restDurationSec, false);
                renderer.updateRoundCounter(0, state.config.numRounds);
              }
              state._presetName = activeClass.title;
              renderer.updatePresetLabel(activeClass.title);
            }
          } else {
            // Defer preset loading until session stops (Req 19.3)
            pendingClassType = activeClass.classType;
          }
        } else {
          if (hadActiveClass) {
            audioManager.playEndOfClassRing();
            hadActiveClass = false;
          }
          pendingClassType = null;
        }
      },
      // onError
      (errorMsg) => {
        if (!APP_SETTINGS.scheduleEnabled) return;
        const now = new Date();
        const nextClass = scheduleManager.getNextClass(now);
        renderer.updateScheduleDisplay(null, nextClass, errorMsg);
        renderer.updateNextClassDisplay(null);
      }
    );

    // 8b. Wire up key 9 reset: use active class preset or fall back to DEFAULT_CONFIG
    inputHandler._scheduleManager = scheduleManager;
    overlayManager._onScheduleToggle = (enabled) => {
      if (enabled) {
        const now = new Date();
        const active = scheduleManager.getActiveClass(now);
        const next = scheduleManager.getNextClass(now);
        renderer.updateScheduleDisplay(active, next, null);
        renderer.updateNextClassDisplay(active ? next : null);
        classProgress.setActiveClass(active);
        scheduleManager.startPolling();
      } else {
        renderer.updateScheduleDisplay(null, null, null);
        renderer.updateNextClassDisplay(null);
        classProgress.setActiveClass(null);
      }
    };
    inputHandler._resetCallback = () => {
      const now = new Date();
      const active = APP_SETTINGS.scheduleEnabled ? scheduleManager.getActiveClass(now) : null;
      const preset = active ? presetManager.getPreset(active.classType) : null;
      const src = preset || { ...DEFAULT_CONFIG };
      state.config.roundDurationSec = src.roundDurationSec;
      state.config.restDurationSec = src.restDurationSec;
      state.config.numRounds = src.numRounds;
      state.remainingSec = src.roundDurationSec;
      state._presetName = active ? active.title : null;
      StorageManager.save(state.config);
    };

    // 9. Initial render
    renderer.updateClockDisplay();
    renderer.updateRoundDisplay(state.config.roundDurationSec, false);
    renderer.updateRestDisplay(state.config.restDurationSec, false);
    renderer.updateRoundCounter(0, state.config.numRounds);
    renderer.updatePresetLabel(null);

    // 10. Load schedule from config.json and start polling
    const initSchedule = isDebug && debugScheduleEntry
      ? Promise.resolve().then(() => {
          // Inject debug entry directly into schedule manager
          scheduleManager._schedule = [debugScheduleEntry];
          const preset = presetManager.getPreset(debugScheduleEntry.classType);
          if (preset && debugScheduleEntry.classType) {
            // Apply preset overrides if any exist in config
          }
          scheduleManager._checkActiveClass();
        })
      : scheduleManager.loadConfig();

    initSchedule.then(() => {
      if (APP_SETTINGS.scheduleEnabled) {
        const now = new Date();
        const active = scheduleManager.getActiveClass(now);
        const next = scheduleManager.getNextClass(now);
        renderer.updateScheduleDisplay(active, next, null);
        renderer.updateNextClassDisplay(active ? next : null);
        classProgress.setActiveClass(active);
      }
      scheduleManager.startPolling();

      // 10b. Start weather polling (after config loaded so overrides are applied)
      const weatherManager = new WeatherManager((tempStr) => {
        renderer.updateTemperature(tempStr);
      });
      weatherManager.start();
    });

    // 11. Wall clock update every second
    setInterval(() => {
      renderer.updateClockDisplay();
      classProgress.draw();
    }, 1000);

    // 12. Re-read config.json every 30 minutes to pick up schedule syncs
    setInterval(() => {
      scheduleManager.loadConfig().then(() => {
        const now = new Date();
        const active = scheduleManager.getActiveClass(now);
        const next = scheduleManager.getNextClass(now);
        renderer.updateScheduleDisplay(active, next, null);
        renderer.updateNextClassDisplay(active ? next : null);
        classProgress.setActiveClass(active);
      });
    }, 30 * 60 * 1000);

    // 13. Refresh schedule and next class displays every 60 seconds
    setInterval(() => {
      if (!APP_SETTINGS.scheduleEnabled) return;
      const now = new Date();
      const active = scheduleManager.getActiveClass(now);
      const next = scheduleManager.getNextClass(now);
      renderer.updateScheduleDisplay(active, next, null);
      renderer.updateNextClassDisplay(active ? next : null);
    }, 60000);
  });
}
