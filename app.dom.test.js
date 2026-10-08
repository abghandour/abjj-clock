/**
 * End-to-end style tests for the BJJ timer app: the real index.html markup is
 * loaded into jsdom and the classes are exercised together the way the app
 * wires them (engine → renderer, overlays → input handler, primary → secondary
 * sync). Pure unit tests for the core engine/schedule live in app.test.js.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const {
  formatTime,
  HOLD_MS,
  DEFAULT_CONFIG,
  APP_SETTINGS,
  PHASES,
  prepBeepSecond,
  STORAGE_KEY,
  StorageManager,
  createTimerState,
  TimerEngine,
  AudioManager,
  ICONS,
  presetIcon,
  TRAINING_MODES,
  Renderer,
  ClassProgressRenderer,
  OverlayManager,
  InputHandler,
  ClassPresetManager,
  ScheduleManager,
  HOLIDAY_THEMES,
  getActiveHoliday,
  nextDisplayMode,
  DISPLAY_MODES,
  DisplaySyncManager,
  SYNC_SECTION_IDS,
  SYNC_ATTR_IDS,
  buildSyncSnapshot,
  applySyncSnapshot,
  syncElementFromHtml,
  SYNCED_SCHEDULE_FILE,
} = require('./app.js');

const INDEX_HTML = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
const BODY_HTML = INDEX_HTML
  .slice(INDEX_HTML.indexOf('<body>') + '<body>'.length, INDEX_HTML.indexOf('</body>'))
  .replace(/<script[^>]*><\/script>/g, '');

/** Load the real page markup into the test document. */
function loadDom() {
  document.documentElement.className = '';
  document.body.className = '';
  document.body.innerHTML = BODY_HTML;
}

/** AudioManager stand-in that records calls without touching Web Audio. */
function fakeAudio() {
  const names = [
    '_ensureContext', 'playCountdownBeep', 'playPrepBeep', 'playRoundStartFanfare',
    'playEndOfRoundBeep', 'playEndOfRestBeep', 'playEndOfRoundBeepT2', 'playEndOfRestBeepT2',
    'playCountdownBeepT2', 'playEndOfClassRing', 'playStartOfClassRing', 'playMuffle', 'playCancel'
  ];
  const audio = {};
  for (const n of names) audio[n] = vi.fn();
  return audio;
}

function keydown(key, extra) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, cancelable: true, ...(extra || {}) }));
}
function keyup(key) {
  document.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, cancelable: true }));
}
function press(key) {
  keydown(key);
  keyup(key);
}

// ─── StorageManager hardening ───

describe('StorageManager validation', () => {
  beforeEach(() => localStorage.clear());

  it('rejects NaN, negative and fractional durations from storage', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      roundDurationSec: NaN, restDurationSec: -5, numRounds: 2.5, prepDurationSec: 10
    }));
    const cfg = StorageManager.load();
    expect(cfg.roundDurationSec).toBe(DEFAULT_CONFIG.roundDurationSec);
    expect(cfg.restDurationSec).toBe(DEFAULT_CONFIG.restDurationSec);
    expect(cfg.numRounds).toBe(DEFAULT_CONFIG.numRounds);
    expect(cfg.prepDurationSec).toBe(10);
  });

  it('returns defaults for a non-object payload', () => {
    localStorage.setItem(STORAGE_KEY, '42');
    expect(StorageManager.load()).toEqual({ ...DEFAULT_CONFIG });
  });

});

// ─── TimerEngine wall-clock driven ticks ───

describe('TimerEngine timing', () => {
  let state, engine, ticks;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 8, 12, 0, 0));
    state = createTimerState({ roundDurationSec: 5, restDurationSec: 2, numRounds: 2, prepDurationSec: 0 });
    ticks = vi.fn();
    engine = new TimerEngine(state, ticks, () => {});
  });

  afterEach(() => {
    engine.stop();
    vi.useRealTimers();
  });

  it('ticks once per elapsed second of wall-clock time', () => {
    engine.start();
    vi.advanceTimersByTime(999);
    expect(state.remainingSec).toBe(5);
    vi.advanceTimersByTime(1);
    expect(state.remainingSec).toBe(4);
    vi.advanceTimersByTime(3000);
    expect(state.remainingSec).toBe(1);
  });

  it('runs a full limited session to completion on the clock', () => {
    engine.start();
    // Round 1 (5s) → rest (2s) → round 2 (5s) → IDLE
    vi.advanceTimersByTime(5000);
    expect(state.phase).toBe(PHASES.REST);
    vi.advanceTimersByTime(2000);
    expect(state.phase).toBe(PHASES.ROUND);
    expect(state.currentRound).toBe(2);
    vi.advanceTimersByTime(5000);
    expect(state.phase).toBe(PHASES.IDLE);
    expect(state.intervalId).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('catches up missed seconds after a stalled event loop', () => {
    engine.start();
    // Simulate the browser throttling timers: the deadline is 2.5s in the past
    engine._nextTickAt = performance.now() - 2500;
    engine._drive();
    expect(state.remainingSec).toBe(2); // three ticks replayed
    expect(state.intervalId).not.toBeNull();
    vi.advanceTimersByTime(500);
    expect(state.remainingSec).toBe(1);
  });

  it('preserves the partial second across pause and resume', () => {
    engine.start();
    vi.advanceTimersByTime(400);
    engine.pause();
    expect(state.intervalId).toBeNull();
    vi.advanceTimersByTime(5000); // paused: nothing happens
    expect(state.remainingSec).toBe(5);
    engine.resume();
    vi.advanceTimersByTime(599);
    expect(state.remainingSec).toBe(5);
    vi.advanceTimersByTime(1);
    expect(state.remainingSec).toBe(4);
  });

  it('does not accumulate drift over a long round', () => {
    state.config.roundDurationSec = 600;
    state.config.numRounds = 1;
    engine.start();
    vi.advanceTimersByTime(600 * 1000 - 1);
    expect(state.phase).toBe(PHASES.ROUND);
    expect(state.remainingSec).toBe(1);
    vi.advanceTimersByTime(1);
    expect(state.phase).toBe(PHASES.IDLE);
  });

  it('stop() during a tick leaves no timer armed', () => {
    state.config.numRounds = 1;
    engine.start();
    vi.advanceTimersByTime(5000);
    expect(state.phase).toBe(PHASES.IDLE);
    expect(vi.getTimerCount()).toBe(0);
  });
});

// ─── prepBeepSecond ───

describe('prepBeepSecond', () => {
  it('beeps for each prep second except the last, which hands over to the bell', () => {
    expect(prepBeepSecond(PHASES.PREP, 4, 5)).toBe(5);
    expect(prepBeepSecond(PHASES.PREP, 1, 5)).toBe(2);
    expect(prepBeepSecond(PHASES.PREP, 0, 5)).toBeNull();
  });

  it('does not beep on the first tick of prep or outside prep', () => {
    expect(prepBeepSecond(PHASES.PREP, 5, 5)).toBeNull();
    expect(prepBeepSecond(PHASES.ROUND, 3, 5)).toBeNull();
  });
});

// ─── AudioManager resilience ───

