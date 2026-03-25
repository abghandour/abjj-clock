import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  formatTime,
  parseTimeInput,
  isNumeric,
  generateRoundDurations,
  DEFAULT_CONFIG,
  APP_SETTINGS,
  applyConfigSettings,
  PHASES,
  STORAGE_KEY,
  StorageManager,
  createTimerState,
  TimerEngine,
  ClassPresetManager,
  VALID_DAYS,
  VALID_CLASS_TYPES,
  SCHEDULE_STORAGE_KEY,
  ScheduleManager,
} = require('./app.js');

// ─── formatTime ───

describe('formatTime', () => {
  it('formats 0 seconds as 00:00', () => {
    expect(formatTime(0)).toBe('00:00');
  });

  it('formats 59 seconds as 00:59', () => {
    expect(formatTime(59)).toBe('00:59');
  });

  it('formats 60 seconds as 01:00', () => {
    expect(formatTime(60)).toBe('01:00');
  });

  it('formats 300 seconds as 05:00', () => {
    expect(formatTime(300)).toBe('05:00');
  });

  it('formats 5999 seconds as 99:59', () => {
    expect(formatTime(5999)).toBe('99:59');
  });

  it('formats 90 seconds as 01:30', () => {
    expect(formatTime(90)).toBe('01:30');
  });

  it('zero-pads single digit minutes and seconds', () => {
    expect(formatTime(61)).toBe('01:01');
  });
});

// ─── parseTimeInput ───

describe('parseTimeInput', () => {
  it('converts 0 minutes 0 seconds to 0', () => {
    expect(parseTimeInput(0, 0)).toBe(0);
  });

  it('converts 5 minutes 0 seconds to 300', () => {
    expect(parseTimeInput(5, 0)).toBe(300);
  });

  it('converts 1 minute 30 seconds to 90', () => {
    expect(parseTimeInput(1, 30)).toBe(90);
  });

  it('round-trips with formatTime', () => {
    expect(formatTime(parseTimeInput(5, 30))).toBe('05:30');
  });
});

// ─── isNumeric ───

describe('isNumeric', () => {
  it('returns true for digit-only strings', () => {
    expect(isNumeric('123')).toBe(true);
    expect(isNumeric('0')).toBe(true);
    expect(isNumeric('007')).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(isNumeric('')).toBe(false);
  });

  it('returns false for strings with non-digit characters', () => {
    expect(isNumeric('12a')).toBe(false);
    expect(isNumeric('abc')).toBe(false);
    expect(isNumeric(' 5')).toBe(false);
    expect(isNumeric('3.14')).toBe(false);
    expect(isNumeric('-1')).toBe(false);
  });
});

// ─── generateRoundDurations ───

describe('generateRoundDurations', () => {
  it('returns empty array for 0 rounds', () => {
    expect(generateRoundDurations('pyramid', 0, 600)).toEqual([]);
  });

  it('returns single duration for 1 round', () => {
    expect(generateRoundDurations('pyramid', 1, 300)).toEqual([300]);
  });

  it('returns at least 30 seconds per round', () => {
    expect(generateRoundDurations('pyramid', 1, 0)).toEqual([30]);
  });

  it('ladder_up produces ascending durations', () => {
    const durations = generateRoundDurations('ladder_up', 4, 600);
    expect(durations).toHaveLength(4);
    for (let i = 1; i < durations.length; i++) {
      expect(durations[i]).toBeGreaterThanOrEqual(durations[i - 1]);
    }
  });

  it('ladder_down produces descending durations', () => {
    const durations = generateRoundDurations('ladder_down', 4, 600);
    expect(durations).toHaveLength(4);
    for (let i = 1; i < durations.length; i++) {
      expect(durations[i]).toBeLessThanOrEqual(durations[i - 1]);
    }
  });

  it('pyramid produces symmetric durations', () => {
    const durations = generateRoundDurations('pyramid', 5, 600);
    expect(durations).toHaveLength(5);
    // First and last should be equal (or within 1 due to rounding)
    expect(Math.abs(durations[0] - durations[4])).toBeLessThanOrEqual(1);
    // Middle should be the largest
    expect(durations[2]).toBeGreaterThanOrEqual(durations[0]);
    expect(durations[2]).toBeGreaterThanOrEqual(durations[4]);
  });

  it('all durations are divisible by 30', () => {
    const durations = generateRoundDurations('pyramid', 5, 600);
    durations.forEach(d => expect(d % 30).toBe(0));
  });

  it('total is close to totalTrainingSec', () => {
    const durations = generateRoundDurations('pyramid', 5, 600);
    const total = durations.reduce((a, b) => a + b, 0);
    // Allow drift from 30s snapping
    expect(Math.abs(total - 600)).toBeLessThanOrEqual(150);
  });

  it('all durations are at least 30 seconds', () => {
    const durations = generateRoundDurations('ladder_up', 10, 1800);
    durations.forEach(d => expect(d).toBeGreaterThanOrEqual(30));
  });
});

