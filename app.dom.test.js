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
  STRINGS, LANGUAGES, t, setLanguage, applyStaticTranslations, presetDisplayName, classDisplayName,
  Scoreboard, SCORE_FIELDS, SCORE_BURST_MS,
  TetrisGame, TETRIS_COLS, TETRIS_ROWS, TETRIS_SCORES_KEY, TETRIS_SCORES_MAX, TETRIS_NAME_CHARS, loadTetrisScores, recordTetrisScore, normalizeTetrisName,
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
    'playCountdownBeepT2', 'playEndOfClassRing', 'playStartOfClassRing', 'playMuffle', 'playResume', 'playCancel', 'playBark'
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

  it('marks the last ten seconds of an active round or rest with the warn class only', () => {
    renderer.updateRoundDisplay(10, true);
    const el = document.getElementById('round-timer');
    expect(el.classList.contains('timer-warn')).toBe(true);
    renderer.updateRoundDisplay(10, false);
    expect(el.classList.contains('timer-warn')).toBe(false);
    renderer.updateRoundDisplay(11, true);
    expect(el.classList.contains('timer-warn')).toBe(false);
    const rest = document.getElementById('rest-timer');
    const container = document.getElementById('dual-timer-container');
    renderer.updateRestDisplay(8, true);
    expect(rest.classList.contains('timer-warn')).toBe(true);
    expect(container.classList.contains('rest-active')).toBe(true); // rest takes the big slot
    renderer.updateRestDisplay(30, false);
    expect(rest.classList.contains('timer-warn')).toBe(false);
    expect(container.classList.contains('rest-active')).toBe(false);
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

  it('state label names Ready / Paused / Finished / Editing and is empty while running or idle', () => {
    const bar = document.getElementById('status-bar');
    renderer.updateStatusBar('ready');
    expect(bar.textContent).toContain('Ready');
    expect(bar.classList.contains('active')).toBe(true);
    renderer.updateStatusBar('menu'); // overlays leave the label alone
    expect(bar.textContent).toContain('Ready');
    renderer.updateStatusBar('running');
    expect(bar.innerHTML).toBe('');
    expect(bar.classList.contains('active')).toBe(false);
    renderer.updateStatusBar('paused');
    expect(bar.textContent).toContain('Paused');
    renderer.updateStatusBar('finished');
    expect(bar.textContent).toContain('Finished');
    renderer.updateStatusBar('editing', { field: 'rest seconds' });
    expect(bar.textContent).toContain('Editing rest seconds');
    expect(bar.textContent).toContain('▶ start');
    renderer.updateStatusBar('notice', { text: 'Stop first · hold ▶' });
    expect(bar.textContent).toBe('Stop first · hold ▶');
    renderer.updateStatusBar('clock');
    expect(bar.innerHTML).toBe('');
  });

  it('labels the outside temperature', () => {
    renderer.updateTemperature('72°F');
    expect(document.getElementById('temperature').textContent).toBe('Outside 72°F');
    renderer.updateTemperature('');
    expect(document.getElementById('temperature').style.display).toBe('none');
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

describe('language', () => {
  beforeEach(() => { loadDom(); localStorage.clear(); });
  afterEach(() => setLanguage('en'));

  it('every English key has a Portuguese translation and t() falls back to English', () => {
    for (const key of Object.keys(STRINGS.en)) expect(STRINGS.pt[key], key).toBeDefined();
    expect(LANGUAGES).toEqual(['en', 'pt']);
    expect(t('label.rounds', { n: 3 })).toBe('3 rounds');
    expect(t('nope.key')).toBe('nope.key');
    setLanguage('pt');
    expect(t('label.rest')).toBe('Descanso');
    expect(localStorage.getItem('bjj-timer-language')).toBe('pt');
    expect(document.documentElement.lang).toBe('pt-BR');
    expect(presetDisplayName('Ladder Up')).toBe('Escada crescente');
    expect(presetDisplayName('Blue Belt')).toBe('Faixa Azul');
    expect(presetDisplayName('Open Mat')).toBe('Tatame livre'); // class titles used as preset names
    expect(presetDisplayName('Some Seminar')).toBe('Some Seminar'); // unknown names stay as stored
    expect(classDisplayName('Marathon Roll- Adults')).toBe('Maratona de rola (adultos)'); // spacing/punctuation ignored
    expect(classDisplayName('MARATHON ROLL - ADULTS')).toBe('Maratona de rola (adultos)');
    expect(classDisplayName('Yoga')).toBe('Yoga');
    expect(setLanguage('xx')).toBe('en');
  });

  it('relabels the static markup and the renderer output in Portuguese', () => {
    const renderer = new Renderer();
    setLanguage('pt');
    expect(document.getElementById('rest-label').textContent).toBe('Descanso');
    expect(document.querySelector('#timer-panel-2 .timer-panel-name').textContent).toBe('Cronômetro 2');
    expect(document.getElementById('stealth-hint').textContent).toContain('Pressione');
    renderer.updateStatusBar('paused');
    expect(document.getElementById('status-bar').textContent).toContain('Pausado');
    renderer.updateRoundCounter(2, 5);
    expect(document.getElementById('round-counter').textContent).toBe('Rodada 2 / 5');
    renderer.updateRoundCounter(0, 0);
    expect(document.getElementById('round-counter').textContent).toContain('Repetir');
    renderer.updatePresetLabel(null);
    expect(document.getElementById('preset-label').textContent).toContain('Personalizado');
    renderer.updateTemperature('20°C');
    expect(document.getElementById('temperature').textContent).toBe('Lá fora 20°C');
    renderer.updateRoundList([300, 240], 1, 'Ladder Down', null, 30, 0, 100, PHASES.ROUND);
    expect(document.getElementById('round-list').textContent).toContain('Agora R1');
    expect(document.getElementById('round-list').textContent).toContain('Escada decrescente');
    setLanguage('en');
    expect(document.getElementById('rest-label').textContent).toBe('Rest');
  });
});

describe('round list emphasis', () => {
  beforeEach(() => loadDom());

  it('shows the current and next round large above the full list', () => {
    const renderer = new Renderer();
    renderer.updateRoundList([300, 240, 180], 2, 'Ladder Down', null, 30, 0, 100, PHASES.ROUND);
    const list = document.getElementById('round-list');
    expect(list.querySelector('.round-now-cur').textContent).toBe('Now R2 · 04:00');
    expect(list.querySelector('.round-now-next').textContent).toBe('Next R3 · 03:00');
    renderer.updateRoundList([300, 240, 180], 3, 'Ladder Down', null, 30, 0, 100, PHASES.ROUND);
    expect(list.querySelector('.round-now-next').textContent).toBe('Last round');
    renderer.updateRoundList([300, 240, 180], 0, 'Ladder Down', null, 30, 0);
    expect(list.querySelector('.round-now')).toBeNull(); // idle preview: list only
  });
});

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
    const dur = () => overlayEl.querySelector('.ts-minutes').textContent + ':' + overlayEl.querySelector('.ts-seconds').textContent;
    expect(dur()).toBe('05:00'); // odd round picker starts at the 5:00 default
    overlay.handleKey('Enter'); // odd round 5:00
    expect(dur()).toBe('00:30'); // odd rest default
    overlay.handleKey('Enter'); // odd rest 30s
    expect(dur()).toBe('05:00'); // even round starts from the odd round
    overlay.handleKey('ArrowDown'); overlay.handleKey('ArrowDown'); overlay.handleKey('ArrowDown');
    expect(dur()).toBe('02:00');
    overlay.handleKey('Enter'); // even round 2:00
    expect(dur()).toBe('00:30'); // even rest starts from the odd rest
    overlay.handleKey('Enter'); // accept it
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

  it('reaches the maintenance screen from credits with a double star', () => {
    overlay.showTrainingMenu(baseConfig(), () => {});
    overlay.handleKey('/');
    expect(overlayEl.textContent).toContain('Credits');
    overlay.handleKey('*');
    expect(overlay._mode).toBe('credits');
    overlay.handleKey('*');
    expect(overlay._mode).toBe('confirm-update');
    expect(overlayEl.textContent).toContain('Maintenance');
    expect(overlayEl.textContent).toContain('Install update and restart');
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
    overlay.handleKey('1'); // Install → asks first
    expect(overlay._mode).toBe('confirm-app-update');
    overlay.handleKey('Menu'); // declined → back to the maintenance list
    expect(overlay._mode).toBe('confirm-update');
    overlay.handleKey('1');
    overlay.handleKey('2'); // Yes, install now
    expect(overlay._mode).toBe('updating');
    overlay.handleKey('5'); // ignored while updating
    expect(overlay._mode).toBe('updating');
    await new Promise(r => setTimeout(r, 0));
    expect(overlay._mode).toBe('update-error');
    expect(overlayEl.textContent).toContain('Connection refused');
    expect(overlayEl.textContent).toContain('Menu to return');
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
    expect(audio.playMuffle).toHaveBeenCalledTimes(1); // pause
    expect(audio.playResume).toHaveBeenCalledTimes(1); // resume sounds different
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

  it('Enter in time-setting mode saves and goes to Ready', () => {
    press('ArrowUp');
    press('+');
    press('Enter');
    expect(input._timeSettingMode).toBe(false);
    expect(state.phase).toBe(PHASES.IDLE);
    expect(input._ready).toBe(true);
    expect(state.remainingSec).toBe(65);
    expect(StorageManager.load().roundDurationSec).toBe(65);
  });

  it('the ring does not edit a running timer', () => {
    press('Enter');
    press('Enter');
    press('ArrowUp');
    press('+');
    expect(state.phase).toBe(PHASES.ROUND);
    expect(input._timeSettingMode).toBe(false);
    expect(state.config.roundDurationSec).toBe(5);
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
    press('Enter'); // save → Ready
    press('Enter'); // start both timers
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
    expect(body.seq).toBe(1);
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

  it('a different key arriving mid-hold cancels the pending gesture so its release relays nothing', async () => {
    sync.startSecondary(() => {});
    keydown(' ');
    vi.advanceTimersByTime(400);
    press('0'); // Flirc's hold-▶ key
    keyup(' ');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch.mock.calls.map(call => JSON.parse(call[1].body).type)).toEqual(['keydown', 'keyup']);
    press(' '); // the next tap is relayed normally
    await vi.advanceTimersByTimeAsync(0);
    expect(JSON.parse(fetch.mock.lastCall[1].body)).toMatchObject({ type: 'press', key: ' ' });
  });

  it('ignores a snapshot older than the newest one from the same session', () => {
    const received = vi.fn();
    sync.startSecondary(received);
    stream.onmessage({ data: JSON.stringify({ sessionId: 'a', seq: 2, sentAt: Date.now() }) });
    stream.onmessage({ data: JSON.stringify({ sessionId: 'a', seq: 1, sentAt: Date.now() }) });
    expect(received).toHaveBeenCalledTimes(1);
    stream.onmessage({ data: JSON.stringify({ sessionId: 'b', seq: 1, sentAt: Date.now() }) }); // new primary session
    expect(received).toHaveBeenCalledTimes(2);
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
    // Mirror boot: the fixture config is the "default" a reset lands on, so the
    // idle menu starts without a Reset row.
    input._defaultConfigCallback = () => ({ ...FIXTURE_DEFAULTS, presetName: null });
    input._resetCallback = () => {
      Object.assign(state.config, FIXTURE_DEFAULTS);
      state.remainingSec = FIXTURE_DEFAULTS.roundDurationSec;
      state._presetName = null;
    };
    document.body.classList.add('timer-idle');
  });

  afterEach(() => {
    input.destroy();
    engine.stop();
    vi.useRealTimers();
  });

  const FIXTURE_DEFAULTS = { roundDurationSec: 5, restDurationSec: 2, numRounds: 0, prepDurationSec: 0 };
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
    expect(selectedName()).toBe('Scoreboard'); // toggle row leads the preset list
    press('ArrowDown'); press('ArrowDown');
    press('Enter'); // second IBJJF preset
    expect(overlay.isOpen()).toBe(false);
    const names = Object.keys(APP_SETTINGS.competitionPresets);
    expect(document.getElementById('preset-label').textContent).toContain(names[1]);

    press('Escape');
    expect(selectedName()).toBe('Training'); // presets lead; Scoreboard then Restore follow once a competition preset is selected
    press('ArrowDown'); press('ArrowDown');
    expect(selectedName()).toBe('Scoreboard');
    press('ArrowDown');
    expect(selectedName()).toBe('Restore defaults');
    press('ArrowUp'); press('ArrowUp'); press('ArrowUp');
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
    press(' '); // save and start
    expect(state.phase).toBe(PHASES.ROUND);
    expect(state.config.roundDurationSec).toBe(65);
    keydown('Escape');
    vi.advanceTimersByTime(HOLD_MS);
    keyup('Escape');
    expect(state.phase).toBe(PHASES.IDLE); // running → stop to Ready
    expect(input._ready).toBe(true);
    expect(overlay.isOpen()).toBe(false); // the hold must not also open the menu
    press('Delete');
    expect(state.config.roundDurationSec).toBe(FIXTURE_DEFAULTS.roundDurationSec);
    expect(document.body.classList.contains('timer-idle')).toBe(true);
  });

  it('time-setting: ring adjusts, ▶ saves and starts, Menu cancels and reverts', () => {
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
    press(' '); // ▶ saves and starts
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
    const dur = () => overlayEl().querySelector('.ts-minutes').textContent + ':' + overlayEl().querySelector('.ts-seconds').textContent;
    expect(dur()).toBe('00:30'); // rest picker starts at the 30 s default, minutes field first
    press('ArrowRight'); // → seconds field
    press('PageUp'); // held ring: +15 s → 45
    expect(dur()).toBe('00:45');
    expect(overlayEl().textContent).toContain('Step 3 of 3');
    press('Escape'); // Menu steps back one prompt, keeping the entered value
    expect(overlay._mode).toBe('training-rounds');
    expect(overlayEl().querySelector('.overlay-input').textContent).toBe('3');
    expect(overlayEl().textContent).toContain('Step 2 of 3');
    press('Escape');
    expect(overlay._mode).toBe('training-minutes');
    expect(overlayEl().querySelector('.overlay-input').textContent).toBe('12');
    press('Escape'); // first step: back to the training list, not closed, selection kept
    expect(overlay._mode).toBe('training');
    expect(selectedName()).toBe('Ladder Up');
    press('Enter');
    expect(overlayEl().textContent).toContain('Step 1 of 3');
    expect(overlayEl().querySelector('.overlay-input-dim')).not.toBeNull(); // suggested value
    expect(overlayEl().textContent).toContain('suggested');
    press('ArrowUp'); // 11 minutes
    press('Enter');
    press('Enter'); // empty rounds → default 4
    expect(overlay._mode).toBe('training-rest');
    expect(overlayEl().textContent).toContain('minutes');
    expect(overlayEl().textContent).toContain('seconds');
    press('Enter'); // empty rest → default 30
    expect(overlay.isOpen()).toBe(false);
    expect(state.roundDurations).toHaveLength(4);
    expect(state.config.restDurationSec).toBe(30);
  });

  it('chainsaw Menu steps back through the prompts and keeps confirmed values', () => {
    press('Escape');
    press('Enter'); // Training
    press('Enter'); // Chainsaw
    const dur = () => overlayEl().querySelector('.ts-minutes').textContent + ':' + overlayEl().querySelector('.ts-seconds').textContent;
    press('ArrowUp'); // odd round 6:00
    press('Enter');
    expect(overlay._mode).toBe('chainsaw-odd-rest');
    expect(dur()).toBe('00:30');
    press('ArrowRight'); press('ArrowUp'); // odd rest 0:35
    press('Enter');
    expect(overlay._mode).toBe('chainsaw-even-round');
    expect(overlayEl().textContent).toContain('Step 3 of 5');
    press('Escape'); // back to odd rest with its value
    expect(overlay._mode).toBe('chainsaw-odd-rest');
    expect(dur()).toBe('00:35');
    press('Escape');
    expect(overlay._mode).toBe('chainsaw-odd-round');
    expect(dur()).toBe('06:00');
    press('Enter'); // forward again: odd rest keeps 0:35 instead of the 0:30 default
    expect(dur()).toBe('00:35');
    press('Escape'); press('Escape'); // first step → training list
    expect(overlay._mode).toBe('training');
  });

  it('chainsaw round steps edit the min:sec picker with the ring', () => {
    press('Escape');
    press('Enter'); // Training
    press('Enter'); // Chainsaw (first row)
    expect(overlay._mode).toBe('chainsaw-odd-round');
    const dur = () => overlayEl().querySelector('.ts-minutes').textContent + ':' + overlayEl().querySelector('.ts-seconds').textContent;
    expect(dur()).toBe('05:00');
    press('ArrowUp'); // minutes field: +1
    expect(dur()).toBe('06:00');
    press('ArrowRight'); // → seconds field
    press('ArrowUp'); press('ArrowUp'); press('ArrowUp'); // +5 s each
    expect(dur()).toBe('06:15');
    press('PageDown'); // held ring: −15 s
    expect(dur()).toBe('06:00');
    press('ArrowDown'); // seconds wrap 00 → 55 (minutes untouched)
    expect(dur()).toBe('06:55');
    press('ArrowLeft'); // back to minutes
    press('PageDown'); press('PageDown'); // −5 min each, floors at zero
    expect(dur()).toBe('00:55');
    press('Enter'); // odd round accepted → odd rest step
    expect(overlay._mode).toBe('chainsaw-odd-rest');
    expect(overlay._chainsawOddRoundSec).toBe(55);
  });

  it('Weekly schedule and Holiday theme menu items toggle in place', () => {
    const scheduleManager = { _schedule: [] };
    input._scheduleManager = scheduleManager;
    const toggles = [];
    overlay._onScheduleToggle = (v) => toggles.push(v);
    APP_SETTINGS.scheduleEnabled = true;
    press('Escape');
    press('ArrowDown'); press('ArrowDown'); // View schedule
    expect(selectedName()).toBe('View schedule');
    press('Enter');
    expect(overlay._mode).toBe('schedule');
    press('ArrowRight'); // ◀▶ moves the large day view, never the setting
    expect(APP_SETTINGS.scheduleEnabled).toBe(true);
    expect(overlay._mode).toBe('schedule');
    press('Escape');
    expect(overlay._mode).toBe('main');
    for (let i = 0; i < 4; i++) press('ArrowDown'); // Follow class schedule toggle
    expect(selectedName()).toBe('Follow class schedule');
    expect(overlayEl().textContent).toContain('ON');
    press('Enter');
    expect(overlay._mode).toBe('main');
    expect(APP_SETTINGS.scheduleEnabled).toBe(false);
    expect(overlayEl().textContent).toContain('OFF');
    press('Enter');
    expect(APP_SETTINGS.scheduleEnabled).toBe(true);
    expect(toggles).toEqual([false, true]);
    expect(overlay._mode).toBe('main');
    for (let i = 0; i < 4; i++) press('ArrowUp'); // back to the top

    const before = APP_SETTINGS.holidayThemeEnabled;
    for (let i = 0; i < 5; i++) press('ArrowDown'); // Holiday theme
    expect(selectedName()).toBe('Holiday theme');
    expect(overlayEl().textContent).toContain(before ? 'ON' : 'OFF');
    press('Enter'); // toggles in place, menu stays open
    expect(overlay._mode).toBe('main');
    expect(APP_SETTINGS.holidayThemeEnabled).toBe(!before);
    expect(overlayEl().textContent).toContain(before ? 'OFF' : 'ON');
    press('ArrowDown'); // Quiet visuals toggles in place too
    expect(selectedName()).toBe('Quiet visuals');
    const quietBefore = APP_SETTINGS.quietVisuals;
    press('Enter');
    expect(APP_SETTINGS.quietVisuals).toBe(!quietBefore);
    expect(document.body.classList.contains('quiet-visuals')).toBe(!quietBefore);
    press('Enter');
    expect(APP_SETTINGS.quietVisuals).toBe(quietBefore);
    press('ArrowDown'); press('ArrowDown'); press('ArrowDown'); press('ArrowDown'); // clamps on the last row
    expect(selectedName()).toBe('Tetris');
    press('ArrowUp'); // About
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

  it('Language row toggles English / Portuguese in place and relabels the menu', () => {
    const names = () => Array.from(overlayEl().querySelectorAll('.mg-name')).map(el => el.textContent);
    try {
      press('Escape');
      for (let i = 0; i < 7; i++) press('ArrowDown');
      expect(selectedName()).toBe('Language');
      expect(overlayEl().textContent).toContain('English');
      press('Enter');
      expect(overlay._mode).toBe('main');
      expect(APP_SETTINGS.language).toBe('pt');
      expect(selectedName()).toBe('Idioma'); // highlight stays on the row, menu re-labelled
      expect(overlayEl().textContent).toContain('Português');
      expect(names()).toContain('Treino');
      expect(names()).toContain('Manutenção');
      expect(document.getElementById('rest-label').textContent).toBe('Descanso');
      press('Escape');
      press('Enter'); // ready state label in Portuguese
      expect(document.getElementById('status-bar').textContent).toContain('Pronto');
      press('Escape');
      expect(names()[2]).toBe('Restaurar padrões'); // third once the app is not in its default state
      press('Enter'); // Treino (first row)
      expect(overlayEl().textContent).toContain('Predefinições de treino');
      press('Escape'); press('ArrowDown'); press('Enter'); // Competição
      expect(overlayEl().textContent).toContain('Faixa Azul');
      expect(overlayEl().textContent).toContain('Infantil');
      press('Escape'); press('ArrowUp'); press('Enter'); // back to Treino
      expect(overlayEl().textContent).toContain('Motosserra');
      press('ArrowDown'); press('Enter'); // Escada crescente wizard
      expect(overlayEl().textContent).toContain('Passo 1 de 3');
      expect(overlayEl().textContent).toContain('Minutos no total');
      press('Escape'); press('Escape');
      for (let i = 0; i < 8; i++) press('ArrowDown'); // Restaurar padrões leads while ready
      expect(selectedName()).toBe('Idioma');
      press('Enter');
      expect(APP_SETTINGS.language).toBe('en');
      expect(selectedName()).toBe('Language');
    } finally {
      setLanguage('en');
    }
  });

  it('Maintenance lists install and schedule sync; install asks first, defaults to No', () => {
    const perform = vi.spyOn(overlay, '_performUpdate').mockImplementation(() => {});
    const toMaintenance = () => { for (let i = 0; i < 8; i++) press('ArrowDown'); };
    press('Escape');
    toMaintenance();
    expect(selectedName()).toBe('Maintenance');
    press('Enter');
    expect(overlay._mode).toBe('confirm-update');
    expect(selectedName()).toBe('Install update and restart');
    press('Enter');
    expect(overlay._mode).toBe('confirm-app-update');
    expect(selectedName()).toBe('No, go back');
    press('Enter'); // default No → back to the maintenance list, nothing downloaded
    expect(overlay._mode).toBe('confirm-update');
    expect(perform).not.toHaveBeenCalled();
    press('Escape'); // Menu from the list → main menu
    expect(overlay._mode).toBe('main');
    toMaintenance(); press('Enter'); press('Enter');
    press('Escape'); // Menu also declines
    expect(overlay._mode).toBe('confirm-update');
    press('Enter');
    press('ArrowDown');
    expect(selectedName()).toBe('Yes, install now');
    press('Enter');
    expect(perform).toHaveBeenCalledWith('/update', expect.any(String));
    perform.mockClear();
    press('Escape'); // (mocked update left the mode alone) → list
    toMaintenance(); // noop if the menu is not open
    overlay.closeOverlay();
    press('Escape'); toMaintenance(); press('Enter');
    press('ArrowDown'); // Sync class schedule runs without a prompt
    expect(selectedName()).toBe('Sync class schedule');
    press('Enter');
    expect(perform).toHaveBeenCalledWith('/sync-schedule', expect.any(String));
    perform.mockRestore();
  });

  it('Hide display item enters stealth and any button wakes it', () => {
    press('Escape');
    press('ArrowDown'); press('ArrowDown'); press('ArrowDown'); // Hide display
    expect(selectedName()).toBe('Hide display');
    expect(overlayEl().textContent).toContain('rest timer stays');
    press('Enter');
    expect(overlay.isOpen()).toBe(false);
    expect(renderer.stealth).toBe(true);
    press(' ');
    expect(renderer.stealth).toBe(false);
    expect(input._ready).toBe(false); // the wake-up press does nothing else
  });

  it('menu while running is Pause / Stop and keep settings / Restore defaults (asks) / Hide display', () => {
    press('Enter'); press('Enter');
    expect(state.phase).toBe(PHASES.ROUND);
    press('Escape');
    const names = () => Array.from(overlayEl().querySelectorAll('.mg-name')).map(el => el.textContent);
    expect(names()).toEqual(['Pause', 'Stop and keep settings', 'Restore defaults', 'Hide display']);
    press('Enter'); // Pause leads: a stray OK can never discard the session
    expect(overlay.isOpen()).toBe(false);
    expect(state.paused).toBe(true);
    expect(document.getElementById('status-bar').textContent).toContain('Paused');
    press('Escape');
    expect(names()[0]).toBe('Resume');
    press('Enter'); // Resume
    expect(state.paused).toBe(false);
    expect(state.phase).toBe(PHASES.ROUND);
    expect(document.getElementById('status-bar').innerHTML).toBe('');

    state.config.roundDurationSec = 123;
    press('Escape');
    press('ArrowDown'); press('Enter'); // Stop and keep settings → stopped, ready, same settings
    expect(overlay.isOpen()).toBe(false);
    expect(state.phase).toBe(PHASES.IDLE);
    expect(input._ready).toBe(true);
    expect(state.config.roundDurationSec).toBe(123);
    expect(document.getElementById('status-bar').textContent).toContain('Ready');

    press('Enter'); // start again
    expect(state.phase).toBe(PHASES.ROUND);
    press('Escape');
    press('ArrowDown'); press('ArrowDown'); press('Enter'); // Restore defaults → asks first
    expect(overlay._mode).toBe('confirm-action');
    expect(selectedName()).toBe('No, go back');
    expect(overlayEl().textContent).toContain('Restore defaults?');
    press('Enter'); // No → back to the running menu, timer untouched
    expect(overlay._mode).toBe('main');
    expect(state.phase).toBe(PHASES.ROUND);
    press('ArrowDown'); press('ArrowDown'); press('Enter');
    press('Escape'); // Menu declines too
    expect(overlay._mode).toBe('main');
    expect(state.phase).toBe(PHASES.ROUND);
    press('ArrowDown'); press('ArrowDown'); press('Enter');
    press('ArrowDown'); press('Enter'); // Yes, restore defaults
    expect(overlay.isOpen()).toBe(false);
    expect(state.phase).toBe(PHASES.IDLE);
    expect(input._ready).toBe(false);
    expect(state.config.roundDurationSec).toBe(FIXTURE_DEFAULTS.roundDurationSec);
  });

  it('idle menu is ordered by use and shows Restore defaults third only when not in the default state', () => {
    const names = () => Array.from(overlayEl().querySelectorAll('.mg-name')).map(el => el.textContent);
    press('Escape');
    expect(names()).toEqual(['Training', 'Competition', 'View schedule', 'Hide display', 'Follow class schedule',
      'Holiday theme', 'Quiet visuals', 'Language', 'Maintenance', 'About', 'Tetris']); // default state: no Restore row
    press('Escape');
    expect(overlay.isOpen()).toBe(false);

    press('Enter'); // ready state counts as non-default
    expect(input._ready).toBe(true);
    press('Escape');
    expect(names().slice(0, 4)).toEqual(['Training', 'Competition', 'Restore defaults', 'View schedule']);
    press('ArrowDown'); press('ArrowDown'); press('Enter'); // idle: restores without a prompt (nothing running to lose)
    expect(overlay.isOpen()).toBe(false);
    expect(input._ready).toBe(false);
    press('Escape');
    expect(names()[2]).toBe('View schedule');
    press('Escape');

    state.config.roundDurationSec = 123; // changed settings count as non-default
    press('Escape');
    expect(names()[2]).toBe('Restore defaults');
    press('ArrowDown'); press('ArrowDown'); press('Enter');
    expect(state.config.roundDurationSec).toBe(FIXTURE_DEFAULTS.roundDurationSec);
    press('Escape');
    expect(names()[2]).toBe('View schedule');
  });

  it('editing shows the field and controls in the state label', () => {
    press('ArrowDown'); // enters editing on round minutes
    const bar = document.getElementById('status-bar');
    expect(bar.textContent).toContain('Editing round minutes');
    expect(bar.textContent).toContain('▶ start');
    press('ArrowRight');
    expect(bar.textContent).toContain('Editing round seconds');
    press('Escape');
    expect(bar.innerHTML).toBe('');
    press('Enter'); press('Enter'); // running
    press('ArrowDown'); // no editing while running: the label says how to stop
    expect(bar.textContent).toBe('Stop first · hold ▶');
  });

  it('a finished session is labelled Finished until the next start', () => {
    state.config.numRounds = 1;
    const bar = document.getElementById('status-bar');
    press('Enter'); press('Enter');
    expect(state.phase).toBe(PHASES.ROUND);
    expect(bar.innerHTML).toBe('');
    vi.advanceTimersByTime(FIXTURE_DEFAULTS.roundDurationSec * 1000 + 1500);
    // The boot wiring sets the Finished label; here the fixture has no boot, so
    // the renderer is driven directly the way boot does on natural completion
    renderer.updateStatusBar('finished');
    expect(bar.textContent).toContain('Finished');
    press('Enter');
    if (state.phase === PHASES.IDLE) press('Enter');
    expect(bar.innerHTML).toBe('');
  });

  it('schedule overlay opens on today and ◀▶ change the day shown large', () => {
    input._scheduleManager = { _schedule: [
      { dayOfWeek: 'Tuesday', startTime: '18:00', endTime: '19:00', title: 'Adult Jiu-Jitsu, all levels', classType: 'adult_all_levels' },
      { dayOfWeek: 'Wednesday', startTime: '17:00', endTime: '18:00', title: 'Kids Basics', classType: 'kids' }
    ] };
    press('Escape');
    press('ArrowDown'); press('ArrowDown'); press('Enter'); // View schedule (fixture clock: Tuesday Sept 8 2026)
    expect(overlay._mode).toBe('schedule');
    const detail = () => overlayEl().querySelector('.sched-detail').textContent;
    expect(detail()).toContain('Tuesday');
    expect(detail()).toContain('today');
    expect(detail()).toContain('Adult Jiu-Jitsu, all levels');
    expect(detail()).toContain('pm'); // AM/PM shown in the schedule
    expect(overlayEl().querySelector('.sched-day.sched-sel.sched-today')).not.toBeNull();
    press('ArrowRight');
    expect(detail()).toContain('Wednesday');
    expect(detail()).toContain('Kids Basics');
    press('ArrowRight');
    expect(detail()).toContain('Thursday');
    expect(detail()).toContain('No classes');
    press('Escape');
    expect(overlay._mode).toBe('main');
    press('Escape');
    try {
      setLanguage('pt');
      press('Escape');
      press('ArrowDown'); press('ArrowDown'); press('Enter');
      expect(detail()).toContain('Terça');
      expect(detail()).toContain('hoje');
      expect(overlayEl().textContent).toContain('Jiu-Jitsu adulto, todos os níveis');
      expect(overlayEl().textContent).toContain('Infantil básico');
      expect(overlayEl().textContent).not.toContain('Kids Basics');
      press('Escape');
    } finally { setLanguage('en'); }
  });

  it('a changed preparation countdown shows the Restore row and restoring clears it', () => {
    const names = () => Array.from(overlayEl().querySelectorAll('.mg-name')).map(el => el.textContent);
    state.config.prepDurationSec = 10;
    press('Escape');
    expect(names()[2]).toBe('Restore defaults');
    press('ArrowDown'); press('ArrowDown'); press('Enter');
    expect(overlay.isOpen()).toBe(false);
    expect(state.config.prepDurationSec).toBe(0);
    press('Escape');
    expect(names()[2]).toBe('View schedule');
  });

  it.each(['blur', 'visibilitychange'])('a hold interrupted by %s never fires', event => {
    press(' ');
    press(' ');
    expect(state.phase).toBe(PHASES.ROUND);
    keydown('Escape');
    vi.advanceTimersByTime(300);
    (event === 'blur' ? window : document).dispatchEvent(new Event(event));
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(state.phase).toBe(PHASES.ROUND); // no reset
    keyup('Escape'); // release after focus returns is not a Menu tap either
    expect(overlay.isOpen()).toBe(false);
    expect(state.phase).toBe(PHASES.ROUND);
    press('Escape'); // the next gesture works normally
    expect(overlay.isOpen()).toBe(true);
  });

  it('destroy() drops a pending hold instead of firing it later', () => {
    press(' ');
    press(' ');
    keydown('Escape');
    input.destroy();
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(state.phase).toBe(PHASES.ROUND);
    input = new InputHandler(engine, overlay, renderer, audio, state); // afterEach destroys this one
  });

  // ─── Regular timer: settings change only while nothing is live ───

  const bar = () => document.getElementById('status-bar');
  const hold = (key) => { keydown(key); vi.advanceTimersByTime(HOLD_MS); keyup(key); };
  const startRunning = () => { press(' '); press(' '); vi.advanceTimersByTime(2000); };

  it.each(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'])(
    'the ring (%s) never edits or stops a running timer', key => {
      state.config.roundDurationSec = 30;
      startRunning();
      press(key);
      press(key);
      expect(input._timeSettingMode).toBe(false);
      expect(state.phase).toBe(PHASES.ROUND);
      expect(state.remainingSec).toBe(28);
      expect(state.config.roundDurationSec).toBe(30);
      expect(audio.playCancel).not.toHaveBeenCalled();
    });

  it('the ring while running says how to stop, then clears', () => {
    startRunning();
    press('ArrowUp');
    expect(bar().textContent).toBe('Stop first · hold ▶');
    vi.advanceTimersByTime(2000);
    expect(bar().innerHTML).toBe('');
    press('Escape'); // Menu still opens the running menu
    expect(overlay.isOpen()).toBe(true);
  });

  it('the ring while paused keeps the session paused and the Paused label back after the notice', () => {
    startRunning();
    press(' ');
    expect(state.paused).toBe(true);
    press('ArrowUp');
    press('ArrowDown');
    expect(input._timeSettingMode).toBe(false);
    expect(state.paused).toBe(true);
    expect(state.phase).toBe(PHASES.ROUND);
    vi.advanceTimersByTime(2000);
    expect(bar().textContent).toContain('Paused');
  });

  it('a repeated notice after resuming restores the running label', () => {
    startRunning();
    const runningLabel = bar().innerHTML;
    press(' ');
    expect(bar().textContent).toContain('Paused');
    press('ArrowUp');
    expect(bar().textContent).toBe('Stop first · hold ▶');
    vi.advanceTimersByTime(500);
    press(' ');
    expect(state.paused).toBe(false);
    expect(bar().innerHTML).toBe(runningLabel);
    press('ArrowDown');
    expect(bar().textContent).toBe('Stop first · hold ▶');
    vi.advanceTimersByTime(2000);
    expect(state.phase).toBe(PHASES.ROUND);
    expect(state.paused).toBe(false);
    expect(bar().innerHTML).toBe(runningLabel);
  });

  it('a notice does not overwrite a state reached before it times out', () => {
    startRunning();
    press('ArrowUp');
    press(' '); // pause during the notice
    expect(bar().textContent).toContain('Paused');
    vi.advanceTimersByTime(2000);
    expect(bar().textContent).toContain('Paused');
  });

  it('OK in the editor saves and goes to Ready without starting', () => {
    press('ArrowUp');
    press('ArrowUp');
    press('Enter');
    expect(input._timeSettingMode).toBe(false);
    expect(state.phase).toBe(PHASES.IDLE);
    expect(input._ready).toBe(true);
    expect(document.body.classList.contains('timer-idle')).toBe(false);
    expect(bar().textContent).toContain('Ready');
    expect(StorageManager.load().roundDurationSec).toBe(65);
    expect(document.getElementById('round-timer').textContent).toBe('01:05');
    press(' ');
    expect(state.phase).toBe(PHASES.ROUND);
    expect(state.remainingSec).toBe(65);
  });

  it('▶ in the editor saves and starts', () => {
    press('ArrowUp');
    press('ArrowUp');
    press(' ');
    expect(state.phase).toBe(PHASES.ROUND);
    expect(state.remainingSec).toBe(65);
    expect(StorageManager.load().roundDurationSec).toBe(65);
  });

  it.each([
    ['hold ▶', () => hold(' ')],
    ['hold ▶ (Flirc 0)', () => press('0')],
    ['hold OK', () => hold('Enter')],
    ['hold Menu', () => hold('Escape')],
    ['hold Menu (Flirc Delete)', () => press('Delete')],
  ])('%s while running stops to Ready with the same times', (_name, stop) => {
    state.config.roundDurationSec = 30;
    startRunning();
    stop();
    expect(state.phase).toBe(PHASES.IDLE);
    expect(input._ready).toBe(true);
    expect(document.body.classList.contains('timer-idle')).toBe(false);
    expect(state.config.roundDurationSec).toBe(30);
    expect(bar().textContent).toContain('Ready');
    expect(overlay.isOpen()).toBe(false);
  });

  it('Ready and Finished name the way back to the clock face', () => {
    press(' ');
    expect(bar().textContent).toContain('hold ▶ clock');
    renderer.updateStatusBar('finished');
    expect(bar().textContent).toContain('hold ▶ clock');
  });

  it('the ring with a round-list preset loaded says why it does nothing', () => {
    state.roundDurations = [60, 120, 180];
    press('ArrowUp');
    expect(input._timeSettingMode).toBe(false);
    expect(bar().textContent).toBe('Preset · Menu → Restore defaults to edit');
  });

  it('the editing control line has no running variant', () => {
    press('ArrowUp');
    expect(bar().textContent).toContain('OK save');
    expect(bar().textContent).not.toContain('restart');
  });
});

describe('main menu icons', () => {
  it('every row has its own icon, idle and running', () => {
    vi.useFakeTimers();
    loadDom();
    const state = createTimerState({ roundDurationSec: 5, restDurationSec: 2, numRounds: 0, prepDurationSec: 0 });
    const renderer = new Renderer();
    const overlay = new OverlayManager();
    const engine = new TimerEngine(state, () => {}, () => {});
    const input = new InputHandler(engine, overlay, renderer, fakeAudio(), state);
    input._displayModeCallback = () => {};
    const icons = () => Array.from(document.querySelectorAll('#overlay .mg-icon')).map(el => el.innerHTML);
    state.config.roundDurationSec = 99; // non-default → Restore row present
    press('Escape');
    let list = icons();
    expect(list.every(Boolean)).toBe(true);
    expect(new Set(list).size).toBe(list.length);
    press('Escape');
    press('Enter'); press('Enter');
    press('Escape');
    list = icons();
    expect(new Set(list).size).toBe(list.length);
    input.destroy(); engine.stop();
    vi.useRealTimers();
  });
});

describe('Scoreboard', () => {
  let sb;
  const root = () => document.getElementById('scoreboard');
  const focused = () => root().querySelector('.sb-field.sb-focus').dataset.field;
  const value = (f) => root().querySelector(`.sb-field[data-field="${f}"] .sb-value`).textContent;
  const sup = (f) => root().querySelector(`.sb-field[data-field="${f}"] .sb-sup`);
  beforeEach(() => { vi.useFakeTimers(); loadDom(); sb = new Scoreboard(root()); });
  afterEach(() => { sb.destroy(); vi.useRealTimers(); });

  it('starts 0-0 with the cursor on Blue points and labels filled in', () => {
    expect(SCORE_FIELDS).toEqual(['bluePen', 'blueAdv', 'bluePoints', 'whitePoints', 'whiteAdv', 'whitePen']);
    expect(focused()).toBe('bluePoints');
    expect(SCORE_FIELDS.map(value)).toEqual(['0', '0', '0', '0', '0', '0']);
    expect(root().querySelector('.sb-field[data-field="bluePoints"] .sb-label').textContent).toBe('Points');
    expect(root().querySelector('.sb-field[data-field="whiteAdv"] .sb-label').textContent).toBe('Adv');
    expect(root().querySelector('.sb-field[data-field="whitePen"] .sb-label').textContent).toBe('Pen');
  });

  it('◀ ▶ walk the ring order and stop at the ends', () => {
    sb.handleKey('ArrowLeft'); expect(focused()).toBe('blueAdv');
    sb.handleKey('ArrowLeft'); expect(focused()).toBe('bluePen');
    sb.handleKey('ArrowLeft'); expect(focused()).toBe('bluePen');
    for (let i = 0; i < 3; i++) sb.handleKey('ArrowRight');
    expect(focused()).toBe('whitePoints');
    sb.handleKey('ArrowRight'); expect(focused()).toBe('whiteAdv');
    sb.handleKey('ArrowRight'); expect(focused()).toBe('whitePen');
    sb.handleKey('ArrowRight'); expect(focused()).toBe('whitePen');
  });

  it('▲ ▼ change the focused value by 1, never below 0, and ADV / PEN send the cursor home', () => {
    sb.handleKey('ArrowUp'); sb.handleKey('ArrowUp');
    expect(value('bluePoints')).toBe('2');
    sb.handleKey('ArrowDown'); sb.handleKey('ArrowDown'); sb.handleKey('ArrowDown');
    expect(value('bluePoints')).toBe('0');
    sb.handleKey('ArrowLeft'); sb.handleKey('ArrowUp'); // Blue ADV +1
    expect(value('blueAdv')).toBe('1');
    expect(focused()).toBe('bluePoints');
    sb.handleKey('ArrowLeft'); sb.handleKey('ArrowLeft'); sb.handleKey('ArrowUp'); // Blue PEN +1
    expect(value('bluePen')).toBe('1');
    expect(root().querySelector('.sb-field[data-field="bluePen"]').classList.contains('sb-pen-hot')).toBe(true);
    expect(focused()).toBe('bluePoints');
    for (let i = 0; i < 3; i++) sb.handleKey('ArrowRight'); // White PEN
    sb.handleKey('ArrowUp');
    expect(value('whitePen')).toBe('1');
    expect(focused()).toBe('whitePoints');
  });

  it('shows the net change of a burst and fades it after two seconds', () => {
    sb.handleKey('ArrowUp');
    expect(sup('bluePoints').textContent).toBe('+1');
    expect(sup('bluePoints').classList.contains('show')).toBe(true);
    const firstSeq = sup('bluePoints').dataset.seq;
    vi.advanceTimersByTime(SCORE_BURST_MS - 100);
    sb.handleKey('ArrowUp');
    expect(sup('bluePoints').textContent).toBe('+2');
    expect(sup('bluePoints').dataset.seq).not.toBe(firstSeq); // the CSS fade restarts from this press
    expect(sup('bluePoints').classList.contains('show')).toBe(true);
    sb.handleKey('ArrowDown');
    expect(sup('bluePoints').textContent).toBe('+1');
    vi.advanceTimersByTime(SCORE_BURST_MS);
    expect(sup('bluePoints').textContent).toBe('');
    expect(sup('bluePoints').classList.contains('show')).toBe(false);
    sb.handleKey('ArrowDown'); // new burst after the fade, and the floor at 0 applies
    expect(sup('bluePoints').textContent).toBe('-1');
    sb.handleKey('ArrowDown');
    expect(sup('bluePoints').textContent).toBe('-1');
    expect(value('bluePoints')).toBe('0');
    sb.handleKey('ArrowRight'); sb.handleKey('ArrowUp'); // a different field starts its own burst
    expect(sup('whitePoints').textContent).toBe('+1');
    expect(sup('bluePoints').textContent).toBe('');
    sb.reset();
    expect(sup('whitePoints').textContent).toBe('');
    expect(value('whitePoints')).toBe('0');
    expect(focused()).toBe('bluePoints');
  });
});

describe('Tetris', () => {
  let root, game, lines;
  // Deterministic piece order: always the O piece (2x2), easy to stack
  const alwaysO = () => 0.2; // index 1 of 7 → 'O'
  beforeEach(() => {
    vi.useFakeTimers();
    loadDom();
    localStorage.clear();
    root = document.createElement('div');
    document.body.appendChild(root);
    lines = [];
    game = new TetrisGame(root, { onLines: (n) => lines.push(n), random: alwaysO, now: () => new Date('2026-10-23T12:00:00Z') });
    game.start();
  });
  afterEach(() => { game.stop(); vi.useRealTimers(); });

  // Fill every row but the top one so the next spawn ends the game
  const endGame = () => {
    game.board = game.board.map((row, r) => r >= 1 ? row.map((_, c) => (c === 0 ? '' : 'Z')) : row);
    game.cur.x = 4; game.handleKey('Enter');
    expect(game.over).toBe(true);
  };
  const rowText = (i) => Array.from(root.querySelectorAll('.tetris-hiscore-row')[i].children).map(el => el.textContent.replace(/\u00a0/g, ' '));
  const cursorIndex = () => Array.from(root.querySelectorAll('.tetris-hiscore-row.hs-entering .hs-ch')).findIndex(ch => ch.classList.contains('hs-cursor'));

  it('renders a 10x20 grid, moves, hard drops and locks pieces', () => {
    expect(root.querySelectorAll('.tetris-board .tc')).toHaveLength(TETRIS_COLS * TETRIS_ROWS);
    expect(root.querySelector('.tetris-dog').getAttribute('src')).toBe('paco.png');
    const filled = () => root.querySelectorAll('.tetris-board .tc-O').length;
    expect(filled()).toBe(4); // the falling piece is painted
    for (let i = 0; i < 6; i++) game.handleKey('ArrowLeft');
    expect(game.cur.x).toBe(0); // walls stop movement
    game.handleKey('Enter'); // hard drop
    expect(game.board[TETRIS_ROWS - 1][0]).toBe('O');
    expect(game.board[TETRIS_ROWS - 1][1]).toBe('O');
    expect(filled()).toBe(8); // locked piece + the new falling one
    expect(lines).toEqual([]);
  });

  it('gravity ticks on the interval and pausing stops it', () => {
    const y = game.cur.y;
    vi.advanceTimersByTime(game.interval);
    expect(game.cur.y).toBe(y + 1);
    game.handleKey('Play'); // pause
    expect(game.paused).toBe(true);
    expect(root.querySelector('.tetris-status').textContent).toBe('Paused');
    vi.advanceTimersByTime(game.interval * 3);
    expect(game.cur.y).toBe(y + 1);
    game.handleKey('Play');
    expect(game.paused).toBe(false);
    expect(root.querySelector('.tetris-status').textContent).toBe('');
  });

  it('clears full lines, scores them and makes Paco bark', () => {
    // Five O pieces across the bottom fill two rows at once
    for (let i = 0; i < 5; i++) {
      game.cur.x = i * 2;
      game.handleKey('Enter');
    }
    expect(lines).toEqual([2]);
    expect(game.lines).toBe(2);
    expect(game.score).toBe(300);
    expect(game.board[TETRIS_ROWS - 1].every(c => c === '')).toBe(true);
    expect(root.querySelector('.tetris-dog').classList.contains('barking')).toBe(true);
    expect(root.querySelector('.tetris-bubble').textContent).toBe('Woof!');
    vi.advanceTimersByTime(900);
    expect(root.querySelector('.tetris-dog').classList.contains('barking')).toBe(false);
    expect(root.querySelector('.tetris-bubble').textContent).toBe('');
    expect(root.querySelector('.tetris-lines').textContent).toBe('2');
  });

  it('a four-line clear gets the big bark', () => {
    game.board = game.board.map((row, r) => r >= TETRIS_ROWS - 4 ? row.map((_, c) => (c < 8 ? 'I' : '')) : row);
    game.cur = { type: 'I', shape: [[1], [1], [1], [1]], x: 8, y: 0 };
    game.handleKey('Enter');
    game.cur = { type: 'I', shape: [[1], [1], [1], [1]], x: 9, y: 0 };
    game.handleKey('Enter');
    expect(lines).toEqual([4]);
    expect(game.score).toBe(800);
    expect(root.querySelector('.tetris-bubble').textContent).toBe('WOOF WOOF!');
  });

  it('ends when a piece cannot spawn and OK restarts', () => {
    game.board = game.board.map((row, r) => r >= 1 ? row.map((_, c) => (c === 0 ? '' : 'Z')) : row);
    game.cur.x = 4; game.handleKey('Enter'); // locks right at the top → next spawn collides
    expect(game.over).toBe(true);
    expect(root.querySelector('.tetris-status').textContent).toContain('Game over');
    game.handleKey('ArrowLeft'); // ignored
    game.handleKey('Enter');
    expect(game.over).toBe(false);
    expect(game.lines).toBe(0);
    expect(game.board.every(row => row.every(c => c === ''))).toBe(true);
  });

  it('shows an empty five-row arcade leaderboard at the bottom right', () => {
    const table = root.querySelector('.tetris-bottom .tetris-hiscore');
    expect(table.querySelector('.tetris-hiscore-title').textContent).toBe('High scores');
    expect(table.querySelectorAll('.tetris-hiscore-row')).toHaveLength(TETRIS_SCORES_MAX);
    expect(rowText(0)).toEqual(['1ST', '---', '------']);
    expect(rowText(4)).toEqual(['5TH', '---', '------']);
    expect(root.querySelectorAll('.tetris-hiscore-row.hs-empty')).toHaveLength(5);
    expect(root.querySelector('.tetris-bottom .tetris-dog')).not.toBeNull();
  });

  it('a new record asks for initials: ▲▼ letter, ◀▶ position, OK confirms and persists', () => {
    game.score = 1200; game.lines = 7;
    endGame();
    expect(game.newRank).toBe(0);
    expect(game.entering).toBe(true);
    expect(rowText(0)).toEqual(['1ST', 'AAA', '001200']);
    expect(cursorIndex()).toBe(0);
    expect(root.querySelector('.tetris-status').textContent).toBe('New record! · ▲▼ letter · ◀▶ position · OK confirm');
    expect(localStorage.getItem(TETRIS_SCORES_KEY)).toBeNull(); // nothing saved until confirmed
    game.handleKey('ArrowUp'); game.handleKey('ArrowUp'); // A → C
    game.handleKey('ArrowRight');
    game.handleKey('ArrowDown'); // A → wraps to space
    game.handleKey('ArrowRight');
    game.handleKey('ArrowRight'); // stays on the last letter
    for (let i = 0; i < 10; i++) game.handleKey('ArrowUp'); // A → K
    expect(cursorIndex()).toBe(2);
    expect(rowText(0)).toEqual(['1ST', 'C K', '001200']);
    game.handleKey('ArrowLeft'); game.handleKey('ArrowLeft'); game.handleKey('ArrowLeft');
    expect(cursorIndex()).toBe(0);
    game.handleKey('ArrowDown'); // C → B
    game.handleKey('Play'); // ignored while entering
    expect(game.over).toBe(true);
    game.handleKey('Enter'); // confirm
    expect(game.entering).toBe(false);
    expect(cursorIndex()).toBe(-1);
    expect(rowText(0)).toEqual(['1ST', 'B K', '001200']);
    expect(root.querySelectorAll('.tetris-hiscore-row')[0].classList.contains('hs-new')).toBe(true);
    expect(root.querySelector('.tetris-status').textContent).toBe('New record! · OK: play again');
    expect(JSON.parse(localStorage.getItem(TETRIS_SCORES_KEY))).toEqual([{ name: 'B K', score: 1200, lines: 7, date: '2026-10-23' }]);
    game.handleKey('Enter'); // restart: table stays, highlight goes
    expect(game.over).toBe(false);
    expect(rowText(0)).toEqual(['1ST', 'B K', '001200']);
    expect(root.querySelector('.tetris-hiscore-row.hs-new')).toBeNull();
  });

  it('quitting mid-entry keeps the score with the letters typed so far', () => {
    game.score = 400; game.lines = 2;
    endGame();
    game.handleKey('ArrowUp'); // B
    game.stop(); // Menu quit closes the overlay
    expect(game.entering).toBe(false);
    expect(JSON.parse(localStorage.getItem(TETRIS_SCORES_KEY))[0].name).toBe('BAA');
  });

  it('a zero score is not filed and the status says game over', () => {
    endGame();
    expect(game.newRank).toBe(-1);
    expect(root.querySelector('.tetris-status').textContent).toContain('Game over');
    expect(localStorage.getItem(TETRIS_SCORES_KEY)).toBeNull();
  });

  it('loads stored scores best-first, keeps five and ignores junk', () => {
    localStorage.setItem(TETRIS_SCORES_KEY, JSON.stringify([
      { score: 300, lines: 2, date: '2026-01-01' }, { score: 900, lines: 5, date: '2026-01-02' }, { score: 0 }, null, 'x',
      { score: 500, lines: 3 }, { score: 700, lines: 4 }, { score: 100, lines: 1 }, { score: 800, lines: 4 }
    ]));
    expect(loadTetrisScores().map(e => e.score)).toEqual([900, 800, 700, 500, 300]);
    expect(loadTetrisScores().map(e => e.name)).toEqual(['   ', '   ', '   ', '   ', '   ']);
    expect(normalizeTetrisName('abcd')).toBe('ABC');
    expect(normalizeTetrisName('a-1')).toBe('A1 ');
    expect(TETRIS_NAME_CHARS).toContain(' ');
    const fresh = new TetrisGame(document.createElement('div'), { random: alwaysO });
    fresh.render();
    expect(fresh.highScores.map(e => e.score)).toEqual([900, 800, 700, 500, 300]);
    localStorage.setItem(TETRIS_SCORES_KEY, '{not json');
    expect(loadTetrisScores()).toEqual([]);
  });

  it('recordTetrisScore ranks new entries, keeps older ties ahead and drops the sixth', () => {
    const list = [600, 500, 400, 300, 200].map(score => ({ score, lines: 1, date: '' }));
    expect(recordTetrisScore(list, { score: 500, lines: 1, date: '' }).rank).toBe(2);
    const top = recordTetrisScore(list, { score: 700, lines: 1, date: '' });
    expect(top.rank).toBe(0);
    expect(top.scores.map(e => e.score)).toEqual([700, 600, 500, 400, 300]);
    expect(recordTetrisScore(list, { score: 150, lines: 1, date: '' }).rank).toBe(-1);
    expect(recordTetrisScore(list, { score: 200, lines: 1, date: '' }).rank).toBe(-1);
    expect(list).toHaveLength(5); // input untouched
  });
});

describe('Scoreboard from the remote', () => {
  let state, engine, renderer, overlay, audio, input;
  const competitionName = () => Object.keys(APP_SETTINGS.competitionPresets)[0];
  const overlayEl = () => document.getElementById('overlay');
  const selectedName = () => overlayEl().querySelector('.mg-name.mg-sel').textContent;
  const focused = () => document.querySelector('#scoreboard .sb-field.sb-focus').dataset.field;
  const value = (f) => document.querySelector(`#scoreboard .sb-field[data-field="${f}"] .sb-value`).textContent;
  const loadCompetition = () => input._applyMenuConfig({ roundDurationSec: 5, restDurationSec: 2, numRounds: 0, prepDurationSec: 0, presetName: competitionName() });
  const hold = (key) => { keydown(key); vi.advanceTimersByTime(HOLD_MS); keyup(key); };

  beforeEach(() => {
    vi.useFakeTimers();
    loadDom();
    localStorage.clear();
    APP_SETTINGS.scoreboard = false;
    state = createTimerState({ roundDurationSec: 5, restDurationSec: 2, numRounds: 0, prepDurationSec: 0 });
    renderer = new Renderer();
    audio = fakeAudio();
    overlay = new OverlayManager();
    engine = new TimerEngine(state, () => {}, () => {});
    input = new InputHandler(engine, overlay, renderer, audio, state);
    input._defaultConfigCallback = () => ({ roundDurationSec: 5, restDurationSec: 2, numRounds: 0, prepDurationSec: 0, presetName: null });
    input._resetCallback = () => { state._presetName = null; };
    document.body.classList.add('timer-idle');
  });
  afterEach(() => { input.destroy(); engine.stop(); APP_SETTINGS.scoreboard = false; vi.useRealTimers(); });

  it('the Competition Presets list leads with a persisted Scoreboard toggle', () => {
    press('Escape'); press('ArrowDown'); press('Enter'); // main menu → Competition
    expect(overlay._mode).toBe('competition');
    expect(selectedName()).toBe('Scoreboard');
    expect(overlayEl().textContent).toContain('OFF');
    press('Enter');
    expect(APP_SETTINGS.scoreboard).toBe(true);
    expect(localStorage.getItem('bjj-timer-scoreboard')).toBe('true');
    expect(overlay._mode).toBe('competition'); // stays open, note flips
    expect(selectedName()).toBe('Scoreboard');
    expect(overlayEl().textContent).toContain('ON');
    press('ArrowDown'); press('Enter'); // first preset
    expect(overlay.isOpen()).toBe(false);
    expect(state._presetName).toBe(competitionName());
    expect(document.body.classList.contains('scoreboard')).toBe(true);
    press('1'); // digit shortcut still picks a preset directly
  });

  it('panels only show for competition presets with the setting on, never in dual mode', () => {
    APP_SETTINGS.scoreboard = true;
    input._applyMenuConfig({ roundDurationSec: 20, restDurationSec: 10, numRounds: 8, prepDurationSec: 0, presetName: 'Tabata' });
    expect(document.body.classList.contains('scoreboard')).toBe(false);
    loadCompetition();
    expect(document.body.classList.contains('scoreboard')).toBe(true);
    input._activateDualMode(); // clears the preset
    expect(document.body.classList.contains('scoreboard')).toBe(false);
    input._deactivateDualMode();
    loadCompetition();
    expect(document.body.classList.contains('scoreboard')).toBe(true);
    overlay.toggleScoreboard(); // off from the main-menu row
    expect(document.body.classList.contains('scoreboard')).toBe(false);
  });

  it('while a round is live the ring keeps score instead of asking to stop first', () => {
    APP_SETTINGS.scoreboard = true;
    loadCompetition();
    press(' '); press(' '); // ready → running
    expect(state.phase).toBe(PHASES.ROUND);
    press('ArrowUp'); press('ArrowUp');
    expect(value('bluePoints')).toBe('2');
    expect(audio.playMuffle).toHaveBeenCalledTimes(2);
    press('ArrowRight'); press('ArrowUp');
    expect(value('whitePoints')).toBe('1');
    press('ArrowRight'); press('ArrowUp'); // White ADV, cursor goes home
    expect(value('whiteAdv')).toBe('1');
    expect(focused()).toBe('whitePoints');
    expect(input._timeSettingMode).toBe(false);
    expect(document.getElementById('status-bar').textContent).not.toContain('Stop');
    press(' '); // pause: scoring still works
    press('ArrowDown');
    expect(value('whitePoints')).toBe('0');
    // Running menu offers Reset score
    press('Escape');
    press('ArrowDown'); press('ArrowDown');
    expect(selectedName()).toBe('Reset score');
    press('Enter');
    expect(overlay.isOpen()).toBe(false);
    expect(value('bluePoints')).toBe('0');
    expect(value('whiteAdv')).toBe('0');
  });

  it('every match starts 0-0 and stopping clears the panels', () => {
    APP_SETTINGS.scoreboard = true;
    loadCompetition();
    press(' '); press(' ');
    press('ArrowUp'); press('ArrowUp'); press('ArrowUp');
    expect(value('bluePoints')).toBe('3');
    hold(' '); // stop → ready
    expect(state.phase).toBe(PHASES.IDLE);
    expect(value('bluePoints')).toBe('0');
    press(' '); // start again from ready
    expect(state.phase).toBe(PHASES.ROUND);
    press('ArrowUp');
    expect(value('bluePoints')).toBe('1');
    hold(' ');
    press(' ');
    expect(value('bluePoints')).toBe('0');
  });

  it('a match started from time-setting mode also begins 0-0', () => {
    APP_SETTINGS.scoreboard = true;
    loadCompetition();
    press(' '); press(' ');
    press('ArrowUp'); press('ArrowUp');
    expect(value('bluePoints')).toBe('2');
    engine.stop(); // a finite preset ending on its own: no stop gesture, no reset
    expect(state.phase).toBe(PHASES.IDLE);
    expect(value('bluePoints')).toBe('2');
    press('ArrowUp'); // idle ring: time-setting mode
    expect(input._timeSettingMode).toBe(true);
    press(' '); // Play from the editor starts the next match
    expect(state.phase).toBe(PHASES.ROUND);
    expect(value('bluePoints')).toBe('0');
  });

  it('cancelling a time edit brings the panels back with the restored preset', () => {
    APP_SETTINGS.scoreboard = true;
    loadCompetition();
    press(' '); // ready
    press('ArrowUp'); // enter time setting
    press('ArrowUp'); // an edit drops the preset, so the panels go away
    expect(state._presetName).toBeNull();
    expect(document.body.classList.contains('scoreboard')).toBe(false);
    press('Escape'); // cancel restores the preset
    expect(state._presetName).toBe(competitionName());
    expect(document.body.classList.contains('scoreboard')).toBe(true);
  });

  it('with the scoreboard off the ring still shows the stop-first notice', () => {
    loadCompetition();
    press(' '); press(' ');
    press('ArrowUp');
    expect(document.getElementById('status-bar').textContent).toContain(t('notice.stopFirst'));
    expect(value('bluePoints')).toBe('0');
  });

  it('the scoreboard is part of the display snapshot', () => {
    APP_SETTINGS.scoreboard = true;
    loadCompetition();
    press(' '); press(' '); press('ArrowUp');
    const snap = buildSyncSnapshot(document, () => ({}), 's1');
    expect(snap.bodyClass).toContain('scoreboard');
    expect(snap.sections.scoreboard).toContain('sb-focus');
    expect(snap.sections.scoreboard).toContain('>1<');
  });
});

describe('Tetris from the main menu', () => {
  let state, engine, renderer, overlay, audio, input;
  beforeEach(() => {
    vi.useFakeTimers();
    loadDom();
    state = createTimerState({ roundDurationSec: 5, restDurationSec: 2, numRounds: 0, prepDurationSec: 0 });
    renderer = new Renderer();
    audio = fakeAudio();
    overlay = new OverlayManager();
    engine = new TimerEngine(state, () => {}, () => {});
    input = new InputHandler(engine, overlay, renderer, audio, state);
    input._defaultConfigCallback = () => ({ roundDurationSec: 5, restDurationSec: 2, numRounds: 0, prepDurationSec: 0, presetName: null });
    document.body.classList.add('timer-idle');
  });
  afterEach(() => { input.destroy(); engine.stop(); vi.useRealTimers(); });

  it('Tetris is the last row; Menu quits back to the menu and the bark plays through the audio manager', () => {
    press('Escape');
    for (let i = 0; i < 12; i++) press('ArrowDown');
    expect(document.querySelector('#overlay .mg-name.mg-sel').textContent).toBe('Tetris');
    press('Enter');
    expect(overlay._mode).toBe('tetris');
    expect(document.querySelectorAll('#overlay .tetris-board .tc')).toHaveLength(200);
    const game = overlay._tetris;
    press('ArrowRight');
    expect(game.cur.x).toBeGreaterThan(0);
    game.board = game.board.map((row, r) => r === TETRIS_ROWS - 1 ? row.map((_, c) => (c < 6 ? 'T' : '')) : row);
    game.cur = { type: 'I', shape: [[1, 1, 1, 1]], x: 6, y: 0 };
    press('Enter'); // hard drop completes the bottom row
    expect(audio.playBark).toHaveBeenCalledWith(1);
    press('Escape'); // Menu quits
    expect(overlay._mode).toBe('main');
    expect(overlay._tetris).toBeNull();
    vi.advanceTimersByTime(5000); // no timer left running
    press('Escape');
    expect(overlay.isOpen()).toBe(false);
  });
});