describe('AudioManager', () => {
  let origCtx, origAudio;

  beforeEach(() => {
    origCtx = window.AudioContext;
    origAudio = window.Audio;
  });

  afterEach(() => {
    window.AudioContext = origCtx;
    window.Audio = origAudio;
  });

  it('keeps synthesized audio enabled after a single oscillator failure', () => {
    window.AudioContext = class {
      constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
      createOscillator() { throw new Error('boom'); }
      createGain() { return {}; }
    };
    const am = new AudioManager();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    am.playCountdownBeep();
    expect(am.disabled).toBe(false);
    am.playMuffle();
    am.playCancel();
    expect(am.disabled).toBe(false);
    warn.mockRestore();
  });

  it('disables audio only when the context cannot be created', () => {
    window.AudioContext = class { constructor() { throw new Error('no audio'); } };
    window.webkitAudioContext = undefined;
    const am = new AudioManager();
    expect(am._ensureContext()).toBe(false);
    expect(am.disabled).toBe(true);
  });

  it('preloads each bell once and plays clones with a caught rejection', async () => {
    const created = [];
    class FakeAudio {
      constructor(src) { this.src = src; this.preload = ''; created.push(this); }
      cloneNode() { const c = new FakeAudio(this.src); c.cloned = true; return c; }
      play() { return Promise.reject(new Error('autoplay blocked')); }
      pause() {}
    }
    window.Audio = FakeAudio;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const am = new AudioManager();
    am.preload();
    expect(created.filter(a => !a.cloned)).toHaveLength(AudioManager.CLIPS.length);
    am.playEndOfRoundBeep();
    am.playEndOfRoundBeep();
    const clones = created.filter(a => a.cloned);
    expect(clones).toHaveLength(2);
    expect(created.filter(a => !a.cloned)).toHaveLength(AudioManager.CLIPS.length); // no new base clips
    expect(clones[0].volume).toBe(APP_SETTINGS.audio.volume);
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ─── Icons ───

describe('presetIcon', () => {
  const s = 'width="1em" height="1em" viewBox="0 0 24 24"';

  it('maps belts, kids and training presets to icons', () => {
    expect(presetIcon('Blue Belt', s)).toBe(ICONS.belt(s, '#1e90ff'));
    expect(presetIcon('Kids (under 15)', s)).toBe(ICONS.kids(s));
    expect(presetIcon('Ladder Up', s)).toBe(ICONS.ladderUp(s));
    expect(presetIcon('Inv. Pyramid', s)).toBe(ICONS.invPyramid(s));
    expect(presetIcon('Chainsaw', s)).toBe(ICONS.chainsaw(s));
    expect(presetIcon('Tabata', s)).toBe(ICONS.tabata(s));
    expect(presetIcon('Dual Timer', s)).toBe(ICONS.dual(s));
  });

  it('returns an empty string for unknown names', () => {
    expect(presetIcon('Adult Noon Class', s)).toBe('');
    expect(presetIcon(null, s)).toBe('');
  });

  it('every training mode has a label and an icon', () => {
    for (const mode of Object.values(TRAINING_MODES)) {
      expect(typeof mode.label).toBe('string');
      expect(typeof ICONS[mode.icon]).toBe('function');
    }
  });
});

// ─── Renderer ───

describe('Renderer', () => {
  let renderer;

  beforeEach(() => {
    loadDom();
    renderer = new Renderer();
  });

  it('updates timer digits in place without replacing the span nodes', () => {
    const minsEl = document.querySelector('#round-timer .ts-minutes');
    const secsEl = document.querySelector('#round-timer .ts-seconds');
    renderer.updateRoundDisplay(125, true);
    expect(document.querySelector('#round-timer .ts-minutes')).toBe(minsEl);
    expect(minsEl.textContent).toBe('02');
    expect(secsEl.textContent).toBe('05');
    expect(document.getElementById('round-timer').classList.contains('timer-active')).toBe(true);
  });

  it('recreates digit spans if they are missing', () => {
    const el = document.getElementById('rest-timer');
    el.textContent = '';
    renderer.updateRestDisplay(61, false);
    expect(el.textContent).toBe('01:01');
  });

  it('highlights the last ten seconds of an active round only', () => {
    renderer.updateRoundDisplay(10, true);
    const el = document.getElementById('round-timer');
    expect(el.style.backgroundColor).toBe('var(--accent-yellow)');
    expect(el.querySelector('.ts-minutes').style.borderColor).toBe('var(--accent-yellow)');
    renderer.updateRoundDisplay(10, false);
    expect(el.style.backgroundColor).toBe('');
    renderer.updateRoundDisplay(11, true);
    expect(el.style.backgroundColor).toBe('');
  });

  it('formats the wall clock as 12-hour time with seconds and AM/PM', () => {
    renderer.updateClockDisplay(new Date(2026, 8, 8, 0, 5, 9));
    const clock = document.getElementById('clock');
    expect(clock.textContent).toBe('12:0509 AM');
    expect(clock.querySelector('.clock-seconds').textContent).toBe('09');
    expect(clock.querySelector('.clock-ampm').textContent).toBe('AM');
    renderer.updateClockDisplay(new Date(2026, 8, 8, 13, 30, 0));
    expect(clock.textContent).toBe('1:3000 PM');
    expect(document.getElementById('day-of-week').textContent).toBe('Tuesday');
  });

  it('skips clock repaints when the second has not changed', () => {
    const clock = document.getElementById('clock');
    renderer.updateClockDisplay(new Date(2026, 8, 8, 9, 0, 0));
    const first = clock.querySelector('.clock-seconds');
    renderer.updateClockDisplay(new Date(2026, 8, 8, 9, 0, 0));
    expect(clock.querySelector('.clock-seconds')).toBe(first);
  });

  it('renders the round counter for idle, unlimited and limited sessions', () => {
    const el = document.getElementById('round-counter');
    renderer.updateRoundCounter(0, 0);
    expect(el.textContent).toBe('Repeat');
    expect(el.querySelector('svg')).not.toBeNull();
    renderer.updateRoundCounter(0, 3);
    expect(el.textContent).toBe('3 rounds');
    renderer.updateRoundCounter(2, 0);
    expect(el.textContent).toBe('Round 2');
    renderer.updateRoundCounter(2, 5);
    expect(el.textContent).toBe('Round 2 / 5');
  });

  it('escapes preset names and shows a gear for custom', () => {
    const el = document.getElementById('preset-label');
    renderer.updatePresetLabel('<img src=x onerror=alert(1)>');
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('<img src=x onerror=alert(1)>');
    renderer.updatePresetLabel(null);
    expect(el.textContent).toBe('Custom');
    expect(el.querySelector('svg')).not.toBeNull();
  });

  it('renders the round list with overtime badges and caches unchanged markup', () => {
    renderer.remainingClassSecProvider = () => 8 * 60;
    const list = document.getElementById('round-list');
    renderer.updateRoundList([300, 300, 300], 1, 'Ladder Up', null, 60, renderer.getRemainingClassSec(), 200, PHASES.ROUND);
    expect(list.classList.contains('active')).toBe(true);
    const items = list.querySelectorAll('.round-item');
    expect(items).toHaveLength(3);
    expect(items[0].classList.contains('current')).toBe(true);
    // R1 has 200s left, R2 ends at 200+60+300=560s (< 480s? no: 560 > 480 → 2m over)
    expect(items[1].querySelector('.overtime-badge').textContent).toBe('2m overtime');
    expect(items[2].querySelector('.overtime-badge').textContent).toBe('8m overtime');
    expect(list.querySelector('svg')).not.toBeNull();

    const firstNode = items[0];
    renderer.updateRoundList([300, 300, 300], 1, 'Ladder Up', null, 60, renderer.getRemainingClassSec(), 200, PHASES.ROUND);
    expect(list.querySelectorAll('.round-item')[0]).toBe(firstNode); // no re-parse
    renderer.updateRoundList([300, 300, 300], 2, 'Ladder Up', null, 60, renderer.getRemainingClassSec(), 300, PHASES.ROUND);
    expect(list.querySelectorAll('.round-item')[0].classList.contains('past')).toBe(true);
  });

  it('hides the round list for empty durations', () => {
    const list = document.getElementById('round-list');
    renderer.updateRoundList([120], 0, 'Pyramid', null, 30, 0);
    renderer.updateRoundList([], 0, null);
    expect(list.classList.contains('active')).toBe(false);
    expect(list.innerHTML).toBe('');
  });

  it('getRemainingClassSec falls back to 0 without a provider or with bad values', () => {
    expect(renderer.getRemainingClassSec()).toBe(0);
    renderer.remainingClassSecProvider = () => NaN;
    expect(renderer.getRemainingClassSec()).toBe(0);
    renderer.remainingClassSecProvider = () => 90;
    expect(renderer.getRemainingClassSec()).toBe(90);
  });

  it('shows the active class with remaining time, then the next class', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 8, 18, 15));
    const active = { dayOfWeek: 'Tuesday', startTime: '18:00', endTime: '19:30', title: 'Adult <b>Basics</b>', classType: 'adult_basics' };
    const next = { dayOfWeek: 'Wednesday', startTime: '17:30', endTime: '18:30', title: 'Kids', classType: 'kids' };
    renderer.updateScheduleDisplay(active, next, null);
    const disp = document.getElementById('schedule-display');
    expect(disp.querySelector('.class-title').textContent).toBe('Adult <b>Basics</b>');
    expect(disp.querySelector('.class-time').textContent).toBe('1h 15m remaining');

    renderer.updateScheduleDisplay(null, next, null);
    expect(disp.querySelector('.class-title').textContent).toBe('Next: Kids');
    expect(disp.querySelector('.class-time').textContent).toBe('Wednesday at 5:30PM');

    renderer.updateScheduleDisplay(null, null, 'Could not load schedule');
    expect(disp.textContent).toBe('Could not load schedule');

    renderer.updateNextClassDisplay(next);
    const nextEl = document.getElementById('next-class-display');
    expect(nextEl.querySelector('.next-title').textContent).toBe('Next: Kids');
    expect(nextEl.querySelector('.next-time').textContent).toBe('Wednesday 5:30PM');
    expect(nextEl.querySelector('.next-countdown')).toBeNull();

    const later = { ...next, dayOfWeek: 'Tuesday', startTime: '20:00' };
    renderer.updateNextClassDisplay(later);
    expect(nextEl.querySelector('.next-countdown').textContent).toBe('(in 1h 45m)');
    vi.useRealTimers();
  });

  it('status bar stays empty in every mode (corner hints removed)', () => {
    const bar = document.getElementById('status-bar');
    for (const mode of ['clock', 'ready', 'running', 'paused', 'editing', 'menu', 'hidden']) {
      renderer.updateStatusBar(mode);
      expect(bar.innerHTML).toBe('');
    }
  });

  it('stealth hides everything except the rest section during REST', () => {
    renderer.toggleStealth();
    renderer.applyStealth(PHASES.ROUND);
    expect(document.getElementById('round-section').style.visibility).toBe('hidden');
    expect(document.getElementById('rest-section').style.visibility).toBe('hidden');
    expect(document.getElementById('stealth-hint').style.display).toBe('block');
    renderer.applyStealth(PHASES.REST);
    expect(document.getElementById('rest-section').style.visibility).toBe('');
    renderer.toggleStealth();
    renderer.applyStealth(PHASES.IDLE);
    expect(document.getElementById('round-section').style.visibility).toBe('');
  });
});

// ─── ClassProgressRenderer ───

describe('ClassProgressRenderer', () => {
  it('scales the canvas backing store by devicePixelRatio and keeps the CSS size', () => {
    loadDom();
    const origDpr = window.devicePixelRatio;
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
    HTMLCanvasElement.prototype.getContext = () => null;
    const cp = new ClassProgressRenderer();
    expect(cp.canvas.width).toBe(500);
    expect(cp.canvas.height).toBe(500);
    expect(cp.canvas.style.width).toBe('250px');
    Object.defineProperty(window, 'devicePixelRatio', { value: origDpr, configurable: true });
  });
});

// ─── ScheduleManager ───

describe('ScheduleManager remaining time and config loading', () => {
  const bundled = [
    { dayOfWeek: 'Tuesday', startTime: '18:00', endTime: '19:00', title: 'Bundled', classType: 'adult_basics' },
  ];
  const synced = [
    { dayOfWeek: 'Tuesday', startTime: '18:00', endTime: '19:30', title: 'Synced', classType: 'adult_advanced' },
    { dayOfWeek: 'Funday', startTime: '18:00', endTime: '19:30', title: 'Bad', classType: 'adult_advanced' },
  ];
  let manager, onError, origFetch;

  const mockFetch = (responses) => {
    global.fetch = vi.fn(async (url) => {
      const r = responses[url];
      if (!r) return { ok: false, status: 404, json: async () => { throw new Error('404'); } };
      if (r instanceof Error) throw r;
      return { ok: true, status: 200, json: async () => r };
    });
  };

  beforeEach(() => {
    localStorage.clear();
    origFetch = global.fetch;
    onError = vi.fn();
    manager = new ScheduleManager(new ClassPresetManager(), () => {}, onError);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = origFetch;
    console.warn.mockRestore();
  });

  it('computes remaining seconds in the active class from the wall clock', () => {
    manager._schedule = bundled;
    expect(manager.getRemainingClassSec(new Date(2026, 8, 8, 18, 30, 15))).toBe(29 * 60 + 45);
    expect(manager.getRemainingClassSec(new Date(2026, 8, 8, 19, 0, 0))).toBe(0);
    expect(manager.getRemainingClassSec(new Date(2026, 8, 9, 18, 30, 0))).toBe(0);
  });

  it('prefers the synced schedule.json over the bundled schedule and validates it', async () => {
    mockFetch({ 'config.json': { schedule: bundled }, [SYNCED_SCHEDULE_FILE]: { schedule: synced } });
    await manager.loadConfig();
    expect(manager._schedule.map(e => e.title)).toEqual(['Synced']);
    expect(onError).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith('config.json', { cache: 'no-store' });
    expect(global.fetch).toHaveBeenCalledWith(SYNCED_SCHEDULE_FILE, { cache: 'no-store' });
  });

  it('falls back to the bundled schedule when schedule.json is missing or malformed', async () => {
    mockFetch({ 'config.json': { schedule: bundled } });
    await manager.loadConfig();
    expect(manager._schedule.map(e => e.title)).toEqual(['Bundled']);

    mockFetch({ 'config.json': { schedule: bundled }, [SYNCED_SCHEDULE_FILE]: { schedule: 'nope' } });
    await manager.loadConfig();
    expect(manager._schedule.map(e => e.title)).toEqual(['Bundled']);
  });

  it('uses the localStorage cache and reports an error when config.json fails', async () => {
    mockFetch({ 'config.json': { schedule: bundled } });
    await manager.loadConfig();
    const fresh = new ScheduleManager(new ClassPresetManager(), () => {}, onError);
    mockFetch({});
    await fresh.loadConfig();
    expect(onError).toHaveBeenCalledWith('Could not load schedule');
    expect(fresh._schedule.map(e => e.title)).toEqual(['Bundled']);
  });

  it('applies config.json defaults and preset overrides while loading', async () => {
    const before = DEFAULT_CONFIG.roundDurationSec;
    mockFetch({ 'config.json': { schedule: bundled, defaults: { roundDurationSec: 420 }, presetOverrides: { kids: { restDurationSec: 15 } } } });
    await manager.loadConfig();
    expect(DEFAULT_CONFIG.roundDurationSec).toBe(420);
    expect(manager.presetManager.getPreset('kids').restDurationSec).toBe(15);
    DEFAULT_CONFIG.roundDurationSec = before;
  });
});

// ─── OverlayManager ───

describe('OverlayManager', () => {
  let overlay, overlayEl;
  const baseConfig = () => ({ roundDurationSec: 300, restDurationSec: 60, numRounds: 0, prepDurationSec: 0 });

  beforeEach(() => {
    loadDom();
    localStorage.clear();
    overlay = new OverlayManager();
    overlayEl = document.getElementById('overlay');
  });

  it('applies a competition preset by its number and closes', () => {
    const cb = vi.fn();
    overlay.showCompetitionMenu(baseConfig(), cb);
    expect(overlayEl.classList.contains('active')).toBe(true);
    expect(overlayEl.textContent).toContain('Blue Belt');
    overlay.handleKey('2');
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({
      roundDurationSec: 360, restDurationSec: 60, numRounds: 0, presetName: 'Blue Belt'
    }));
    expect(overlay.isOpen()).toBe(false);
    expect(overlayEl.innerHTML).toBe('');
  });

  it('ignores out-of-range preset keys and closes on * or /', () => {
    const cb = vi.fn();
    overlay.showCompetitionMenu(baseConfig(), cb);
    overlay.handleKey('9');
    expect(cb).not.toHaveBeenCalled();
    expect(overlay.isOpen()).toBe(true);
    overlay.handleKey('/');
    expect(overlay.isOpen()).toBe(false);
  });

  it('walks the ladder-up training flow and produces snapped round durations', () => {
    const cb = vi.fn();
    overlay.remainingClassSecProvider = () => 47 * 60; // default 45 minutes
    overlay.showTrainingMenu(baseConfig(), cb);
    overlay.handleKey('1'); // Ladder Up
    expect(overlayEl.textContent).toContain('Total minutes:');
    expect(overlayEl.querySelector('.overlay-input').textContent).toBe('45'); // default shown dimmed
    overlay.handleKey('Enter'); // accept default minutes
    expect(overlayEl.textContent).toContain('How many rounds?');
    overlay.handleKey('1');
    overlay.handleKey('Enter');
    expect(overlayEl.textContent).toContain('Need at least 2 rounds');
    overlay.handleKey('3');
    overlay.handleKey('Enter');
    expect(overlayEl.textContent).toContain('Rest between rounds');
    overlay.handleKey('Enter'); // default rest 30s
    expect(cb).toHaveBeenCalledTimes(1);
    const cfg = cb.mock.calls[0][0];
    expect(cfg.presetName).toBe('Ladder Up');
    expect(cfg.numRounds).toBe(3);
    expect(cfg.restDurationSec).toBe(30);
    expect(cfg.roundDurations).toHaveLength(3);
    expect(cfg.roundDurations[0]).toBeLessThan(cfg.roundDurations[2]);
    cfg.roundDurations.forEach(d => expect(d % 30).toBe(0));
  });

  it('rejects rest that leaves no room for rounds', () => {
    const cb = vi.fn();
    overlay.showTrainingMenu(baseConfig(), cb);
    overlay.handleKey('3'); // Pyramid
    '2'.split('').forEach(k => overlay.handleKey(k));
    overlay.handleKey('Enter'); // 2 minutes
    overlay.handleKey('4');
    overlay.handleKey('Enter'); // 4 rounds
    '60'.split('').forEach(k => overlay.handleKey(k));
    overlay.handleKey('Enter'); // 60s rest → 180s rest for 120s budget
    expect(cb).not.toHaveBeenCalled();
    expect(overlayEl.textContent).toContain('Rest too long');
  });

  it('builds alternating chainsaw rounds with a default round count from class time', () => {
    const cb = vi.fn();
    overlay.remainingClassSecProvider = () => 20 * 60;
    overlay.showTrainingMenu(baseConfig(), cb);
    overlay.handleKey('0'); // Chainsaw
    '5'.split('').forEach(k => overlay.handleKey(k));
    overlay.handleKey('Enter'); // odd round 5:00
    '30'.split('').forEach(k => overlay.handleKey(k));
    overlay.handleKey('Enter'); // odd rest 30s
    '2'.split('').forEach(k => overlay.handleKey(k));
    overlay.handleKey('Enter'); // even round 2:00
    overlay.handleKey('Enter'); // even rest defaults to odd rest
    // 20 minutes fits 300+30+120+30+300+30+120 = 930s → four rounds
    expect(overlayEl.querySelector('.overlay-input').textContent).toBe('4'); // default shown in the box
    overlay.handleKey('Enter'); // accept default
    const cfg = cb.mock.calls[0][0];
    expect(cfg.presetName).toBe('Chainsaw');
    expect(cfg.roundDurations).toEqual([300, 120, 300, 120]);
    expect(cfg.restDurations).toEqual([30, 30, 30, 30]);
    expect(cfg.numRounds).toBe(4);
  });

  it('applies the Tabata preset and hands dual timer off to its callback', () => {
    const cb = vi.fn();
    overlay.showTrainingMenu(baseConfig(), cb);
    overlay.handleKey('5');
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ roundDurationSec: 20, restDurationSec: 10, numRounds: 8, presetName: 'Tabata' }));

    const dual = vi.fn();
    overlay._dualTimerCallback = dual;
    overlay.showTrainingMenu(baseConfig(), cb);
    overlay.handleKey('6');
    expect(dual).toHaveBeenCalled();
    expect(overlay.isOpen()).toBe(false);
  });

  it('schedule overlay is view-only and toggleSchedule survives localStorage failures', () => {
    const toggle = vi.fn();
    overlay._onScheduleToggle = toggle;
    APP_SETTINGS.scheduleEnabled = true;
    overlay.showSchedule([{ dayOfWeek: 'Monday', startTime: '12:00', endTime: '13:00', title: 'Noon <i>x</i>', classType: 'adult_basics' }]);
    expect(overlayEl.textContent).toContain('Noon <i>x</i>');
    expect(overlayEl.querySelector('i')).toBeNull();
    overlay.handleKey('-');
    expect(APP_SETTINGS.scheduleEnabled).toBe(true); // keys on the overlay no longer toggle
    expect(toggle).not.toHaveBeenCalled();

    overlay.toggleSchedule();
    expect(APP_SETTINGS.scheduleEnabled).toBe(false);
    expect(localStorage.getItem('bjj-timer-schedule-enabled')).toBe('false');
    expect(toggle).toHaveBeenCalledWith(false);

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    overlay.toggleSchedule();
    expect(APP_SETTINGS.scheduleEnabled).toBe(true);
    expect(toggle).toHaveBeenLastCalledWith(true);
    setItem.mockRestore();
    overlay.handleKey('5');
    expect(overlay.isOpen()).toBe(false);
  });

  it('reaches the system update screen from credits with a double star', () => {
    overlay.showTrainingMenu(baseConfig(), () => {});
    overlay.handleKey('/');
    expect(overlayEl.textContent).toContain('Credits');
    overlay.handleKey('*');
    expect(overlay._mode).toBe('credits');
    overlay.handleKey('*');
    expect(overlay._mode).toBe('confirm-update');
    expect(overlayEl.textContent).toContain('System Update');
    overlay.handleKey('9');
    expect(overlay._mode).toBe('credits');
    overlay.handleKey('0');
    expect(overlay.isOpen()).toBe(false);
  });

  it('shows a failure screen when the update server is unreachable', async () => {
    const origFetch = global.fetch;
    global.fetch = vi.fn(() => Promise.reject(new Error('Connection refused')));
    overlay.showTrainingMenu(baseConfig(), () => {});
    overlay.handleKey('/');
    overlay.handleKey('*');
    overlay.handleKey('*');
    overlay.handleKey('1');
    expect(overlay._mode).toBe('updating');
    overlay.handleKey('5'); // ignored while updating
    expect(overlay._mode).toBe('updating');
    await new Promise(r => setTimeout(r, 0));
    expect(overlay._mode).toBe('update-error');
    expect(overlayEl.textContent).toContain('Connection refused');
    overlay.handleKey('5');
    expect(overlay._mode).toBe('credits');
    global.fetch = origFetch;
  });
});