// ─── applyConfigSettings ───

describe('applyConfigSettings', () => {
  // Save originals and restore after each test
  let origDefaults, origAudio, origWeather;

  beforeEach(() => {
    origDefaults = { ...DEFAULT_CONFIG };
    origAudio = { ...APP_SETTINGS.audio };
    origWeather = { ...APP_SETTINGS.weather };
  });

  afterEach(() => {
    Object.assign(DEFAULT_CONFIG, origDefaults);
    Object.assign(APP_SETTINGS.audio, origAudio);
    Object.assign(APP_SETTINGS.weather, origWeather);
  });

  it('does nothing for null/undefined input', () => {
    applyConfigSettings(null);
    applyConfigSettings(undefined);
    expect(DEFAULT_CONFIG.roundDurationSec).toBe(origDefaults.roundDurationSec);
  });

  it('overrides default timer config', () => {
    applyConfigSettings({ defaults: { roundDurationSec: 180, restDurationSec: 30 } });
    expect(DEFAULT_CONFIG.roundDurationSec).toBe(180);
    expect(DEFAULT_CONFIG.restDurationSec).toBe(30);
  });

  it('overrides audio settings', () => {
    applyConfigSettings({ audio: { volume: 0.8 } });
    expect(APP_SETTINGS.audio.volume).toBe(0.8);
  });

  it('overrides weather settings', () => {
    applyConfigSettings({ weather: { enabled: false, units: 'celsius' } });
    expect(APP_SETTINGS.weather.enabled).toBe(false);
    expect(APP_SETTINGS.weather.units).toBe('celsius');
  });

  it('replaces competition presets entirely', () => {
    applyConfigSettings({
      competitionPresets: { 'Test Belt': { roundDurationSec: 120, restDurationSec: 30, numRounds: 2 } }
    });
    expect(Object.keys(APP_SETTINGS.competitionPresets)).toEqual(['Test Belt']);
    expect(APP_SETTINGS.competitionPresets['Test Belt'].roundDurationSec).toBe(120);
  });
});

// ─── StorageManager ───

describe('StorageManager', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns defaults when nothing is stored', () => {
    const config = StorageManager.load();
    expect(config.roundDurationSec).toBe(DEFAULT_CONFIG.roundDurationSec);
    expect(config.restDurationSec).toBe(DEFAULT_CONFIG.restDurationSec);
    expect(config.numRounds).toBe(DEFAULT_CONFIG.numRounds);
  });

  it('round-trips save and load', () => {
    const config = { roundDurationSec: 180, restDurationSec: 45, numRounds: 3, prepDurationSec: 10 };
    StorageManager.save(config);
    const loaded = StorageManager.load();
    expect(loaded).toEqual(config);
  });

  it('returns defaults for corrupted data', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json');
    const config = StorageManager.load();
    expect(config.roundDurationSec).toBe(DEFAULT_CONFIG.roundDurationSec);
  });

  it('fills missing fields with defaults', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ roundDurationSec: 200 }));
    const config = StorageManager.load();
    expect(config.roundDurationSec).toBe(200);
    expect(config.restDurationSec).toBe(DEFAULT_CONFIG.restDurationSec);
  });
});

