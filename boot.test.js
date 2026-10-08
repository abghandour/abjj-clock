/**
 * Boots the real app (index.html markup + app.js DOMContentLoaded wiring)
 * inside jsdom with the network stubbed, then drives it through a session
 * from the keyboard. This covers the init path the class-level tests skip:
 * config.json defaults on first boot, schedule wiring, and dual-screen
 * broadcasting.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const INDEX_HTML = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
const BODY_HTML = INDEX_HTML
  .slice(INDEX_HTML.indexOf('<body>') + '<body>'.length, INDEX_HTML.indexOf('</body>'))
  .replace(/<script[^>]*><\/script>/g, '');
const CONFIG = JSON.parse(readFileSync(join(process.cwd(), 'config.json'), 'utf8'));

function press(key, code) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, code: code || key, cancelable: true }));
  document.dispatchEvent(new KeyboardEvent('keyup', { key, code: code || key, cancelable: true }));
}

// Flip the weekly-schedule toggle through the main menu (Menu → "Weekly
// schedule" row → OK → Menu closes). Asserts the toggle landed where asked.
function setSchedule(enabled) {
  if (app.APP_SETTINGS.scheduleEnabled === enabled) return;
  const { state, inputHandler } = window.__bjjApp;
  if (state.phase !== app.PHASES.IDLE) {
    // The running-timer menu has no settings rows; flip the setting directly
    inputHandler.overlayManager.toggleSchedule();
    return;
  }
  press('Escape');
  const selected = () => document.querySelector('#overlay .mg-name.mg-sel')?.textContent;
  for (let i = 0; i < 12 && selected() !== 'Weekly schedule'; i++) press('ArrowDown');
  if (selected() !== 'Weekly schedule') throw new Error('Weekly schedule row not found in the main menu');
  press('Enter');
  press('Escape');
  if (app.APP_SETTINGS.scheduleEnabled !== enabled) throw new Error('schedule toggle did not apply');
}

// app.js registers its DOMContentLoaded handler once at require time; each
// test re-fires that event against a fresh body and tears the instance down.
const app = require('./app.js');
let fetchMock, esInstances;

function stubEnvironment(search) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 8, 10, 0, 0)); // Tuesday 10:00, no class active
  localStorage.clear();
  app.APP_SETTINGS.scheduleEnabled = true;
  app.APP_SETTINGS.holidayThemeEnabled = false;
  window.history.replaceState({}, '', `/index.html${search}`);
  document.documentElement.className = '';
  document.body.className = '';
  document.body.innerHTML = BODY_HTML;

  fetchMock = vi.fn(async (url) => {
    if (url === 'config.json') return { ok: true, json: async () => CONFIG };
    if (url === 'schedule.json') return { ok: false, status: 404, json: async () => { throw new Error('404'); } };
    if (String(url).startsWith('https://api.open-meteo.com')) {
      return { ok: true, json: async () => ({ current: { temperature_2m: 71.6 } }) };
    }
    return { ok: true, json: async () => ({ success: true }) };
  });
  global.fetch = fetchMock;
  esInstances = [];
  global.EventSource = class { constructor(url) { this.url = url; this.onmessage = null; esInstances.push(this); } };
  window.AudioContext = class {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    createOscillator() { return { frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    createBiquadFilter() { return { frequency: { value: 0 }, Q: { value: 0 }, connect() {} }; }
  };
  window.Audio = class {
    constructor(src) { this.src = src; this.volume = 1; }
    cloneNode() { return new window.Audio(this.src); }
    play() { return Promise.resolve(); }
    pause() {}
  };
  HTMLCanvasElement.prototype.getContext = () => ({
    clearRect() {}, drawImage() {}, beginPath() {}, moveTo() {}, arc() {}, closePath() {}, fill() {},
    save() {}, restore() {}, translate() {}, rotate() {}, fillText() {}, fillRect() {}
  });
}

/** Boot the app against the current document and let async init settle. */
async function bootApp() {
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await vi.advanceTimersByTimeAsync(10); // let loadConfig + initSchedule settle
  return app;
}