// ─── InputHandler (full keyboard flow) ───

describe('InputHandler', () => {
  let state, engine, renderer, overlay, audio, input;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 8, 12, 0, 0));
    loadDom();
    localStorage.clear();
    state = createTimerState({ roundDurationSec: 5, restDurationSec: 2, numRounds: 0, prepDurationSec: 0 });
    renderer = new Renderer();
    audio = fakeAudio();
    overlay = new OverlayManager();
    engine = new TimerEngine(state, () => {}, () => {});
    input = new InputHandler(engine, overlay, renderer, audio, state);
    document.body.classList.add('timer-idle');
  });

  afterEach(() => {
    input.destroy();
    engine.stop();
    vi.useRealTimers();
  });

  it('Enter arms the ready state, a second Enter starts, and 0 stops back to ready', () => {
    press('Enter');
    expect(input._ready).toBe(true);
    expect(document.body.classList.contains('timer-idle')).toBe(false);
    expect(state.phase).toBe(PHASES.IDLE);
    press('Enter');
    expect(state.phase).toBe(PHASES.ROUND);
    vi.advanceTimersByTime(2000);
    expect(state.remainingSec).toBe(3);
    press('0');
    expect(state.phase).toBe(PHASES.IDLE);
    expect(input._ready).toBe(true);
    expect(audio.playCancel).toHaveBeenCalled();
    press('0');
    expect(input._ready).toBe(false);
    expect(document.body.classList.contains('timer-idle')).toBe(true);
  });

  it('Enter pauses and resumes a running timer', () => {
    press('Enter');
    press('Enter');
    press('Enter');
    expect(state.paused).toBe(true);
    expect(document.getElementById('dual-timer-container').classList.contains('timer-paused-grayscale')).toBe(true);
    press('Enter');
    expect(state.paused).toBe(false);
    expect(document.getElementById('dual-timer-container').classList.contains('timer-paused-grayscale')).toBe(false);
    expect(audio.playMuffle).toHaveBeenCalledTimes(2);
  });

  it('a long Enter press while idle resets to defaults', () => {
    state.config.roundDurationSec = 123;
    keydown('Enter');
    vi.advanceTimersByTime(800);
    keyup('Enter');
    expect(state.config.roundDurationSec).toBe(DEFAULT_CONFIG.roundDurationSec);
    expect(state.phase).toBe(PHASES.IDLE);
    expect(audio.playCancel).toHaveBeenCalled();
    expect(input._resetCallback).toBeNull();
  });

  it('numpad codes map to the same actions as plain keys', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'NumpadEnter', cancelable: true }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'NumpadEnter', cancelable: true }));
    expect(input._ready).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', code: 'NumpadDivide', cancelable: true }));
    expect(overlay.isOpen()).toBe(true);
    expect(document.getElementById('overlay').textContent).toContain('Competition Presets');
  });

  it('opens the competition and training menus only when idle and routes keys into them', () => {
    press('/');
    expect(overlay.isOpen()).toBe(true);
    press('0'); // Kids preset
    expect(overlay.isOpen()).toBe(false);
    expect(state.config.roundDurationSec).toBe(240);
    expect(document.getElementById('preset-label').textContent).toContain('Kids');
    expect(StorageManager.load().roundDurationSec).toBe(240);

    press('Enter');
    press('Enter');
    press('*');
    expect(overlay.isOpen()).toBe(false); // running: menus stay closed
  });

  it('arrow keys enter time-setting mode and +/- adjust the selected field', () => {
    press('ArrowUp');
    expect(input._timeSettingMode).toBe(true);
    expect(document.getElementById('round-timer').classList.contains('time-setting-minutes')).toBe(true);
    press('+');
    expect(state.config.roundDurationSec).toBe(65);
    press('ArrowRight');
    press('-');
    expect(state.config.roundDurationSec).toBe(60); // seconds 05 → 00
    press('-');
    expect(state.config.roundDurationSec).toBe(60 + 55); // seconds wrap 00 → 55
    press('ArrowRight'); // rest-min
    press('ArrowRight'); // rest-sec
    press('ArrowRight'); // rounds
    press('ArrowRight'); // clamps at the last field
    expect(input._timeSettingField).toBe('rounds');
    press('+');
    expect(state.config.numRounds).toBe(1);
    press('ArrowUp'); // ring adjusts too
    expect(state.config.numRounds).toBe(2);
    press('PageUp'); // held ring (Flirc long-press) steps by 5
    expect(state.config.numRounds).toBe(7);
    press('ArrowLeft');
    expect(input._timeSettingField).toBe('rest-sec');
    press('0'); // cancel restores the snapshot
    expect(input._timeSettingMode).toBe(false);
    expect(state.config.roundDurationSec).toBe(5);
    expect(state.config.numRounds).toBe(0);
  });

  it('Enter in time-setting mode saves and starts immediately', () => {
    press('ArrowUp');
    press('+');
    press('Enter');
    expect(input._timeSettingMode).toBe(false);
    expect(state.phase).toBe(PHASES.ROUND);
    expect(state.remainingSec).toBe(65);
    expect(StorageManager.load().roundDurationSec).toBe(65);
  });

  it('adjusting a value while running stops the session and keeps editing', () => {
    press('Enter');
    press('Enter');
    press('ArrowUp');
    expect(state.phase).toBe(PHASES.ROUND); // still running until a value changes
    press('+');
    expect(state.phase).toBe(PHASES.IDLE);
    expect(input._timeSettingMode).toBe(true);
    expect(input._ready).toBe(true);
  });

  it('activates dual mode from the training menu and keeps an edited round count on exit', () => {
    press('*');
    press('6');
    expect(input._dualMode).toBe(true);
    expect(document.getElementById('timer-panel-2').style.display).toBe('');
    expect(document.getElementById('preset-label').textContent).toContain('Dual Timer');
    expect(state.config.numRounds).toBe(0);

    press('ArrowUp');
    for (let i = 0; i < 4; i++) press('ArrowRight'); // → rounds
    press('+');
    press('+');
    expect(state.config.numRounds).toBe(2);
    press('ArrowRight'); // dual mode continues into timer 2's fields
    expect(input._timeSettingField).toBe('t2-round-min');
    press('ArrowLeft');
    press('Enter'); // save + start both timers
    expect(state.phase).toBe(PHASES.ROUND);
    expect(input._dualState.phase).toBe(PHASES.ROUND);
    vi.advanceTimersByTime(1000);
    // Timer 2 starts from the persisted config (defaults here), not timer 1's 5s
    expect(document.getElementById('round-timer-2').textContent).toBe(formatTime(DEFAULT_CONFIG.roundDurationSec - 1));

    press('0'); // stop both
    expect(input._dualState.phase).toBe(PHASES.IDLE);
    keydown('Enter');
    vi.advanceTimersByTime(800);
    keyup('Enter'); // long press: reset + leave dual mode
    expect(input._dualMode).toBe(false);
    expect(document.getElementById('timer-panel-2').style.display).toBe('none');
    expect(state.config.numRounds).toBe(DEFAULT_CONFIG.numRounds);
  });

  it('restores the pre-dual round count when it was not edited', () => {
    state.config.numRounds = 4;
    input._activateDualMode();
    expect(state.config.numRounds).toBe(0);
    input._deactivateDualMode();
    expect(state.config.numRounds).toBe(4);
  });

  it('stealth mode hides the timers and any key restores them', () => {
    press('.');
    expect(renderer.stealth).toBe(true);
    expect(document.getElementById('round-section').style.visibility).toBe('hidden');
    press('Enter');
    expect(renderer.stealth).toBe(false);
    expect(input._ready).toBe(false); // the key only exits stealth
  });

  it('key 9 shows the weekly schedule and key 7 cycles display modes', () => {
    const cycle = vi.fn();
    input._displayModeCallback = cycle;
    input._scheduleManager = { _schedule: [{ dayOfWeek: 'Friday', startTime: '12:00', endTime: '13:00', title: 'Noon', classType: 'adult_basics' }] };
    press('9');
    expect(document.getElementById('overlay').textContent).toContain('Weekly Schedule');
    expect(document.getElementById('overlay').textContent).toContain('Noon');
    press('1');
    expect(overlay.isOpen()).toBe(false);
    press('7');
    expect(cycle).toHaveBeenCalled();
  });
});