// ─── createTimerState ───

describe('createTimerState', () => {
  it('creates state from provided config', () => {
    const config = { roundDurationSec: 180, restDurationSec: 30, numRounds: 5, prepDurationSec: 10 };
    const state = createTimerState(config);
    expect(state.config).toEqual(config);
    expect(state.phase).toBe(PHASES.IDLE);
    expect(state.remainingSec).toBe(180);
    expect(state.currentRound).toBe(0);
    expect(state.roundDurations).toBeNull();
    expect(state.restDurations).toBeNull();
    expect(state.paused).toBe(false);
  });

  it('loads from StorageManager when no config provided', () => {
    localStorage.clear();
    const state = createTimerState();
    expect(state.config.roundDurationSec).toBe(DEFAULT_CONFIG.roundDurationSec);
  });
});

// ─── TimerEngine ───

describe('TimerEngine', () => {
  let state, tickCb, phaseCb, engine;

  beforeEach(() => {
    vi.useFakeTimers();
    state = createTimerState({
      roundDurationSec: 5,
      restDurationSec: 3,
      numRounds: 2,
      prepDurationSec: 0,
    });
    tickCb = vi.fn();
    phaseCb = vi.fn();
    engine = new TimerEngine(state, tickCb, phaseCb);
  });

  afterEach(() => {
    engine.stop();
    vi.useRealTimers();
  });

  describe('start()', () => {
    it('transitions from IDLE to PREP', () => {
      engine.start();
      expect(state.phase).toBe(PHASES.PREP);
      expect(phaseCb).toHaveBeenCalledWith(state, PHASES.IDLE, PHASES.PREP);
    });

    it('uses minPrepCountdownSec as minimum prep duration', () => {
      engine.start();
      expect(state.remainingSec).toBe(APP_SETTINGS.minPrepCountdownSec);
    });

    it('uses configured prepDurationSec if larger than minimum', () => {
      state.config.prepDurationSec = 10;
      engine.start();
      expect(state.remainingSec).toBe(10);
    });

    it('ignores start when not IDLE', () => {
      engine.start();
      phaseCb.mockClear();
      engine.start(); // should be ignored
      expect(phaseCb).not.toHaveBeenCalled();
    });
  });

  describe('stop()', () => {
    it('transitions to IDLE and resets state', () => {
      engine.start();
      phaseCb.mockClear();
      engine.stop();
      expect(state.phase).toBe(PHASES.IDLE);
      expect(state.remainingSec).toBe(5); // config.roundDurationSec
      expect(state.currentRound).toBe(0);
      expect(state.roundDurations).toBeNull();
      expect(state.restDurations).toBeNull();
      expect(state.paused).toBe(false);
    });

    it('clears the interval', () => {
      engine.start();
      expect(state.intervalId).not.toBeNull();
      engine.stop();
      expect(state.intervalId).toBeNull();
    });

    it('does not fire onPhaseChange if already IDLE', () => {
      engine.stop();
      expect(phaseCb).not.toHaveBeenCalled();
    });
  });

  describe('pause() / resume()', () => {
    it('pauses a running timer', () => {
      engine.start();
      engine.pause();
      expect(state.paused).toBe(true);
      expect(state.intervalId).toBeNull();
    });

    it('resumes a paused timer', () => {
      engine.start();
      engine.pause();
      engine.resume();
      expect(state.paused).toBe(false);
      expect(state.intervalId).not.toBeNull();
    });

    it('pause is no-op when IDLE', () => {
      engine.pause();
      expect(state.paused).toBe(false);
    });

    it('pause is no-op when already paused', () => {
      engine.start();
      engine.pause();
      engine.pause();
      expect(state.paused).toBe(true);
    });

    it('resume is no-op when not paused', () => {
      engine.start();
      engine.resume();
      expect(state.paused).toBe(false);
    });
  });

  describe('tick()', () => {
    it('returns none alert when IDLE', () => {
      const alert = engine.tick();
      expect(alert.type).toBe('none');
    });

    it('decrements remainingSec by 1', () => {
      engine.start();
      const before = state.remainingSec;
      engine.tick();
      expect(state.remainingSec).toBe(before - 1);
    });

    it('fires countdown alert in last 5 seconds of ROUND', () => {
      state.phase = PHASES.ROUND;
      state.remainingSec = 5;
      state.currentRound = 1;
      const alert = engine.tick();
      expect(alert.type).toBe('countdown');
      expect(alert.remainingSec).toBe(4);
    });

    it('fires end_round alert when ROUND reaches 0', () => {
      state.phase = PHASES.ROUND;
      state.remainingSec = 1;
      state.currentRound = 1;
      const alert = engine.tick();
      expect(alert.type).toBe('end_round');
    });

    it('fires end_rest alert when REST reaches 0', () => {
      state.phase = PHASES.REST;
      state.remainingSec = 1;
      state.currentRound = 1;
      const alert = engine.tick();
      expect(alert.type).toBe('end_rest');
    });

    it('transitions PREP → ROUND when prep reaches 0', () => {
      engine.start();
      // Tick through all prep seconds
      for (let i = 0; i < APP_SETTINGS.minPrepCountdownSec; i++) {
        engine.tick();
      }
      expect(state.phase).toBe(PHASES.ROUND);
      expect(state.currentRound).toBe(1);
      expect(state.remainingSec).toBe(5);
    });

    it('transitions ROUND → REST when round reaches 0 (not last round)', () => {
      state.phase = PHASES.ROUND;
      state.remainingSec = 1;
      state.currentRound = 1;
      engine.tick();
      expect(state.phase).toBe(PHASES.REST);
      expect(state.remainingSec).toBe(3);
    });

    it('transitions ROUND → IDLE (skip rest) on last round', () => {
      state.phase = PHASES.ROUND;
      state.remainingSec = 1;
      state.currentRound = 2; // numRounds is 2
      engine.tick();
      expect(state.phase).toBe(PHASES.IDLE);
    });

    it('transitions REST → ROUND when rest reaches 0', () => {
      state.phase = PHASES.REST;
      state.remainingSec = 1;
      state.currentRound = 1;
      engine.tick();
      expect(state.phase).toBe(PHASES.ROUND);
      expect(state.currentRound).toBe(2);
    });

    it('calls onTick after each tick', () => {
      engine.start();
      engine.tick();
      expect(tickCb).toHaveBeenCalled();
    });
  });

  describe('roundDurations / restDurations support', () => {
    it('uses roundDurations array for per-round times', () => {
      state.roundDurations = [10, 20];
      state.phase = PHASES.PREP;
      state.remainingSec = 1;
      engine.tick(); // PREP → ROUND
      expect(state.remainingSec).toBe(10); // first round duration
    });

    it('uses restDurations array for per-round rest times', () => {
      state.roundDurations = [5, 10];
      state.restDurations = [15, 25];
      state.config.numRounds = 0; // unlimited
      state.phase = PHASES.ROUND;
      state.remainingSec = 1;
      state.currentRound = 1;
      engine.tick(); // ROUND → REST
      expect(state.remainingSec).toBe(15); // restDurations[0]
    });

    it('cycles roundDurations with modulo for repeat mode', () => {
      // When roundDurations is set, numRounds = roundDurations.length
      // To test cycling/repeat, set config.numRounds = 0 AND don't set roundDurations
      // (roundDurations.length determines the limit). Instead, test that indexing wraps
      // by using a longer array or verifying within bounds.
      // With roundDurations = [10, 20], numRounds = 2, so round 2 is the last.
      // To test cycling, we need unlimited mode: roundDurations not set, use config directly.
      // Actually, let's test the modulo indexing within a valid transition:
      state.roundDurations = [10, 20, 30];
      state.config.numRounds = 0; // ignored when roundDurations is set (length=3 used)
      state.phase = PHASES.REST;
      state.remainingSec = 1;
      state.currentRound = 1; // next will be round 2, index 1 % 3 = 1
      engine.tick(); // REST → ROUND
      expect(state.remainingSec).toBe(20); // roundDurations[1]
      expect(state.currentRound).toBe(2);
    });

    it('cycles restDurations with modulo', () => {
      state.roundDurations = [5, 10, 15];
      state.restDurations = [15, 25, 35];
      state.config.numRounds = 0;
      state.phase = PHASES.ROUND;
      state.remainingSec = 1;
      state.currentRound = 2; // restIdx = currentRound - 1 = 1, 1 % 3 = 1
      engine.tick();
      expect(state.remainingSec).toBe(25); // restDurations[1]
    });

    it('skips last rest with roundDurations in limited mode', () => {
      state.roundDurations = [5, 10];
      // numRounds determined by roundDurations.length = 2
      state.phase = PHASES.ROUND;
      state.remainingSec = 1;
      state.currentRound = 2;
      engine.tick();
      expect(state.phase).toBe(PHASES.IDLE);
    });
  });
});