describe('app boot', () => {
  afterEach(() => {
    if (window.__bjjApp) window.__bjjApp.teardown();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('seeds the timer from config.json defaults on a fresh profile and runs a session', async () => {
    stubEnvironment('');
    await bootApp();

    // First boot: config.json's 6-minute default, not the built-in 5 minutes
    const roundTimer = document.getElementById('round-timer');
    expect(roundTimer.textContent).toBe('06:00');
    expect(document.getElementById('rest-timer').textContent).toBe('01:00');
    expect(document.getElementById('preset-label').textContent).toBe('Custom');
    expect(document.body.classList.contains('timer-idle')).toBe(true);
    expect(document.getElementById('clock').textContent).toBe('10:0000 AM');

    // Schedule loaded: next class is shown and the weather was polled
    expect(document.getElementById('schedule-display').textContent).toContain('Next:');
    expect(fetchMock.mock.calls.some(c => String(c[0]).startsWith('https://api.open-meteo.com'))).toBe(true);
    expect(document.getElementById('temperature').textContent).toBe('72°F');

    // Enter → ready, Enter → running, ticking on the wall clock
    press('Enter');
    press('Enter');
    await vi.advanceTimersByTimeAsync(3000);
    expect(roundTimer.textContent).toBe('05:57');
    expect(document.getElementById('round-counter').textContent).toBe('Round 1');

    // Pause freezes the digits; resume continues; 0 stops
    press('Enter');
    await vi.advanceTimersByTimeAsync(2000);
    expect(roundTimer.textContent).toBe('05:57');
    press('Enter');
    await vi.advanceTimersByTimeAsync(1000);
    expect(roundTimer.textContent).toBe('05:56');
    press('0');
    expect(roundTimer.textContent).toBe('06:00');

    // Wall clock keeps running independently of the timer
    expect(document.getElementById('clock').textContent).toBe('10:0006 AM');
  });

  it('keeps a persisted config over config.json defaults', async () => {
    stubEnvironment('');
    localStorage.setItem('bjj-timer-config', JSON.stringify({ roundDurationSec: 90, restDurationSec: 15, numRounds: 3, prepDurationSec: 0 }));
    await bootApp();
    expect(document.getElementById('round-timer').textContent).toBe('01:30');
    expect(document.getElementById('round-counter').textContent).toBe('3 rounds');
  });

  it('applies the active class preset when a class is in progress', async () => {
    stubEnvironment('');
    vi.setSystemTime(new Date(2026, 8, 8, 12, 15, 0)); // Tuesday noon class (adult_basics)
    await bootApp();
    expect(document.getElementById('preset-label').textContent).toContain('Adult Noon Class');
    expect(document.getElementById('round-timer').textContent).toBe('05:00');
    expect(document.getElementById('schedule-display').textContent).toContain('45m remaining');
    // Round list overtime calculation gets its class time from the schedule, not the DOM text
    press('*');
    press('1'); // Ladder Up
    expect(document.getElementById('overlay').textContent).toContain('Total minutes:');
    expect(document.getElementById('overlay').querySelector('.overlay-input').textContent).toBe('45'); // default shown dimmed
    press('*');
  });

  it('keeps the schedule hidden across the 30-minute config reload when disabled', async () => {
    stubEnvironment('');
    vi.setSystemTime(new Date(2026, 8, 8, 12, 15, 0));
    await bootApp();
    setSchedule(false);
    expect(document.getElementById('schedule-display').textContent).toBe(''); // off → nothing, not "No classes scheduled"
    await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
    expect(document.getElementById('schedule-display').textContent).toBe('');
    expect(document.getElementById('next-class-display').textContent).toBe('');
  });

  it('broadcasts snapshots and handles relayed keys in dual-screen mode', async () => {
    stubEnvironment('?dual=1');
    await bootApp();
    expect(document.documentElement.classList.contains('screen1')).toBe(true);
    expect(document.documentElement.classList.contains('mode-mirror')).toBe(true);
    // Screens lives in the main menu (Menu button) in dual-screen mode
    press('Escape');
    expect(document.getElementById('overlay').textContent).toContain('Screens');
    press('Escape');
    expect(document.getElementById('overlay').classList.contains('active')).toBe(false);

    const syncPosts = () => fetchMock.mock.calls.filter(c => String(c[0]).endsWith('/sync'));
    expect(syncPosts().length).toBeGreaterThanOrEqual(1);
    // The latest snapshot reflects the config.json default that arrived after
    // boot, once the mutation debounce window has passed
    await vi.advanceTimersByTimeAsync(100);
    const latest = JSON.parse(syncPosts()[syncPosts().length - 1][1].body);
    expect(latest.meta.displayMode).toBe('mirror');
    expect(latest.sections['round-timer']).toContain('06');
    expect(latest.attrs['timer-area']).toBeDefined();

    // A tick on the primary produces exactly one coalesced broadcast
    press('Enter');
    press('Enter');
    await vi.advanceTimersByTimeAsync(100); // flush the broadcast for the key presses
    const before = syncPosts().length;
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(100);
    const after = syncPosts().length;
    expect(after - before).toBe(1);
    expect(JSON.parse(syncPosts()[after - 1][1].body).sections['round-timer']).toContain('59');

    // Key 7 relayed from the secondary cycles the display mode
    const keyStream = esInstances.find(es => es.url.endsWith('/key-events'));
    keyStream.onmessage({ data: JSON.stringify({ type: 'keydown', key: '7', code: 'Numpad7' }) });
    expect(document.documentElement.classList.contains('mode-clocktimer')).toBe(true);
    expect(localStorage.getItem('bjj-timer-display-mode')).toBe('clocktimer');

    // Teardown stops broadcasting entirely
    window.__bjjApp.teardown();
    const settled = syncPosts().length;
    document.getElementById('round-counter').textContent = 'changed';
    await vi.advanceTimersByTimeAsync(11000);
    expect(syncPosts().length).toBe(settled);
  });

  it('boots the secondary display and mirrors the primary snapshot', async () => {
    stubEnvironment('?screen=2');
    await bootApp();
    expect(document.documentElement.classList.contains('screen2')).toBe(true);
    const stream = esInstances.find(es => es.url.endsWith('/sync-events'));
    const roundTimer = document.getElementById('round-timer');
    stream.onmessage({ data: JSON.stringify({
      sessionId: 's1', sentAt: Date.now(),
      bodyClass: 'time-setting',
      sections: { 'round-timer': '<div id="round-timer" class="timer-active"><span class="ts-minutes">03</span>:<span class="ts-seconds">21</span></div>' },
      attrs: { 'dual-timer-container': { class: 'dual-mode', style: '' } },
      meta: { displayMode: 'split', stealth: false, phase: 'ROUND' }
    }) });
    expect(document.getElementById('round-timer')).toBe(roundTimer);
    expect(roundTimer.textContent).toBe('03:21');
    expect(roundTimer.classList.contains('timer-active')).toBe(true);
    expect(document.getElementById('dual-timer-container').classList.contains('dual-mode')).toBe(true);
    expect(document.documentElement.classList.contains('mode-split')).toBe(true);
    expect(document.body.className).toBe('time-setting');
  });
  it('boots dual displays when storage reads are blocked', async () => {
    stubEnvironment('?dual=1');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage blocked'); });
    await bootApp();
    expect(window.__bjjApp.state.config.roundDurationSec).toBe(CONFIG.defaults.roundDurationSec);
    expect(document.documentElement.classList.contains('mode-mirror')).toBe(true);
  });

  it('loads defaults before constructing either timer in saved Split mode', async () => {
    stubEnvironment('?dual=1');
    app.DEFAULT_CONFIG.roundDurationSec = 300;
    localStorage.setItem('bjj-timer-display-mode', 'split');
    await bootApp();
    const { state, inputHandler } = window.__bjjApp;
    expect(state.config.roundDurationSec).toBe(360);
    expect(inputHandler._dualState.config.roundDurationSec).toBe(360);
    expect(document.getElementById('round-timer').textContent).toBe('06:00');
    expect(document.getElementById('round-timer-2').textContent).toBe('06:00');
  });

  it('refuses Split activation during a running or paused training session', async () => {
    stubEnvironment('?dual=1');
    await bootApp();
    const { state, engine, inputHandler } = window.__bjjApp;
    state.roundDurations = [30, 60]; state.restDurations = [5, 10];
    engine.start();
    press('7'); // mirror -> clocktimer
    press('7'); // split requires idle
    expect(document.documentElement.classList.contains('mode-clocktimer')).toBe(true);
    expect(inputHandler._dualMode).toBe(false);
    expect(state.roundDurations).toEqual([30, 60]);
    expect(state.restDurations).toEqual([5, 10]);
    expect(state.remainingSec).toBe(30);
    engine.pause();
    press('7');
    expect(inputHandler._dualMode).toBe(false);
    engine.stop();
    press('7');
    expect(inputHandler._dualMode).toBe(true);
  });

  it.each([false, true])('replaces training arrays and metadata when applying a class preset (deferred=%s)', async deferred => {
    stubEnvironment('');
    await bootApp();
    const { state, engine, scheduleManager } = window.__bjjApp;
    state.roundDurations = [30, 60]; state.restDurations = [5, 10]; state._presetName = 'Chainsaw';
    if (deferred) engine.start();
    vi.setSystemTime(new Date(2026, 8, 8, 12, 15));
    scheduleManager._checkActiveClass();
    if (deferred) {
      expect(state._presetName).toBe('Chainsaw');
      engine.stop();
    }
    expect(state.roundDurations).toBeNull();
    expect(state.restDurations).toBeNull();
    expect(state._presetName).toBe('Adult Noon Class');
    expect(document.getElementById('preset-label').textContent).toContain('Adult Noon Class');
    engine.start();
    expect(state.remainingSec).toBe(300);
  });

  it.each([false, true])('reconciles the current class on schedule re-enable (running=%s)', async running => {
    stubEnvironment('');
    vi.setSystemTime(new Date(2026, 8, 8, 12, 15));
    const ring = vi.spyOn(app.AudioManager.prototype, 'playStartOfClassRing').mockImplementation(() => {});
    const originalFetch = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (url, options) => url === 'config.json'
      ? { ok: true, json: async () => ({ ...CONFIG, audio: { ...CONFIG.audio, classStartSound: true } }) }
      : originalFetch(url, options));
    await bootApp();
    expect(ring).toHaveBeenCalledTimes(1);
    const { state, engine, scheduleManager } = window.__bjjApp;
    setSchedule(false);
    state.config.roundDurationSec = 42;
    state._presetName = 'Custom';
    if (running) engine.start();
    setSchedule(true);
    if (running) {
      expect(state.config.roundDurationSec).toBe(42);
      engine.stop();
    }
    expect(state.config.roundDurationSec).toBe(300);
    expect(state._presetName).toBe('Adult Noon Class');
    expect(ring).toHaveBeenCalledTimes(1);
    // A different occurrence still rings, even when it began while disabled.
    setSchedule(false);
    vi.setSystemTime(new Date(2026, 8, 15, 12, 15));
    scheduleManager._checkActiveClass();
    setSchedule(true);
    expect(ring).toHaveBeenCalledTimes(2);
    app.APP_SETTINGS.audio.classStartSound = CONFIG.audio.classStartSound;
  });

  it('emits the latest transition and current countdown after a stall, for both timer engines', async () => {
    stubEnvironment('?dual=1');
    localStorage.setItem('bjj-timer-display-mode', 'split');
    const cueNames = ['playCountdownBeep', 'playEndOfRoundBeep', 'playEndOfRestBeep', 'playRoundStartFanfare', 'playCountdownBeepT2', 'playEndOfRoundBeepT2', 'playEndOfRestBeepT2'];
    const spies = Object.fromEntries(cueNames.map(name => [name, vi.spyOn(app.AudioManager.prototype, name).mockImplementation(() => {})]));
    await bootApp();
    const { state, engine, inputHandler } = window.__bjjApp;
    for (const timer of [state, inputHandler._dualState]) Object.assign(timer.config, { roundDurationSec: 5, restDurationSec: 2, numRounds: 0 });
    engine.start(); inputHandler._dualEngine.start();
    for (const spy of Object.values(spies)) spy.mockClear();
    for (const timer of [engine, inputHandler._dualEngine]) {
      timer._nextTickAt = performance.now() - 8000; // nine ticks: round 2 has 3 seconds left
      timer._drive();
    }
    expect(state.remainingSec).toBe(3);
    expect(inputHandler._dualState.remainingSec).toBe(3);
    expect(spies.playCountdownBeep).toHaveBeenCalledTimes(1);
    expect(spies.playCountdownBeepT2).toHaveBeenCalledTimes(1);
    expect(spies.playEndOfRoundBeep).not.toHaveBeenCalled();
    expect(spies.playEndOfRoundBeepT2).not.toHaveBeenCalled();
    expect(spies.playEndOfRestBeep).toHaveBeenCalledTimes(1);
    expect(spies.playEndOfRestBeepT2).toHaveBeenCalledTimes(1);
    expect(spies.playRoundStartFanfare).toHaveBeenCalledTimes(2);
  });

  it.each([
    [app.PHASES.ROUND, 0, 'playEndOfRoundBeep', app.PHASES.REST],
    [app.PHASES.REST, 0, 'playEndOfRestBeep', app.PHASES.ROUND],
    [app.PHASES.ROUND, 1, 'playEndOfRoundBeep', app.PHASES.IDLE],
    [app.PHASES.PREP, 0, null, app.PHASES.ROUND],
  ])('plays the latest %s transition sound and flash once after a short stall (rounds=%s)', async (phase, rounds, cue, nextPhase) => {
    stubEnvironment('');
    const names = ['playCountdownBeep', 'playEndOfRoundBeep', 'playEndOfRestBeep', 'playRoundStartFanfare', 'playPrepBeep'];
    const spies = Object.fromEntries(names.map(name => [name, vi.spyOn(app.AudioManager.prototype, name).mockImplementation(() => {})]));
    const flash = vi.spyOn(app.Renderer.prototype, 'applyScreenFlash');
    await bootApp();
    const { state, engine } = window.__bjjApp;
    Object.assign(state.config, { roundDurationSec: 10, restDurationSec: 10, numRounds: rounds });
    engine.start();
    Object.assign(state, { phase, remainingSec: 1 });
    for (const spy of Object.values(spies)) spy.mockClear();
    engine._nextTickAt = performance.now() - 1100;
    engine._drive();
    expect(state.phase).toBe(nextPhase);
    if (nextPhase !== app.PHASES.IDLE) engine._drive();
    expect(spies.playEndOfRoundBeep).toHaveBeenCalledTimes(cue === 'playEndOfRoundBeep' ? 1 : 0);
    expect(spies.playEndOfRestBeep).toHaveBeenCalledTimes(cue === 'playEndOfRestBeep' ? 1 : 0);
    expect(spies.playRoundStartFanfare).toHaveBeenCalledTimes(nextPhase === app.PHASES.ROUND ? 1 : 0);
    expect(flash).toHaveBeenCalledTimes(cue ? 1 : 0);
    expect(spies.playCountdownBeep).not.toHaveBeenCalled();
    expect(spies.playPrepBeep).not.toHaveBeenCalled();
  });

  it('keeps running controls and falls back from saved Split when Open Mat starts before display initialization', async () => {
    stubEnvironment('?dual=1&debug=true');
    vi.spyOn(window, 'prompt').mockReturnValueOnce('Open Mat').mockReturnValueOnce('15');
    localStorage.setItem('bjj-timer-display-mode', 'split');
    await bootApp();
    const { state, inputHandler } = window.__bjjApp;
    expect(state.phase).toBe(app.PHASES.ROUND);
    expect(document.documentElement.classList.contains('mode-mirror')).toBe(true);
    expect(inputHandler._dualMode).toBe(false);
    const post = fetchMock.mock.calls.find(call => call[0].endsWith('/sync'));
    expect(JSON.parse(post[1].body).meta.displayMode).toBe('mirror');
  });

  it('interprets relayed Enter duration without a network-created long press', async () => {
    stubEnvironment('?dual=1');
    await bootApp();
    const { inputHandler } = window.__bjjApp;
    const short = vi.spyOn(inputHandler, '_handleEnterShortPress');
    const long = vi.spyOn(inputHandler, '_handleEnterLongPress');
    const stream = esInstances.find(es => es.url.endsWith('/key-events'));
    stream.onmessage({ data: JSON.stringify({ type: 'press', key: 'Enter', code: 'NumpadEnter', heldMs: 50 }) });
    await vi.advanceTimersByTimeAsync(2000);
    expect(short).toHaveBeenCalledTimes(1);
    expect(long).not.toHaveBeenCalled();
    stream.onmessage({ data: JSON.stringify({ type: 'press', key: 'Enter', code: 'NumpadEnter', heldMs: 900 }) });
    expect(long).toHaveBeenCalledTimes(1);
  });

  it('clears training arrays before the automatic Open Mat start', async () => {
    stubEnvironment('');
    await bootApp();
    const { state, scheduleManager } = window.__bjjApp;
    state.roundDurations = [30, 60]; state.restDurations = [5, 10]; state._presetName = 'Chainsaw';
    const now = new Date();
    const dayOfWeek = app.VALID_DAYS[now.getDay() === 0 ? 6 : now.getDay() - 1];
    scheduleManager._schedule = [{ dayOfWeek, startTime: '09:00', endTime: '11:00', title: 'Open Mat', classType: 'open_mat' }];
    scheduleManager._checkActiveClass();
    expect(state.phase).toBe(app.PHASES.ROUND);
    expect(state.roundDurations).toBeNull();
    expect(state.restDurations).toBeNull();
    expect(state.remainingSec).toBe(app.APP_SETTINGS.competitionPresets['Blue Belt'].roundDurationSec);
    expect(state._presetName).toBe('Open Mat');
  });

  it('uses the configured shared key for primary snapshots', async () => {
    stubEnvironment('?dual=1');
    const previousKey = app.APP_SETTINGS.relay.sharedKey;
    const original = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (url, options) => url === 'config.json'
      ? { ok: true, json: async () => ({ ...CONFIG, relay: { sharedKey: 'configured-test-key' } }) }
      : original(url, options));
    try {
      await bootApp();
      const post = fetchMock.mock.calls.find(call => call[0].endsWith('/sync'));
      expect(post[1].headers['X-Update-Request']).toBe('configured-test-key');
    } finally { app.APP_SETTINGS.relay.sharedKey = previousKey; }
  });

});