// ─── Holiday theme + display modes ───

describe('holiday and display mode helpers', () => {
  it('detects Thanksgiving week and other holidays', () => {
    expect(getActiveHoliday(new Date(2026, 10, 23))).toBe('thanksgiving'); // Mon before Thu Nov 26
    expect(getActiveHoliday(new Date(2026, 10, 26))).toBe('thanksgiving');
    expect(getActiveHoliday(new Date(2026, 10, 27))).toBeNull();
    expect(getActiveHoliday(new Date(2026, 11, 20))).toBe('christmas');
    expect(getActiveHoliday(new Date(2027, 0, 1))).toBe('newyear');
    expect(getActiveHoliday(new Date(2026, 9, 31))).toBe('halloween');
    expect(getActiveHoliday(new Date(2026, 6, 4))).toBe('july4');
    expect(getActiveHoliday(new Date(2026, 1, 14))).toBe('valentine');
    expect(getActiveHoliday(new Date(2026, 5, 1))).toBeNull();
    for (const key of Object.keys(HOLIDAY_THEMES)) expect(HOLIDAY_THEMES[key].particles.count).toBeGreaterThan(0);
  });

  it('cycles display modes and restarts from the first for unknown input', () => {
    expect(nextDisplayMode('mirror')).toBe('clocktimer');
    expect(nextDisplayMode('split')).toBe('mirror');
    expect(nextDisplayMode(null)).toBe(DISPLAY_MODES[0]);
  });
});