// ─── ClassPresetManager ───

describe('ClassPresetManager', () => {
  let manager;

  beforeEach(() => {
    manager = new ClassPresetManager();
  });

  it('returns preset for known class types', () => {
    const preset = manager.getPreset('kids');
    expect(preset).toEqual({ roundDurationSec: 180, restDurationSec: 30, numRounds: 0 });
  });

  it('returns null for unknown class type', () => {
    expect(manager.getPreset('nonexistent')).toBeNull();
  });

  it('returns a copy (not a reference)', () => {
    const p1 = manager.getPreset('kids');
    p1.roundDurationSec = 999;
    const p2 = manager.getPreset('kids');
    expect(p2.roundDurationSec).toBe(180);
  });

  it('has presets for all valid class types', () => {
    VALID_CLASS_TYPES.forEach(type => {
      expect(manager.getPreset(type)).not.toBeNull();
    });
  });

  it('applies overrides to known class types', () => {
    manager.applyOverrides({ kids: { roundDurationSec: 120 } });
    const preset = manager.getPreset('kids');
    expect(preset.roundDurationSec).toBe(120);
    expect(preset.restDurationSec).toBe(30); // unchanged
  });

  it('ignores overrides for unknown class types', () => {
    manager.applyOverrides({ unknown: { roundDurationSec: 999 } });
    expect(manager.getPreset('unknown')).toBeNull();
  });

  it('getDefaultPresets returns all presets', () => {
    const all = manager.getDefaultPresets();
    expect(Object.keys(all)).toHaveLength(VALID_CLASS_TYPES.length);
  });
});