// ─── Dual-screen sync ───

describe('display sync snapshots', () => {
  beforeEach(() => loadDom());

  it('serializes leaf sections and container attributes', () => {
    document.getElementById('timer-area').classList.add('dual-timer-active');
    const snap = buildSyncSnapshot(document, () => ({ displayMode: 'split' }), 'abc');
    expect(snap.sessionId).toBe('abc');
    expect(Object.keys(snap.sections).sort()).toEqual([...SYNC_SECTION_IDS].sort());
    expect(snap.sections['round-timer']).toContain('ts-minutes');
    expect(snap.attrs['timer-area'].class).toBe('dual-timer-active');
    expect(SYNC_ATTR_IDS.every(id => id in snap.attrs)).toBe(true);
    expect(snap.meta.displayMode).toBe('split');
    // The big wrapper is not shipped as markup — only its attributes
    expect(snap.sections['timer-area']).toBeUndefined();
  });

  it('applies snapshots to a secondary while preserving element identity', () => {
    const primary = document.implementation.createHTMLDocument('primary');
    primary.body.innerHTML = BODY_HTML;
    primary.getElementById('round-timer').querySelector('.ts-seconds').textContent = '42';
    primary.getElementById('round-timer').classList.add('timer-active');
    primary.getElementById('dual-timer-container').classList.add('dual-mode');
    primary.getElementById('timer-panel-2').style.display = '';
    primary.body.className = 'time-setting';
    const snap = buildSyncSnapshot(primary, () => ({}), 's1');

    const roundTimer = document.getElementById('round-timer');
    const statusBar = document.getElementById('status-bar');
    const applied = { sections: {}, attrs: {} };
    applySyncSnapshot(document, snap, applied);

    expect(document.getElementById('round-timer')).toBe(roundTimer);
    expect(document.getElementById('status-bar')).toBe(statusBar);
    expect(roundTimer.textContent).toBe('05:42');
    expect(roundTimer.classList.contains('timer-active')).toBe(true);
    expect(document.getElementById('dual-timer-container').classList.contains('dual-mode')).toBe(true);
    expect(document.getElementById('timer-panel-2').style.display).toBe('');
    expect(document.body.className).toBe('time-setting');

    // Unchanged sections are skipped on the next apply
    const secondsEl = roundTimer.querySelector('.ts-seconds');
    applySyncSnapshot(document, snap, applied);
    expect(roundTimer.querySelector('.ts-seconds')).toBe(secondsEl);
  });

  it('syncElementFromHtml reconciles attributes and children', () => {
    const el = document.getElementById('preset-label');
    el.setAttribute('data-old', '1');
    syncElementFromHtml(el, '<div id="preset-label" class="x" style="color:red"><b>Hi</b></div>');
    expect(el.hasAttribute('data-old')).toBe(false);
    expect(el.className).toBe('x');
    expect(el.style.color).toBe('red');
    expect(el.innerHTML).toBe('<b>Hi</b>');
    syncElementFromHtml(el, '');
    expect(el.innerHTML).toBe('<b>Hi</b>'); // empty markup is ignored
  });

  it('a Renderer on the secondary keeps working after snapshots are applied', () => {
    const renderer = new Renderer();
    const snap = buildSyncSnapshot(document, () => ({}), 's1');
    applySyncSnapshot(document, snap, { sections: {}, attrs: {} });
    renderer.stealth = true;
    renderer.applyStealth(PHASES.ROUND);
    expect(document.getElementById('status-bar').style.visibility).toBe('hidden');
    expect(document.getElementById('round-section').style.visibility).toBe('hidden');
  });
});

describe('DisplaySyncManager primary', () => {
  let origFetch, origES, fetchMock, sync;

  beforeEach(() => {
    vi.useFakeTimers();
    loadDom();
    origFetch = global.fetch;
    origES = global.EventSource;
    fetchMock = vi.fn(() => Promise.resolve({ ok: true }));
    global.fetch = fetchMock;
    global.EventSource = class { constructor() { this.onmessage = null; } };
  });

  afterEach(() => {
    sync?.stop();
    global.fetch = origFetch;
    global.EventSource = origES;
    vi.useRealTimers();
  });

  it('broadcasts once on start, then only when synced DOM changes, coalescing bursts', async () => {
    sync = new DisplaySyncManager();
    sync.startPrimary(() => ({ displayMode: 'mirror' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.sections['status-bar']).toBeDefined();
    expect(fetchMock.mock.calls[0][1].headers['X-Update-Request']).toBe('1');

    // A quiet second: no traffic
    vi.advanceTimersByTime(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Two mutations in one tick → one broadcast after the debounce window
    document.getElementById('round-timer').querySelector('.ts-seconds').textContent = '59';
    document.getElementById('round-counter').textContent = 'Round 1';
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(second.sections['round-timer']).toContain('59');
    expect(second.sessionId).toBe(body.sessionId);

    // Mutations outside the synced elements do not broadcast
    document.getElementById('clock').textContent = '9:41';
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Heartbeat resends even when nothing changed
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('replays relayed key events from a secondary as local keyboard events', () => {
    let es;
    global.EventSource = class { constructor() { es = this; } };
    sync = new DisplaySyncManager();
    sync.startPrimary(() => ({}));
    const seen = vi.fn();
    document.addEventListener('keydown', seen);
    es.onmessage({ data: JSON.stringify({ type: 'keydown', key: 'Enter', code: 'NumpadEnter' }) });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0][0].code).toBe('NumpadEnter');
    es.onmessage({ data: 'not json' });
    es.onmessage({ data: JSON.stringify({ type: 'click' }) });
    expect(seen).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', seen);
  });

  it('secondary relays its key presses to the primary', async () => {
    let es;
    global.EventSource = class { constructor() { es = this; } };
    sync = new DisplaySyncManager();
    const onSnap = vi.fn();
    sync.startSecondary(onSnap);
    es.onmessage({ data: JSON.stringify({ sessionId: 'x', sentAt: Date.now(), sections: {} }) });
    expect(onSnap).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'x' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '7', code: 'Numpad7', cancelable: true }));
    await Promise.resolve();
    const call = fetchMock.mock.calls.find(c => c[0].endsWith('/keys'));
    expect(call).toBeDefined();
    expect(JSON.parse(call[1].body)).toEqual(expect.objectContaining({ type: 'keydown', key: '7', code: 'Numpad7' }));
  });
});