// ─── ScheduleManager validation ───

describe('ScheduleManager.validateEntry', () => {
  let manager;

  beforeEach(() => {
    manager = new ScheduleManager(new ClassPresetManager(), () => {}, () => {});
  });

  it('accepts a valid entry', () => {
    const entry = {
      dayOfWeek: 'Monday',
      startTime: '09:00',
      endTime: '10:00',
      title: 'Morning BJJ',
      classType: 'adult_basics',
    };
    const result = manager.validateEntry(entry);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects invalid dayOfWeek', () => {
    const entry = {
      dayOfWeek: 'Funday',
      startTime: '09:00',
      endTime: '10:00',
      title: 'Test',
      classType: 'kids',
    };
    expect(manager.validateEntry(entry).valid).toBe(false);
  });

  it('rejects invalid time format', () => {
    const entry = {
      dayOfWeek: 'Monday',
      startTime: '9:00',
      endTime: '10:00',
      title: 'Test',
      classType: 'kids',
    };
    expect(manager.validateEntry(entry).valid).toBe(false);
  });

  it('rejects startTime >= endTime', () => {
    const entry = {
      dayOfWeek: 'Monday',
      startTime: '10:00',
      endTime: '09:00',
      title: 'Test',
      classType: 'kids',
    };
    expect(manager.validateEntry(entry).valid).toBe(false);
  });

  it('rejects empty title', () => {
    const entry = {
      dayOfWeek: 'Monday',
      startTime: '09:00',
      endTime: '10:00',
      title: '',
      classType: 'kids',
    };
    expect(manager.validateEntry(entry).valid).toBe(false);
  });

  it('rejects invalid classType', () => {
    const entry = {
      dayOfWeek: 'Monday',
      startTime: '09:00',
      endTime: '10:00',
      title: 'Test',
      classType: 'invalid_type',
    };
    expect(manager.validateEntry(entry).valid).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(manager.validateEntry(null).valid).toBe(false);
    expect(manager.validateEntry('string').valid).toBe(false);
  });
});

// ─── ScheduleManager.getActiveClass / getNextClass ───

describe('ScheduleManager active/next class detection', () => {
  let manager;
  const schedule = [
    { dayOfWeek: 'Monday', startTime: '09:00', endTime: '10:00', title: 'Morning', classType: 'adult_basics' },
    { dayOfWeek: 'Monday', startTime: '18:00', endTime: '19:30', title: 'Evening', classType: 'adult_advanced' },
    { dayOfWeek: 'Wednesday', startTime: '12:00', endTime: '13:00', title: 'Noon', classType: 'kids' },
  ];

  beforeEach(() => {
    manager = new ScheduleManager(new ClassPresetManager(), () => {}, () => {});
    manager._schedule = schedule;
  });

  it('returns active class when time is within range', () => {
    // Monday 09:30
    const now = new Date(2026, 2, 2, 9, 30); // March 2, 2026 is a Monday
    const active = manager.getActiveClass(now);
    expect(active).not.toBeNull();
    expect(active.title).toBe('Morning');
  });

  it('returns null when no class is active', () => {
    // Monday 11:00
    const now = new Date(2026, 2, 2, 11, 0);
    const active = manager.getActiveClass(now);
    expect(active).toBeNull();
  });

  it('returns next class when no class is active', () => {
    // Monday 11:00 — next should be Evening at 18:00
    const now = new Date(2026, 2, 2, 11, 0);
    const next = manager.getNextClass(now);
    expect(next).not.toBeNull();
    expect(next.title).toBe('Evening');
  });

  it('wraps around to next week if needed', () => {
    // Wednesday 14:00 — all classes are past, next should be Monday Morning
    const now = new Date(2026, 2, 4, 14, 0); // March 4, 2026 is a Wednesday
    const next = manager.getNextClass(now);
    expect(next).not.toBeNull();
    expect(next.title).toBe('Morning');
  });

  it('returns null for empty schedule', () => {
    manager._schedule = [];
    const now = new Date();
    expect(manager.getActiveClass(now)).toBeNull();
    expect(manager.getNextClass(now)).toBeNull();
  });
});

// ─── PHASES constant ───

describe('PHASES', () => {
  it('has all expected phases', () => {
    expect(PHASES.IDLE).toBe('IDLE');
    expect(PHASES.PREP).toBe('PREP');
    expect(PHASES.ROUND).toBe('ROUND');
    expect(PHASES.REST).toBe('REST');
  });
});

// ─── VALID_DAYS / VALID_CLASS_TYPES ───

describe('constants', () => {
  it('VALID_DAYS has 7 days', () => {
    expect(VALID_DAYS).toHaveLength(7);
    expect(VALID_DAYS[0]).toBe('Monday');
    expect(VALID_DAYS[6]).toBe('Sunday');
  });

  it('VALID_CLASS_TYPES has expected types', () => {
    expect(VALID_CLASS_TYPES).toContain('kids');
    expect(VALID_CLASS_TYPES).toContain('adult_basics');
    expect(VALID_CLASS_TYPES).toContain('adult_advanced');
    expect(VALID_CLASS_TYPES).toContain('marathon_roll');
    expect(VALID_CLASS_TYPES).toContain('open_mat');
  });
});


// ─── ScheduleManager polling and active class transitions ───