describe('monotonic timing and silent catch-up regressions', () => {
  let engine;
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { engine?.stop(); vi.useRealTimers(); });

  it.each([-3600000, 3600000])('ignores a wall-clock jump of %s milliseconds', jump => {
    const state = createTimerState({ roundDurationSec: 30, restDurationSec: 5, numRounds: 2, prepDurationSec: 0 });
    engine = new TimerEngine(state);
    engine.start();
    vi.advanceTimersByTime(400);
    vi.setSystemTime(Date.now() + jump);
    vi.advanceTimersByTime(600);
    expect(state.remainingSec).toBe(29);
    vi.advanceTimersByTime(2000);
    expect(state.remainingSec).toBe(27);
  });

  it('suspends explicitly and resumes the partial second without counting suspended time', () => {
    const state = createTimerState({ roundDurationSec: 30, restDurationSec: 5, numRounds: 2, prepDurationSec: 0 });
    engine = new TimerEngine(state);
    engine.start();
    vi.advanceTimersByTime(400);
    engine.suspend();
    engine.suspend(); // pagehide followed by freeze
    vi.advanceTimersByTime(60000);
    vi.setSystemTime(Date.now() - 3600000);
    engine.resumeFromSuspend();
    vi.advanceTimersByTime(599);
    expect(state.remainingSec).toBe(30);
    vi.advanceTimersByTime(1);
    expect(state.remainingSec).toBe(29);
  });

  it('marks old transitions silent, including a session that ended during the stall', () => {
    const state = createTimerState({ roundDurationSec: 2, restDurationSec: 1, numRounds: 2, prepDurationSec: 2 });
    const changes = [];
    engine = new TimerEngine(state, null, (_s, _old, phase) => changes.push([phase, !!engine.silent]));
    engine.start();
    changes.length = 0;
    engine._nextTickAt = performance.now() - 20000;
    engine._drive();
    expect(state.phase).toBe(PHASES.IDLE);
    expect(changes).toEqual([[PHASES.ROUND, true], [PHASES.REST, true], [PHASES.ROUND, true], [PHASES.IDLE, true]]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('untrusted display snapshots and repeated flash events', () => {
  beforeEach(loadDom);

  it('strips executable markup and URL attributes while preserving inert timer text and SVG', () => {
    const el = document.getElementById('round-timer');
    syncElementFromHtml(el, `<div id="round-timer" onclick="alert(1)" style="background:url(https://evil.example)">
      <img src="x" onerror="alert(1)"><script>alert(1)</script><iframe srcdoc="bad"></iframe>
      <svg onload="alert(1)"><a href="javascript:alert(1)"><text>bad</text></a><use href="https://evil.example"/><path d="M0 0"/></svg>
      <span id="sync-status" onmouseover="alert(1)">01:23</span>
    </div>`);
    expect(el.textContent).toContain('01:23');
    expect(el.querySelector('path')).not.toBeNull();
    expect(el.querySelector('script, iframe, a, use, [onclick], [onload], [onerror], [onmouseover], [src], [href]')).toBeNull();
    expect(el.style.background).toBe('');
    expect(el.hasAttribute('onclick')).toBe(false);
  });

  it('preserves the real prep-countdown child ID when syncing the prep overlay', () => {
    const renderer = new Renderer();
    renderer.showPrepCountdown(3);
    const snapshot = buildSyncSnapshot(document, null, 'prep');
    loadDom();
    applySyncSnapshot(document, snapshot, {});
    const countdown = document.querySelector('#prep-overlay > #prep-countdown');
    expect(countdown).not.toBeNull();
    expect(countdown.textContent).toBe('3');
  });

  it('rejects a disallowed root before copying any of its attributes or children', () => {
    const el = document.createElement('section');
    el.id = 'sec';
    el.textContent = 'original';
    document.body.appendChild(el);
    syncElementFromHtml(el, '<section id="sec" onmouseover="alert(1)"><div onclick="alert(2)">bad</div></section>');
    expect(el.outerHTML).toBe('<section id="sec">original</section>');
  });

  it('rejects other target IDs and mismatched roots, and sanitizes container styles', () => {
    const clock = document.getElementById('clock').outerHTML;
    applySyncSnapshot(document, {
      sections: { clock: '<div id="clock">overwritten</div>', 'round-timer': '<div id="wrong">bad</div>' },
      attrs: { clock: { class: 'evil', style: '' }, 'timer-area': { class: 'safe', style: 'background-image:url(https://evil.example);visibility:hidden' } }
    }, {});
    expect(document.getElementById('clock').outerHTML).toBe(clock);
    expect(document.getElementById('round-timer').textContent).toContain('05');
    expect(document.getElementById('timer-area').style.backgroundImage).toBe('');
    expect(document.getElementById('timer-area').style.visibility).toBe('hidden');
  });

  it('restarts identical active flash markup once per explicit event, not on heartbeats', () => {
    const flash = document.getElementById('screen-flash');
    const reflow = vi.spyOn(flash, 'offsetWidth', 'get');
    const applied = {};
    const snap = { sessionId: 'a', flashSequence: 1, sections: { 'screen-flash': '<div id="screen-flash" class="active"></div>' } };
    applySyncSnapshot(document, snap, applied);
    applySyncSnapshot(document, snap, applied);
    applySyncSnapshot(document, { ...snap, flashSequence: 2 }, applied);
    expect(reflow).toHaveBeenCalledTimes(2);
    reflow.mockRestore();
  });

  it('hides both round sections and reveals only the rest timer whose phase is REST', () => {
    const renderer = new Renderer();
    renderer.stealth = true;
    renderer.applyStealth(PHASES.ROUND, PHASES.REST);
    expect(document.getElementById('round-section').style.visibility).toBe('hidden');
    expect(document.getElementById('round-section-2').style.visibility).toBe('hidden');
    expect(document.getElementById('rest-section').style.visibility).toBe('hidden');
    expect(document.getElementById('rest-section-2').style.visibility).toBe('');
    renderer.applyStealth(PHASES.REST, PHASES.ROUND);
    expect(document.getElementById('rest-section').style.visibility).toBe('');
    expect(document.getElementById('rest-section-2').style.visibility).toBe('hidden');
    renderer.stealth = false;
    renderer.applyStealth();
    expect(document.getElementById('round-section-2').style.visibility).toBe('');
  });
});

describe('secondary connection and input lifecycle', () => {
  let sync, stream;
  beforeEach(() => {
    vi.useFakeTimers();
    loadDom();
    vi.stubGlobal('EventSource', class { constructor() { stream = this; } close() {} });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    sync = new DisplaySyncManager();
  });
  afterEach(() => { sync.stop(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('marks disconnected after missing heartbeats, rejects retained stale data, and recovers', () => {
    const received = vi.fn();
    sync.startSecondary(received);
    const banner = document.getElementById('sync-status');
    expect(banner.hidden).toBe(true);
    stream.onerror();
    vi.advanceTimersByTime(30000);
    expect(banner.hidden).toBe(true);
    expect(document.documentElement.classList.contains('sync-stale')).toBe(false);
    stream.onmessage({ data: JSON.stringify({ sentAt: Date.now() - 60000 }) });
    expect(received).not.toHaveBeenCalled();
    expect(banner.hidden).toBe(true);
    stream.onmessage({ data: JSON.stringify({ sentAt: Date.now() }) });
    expect(banner.hidden).toBe(true);
    vi.advanceTimersByTime(26000);
    expect(banner.hidden).toBe(false);
    stream.onmessage({ data: JSON.stringify({ sentAt: Date.now() }) });
    expect(banner.hidden).toBe(true);
    stream.onerror();
    expect(banner.hidden).toBe(false);
  });

  it('serializes requests and sends Enter as an atomic gesture with locally measured duration', async () => {
    let release;
    fetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    sync.startSecondary(() => {});
    keydown('7'); keyup('7');
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);
    release({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(call => JSON.parse(call[1].body).type)).toEqual(['keydown', 'keyup']);
    keydown('Enter');
    vi.advanceTimersByTime(100);
    keyup('Enter');
    // Delay transport far beyond the long-press threshold.
    await vi.advanceTimersByTimeAsync(2000);
    expect(JSON.parse(fetch.mock.lastCall[1].body)).toMatchObject({ type: 'press', heldMs: 100 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each(['blur', 'visibilitychange'])('discards Enter held across %s and accepts the next press', async event => {
    sync.startSecondary(() => {});
    keydown('Enter');
    vi.advanceTimersByTime(100);
    (event === 'blur' ? window : document).dispatchEvent(new Event(event));
    vi.advanceTimersByTime(60000);
    keyup('Enter');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).not.toHaveBeenCalled();
    keydown('Enter');
    vi.advanceTimersByTime(50);
    keyup('Enter');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.lastCall[1].body)).toMatchObject({ type: 'press', heldMs: 50 });
  });

  it('discards implausibly long Enter gestures and removes recovery listeners on stop', async () => {
    const removeWindow = vi.spyOn(window, 'removeEventListener');
    const removeDocument = vi.spyOn(document, 'removeEventListener');
    sync.startSecondary(() => {});
    const clearEnter = sync._keyListeners.clearEnter;
    keydown('Enter');
    vi.advanceTimersByTime(10001);
    keyup('Enter');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).not.toHaveBeenCalled();
    sync.stop();
    expect(removeWindow).toHaveBeenCalledWith('blur', clearEnter);
    expect(removeDocument).toHaveBeenCalledWith('visibilitychange', clearEnter);
    removeWindow.mockRestore();
    removeDocument.mockRestore();
  });
});

// ─── Apple Remote (via Flirc) vocabulary ───

describe('Remote control (ring / OK / ▶ / Menu)', () => {
  let state, engine, renderer, overlay, audio, input;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 8, 12, 0, 0));
    loadDom();
    localStorage.clear();
    state = createTimerState({ roundDurationSec: 5, restDurationSec: 2, numRounds: 0, prepDurationSec: 0 });
    renderer = new Renderer();
    audio = fakeAudio();
    overlay = new OverlayManager();
    engine = new TimerEngine(state, () => {}, () => {});
    input = new InputHandler(engine, overlay, renderer, audio, state);
    document.body.classList.add('timer-idle');
  });

  afterEach(() => {
    input.destroy();
    engine.stop();
    vi.useRealTimers();
  });

  const overlayEl = () => document.getElementById('overlay');
  const selectedName = () => overlayEl().querySelector('.mg-name.mg-sel').textContent;

  it('▶ taps arm, start and pause; holding ▶ stops', () => {
    press(' ');
    expect(input._ready).toBe(true);
    press(' ');
    expect(state.phase).toBe(PHASES.ROUND);
    press(' ');
    expect(state.paused).toBe(true);
    press(' ');
    expect(state.paused).toBe(false);
    keydown(' ');
    vi.advanceTimersByTime(HOLD_MS);
    keyup(' ');
    expect(state.phase).toBe(PHASES.IDLE);
    expect(input._ready).toBe(true); // stop → ready, like key 0
    expect(audio.playCancel).toHaveBeenCalledTimes(1);
  });

  it("Flirc's long-press key arriving mid-hold cancels the pending tap", () => {
    press(' ');
    press(' ');
    expect(state.phase).toBe(PHASES.ROUND);
    keydown(' ');
    vi.advanceTimersByTime(500);
    press('0'); // Flirc sends '0' after ~0.5 s of holding ▶
    expect(state.phase).toBe(PHASES.IDLE);
    expect(input._ready).toBe(true);
    keyup(' '); // the release must not pause/start anything
    vi.advanceTimersByTime(HOLD_MS);
    expect(state.phase).toBe(PHASES.IDLE);
    expect(input._ready).toBe(true);
    expect(audio.playCancel).toHaveBeenCalledTimes(1);
  });

  it('Menu tap opens the main menu, ring + OK navigate, Menu backs out level by level', () => {
    press('Escape');
    expect(overlay.isOpen()).toBe(true);
    expect(overlayEl().textContent).toContain('Training');
    expect(overlayEl().textContent).toContain('Competition');
    expect(overlayEl().textContent).not.toContain('Screens'); // no dual-screen callback here
    expect(selectedName()).toBe('Training');
    press('ArrowDown');
    expect(selectedName()).toBe('Competition');
    press('Enter');
    expect(overlay._mode).toBe('competition');
    press('ArrowDown');
    press('Enter'); // second IBJJF preset
    expect(overlay.isOpen()).toBe(false);
    const names = Object.keys(APP_SETTINGS.competitionPresets);
    expect(document.getElementById('preset-label').textContent).toContain(names[1]);

    press('Escape');
    press('Enter'); // Training
    expect(overlay._mode).toBe('training');
    press('Escape'); // back to main
    expect(overlay._mode).toBe('main');
    press('Escape'); // close
    expect(overlay.isOpen()).toBe(false);
  });

  it('holding Menu resets to defaults; Delete (Flirc hold-Menu) does the same', () => {
    press('ArrowUp');
    press('ArrowUp');
    press('Enter');
    expect(state.phase).toBe(PHASES.ROUND);
    expect(state.config.roundDurationSec).toBe(65);
    keydown('Escape');
    vi.advanceTimersByTime(HOLD_MS);
    keyup('Escape');
    expect(state.phase).toBe(PHASES.IDLE); // running → stop
    expect(overlay.isOpen()).toBe(false); // the hold must not also open the menu
    press('Delete');
    expect(state.config.roundDurationSec).toBe(DEFAULT_CONFIG.roundDurationSec);
    expect(document.body.classList.contains('timer-idle')).toBe(true);
  });

  it('time-setting: ring adjusts, OK starts, Menu cancels and reverts', () => {
    press('ArrowDown'); // enters editing on round minutes
    expect(input._timeSettingMode).toBe(true);
    press('ArrowUp');
    expect(state.config.roundDurationSec).toBe(65);
    press('ArrowRight');
    press('PageDown'); // held ring: seconds −15, wraps 05 → 50
    expect(state.config.roundDurationSec).toBe(60 + 50);
    press('Escape');
    expect(input._timeSettingMode).toBe(false);
    expect(state.config.roundDurationSec).toBe(5);
    press('ArrowUp');
    press('ArrowUp');
    press(' '); // ▶ confirms and starts like OK
    expect(state.phase).toBe(PHASES.ROUND);
    expect(state.remainingSec).toBe(65);
  });

  it('training value entry steps with the ring and confirms with OK', () => {
    press('Escape');
    press('Enter'); // Training
    press('ArrowDown'); // Ladder Up
    expect(selectedName()).toBe('Ladder Up');
    press('Enter');
    expect(overlay._mode).toBe('training-minutes');
    press('ArrowUp'); // from the fallback default of 10
    press('ArrowUp');
    expect(overlayEl().querySelector('.overlay-input').textContent).toBe('12');
    press('Enter');
    expect(overlay._mode).toBe('training-rounds');
    press('ArrowDown'); // 4 → 3
    expect(overlayEl().querySelector('.overlay-input').textContent).toBe('3');
    press('Enter');
    expect(overlay._mode).toBe('training-rest');
    press('PageUp'); // 30 → 45
    expect(overlayEl().querySelector('.overlay-input').textContent).toBe('45');
    press('Escape'); // back to the training list, not closed, selection kept
    expect(overlay._mode).toBe('training');
    expect(selectedName()).toBe('Ladder Up');
    press('Enter');
    press('ArrowUp'); // 11 minutes
    press('Enter');
    press('Enter'); // empty rounds → default 4
    expect(overlay._mode).toBe('training-rest');
    press('Enter'); // empty rest → default 30
    expect(overlay.isOpen()).toBe(false);
    expect(state.roundDurations).toHaveLength(4);
    expect(state.config.restDurationSec).toBe(30);
  });

  it('chainsaw round steps keep the quick-entry buffer in sync with the ring', () => {
    press('Escape');
    press('Enter'); // Training
    press('Enter'); // Chainsaw (first row)
    expect(overlay._mode).toBe('chainsaw-odd-round');
    press('ArrowUp'); // 5:00 default + 15 s
    expect(overlayEl().querySelector('.overlay-input').textContent).toBe('515');
    press('ArrowDown'); press('ArrowDown');
    expect(overlayEl().querySelector('.overlay-input').textContent).toBe('445');
    press('PageDown'); press('PageDown'); press('PageDown'); press('PageDown'); // 4:45 − 4:00
    expect(overlayEl().querySelector('.overlay-input').textContent).toBe('045'); // < 60 s uses the 0XX form
    press('PageDown');
    expect(overlayEl().querySelector('.overlay-input').textContent).toBe('00'); // floors at zero
  });

  it('Weekly schedule and Holiday theme menu items toggle in place', () => {
    const scheduleManager = { _schedule: [] };
    input._scheduleManager = scheduleManager;
    const toggles = [];
    overlay._onScheduleToggle = (v) => toggles.push(v);
    APP_SETTINGS.scheduleEnabled = true;
    press('Escape');
    press('ArrowDown'); press('ArrowDown'); // Schedule
    press('Enter');
    expect(overlay._mode).toBe('schedule');
    press('ArrowRight'); // ring does nothing on the view-only schedule
    expect(APP_SETTINGS.scheduleEnabled).toBe(true);
    expect(overlay._mode).toBe('schedule');
    press('Escape');
    expect(overlay._mode).toBe('main');
    for (let i = 0; i < 5; i++) press('ArrowDown'); // Weekly schedule toggle
    expect(selectedName()).toBe('Weekly schedule');
    expect(overlayEl().textContent).toContain('ON');
    press('Enter');
    expect(overlay._mode).toBe('main');
    expect(APP_SETTINGS.scheduleEnabled).toBe(false);
    expect(overlayEl().textContent).toContain('OFF');
    press('Enter');
    expect(APP_SETTINGS.scheduleEnabled).toBe(true);
    expect(toggles).toEqual([false, true]);
    expect(overlay._mode).toBe('main');
    press('ArrowUp'); press('ArrowUp'); press('ArrowUp'); press('ArrowUp'); press('ArrowUp'); // back to the top

    const before = APP_SETTINGS.holidayThemeEnabled;
    press('ArrowDown'); press('ArrowDown'); press('ArrowDown'); press('ArrowDown'); // Holiday theme
    expect(selectedName()).toBe('Holiday theme');
    expect(overlayEl().textContent).toContain(before ? 'ON' : 'OFF');
    press('Enter'); // toggles in place, menu stays open
    expect(overlay._mode).toBe('main');
    expect(APP_SETTINGS.holidayThemeEnabled).toBe(!before);
    expect(overlayEl().textContent).toContain(before ? 'OFF' : 'ON');
    press('ArrowDown'); press('ArrowDown'); press('ArrowDown'); // About (clamps)
    expect(selectedName()).toBe('About');
    press('Enter');
    expect(overlay._mode).toBe('credits');
    expect(overlayEl().textContent).not.toContain('Holiday');
    press('ArrowRight'); press('ArrowRight'); // hidden system menu
    expect(overlay._mode).toBe('confirm-update');
    press('Escape');
    expect(overlay._mode).toBe('credits');
    APP_SETTINGS.holidayThemeEnabled = before;
  });

  it('Update app item asks first, defaults to No, and only Yes triggers the update', () => {
    const perform = vi.spyOn(overlay, '_performUpdate').mockImplementation(() => {});
    press('Escape');
    for (let i = 0; i < 6; i++) press('ArrowDown'); // Update app
    expect(selectedName()).toBe('Update app');
    press('Enter');
    expect(overlay._mode).toBe('confirm-app-update');
    expect(selectedName()).toBe('No');
    press('Enter'); // default No → back to the menu, nothing downloaded
    expect(overlay._mode).toBe('main');
    expect(perform).not.toHaveBeenCalled();
    const toUpdate = () => { for (let i = 0; i < 6; i++) press('ArrowDown'); };
    toUpdate(); press('Enter'); // reopen the prompt (menu highlight resets on return)
    expect(overlay._mode).toBe('confirm-app-update');
    press('Escape'); // Menu also declines
    expect(overlay._mode).toBe('main');
    toUpdate(); press('Enter');
    press('ArrowDown');
    expect(selectedName()).toBe('Yes, update now');
    press('Enter');
    expect(perform).toHaveBeenCalledWith('/update', expect.any(String));
    perform.mockRestore();
  });

  it('Blank screen item enters stealth and any button wakes it', () => {
    press('Escape');
    press('ArrowDown'); press('ArrowDown'); press('ArrowDown'); // Blank screen
    expect(selectedName()).toBe('Blank screen');
    press('Enter');
    expect(overlay.isOpen()).toBe(false);
    expect(renderer.stealth).toBe(true);
    press(' ');
    expect(renderer.stealth).toBe(false);
    expect(input._ready).toBe(false); // the wake-up press does nothing else
  });

  it('menu while running is Pause / Reset timer / Blank screen / Reset all, each closing it', () => {
    press('Enter'); press('Enter');
    expect(state.phase).toBe(PHASES.ROUND);
    press('Escape');
    const names = () => Array.from(overlayEl().querySelectorAll('.mg-name')).map(el => el.textContent);
    expect(names()).toEqual(['Pause', 'Reset timer', 'Blank screen', 'Reset all']);
    press('Enter'); // Pause
    expect(overlay.isOpen()).toBe(false);
    expect(state.paused).toBe(true);
    press('Escape');
    expect(names()[0]).toBe('Resume');
    press('Enter'); // Resume
    expect(state.paused).toBe(false);
    expect(state.phase).toBe(PHASES.ROUND);

    state.config.roundDurationSec = 123;
    press('Escape');
    press('ArrowDown'); press('Enter'); // Reset timer → stopped, ready, same settings
    expect(overlay.isOpen()).toBe(false);
    expect(state.phase).toBe(PHASES.IDLE);
    expect(input._ready).toBe(true);
    expect(state.config.roundDurationSec).toBe(123);

    press('Enter'); // start again
    expect(state.phase).toBe(PHASES.ROUND);
    press('Escape');
    press('ArrowDown'); press('ArrowDown'); press('ArrowDown'); press('Enter'); // Reset all
    expect(overlay.isOpen()).toBe(false);
    expect(state.phase).toBe(PHASES.IDLE);
    expect(input._ready).toBe(false);
    expect(state.config.roundDurationSec).toBe(DEFAULT_CONFIG.roundDurationSec);
  });
});