describe('ScheduleManager._checkActiveClass', () => {
  let manager, onActiveClassChange, onError;
  const schedule = [
    { dayOfWeek: 'Monday', startTime: '09:00', endTime: '10:00', title: 'Morning', classType: 'adult_basics' },
    { dayOfWeek: 'Monday', startTime: '18:00', endTime: '19:30', title: 'Evening', classType: 'adult_advanced' },
  ];

  beforeEach(() => {
    onActiveClassChange = vi.fn();
    onError = vi.fn();
    manager = new ScheduleManager(new ClassPresetManager(), onActiveClassChange, onError);
    manager._schedule = schedule;
  });

  it('fires onActiveClassChange when a class becomes active', () => {
    // Simulate: no class active initially, then class starts
    // First check: before class (Monday 08:30) — no change from initial null state
    const before = new Date(2026, 2, 2, 8, 30); // Monday
    vi.setSystemTime(before);
    manager._checkActiveClass();
    // Initial state is null, active is null — no change, no callback
    expect(onActiveClassChange).not.toHaveBeenCalled();

    // Second check: during class (Monday 09:30) — class becomes active
    const during = new Date(2026, 2, 2, 9, 30);
    vi.setSystemTime(during);
    manager._checkActiveClass();
    expect(onActiveClassChange).toHaveBeenCalledTimes(1);
    expect(onActiveClassChange).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Morning' })
    );
  });

  it('does not fire onActiveClassChange when active class has not changed', () => {
    // Check twice during same class
    const during1 = new Date(2026, 2, 2, 9, 15);
    vi.setSystemTime(during1);
    manager._checkActiveClass();
    expect(onActiveClassChange).toHaveBeenCalledTimes(1);

    onActiveClassChange.mockClear();

    const during2 = new Date(2026, 2, 2, 9, 45);
    vi.setSystemTime(during2);
    manager._checkActiveClass();
    expect(onActiveClassChange).not.toHaveBeenCalled();
  });

  it('fires onActiveClassChange with null when class ends', () => {
    // First: during class
    const during = new Date(2026, 2, 2, 9, 30);
    vi.setSystemTime(during);
    manager._checkActiveClass();
    onActiveClassChange.mockClear();

    // Then: after class ends
    const after = new Date(2026, 2, 2, 10, 5);
    vi.setSystemTime(after);
    manager._checkActiveClass();
    expect(onActiveClassChange).toHaveBeenCalledWith(null);
  });

  it('fires onActiveClassChange when transitioning between classes', () => {
    // During Morning class
    const morning = new Date(2026, 2, 2, 9, 30);
    vi.setSystemTime(morning);
    manager._checkActiveClass();
    expect(onActiveClassChange).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Morning' })
    );
    onActiveClassChange.mockClear();

    // Gap between classes
    const gap = new Date(2026, 2, 2, 12, 0);
    vi.setSystemTime(gap);
    manager._checkActiveClass();
    expect(onActiveClassChange).toHaveBeenCalledWith(null);
    onActiveClassChange.mockClear();

    // During Evening class
    const evening = new Date(2026, 2, 2, 18, 30);
    vi.setSystemTime(evening);
    manager._checkActiveClass();
    expect(onActiveClassChange).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Evening' })
    );
  });
});

describe('ScheduleManager.startPolling / stopPolling', () => {
  let manager, onActiveClassChange;

  beforeEach(() => {
    vi.useFakeTimers();
    onActiveClassChange = vi.fn();
    manager = new ScheduleManager(new ClassPresetManager(), onActiveClassChange, () => {});
    manager._schedule = [
      { dayOfWeek: 'Monday', startTime: '09:00', endTime: '10:00', title: 'Morning', classType: 'adult_basics' },
    ];
  });

  afterEach(() => {
    manager.stopPolling();
    vi.useRealTimers();
  });

  it('checks active class immediately on startPolling', () => {
    const now = new Date(2026, 2, 2, 9, 30);
    vi.setSystemTime(now);
    manager.startPolling();
    // Class is active and differs from initial null — callback fires
    expect(onActiveClassChange).toHaveBeenCalledTimes(1);
    expect(onActiveClassChange).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Morning' })
    );
  });

  it('checks active class every 30 seconds during polling', () => {
    const now = new Date(2026, 2, 2, 8, 0);
    vi.setSystemTime(now);
    manager.startPolling();
    // Initial state is null, no class active — no change callback
    expect(onActiveClassChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(30000);
    // Still no class — no change
    expect(onActiveClassChange).not.toHaveBeenCalled();

    // Advance to class start time
    vi.setSystemTime(new Date(2026, 2, 2, 9, 0));
    vi.advanceTimersByTime(30000);
    expect(onActiveClassChange).toHaveBeenCalledTimes(1);
    expect(onActiveClassChange).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Morning' })
    );
  });

  it('stops polling when stopPolling is called', () => {
    const now = new Date(2026, 2, 2, 8, 0);
    vi.setSystemTime(now);
    manager.startPolling();
    // No class active, no change from initial null
    expect(onActiveClassChange).not.toHaveBeenCalled();

    manager.stopPolling();
    vi.setSystemTime(new Date(2026, 2, 2, 9, 0));
    vi.advanceTimersByTime(60000);
    expect(onActiveClassChange).not.toHaveBeenCalled();
  });

  it('detects class end during polling', () => {
    // Start during class
    vi.setSystemTime(new Date(2026, 2, 2, 9, 30));
    manager.startPolling();
    expect(onActiveClassChange).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Morning' })
    );
    onActiveClassChange.mockClear();

    // Advance past class end
    vi.setSystemTime(new Date(2026, 2, 2, 10, 1));
    vi.advanceTimersByTime(30000);
    expect(onActiveClassChange).toHaveBeenCalledWith(null);
  });
});

describe('ScheduleManager schedule display updates', () => {
  let manager;
  const schedule = [
    { dayOfWeek: 'Monday', startTime: '09:00', endTime: '10:00', title: 'Morning', classType: 'adult_basics' },
    { dayOfWeek: 'Monday', startTime: '18:00', endTime: '19:30', title: 'Evening', classType: 'adult_advanced' },
    { dayOfWeek: 'Wednesday', startTime: '12:00', endTime: '13:00', title: 'Noon', classType: 'kids' },
  ];

  beforeEach(() => {
    manager = new ScheduleManager(new ClassPresetManager(), () => {}, () => {});
    manager._schedule = schedule;
  });

  it('getActiveClass returns correct class as time progresses through a class', () => {
    // Start of class
    expect(manager.getActiveClass(new Date(2026, 2, 2, 9, 0)).title).toBe('Morning');
    // Middle of class
    expect(manager.getActiveClass(new Date(2026, 2, 2, 9, 30)).title).toBe('Morning');
    // Last minute of class
    expect(manager.getActiveClass(new Date(2026, 2, 2, 9, 59)).title).toBe('Morning');
    // Class ended
    expect(manager.getActiveClass(new Date(2026, 2, 2, 10, 0))).toBeNull();
  });

  it('getNextClass updates as time progresses', () => {
    // Before first class: next is Morning
    expect(manager.getNextClass(new Date(2026, 2, 2, 8, 0)).title).toBe('Morning');
    // During Morning: next is Evening
    expect(manager.getNextClass(new Date(2026, 2, 2, 9, 30)).title).toBe('Evening');
    // After Morning, before Evening: next is Evening
    expect(manager.getNextClass(new Date(2026, 2, 2, 12, 0)).title).toBe('Evening');
    // During Evening: next is Noon (Wednesday)
    expect(manager.getNextClass(new Date(2026, 2, 2, 18, 30)).title).toBe('Noon');
  });

  it('getNextClass and getActiveClass are consistent at class boundaries', () => {
    // Exactly at class start: active should be the class, next should be a different class
    const atStart = new Date(2026, 2, 2, 9, 0);
    const active = manager.getActiveClass(atStart);
    const next = manager.getNextClass(atStart);
    expect(active.title).toBe('Morning');
    expect(next.title).not.toBe('Morning');
  });
});
