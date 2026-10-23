
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
 * True for a non-negative integer number of seconds. Rejects NaN, Infinity,
 * negatives and fractions so corrupted storage can never produce a timer that
 * fails to count down.
 * @param {*} value
 * @returns {boolean}
 */
function isValidSeconds(value) {
  return Number.isInteger(value) && value >= 0 && value <= 5999;
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
 * Escapes HTML special characters so untrusted text (schedule titles,
 * server output, config values) can be safely interpolated into innerHTML.
 * @param {*} value - Value to escape (coerced to string)
 * @returns {string} HTML-safe string
 */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
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

// Storage can throw even when reading (e.g. disabled browser storage).
function readStorage(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

// App-wide configurable settings (overridden by config.json at runtime)
const APP_SETTINGS = {
  scheduleEnabled: readStorage('bjj-timer-schedule-enabled') !== 'false',
  holidayThemeEnabled: readStorage('bjj-timer-holiday-theme') === 'true',
  // UI language: 'en' (default) or 'pt'. Preset names and class titles stay as
  // stored; everything the app itself says goes through t().
  language: readStorage('bjj-timer-language') === 'pt' ? 'pt' : 'en',
  // Quiet visuals: edge flash instead of a full-screen white flash, steady
  // outlines instead of blinking digits, no countdown dimming.
  quietVisuals: readStorage('bjj-timer-quiet-visuals') === 'true',
  // Match scoreboard (points / advantages / penalties) shown with competition presets
  scoreboard: readStorage('bjj-timer-scoreboard') === 'true',
  relay: { sharedKey: '1' },
  alertThresholdSec: 5,
  audio: {
    countdownBeepFrequency: 800,
    countdownBeepDuration: 0.3,
    prepBeepBaseFrequency: 500,
    prepBeepFrequencyStep: 100,
    prepBeepDuration: 0.15,
    endOfRestFrequency: 600,
    endOfRestDuration: 0.5,
    volume: 1.0,
    classStartSound: false,
    classEndSound: false
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

  if (typeof data.relay?.sharedKey === 'string' && data.relay.sharedKey) APP_SETTINGS.relay.sharedKey = data.relay.sharedKey;

  // Override default timer config
  if (data.defaults && typeof data.defaults === 'object') {
    const d = data.defaults;
    if (isValidSeconds(d.roundDurationSec)) DEFAULT_CONFIG.roundDurationSec = d.roundDurationSec;
    if (isValidSeconds(d.restDurationSec)) DEFAULT_CONFIG.restDurationSec = d.restDurationSec;
    if (isValidSeconds(d.numRounds)) DEFAULT_CONFIG.numRounds = d.numRounds;
    if (isValidSeconds(d.prepDurationSec)) DEFAULT_CONFIG.prepDurationSec = d.prepDurationSec;
    if (isValidSeconds(d.alertThresholdSec)) APP_SETTINGS.alertThresholdSec = d.alertThresholdSec;
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
    if (typeof a.endOfRestFrequency === 'number') s.endOfRestFrequency = a.endOfRestFrequency;
    if (typeof a.endOfRestDuration === 'number') s.endOfRestDuration = a.endOfRestDuration;
    if (typeof a.volume === 'number') s.volume = a.volume;
    if (typeof a.classStartSound === 'boolean') s.classStartSound = a.classStartSound;
    if (typeof a.classEndSound === 'boolean') s.classEndSound = a.classEndSound;
  }

  // Override competition presets
  if (data.competitionPresets && typeof data.competitionPresets === 'object') {
    APP_SETTINGS.competitionPresets = {};
    for (const [name, preset] of Object.entries(data.competitionPresets)) {
      if (preset && typeof preset === 'object') {
        APP_SETTINGS.competitionPresets[name] = {
          roundDurationSec: isValidSeconds(preset.roundDurationSec) ? preset.roundDurationSec : 300,
          restDurationSec: isValidSeconds(preset.restDurationSec) ? preset.restDurationSec : 60,
          numRounds: isValidSeconds(preset.numRounds) ? preset.numRounds : 0
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

// --- Translations ---

const LANGUAGES = ['en', 'pt'];
const LANGUAGE_NAMES = { en: 'English', pt: 'Português' };

/** Every string the app shows, by key. English is the fallback for any gap. */
const STRINGS = {
  en: {
    'menu.title': 'Menu', 'menu.training': 'Training', 'menu.competition': 'Competition',
    'menu.schedule': 'View schedule', 'menu.screens': 'Screens', 'menu.hide': 'Hide display',
    'menu.hide.note': 'rest timer stays', 'menu.holiday': 'Holiday theme', 'menu.quiet': 'Quiet visuals',
    'menu.followSchedule': 'Follow class schedule', 'menu.language': 'Language',
    'menu.maintenance': 'Maintenance', 'menu.about': 'About', 'menu.on': 'ON', 'menu.off': 'OFF',
    'menu.pause': 'Pause', 'menu.resume': 'Resume', 'menu.stopKeep': 'Stop and keep settings',
    'menu.restore': 'Restore defaults',
    'confirm.restore.title': 'Restore defaults?', 'confirm.restore.body': 'Stops the timer and clears the current settings.',
    'confirm.restore.yes': 'Yes, restore defaults', 'confirm.no': 'No, go back',
    'training.title': 'Training Presets', 'competition.title': 'Competition Presets',
    'label.round': 'Round', 'label.rest': 'Rest', 'label.timer1': 'Timer 1', 'label.timer2': 'Timer 2',
    'label.classTimeLeft': 'Class time left', 'label.custom': 'Custom', 'label.repeat': 'Repeat',
    'label.rounds': '{n} rounds', 'label.round1': '1 round', 'label.roundN': 'Round {c}', 'label.roundOf': 'Round {c} / {t}',
    'label.outside': 'Outside {t}',
    'preset.Chainsaw': 'Chainsaw', 'preset.Ladder Up': 'Ladder Up', 'preset.Ladder Down': 'Ladder Down',
    'preset.Pyramid': 'Pyramid', 'preset.Inv. Pyramid': 'Inv. Pyramid', 'preset.Tabata': 'Tabata', 'preset.Dual Timer': 'Dual Timer',
    'preset.Kids (under 15)': 'Kids (under 15)', 'preset.White Belt': 'White Belt', 'preset.Blue Belt': 'Blue Belt',
    'preset.Purple Belt': 'Purple Belt', 'preset.Brown Belt': 'Brown Belt', 'preset.Black Belt': 'Black Belt',
    'note.Chainsaw': 'Alternating round/rest', 'note.Ladder Up': 'Short → long', 'note.Ladder Down': 'Long → short',
    'note.Pyramid': 'Short → long → short', 'note.Inv. Pyramid': 'Long → short → long',
    'note.Tabata': '20s on / 10s off × 8', 'note.Dual Timer': 'Two independent timers',
    'wizard.step': 'Step {n} of {m}', 'wizard.back': 'Menu: back', 'wizard.prev': 'Menu: previous step',
    'wizard.nav': '▲▼ change · OK next', 'wizard.suggested': 'suggested · OK accepts',
    'wizard.minutes': 'minutes', 'wizard.seconds': 'seconds',
    'wizard.totalMinutes': 'Total minutes:', 'wizard.howManyRounds': 'How many rounds?', 'wizard.restBetween': 'Rest between rounds:',
    'wizard.enterNumber': 'Please enter a number', 'wizard.min1minute': 'Need at least 1 minute', 'wizard.min2rounds': 'Need at least 2 rounds',
    'wizard.restTooLong': 'Rest too long, no time left for rounds',
    'chainsaw.oddRound': 'Odd round duration:', 'chainsaw.oddRest': 'Odd round rest:', 'chainsaw.evenRound': 'Even round duration:',
    'chainsaw.evenRest': 'Even round rest:', 'chainsaw.rounds': 'How many rounds:', 'chainsaw.needDuration': 'Round needs a duration',
    'chainsaw.enterNumber': 'Enter a number', 'chainsaw.min1round': 'Need at least 1 round',
    'state.ready': 'Ready', 'state.paused': '❚❚ Paused', 'state.finished': 'Finished', 'state.editing': 'Editing', 'state.editingField': 'Editing {field}',
    'hint.ready': '▶ start · ring edits · hold ▶ clock', 'hint.paused': '▶ resume · Menu options', 'hint.finished': '▶ start again · Menu options · hold ▶ clock',
    'hint.edit': '◀▶ field · ▲▼ adjust\nOK save · ▶ start · Menu cancel',
    'notice.stopFirst': 'Stop first · hold ▶', 'notice.presetLocked': 'Preset · Menu → Restore defaults to edit',
    'field.round-min': 'round minutes', 'field.round-sec': 'round seconds', 'field.rest-min': 'rest minutes',
    'field.rest-sec': 'rest seconds', 'field.rounds': 'rounds', 'field.timer2': 'timer 2 {field}',
    'list.now': 'Now R{n} · {t}', 'list.next': 'Next R{n} · {t}', 'list.last': 'Last round', 'list.overtime': '{n}m overtime',
    'sched.next': 'Next: {title}', 'sched.remainingHM': '{h}h {m}m remaining', 'sched.remainingM': '{m}m remaining',
    'sched.dayAt': '{day} at {time}', 'sched.none': 'No classes scheduled', 'sched.in': 'in {x}',
    'sched.title': 'Weekly Schedule', 'sched.empty': 'none', 'sched.noClasses': 'No classes', 'sched.today': 'today',
    'day.Monday': 'Monday', 'day.Tuesday': 'Tuesday', 'day.Wednesday': 'Wednesday', 'day.Thursday': 'Thursday',
    'day.Friday': 'Friday', 'day.Saturday': 'Saturday', 'day.Sunday': 'Sunday',
    'dayAbbr.Monday': 'Mon', 'dayAbbr.Tuesday': 'Tue', 'dayAbbr.Wednesday': 'Wed', 'dayAbbr.Thursday': 'Thu',
    'dayAbbr.Friday': 'Fri', 'dayAbbr.Saturday': 'Sat', 'dayAbbr.Sunday': 'Sun',
    'credits.title': 'Credits', 'credits.good': 'The good parts', 'credits.hard': 'The hard parts', 'credits.ugly': 'The ugly parts',
    'maint.title': 'Maintenance', 'maint.install': 'Install update and restart', 'maint.sync': 'Sync class schedule',
    'maint.confirmTitle': 'Install update and restart?', 'maint.confirmBody': 'Downloads the newest version and restarts the timer. Takes about a minute.',
    'maint.yes': 'Yes, install now', 'maint.updating': 'Updating…', 'maint.downloading': 'Downloading the newest version',
    'maint.fetching': 'Fetching the class schedule', 'maint.installed': 'Update installed', 'maint.synced': 'Schedule updated',
    'maint.restarting': 'Restarting the timer…', 'maint.failed': 'Update failed', 'maint.menuReturn': 'Menu to return',
    'maint.noWifi': 'No WiFi. Check the network connection', 'maint.timeout': 'Timed out after 60s',
    'maint.connFailed': 'Connection failed', 'maint.unknown': 'Unknown error',
    'screens.toast': 'Screens: {mode}', 'screens.mirror': 'Mirror', 'screens.clocktimer': 'Clock + Timer', 'screens.split': 'Split Timers',
    'sync.disconnected': 'Primary display disconnected. Timer may be out of date',
    'stealth.hint': 'Press any key to display timers',
    'menu.scoreboard': 'Scoreboard', 'menu.resetScore': 'Reset score',
    'score.points': 'Points', 'score.adv': 'Adv', 'score.pen': 'Pen',
    'menu.tetris': 'Tetris', 'tetris.score': 'Score', 'tetris.lines': 'Lines', 'tetris.level': 'Level', 'tetris.next': 'Next',
    'tetris.paused': 'Paused', 'tetris.over': 'Game over', 'tetris.restart': 'OK: play again',
    'tetris.hint': '◀▶ move · ▲ rotate · ▼ drop · OK hard drop · ▶ pause · Menu quit',
    'tetris.bark': 'Woof!', 'tetris.bigBark': 'WOOF WOOF!',
    'tetris.high': 'High scores', 'tetris.newHigh': 'New record!',
    'tetris.enterName': '▲▼ letter · ◀▶ position · OK confirm'
  },
  pt: {
    'menu.title': 'Menu', 'menu.training': 'Treino', 'menu.competition': 'Competição',
    'menu.schedule': 'Ver horário', 'menu.screens': 'Telas', 'menu.hide': 'Ocultar tela',
    'menu.hide.note': 'descanso continua visível', 'menu.holiday': 'Tema festivo', 'menu.quiet': 'Visual discreto',
    'menu.followSchedule': 'Seguir horário das aulas', 'menu.language': 'Idioma',
    'menu.maintenance': 'Manutenção', 'menu.about': 'Sobre', 'menu.on': 'LIGADO', 'menu.off': 'DESLIGADO',
    'menu.pause': 'Pausar', 'menu.resume': 'Retomar', 'menu.stopKeep': 'Parar e manter ajustes',
    'menu.restore': 'Restaurar padrões',
    'confirm.restore.title': 'Restaurar padrões?', 'confirm.restore.body': 'Para o cronômetro e apaga os ajustes atuais.',
    'confirm.restore.yes': 'Sim, restaurar padrões', 'confirm.no': 'Não, voltar',
    'training.title': 'Predefinições de treino', 'competition.title': 'Predefinições de competição',
    'label.round': 'Rodada', 'label.rest': 'Descanso', 'label.timer1': 'Cronômetro 1', 'label.timer2': 'Cronômetro 2',
    'label.classTimeLeft': 'Tempo de aula restante', 'label.custom': 'Personalizado', 'label.repeat': 'Repetir',
    'label.rounds': '{n} rodadas', 'label.round1': '1 rodada', 'label.roundN': 'Rodada {c}', 'label.roundOf': 'Rodada {c} / {t}',
    'label.outside': 'Lá fora {t}',
    'preset.Chainsaw': 'Motosserra', 'preset.Ladder Up': 'Escada crescente', 'preset.Ladder Down': 'Escada decrescente',
    'preset.Pyramid': 'Pirâmide', 'preset.Inv. Pyramid': 'Pirâmide invertida', 'preset.Tabata': 'Tabata', 'preset.Dual Timer': 'Cronômetro duplo',
    'preset.Kids (under 15)': 'Infantil (até 15 anos)', 'preset.White Belt': 'Faixa Branca', 'preset.Blue Belt': 'Faixa Azul',
    'preset.Purple Belt': 'Faixa Roxa', 'preset.Brown Belt': 'Faixa Marrom', 'preset.Black Belt': 'Faixa Preta',
    'note.Chainsaw': 'Rodada e descanso alternados', 'note.Ladder Up': 'Curto → longo', 'note.Ladder Down': 'Longo → curto',
    'note.Pyramid': 'Curto → longo → curto', 'note.Inv. Pyramid': 'Longo → curto → longo',
    'note.Tabata': '20 s ativo / 10 s descanso × 8', 'note.Dual Timer': 'Dois cronômetros independentes',
    'wizard.step': 'Passo {n} de {m}', 'wizard.back': 'Menu: voltar', 'wizard.prev': 'Menu: passo anterior',
    'wizard.nav': '▲▼ alterar · OK avançar', 'wizard.suggested': 'sugerido · OK aceita',
    'wizard.minutes': 'minutos', 'wizard.seconds': 'segundos',
    'wizard.totalMinutes': 'Minutos no total:', 'wizard.howManyRounds': 'Quantas rodadas?', 'wizard.restBetween': 'Descanso entre rodadas:',
    'wizard.enterNumber': 'Digite um número', 'wizard.min1minute': 'Mínimo de 1 minuto', 'wizard.min2rounds': 'Mínimo de 2 rodadas',
    'wizard.restTooLong': 'Descanso longo demais, não sobra tempo para as rodadas',
    'chainsaw.oddRound': 'Duração das rodadas ímpares:', 'chainsaw.oddRest': 'Descanso das rodadas ímpares:', 'chainsaw.evenRound': 'Duração das rodadas pares:',
    'chainsaw.evenRest': 'Descanso das rodadas pares:', 'chainsaw.rounds': 'Quantas rodadas:', 'chainsaw.needDuration': 'A rodada precisa de duração',
    'chainsaw.enterNumber': 'Digite um número', 'chainsaw.min1round': 'Mínimo de 1 rodada',
    'state.ready': 'Pronto', 'state.paused': '❚❚ Pausado', 'state.finished': 'Concluído', 'state.editing': 'Editando', 'state.editingField': 'Editando {field}',
    'hint.ready': '▶ iniciar · anel edita · segure ▶ relógio', 'hint.paused': '▶ retomar · Menu opções', 'hint.finished': '▶ reiniciar · Menu opções · segure ▶ relógio',
    'hint.edit': '◀▶ campo · ▲▼ ajustar\nOK salvar · ▶ iniciar · Menu cancelar',
    'notice.stopFirst': 'Pare primeiro · segure ▶', 'notice.presetLocked': 'Predefinição · Menu → Restaurar padrões para editar',
    'field.round-min': 'minutos da rodada', 'field.round-sec': 'segundos da rodada', 'field.rest-min': 'minutos do descanso',
    'field.rest-sec': 'segundos do descanso', 'field.rounds': 'rodadas', 'field.timer2': 'cronômetro 2, {field}',
    'list.now': 'Agora R{n} · {t}', 'list.next': 'Próximo R{n} · {t}', 'list.last': 'Última rodada', 'list.overtime': '{n} min além',
    'sched.next': 'Próxima: {title}', 'sched.remainingHM': 'faltam {h}h {m}min', 'sched.remainingM': 'faltam {m} min',
    'sched.dayAt': '{day} às {time}', 'sched.none': 'Nenhuma aula marcada', 'sched.in': 'em {x}',
    'sched.title': 'Horário semanal', 'sched.empty': 'nenhuma', 'sched.noClasses': 'Sem aulas', 'sched.today': 'hoje',
    'day.Monday': 'Segunda', 'day.Tuesday': 'Terça', 'day.Wednesday': 'Quarta', 'day.Thursday': 'Quinta',
    'day.Friday': 'Sexta', 'day.Saturday': 'Sábado', 'day.Sunday': 'Domingo',
    'dayAbbr.Monday': 'Seg', 'dayAbbr.Tuesday': 'Ter', 'dayAbbr.Wednesday': 'Qua', 'dayAbbr.Thursday': 'Qui',
    'dayAbbr.Friday': 'Sex', 'dayAbbr.Saturday': 'Sáb', 'dayAbbr.Sunday': 'Dom',
    'credits.title': 'Créditos', 'credits.good': 'As partes boas', 'credits.hard': 'As partes difíceis', 'credits.ugly': 'As partes feias',
    'maint.title': 'Manutenção', 'maint.install': 'Instalar atualização e reiniciar', 'maint.sync': 'Sincronizar horário das aulas',
    'maint.confirmTitle': 'Instalar atualização e reiniciar?', 'maint.confirmBody': 'Baixa a versão mais recente e reinicia o cronômetro. Leva cerca de um minuto.',
    'maint.yes': 'Sim, instalar agora', 'maint.updating': 'Atualizando…', 'maint.downloading': 'Baixando a versão mais recente',
    'maint.fetching': 'Buscando o horário das aulas', 'maint.installed': 'Atualização instalada', 'maint.synced': 'Horário atualizado',
    'maint.restarting': 'Reiniciando o cronômetro…', 'maint.failed': 'Falha na atualização', 'maint.menuReturn': 'Menu para voltar',
    'maint.noWifi': 'Sem WiFi. Verifique a conexão de rede', 'maint.timeout': 'Tempo esgotado após 60 s',
    'maint.connFailed': 'Falha na conexão', 'maint.unknown': 'Erro desconhecido',
    'screens.toast': 'Telas: {mode}', 'screens.mirror': 'Espelho', 'screens.clocktimer': 'Relógio + Cronômetro', 'screens.split': 'Cronômetros separados',
    'sync.disconnected': 'Tela principal desconectada. O cronômetro pode estar desatualizado',
    'stealth.hint': 'Pressione qualquer botão para mostrar os cronômetros',
    'menu.scoreboard': 'Placar', 'menu.resetScore': 'Zerar placar',
    'score.points': 'Pontos', 'score.adv': 'Vant', 'score.pen': 'Pun',
    'menu.tetris': 'Tetris', 'tetris.score': 'Pontos', 'tetris.lines': 'Linhas', 'tetris.level': 'Nível', 'tetris.next': 'Próxima',
    'tetris.paused': 'Pausado', 'tetris.over': 'Fim de jogo', 'tetris.restart': 'OK: jogar de novo',
    'tetris.hint': '◀▶ mover · ▲ girar · ▼ descer · OK cair · ▶ pausar · Menu sair',
    'tetris.bark': 'Au!', 'tetris.bigBark': 'AU AU!',
    'tetris.high': 'Recordes', 'tetris.newHigh': 'Novo recorde!',
    'tetris.enterName': '▲▼ letra · ◀▶ posição · OK confirmar'
  }
};

/**
 * Translate a string key for the current language, filling {placeholders}.
 * Unknown keys fall back to English, then to the key itself.
 * @param {string} key
 * @param {Object} [vars]
 * @returns {string}
 */
function t(key, vars) {
  const table = STRINGS[APP_SETTINGS.language] || STRINGS.en;
  let str = table[key] !== undefined ? table[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
  if (vars) for (const k of Object.keys(vars)) str = str.split(`{${k}}`).join(String(vars[k]));
  return str;
}

/**
 * Class titles arrive from the synced calendar in English. Known titles are
 * translated for display by a normalised lookup (case, spacing and
 * punctuation ignored); anything else shows as written.
 */
const CLASS_TITLES = {
  pt: {
    'adultnoonclass': 'Aula de adultos (meio-dia)',
    'kidsjiujitsubasics': 'Jiu-Jitsu infantil básico',
    'adultjiujitsubasics': 'Jiu-Jitsu adulto básico',
    'drillonly': 'Só drills',
    'marathonrolladults': 'Maratona de rola (adultos)',
    'kidsadvanced': 'Infantil avançado',
    'adultjiujitsualllevels': 'Jiu-Jitsu adulto, todos os níveis',
    'adultadvanced': 'Adulto avançado',
    'womensprivategroupclass': 'Aula particular em grupo (mulheres)',
    'kidsbasics': 'Infantil básico',
    'kidsnogi': 'Infantil no-gi',
    'openmat': 'Tatame livre',
    'openmatspecial': 'Tatame livre especial'
  }
};

function normalizeClassTitle(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Display name for a class title from the schedule. */
function classDisplayName(title) {
  if (!title) return '';
  const table = CLASS_TITLES[APP_SETTINGS.language];
  if (!table) return title;
  const hit = table[normalizeClassTitle(title)];
  return hit !== undefined ? hit : title;
}

/**
 * Display name for a stored preset name: a built-in preset when the app
 * knows it, else a class title (the schedule applies presets under the
 * class name), else the name as stored.
 */
function presetDisplayName(name) {
  if (!name) return '';
  const table = STRINGS[APP_SETTINGS.language] || STRINGS.en;
  if (table[`preset.${name}`] !== undefined) return table[`preset.${name}`];
  return classDisplayName(name);
}

/**
 * Re-label the static markup (round / rest labels, panel names, banners) in
 * the current language. Dynamic content re-renders through t() on its own.
 * @param {Document} [doc]
 */
function applyStaticTranslations(doc) {
  doc = doc || (typeof document !== 'undefined' ? document : null);
  if (!doc) return;
  const set = (sel, text) => doc.querySelectorAll(sel).forEach(el => { if (el.textContent !== text) el.textContent = text; });
  set('#round-label, .round-label-2', t('label.round'));
  set('#rest-label, .rest-label-2', t('label.rest'));
  set('#timer-panel-1 .timer-panel-name', t('label.timer1'));
  set('#timer-panel-2 .timer-panel-name', t('label.timer2'));
  set('#class-progress-label', t('label.classTimeLeft'));
  set('#sync-status', t('sync.disconnected'));
  set('#stealth-hint', t('stealth.hint'));
  doc.documentElement.lang = APP_SETTINGS.language === 'pt' ? 'pt-BR' : 'en';
}

/**
 * Switch the UI language, persist it and re-label the static markup.
 * @param {string} lang - 'en' | 'pt'
 * @returns {string} the language now in effect
 */
function setLanguage(lang) {
  const next = LANGUAGES.includes(lang) ? lang : 'en';
  APP_SETTINGS.language = next;
  try {
    localStorage.setItem('bjj-timer-language', next);
  } catch (e) {
    // localStorage unavailable — setting applies for this session only
  }
  applyStaticTranslations();
  return next;
}

const PHASES = {
  IDLE: 'IDLE',
  PREP: 'PREP',
  ROUND: 'ROUND',
  REST: 'REST'
};

/**
 * Decide whether a tick that started in PREP should play a prep beep, and
 * for which second. Returns null when no beep is due — including the final
 * tick (remaining 0), where the round-start bell plays instead.
 * @param {string} phaseBeforeTick - Phase when the tick started
 * @param {number} remainingSec - Prep seconds remaining after the tick
 * @param {number} prepDurationSec
 * @returns {number|null} 1-based prep second to beep for, or null
 */
function prepBeepSecond(phaseBeforeTick, remainingSec, prepDurationSec) {
  if (phaseBeforeTick !== PHASES.PREP) return null;
  if (remainingSec < 1 || remainingSec > prepDurationSec - 1) return null;
  return remainingSec + 1;
}

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
      if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_CONFIG };
      const pick = (key) => (isValidSeconds(parsed[key]) ? parsed[key] : DEFAULT_CONFIG[key]);
      return {
        roundDurationSec: pick('roundDurationSec'),
        restDurationSec: pick('restDurationSec'),
        numRounds: pick('numRounds'),
        prepDurationSec: pick('prepDurationSec')
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
    // Monotonic deadlines ignore NTP/manual wall-clock changes.
    // Explicit page suspension pauses elapsed time; background throttling catches up.
    this._nextTickAt = 0;
    this._pausedRemainderMs = null;
  }

  // A frozen page has no reliable elapsed clock on every OS. Pause explicitly
  // instead of guessing from a wall clock that may have changed during sleep.
  suspend() {
    if (this.state.phase !== PHASES.IDLE && !this.state.paused) {
      this._resumeAfterSuspend = true;
      this.pause();
    }
  }

  resumeFromSuspend() {
    if (this._resumeAfterSuspend) this.resume();
    this._resumeAfterSuspend = false;
  }

  /**
   * Arm a timeout for the next tick deadline. The timeout id is stored in
   * state.intervalId so existing callers (and tests) can check for a
   * running timer the same way they always have.
   * @private
   */
  _scheduleNext() {
    const delay = Math.max(0, this._nextTickAt - performance.now());
    this.state.intervalId = setTimeout(() => this._drive(), delay);
  }

  /**
   * Fire every tick whose deadline has passed, then re-arm. If the browser
   * throttled timers for several seconds, advance missed state silently and
   * emit countdown cues only for the most recent second. Retain the latest
   * transition's cues even when that transition occurred on an earlier tick.
   * @private
   */
  _drive() {
    this._clearTimer();
    const now = performance.now();
    let guard = 0;
    let latestTransitionCues = [];
    try {
      while (now >= this._nextTickAt && guard++ < 3600) {
        this._nextTickAt += 1000;
        this.silent = this._nextTickAt <= now;
        this._transitionCues = [];
        this.tick();
        if (this._transitionCues.length) latestTransitionCues = this._transitionCues;
        if (this.state.phase === PHASES.IDLE || this.state.paused) break;
      }
    } finally {
      this.silent = false;
      this._transitionCues = null;
    }
    for (const cue of latestTransitionCues) cue();
    if (this.state.phase !== PHASES.IDLE && !this.state.paused) this._scheduleNext();
  }

  // Group fanfare, bell and flash from one tick; catch-up plays only the
  // newest group. State/UI callbacks still run immediately on every tick.
  emitTransitionCue(cue) {
    if (this._transitionCues) this._transitionCues.push(cue);
    else cue();
  }

  /**
   * Cancel any armed tick timeout.
   * @private
   */
  _clearTimer() {
    if (this.state.intervalId !== null) {
      clearTimeout(this.state.intervalId);
      this.state.intervalId = null;
    }
  }

  /**
   * Begin a session. If config.prepDurationSec > 0, starts with a prep countdown
   * (with audio cues) before transitioning to ROUND; otherwise goes straight to ROUND.
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

    this._pausedRemainderMs = null;
    this._nextTickAt = performance.now() + 1000;
    this._scheduleNext();
  }

  /**
   * Stop the session. Transitions any phase → IDLE, clears the interval,
   * resets remainingSec to config.roundDurationSec and currentRound to 0.
   */
  stop() {
    this._clearTimer();
    this._pausedRemainderMs = null;

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
    // Remember how much of the current second was left so resume() picks up
    // exactly where the countdown stopped instead of restarting the second.
    this._pausedRemainderMs = Math.min(1000, Math.max(0, this._nextTickAt - performance.now()));
    this._clearTimer();
    this.state.paused = true;
  }

  /**
   * Resume a paused timer. Restarts the interval.
   * No-op if not paused.
   */
  resume() {
    if (!this.state.paused) return;
    this.state.paused = false;
    const remainder = this._pausedRemainderMs === null ? 1000 : this._pausedRemainderMs;
    this._pausedRemainderMs = null;
    this._nextTickAt = performance.now() + remainder;
    this._scheduleNext();
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
          // Check if rest duration is 0 — skip rest, go directly to next round
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
    this._clips = {}; // src → preloaded HTMLAudioElement (cloned per play)
  }

  /**
   * Fetch and decode the bell files once so the first ring of a session does
   * not wait on a network round-trip.
   */
  preload() {
    for (const src of AudioManager.CLIPS) this._clip(src);
  }

  /**
   * Return the cached Audio element for a file, creating it on first use.
   * @param {string} src
   * @returns {HTMLAudioElement|null}
   * @private
   */
  _clip(src) {
    if (!this._clips[src]) {
      try {
        const audio = new Audio(src);
        audio.preload = 'auto';
        this._clips[src] = audio;
      } catch (e) {
        return null;
      }
    }
    return this._clips[src];
  }

  /**
   * Play a preloaded clip. Each play uses a clone so overlapping rings
   * (e.g. both dual timers ending together) do not cut each other off.
   * @param {string} src
   * @param {number} [stopAfterMs] - Optionally stop playback after this delay
   * @private
   */
  _playFile(src, stopAfterMs) {
    try {
      const base = this._clip(src);
      if (!base) return;
      const audio = base.cloneNode();
      audio.volume = APP_SETTINGS.audio.volume;
      const p = audio.play();
      if (p && typeof p.catch === 'function') {
        p.catch(e => console.warn(`Audio play failed (${src}):`, e));
      }
      if (stopAfterMs) {
        setTimeout(() => { audio.pause(); audio.currentTime = 0; }, stopAfterMs);
      }
    } catch (e) {
      console.warn(`Audio error (${src}):`, e);
    }
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
      // A single failed oscillator (e.g. a context still resuming) must not
      // silence every later beep — only context creation disables audio.
      console.warn('Tone playback failed:', e);
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
    this._playFile('boxing-bell-single-loud.mp3', 2000);
  }

  /**
   * Boxing ring bell to signal end of round — single strike.
   */
  playEndOfRoundBeep() {
    this._playFile('boxing-bell-loud.mp3');
  }

  /**
   * Tone for rest end (configurable frequency/duration).
   */
  playEndOfRestBeep() {
    this._playTone(APP_SETTINGS.audio.endOfRestFrequency, APP_SETTINGS.audio.endOfRestDuration);
  }

  /**
   * Timer 2 end-of-round: different bell sound.
   */
  playEndOfRoundBeepT2() {
    this._playFile('boxing-bell-single-loud.mp3');
  }

  /**
   * Timer 2 end-of-rest: higher-pitched tone (50% higher).
   */
  playEndOfRestBeepT2() {
    this._playTone(APP_SETTINGS.audio.endOfRestFrequency * 1.5, APP_SETTINGS.audio.endOfRestDuration);
  }

  /**
   * Timer 2 countdown: higher-pitched beep (50% higher).
   */
  playCountdownBeepT2() {
    this._playTone(APP_SETTINGS.audio.countdownBeepFrequency * 1.5, APP_SETTINGS.audio.countdownBeepDuration);
  }

  /**
   * Loud, repeating descending ring to signal end of class.
   * Plays G5 → E5 → C5 pattern three times so it's unmissable.
   */
  playEndOfClassRing() {
    this._playFile('boxing-bell-single-loud.mp3');
  }

  /**
   * Sound to signal the start of a class.
   */
  playStartOfClassRing() {
    this._playFile('boxing-bell-single.mp3');
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
      console.warn('Muffle playback failed:', e);
    }
  }

  /**
   * Play a short rising two-note cue for resume, so pause and resume are
   * distinguishable by ear.
   */
  playResume() {
    try {
      if (!this._ensureContext()) return;
      const ctx = this.audioCtx;
      const now = ctx.currentTime;
      const vol = APP_SETTINGS.audio.volume;
      [[330, 0], [440, 0.09]].forEach(([freq, at]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(vol * 0.9, now + at);
        gain.gain.exponentialRampToValueAtTime(0.001, now + at + 0.12);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + at);
        osc.stop(now + at + 0.12);
      });
    } catch (e) {
      console.warn('Resume cue playback failed:', e);
    }
  }

  /**
   * A little dog bark: a burst of band-passed noise with a quick pitch drop.
   * @param {number} [count=1] - Barks in a row (a four-line Tetris gets two)
   */
  playBark(count) {
    try {
      if (!this._ensureContext()) return;
      const ctx = this.audioCtx;
      const vol = APP_SETTINGS.audio.volume;
      const n = Math.max(1, count | 0);
      for (let i = 0; i < n; i++) {
        const at = ctx.currentTime + i * 0.22;
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(620, at);
        osc.frequency.exponentialRampToValueAtTime(240, at + 0.12);
        filter.type = 'bandpass';
        filter.frequency.value = 900;
        filter.Q.value = 2;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(vol * 1.4, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        osc.start(at);
        osc.stop(at + 0.17);
      }
    } catch (e) {
      console.warn('Bark playback failed:', e);
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
      console.warn('Cancel tone playback failed:', e);
    }
  }
}

AudioManager.CLIPS = [
  'boxing-bell-loud.mp3',
  'boxing-bell-single-loud.mp3',
  'boxing-bell-single.mp3'
];

// --- Icons ---

// Inline SVG icons shared by the preset label, round list and preset menus.
// Each takes the size/viewBox attribute string so callers control sizing.
const ICONS = {
  chainsaw: (s) => `<svg ${s} fill="currentColor"><rect x="2" y="14" width="3" height="8" rx="0.5"/><rect x="7" y="6" width="3" height="16" rx="0.5"/><rect x="12" y="14" width="3" height="8" rx="0.5"/><rect x="17" y="6" width="3" height="16" rx="0.5"/></svg>`,
  ladderUp: (s) => `<svg ${s} fill="currentColor"><rect x="2" y="18" width="3" height="4" rx="0.5"/><rect x="7" y="14" width="3" height="8" rx="0.5"/><rect x="12" y="9" width="3" height="13" rx="0.5"/><rect x="17" y="4" width="3" height="18" rx="0.5"/></svg>`,
  ladderDown: (s) => `<svg ${s} fill="currentColor"><rect x="2" y="4" width="3" height="18" rx="0.5"/><rect x="7" y="9" width="3" height="13" rx="0.5"/><rect x="12" y="14" width="3" height="8" rx="0.5"/><rect x="17" y="18" width="3" height="4" rx="0.5"/></svg>`,
  pyramid: (s) => `<svg ${s} fill="currentColor"><rect x="1" y="16" width="3" height="6" rx="0.5"/><rect x="5.5" y="11" width="3" height="11" rx="0.5"/><rect x="10" y="5" width="3" height="17" rx="0.5"/><rect x="14.5" y="11" width="3" height="11" rx="0.5"/><rect x="19" y="16" width="3" height="6" rx="0.5"/></svg>`,
  invPyramid: (s) => `<svg ${s} fill="currentColor"><rect x="1" y="5" width="3" height="17" rx="0.5"/><rect x="5.5" y="11" width="3" height="11" rx="0.5"/><rect x="10" y="16" width="3" height="6" rx="0.5"/><rect x="14.5" y="11" width="3" height="11" rx="0.5"/><rect x="19" y="5" width="3" height="17" rx="0.5"/></svg>`,
  tabata: (s) => `<svg ${s} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,
  dual: (s) => `<svg ${s} fill="currentColor"><rect x="1" y="6" width="9" height="16" rx="1" opacity="0.8"/><rect x="14" y="6" width="9" height="16" rx="1" opacity="0.8"/></svg>`,
  kids: (s) => `<svg ${s} fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="3"/><path d="M12 8v6"/><path d="M9 21l3-7 3 7"/><path d="M7 13l5 2 5-2"/></svg>`,
  belt: (s, color) => {
    const edge = color === '#ffffff' ? '#888' : color;
    const knot = color === '#ffffff' ? '#888' : 'rgba(0,0,0,0.3)';
    return `<svg ${s} fill="none"><rect x="1" y="9" width="22" height="6" rx="1" fill="${color}" stroke="${edge}" stroke-width="0.5"/><rect x="10" y="7" width="4" height="10" rx="1" fill="${color}" stroke="${knot}" stroke-width="0.5"/><line x1="12" y1="17" x2="11" y2="21" stroke="${edge}" stroke-width="1.5" stroke-linecap="round"/><line x1="12" y1="17" x2="13" y2="21" stroke="${edge}" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  },
  gear: (s) => `<svg ${s} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  repeat: (s) => `<svg ${s} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>`,
  play: (s) => `<svg ${s} fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg>`,
  pause: (s) => `<svg ${s} fill="currentColor"><rect x="5" y="4" width="5" height="16" rx="1"/><rect x="14" y="4" width="5" height="16" rx="1"/></svg>`,
  blank: (s) => `<svg ${s} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8"/></svg>`,
  power: (s) => `<svg ${s} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/></svg>`,
  download: (s) => `<svg ${s} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>`,
  // Main-menu rows: one distinct, conventional glyph per action
  undo: (s) => `<svg ${s} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/></svg>`,
  stop: (s) => `<svg ${s} fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>`,
  calendar: (s) => `<svg ${s} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`,
  clock: (s) => `<svg ${s} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,
  eyeOff: (s) => `<svg ${s} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.9 17.9A10.9 10.9 0 0 1 12 20c-7 0-11-8-11-8a20 20 0 0 1 5.1-6"/><path d="M9.9 4.2A10 10 0 0 1 12 4c7 0 11 8 11 8a20 20 0 0 1-2.2 3.2"/><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2"/><path d="M1 1l22 22"/></svg>`,
  moon: (s) => `<svg ${s} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`,
  globe: (s) => `<svg ${s} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
  wrench: (s) => `<svg ${s} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
  info: (s) => `<svg ${s} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
  trophy: (s) => `<svg ${s} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M7 6H4a1 1 0 0 0-1 1 4 4 0 0 0 4 4M17 6h3a1 1 0 0 1 1 1 4 4 0 0 1-4 4"/></svg>`,
  gamepad: (s) => `<svg ${s} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="11" rx="4"/><path d="M6 12h4M8 10v4"/><path d="M15 11h.01M18 13h.01"/></svg>`,
  snow: (s) => `<svg ${s} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"/><path d="M3.3 7l17.4 10"/><path d="M3.3 17L20.7 7"/><path d="M9 4.5l3 2 3-2"/><path d="M9 19.5l3-2 3 2"/><path d="M4.5 9.5l3.5 1-1 3.5"/><path d="M19.5 14.5l-3.5-1 1-3.5"/><path d="M4.5 14.5l3.5-1-1-3.5"/><path d="M19.5 9.5l-3.5 1 1 3.5"/></svg>`
};

const BELT_COLORS = {
  white: '#ffffff', blue: '#1e90ff', purple: '#9b30ff', brown: '#8B4513', black: '#222222'
};

/**
 * Pick the icon for a preset by its display name (competition belts, kids,
 * training shapes). Returns '' when no icon applies.
 * @param {string} name
 * @param {string} s - SVG size/viewBox attributes
 * @returns {string}
 */
function presetIcon(name, s) {
  if (!name) return '';
  const lower = name.toLowerCase();
  if (lower.includes('kid') || lower.includes('child') || lower.includes('youth')) return ICONS.kids(s);
  for (const belt of Object.keys(BELT_COLORS)) {
    if (lower.includes(belt)) return ICONS.belt(s, BELT_COLORS[belt]);
  }
  if (lower === 'chainsaw') return ICONS.chainsaw(s);
  if (lower === 'pyramid') return ICONS.pyramid(s);
  if (lower.includes('inv')) return ICONS.invPyramid(s);
  if (lower.includes('ladder up')) return ICONS.ladderUp(s);
  if (lower.includes('ladder down')) return ICONS.ladderDown(s);
  if (lower === 'tabata') return ICONS.tabata(s);
  if (lower === 'dual timer') return ICONS.dual(s);
  return '';
}

// Training preset ids → display names and icons
const TRAINING_MODES = {
  pyramid: { label: 'Pyramid', icon: 'pyramid' },
  inv_pyramid: { label: 'Inv. Pyramid', icon: 'invPyramid' },
  ladder_up: { label: 'Ladder Up', icon: 'ladderUp' },
  ladder_down: { label: 'Ladder Down', icon: 'ladderDown' }
};

// Hold duration (ms) that turns a tap on ▶ / OK / Menu into a long press
const HOLD_MS = 800;
// How long a state-label notice (e.g. "Stop first") stays up
const NOTICE_MS = 2000;

// Rounds assumed when a training preset's rounds prompt is confirmed empty
const TRAINING_DEFAULT_ROUNDS = 4;
// Total minutes assumed when no class is in progress to derive one from
const TRAINING_DEFAULT_MINUTES = 10;

// Starting values for the chainsaw duration prompts
const CHAINSAW_DEFAULT_ROUND_SEC = 300;
const CHAINSAW_DEFAULT_REST_SEC = 30;

/**
 * Remote-control vocabulary. The app is driven by an Apple Remote through a
 * Flirc receiver, which emits ordinary keystrokes:
 *   ring  → Arrow keys (hold Up/Down → PageUp/PageDown via Flirc long-press)
 *   OK    → Enter
 *   ▶⏸    → Space   (hold → '0' via Flirc long-press)
 *   Menu  → Escape  (hold → Delete via Flirc long-press)
 * The original numpad bindings keep working for keyboards.
 */
const TRAINING_MENU_ITEMS = [
  { key: '0', icon: 'chainsaw', name: 'Chainsaw', note: 'Alternating round/rest' },
  { key: '1', icon: 'ladderUp', name: 'Ladder Up', note: 'Short → long' },
  { key: '2', icon: 'ladderDown', name: 'Ladder Down', note: 'Long → short' },
  { key: '3', icon: 'pyramid', name: 'Pyramid', note: 'Short → long → short' },
  { key: '4', icon: 'invPyramid', name: 'Inv. Pyramid', note: 'Long → short → long' },
  { key: '5', icon: 'tabata', name: 'Tabata', note: '20s on / 10s off × 8' },
  { key: '6', icon: 'dual', name: 'Dual Timer', note: 'Two independent timers' }
];

/**
 * Move a list selection by `delta`, clamped to the list bounds.
 * @param {number} index
 * @param {number} delta
 * @param {number} length
 * @returns {number}
 */
function moveSelection(index, delta, length) {
  if (length <= 0) return 0;
  return Math.min(length - 1, Math.max(0, index + delta));
}

/**
 * Step a numeric overlay input buffer with the ring. An empty buffer starts
 * from `base` (the default or current value) so the first press is predictable.
 * @param {string} buffer - Current typed digits ('' when empty)
 * @param {number} base - Value assumed when the buffer is empty
 * @param {number} delta - Signed step
 * @param {number} min - Lower bound
 * @returns {string} New buffer (always digits)
 */
function stepNumericBuffer(buffer, base, delta, min) {
  const current = buffer === '' || !isNumeric(buffer) ? base : parseInt(buffer, 10);
  return String(Math.max(min, current + delta));
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
    this.scheduleDisplayEl = document.getElementById('schedule-display');
    this.roundListEl = document.getElementById('round-list');
    this.nextClassDisplayEl = document.getElementById('next-class-display');
    this.restSectionEl = document.getElementById('rest-section');
    this.clockAreaEl = document.getElementById('top-right-bar');
    this.roundSectionEl = document.getElementById('round-section');
    this.presetLabelEl = document.getElementById('preset-label');
    this.statusBarEl = document.getElementById('status-bar');
    this.stealth = false;
    this.showScreensKey = false; // Only true when dual-screen mode is enabled (?dual=1)
    // Supplies remaining seconds in the active class (wired by the app); the
    // round list uses it to flag rounds that would run past the class end.
    this.remainingClassSecProvider = null;
    this._lastRoundListHtml = null;
    this._lastClockText = null;
    this._lastWeekday = null;
    this._weekdayFmt = null;
  }

  /**
   * Write MM:SS into a timer element, reusing its two digit spans so each
   * tick is two text writes instead of a full innerHTML re-parse.
   * @param {HTMLElement} el
   * @param {number} remainingSec
   * @returns {{minsEl: HTMLElement, secsEl: HTMLElement}}
   */
  static setDigits(el, remainingSec) {
    let minsEl = el.querySelector('.ts-minutes');
    let secsEl = el.querySelector('.ts-seconds');
    if (!minsEl || !secsEl) {
      el.innerHTML = '<span class="ts-minutes"></span>:<span class="ts-seconds"></span>';
      minsEl = el.querySelector('.ts-minutes');
      secsEl = el.querySelector('.ts-seconds');
    }
    const mins = String(Math.floor(remainingSec / 60)).padStart(2, '0');
    const secs = String(remainingSec % 60).padStart(2, '0');
    if (minsEl.textContent !== mins) minsEl.textContent = mins;
    if (secsEl.textContent !== secs) secsEl.textContent = secs;
    return { minsEl, secsEl };
  }

  /**
   * Update the round timer text and active styling.
   * @param {number} remainingSec - Seconds remaining
   * @param {boolean} isActive - Whether the round phase is currently active
   */
  updateRoundDisplay(remainingSec, isActive) {
    if (!this.roundTimerEl) return;
    Renderer.setDigits(this.roundTimerEl, remainingSec);
    this.roundTimerEl.classList.toggle('timer-active', isActive);
    if (!isActive) this.roundTimerEl.classList.remove('timer-paused');
    // Final ten seconds: yellow box with black digits (white on yellow is
    // unreadable from across the mat)
    this.roundTimerEl.classList.toggle('timer-warn', isActive && remainingSec <= 10);
  }

  /**
   * Update the rest timer text and active styling.
   * @param {number} remainingSec - Seconds remaining
   * @param {boolean} isActive - Whether the rest phase is currently active
   */
  updateRestDisplay(remainingSec, isActive) {
    if (!this.restTimerEl) return;
    Renderer.setDigits(this.restTimerEl, remainingSec);
    this.restTimerEl.classList.toggle('timer-active', isActive);
    if (!isActive) this.restTimerEl.classList.remove('timer-paused');
    this.restTimerEl.classList.toggle('timer-warn', isActive && remainingSec <= 10);
    // While resting, the rest box takes the big slot and the round box the small one
    const container = document.getElementById('dual-timer-container');
    if (container) container.classList.toggle('rest-active', isActive);
  }

  /**
   * Format a Date as 12-hour clock parts without locale lookups.
   * @param {Date} now
   * @returns {{hhmm: string, ss: string, ampm: string}}
   */
  static clockParts(now) {
    const h = now.getHours();
    const h12 = h % 12 === 0 ? 12 : h % 12;
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return { hhmm: `${h12}:${mm}`, ss, ampm: h >= 12 ? 'PM' : 'AM' };
  }

  /**
   * Update the wall clock display in HH:MM:SS format with day of week.
   * @param {Date} [now]
   */
  updateClockDisplay(now) {
    now = now || new Date();
    if (this.clockEl) {
      const { hhmm, ss, ampm } = Renderer.clockParts(now);
      const text = `${hhmm}${ss}${ampm}`;
      if (text !== this._lastClockText) {
        this._lastClockText = text;
        this.clockEl.innerHTML = `${hhmm}<span class="clock-seconds">${ss}</span> <span class="clock-ampm">${ampm}</span>`;
      }
    }
    if (this.dayOfWeekEl) {
      const day = now.getDay();
      if (day !== this._lastWeekday) {
        this._lastWeekday = day;
        this.dayOfWeekEl.textContent = VALID_DAYS[day === 0 ? 6 : day - 1];
      }
    }
  }

  /**
   * Update the temperature display.
   * @param {string} text - Temperature text to display (e.g. "72°F")
   */
  updateTemperature(text) {
    if (this.temperatureEl) {
      this._lastTemperature = text;
      this.temperatureEl.textContent = text ? t('label.outside', { t: text }) : '';
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
    this.screenFlashEl.dataset.flashSequence = String(Number(this.screenFlashEl.dataset.flashSequence || 0) + 1);
    this.screenFlashEl.classList.remove('active');
    void this.screenFlashEl.offsetWidth;
    this.screenFlashEl.classList.add('active');
  }

  /**
   * Show the translucent pause overlay with pause icon.
   */
  showPauseOverlay() {
    const container = document.getElementById('dual-timer-container');
    if (container) container.classList.add('timer-paused-grayscale');
  }

  /**
   * Hide the pause overlay.
   */
  hidePauseOverlay() {
    const container = document.getElementById('dual-timer-container');
    if (container) container.classList.remove('timer-paused-grayscale');
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
  applyStealth(phase, phase2) {
    if (phase === undefined && this.phaseProvider) [phase, phase2] = this.phaseProvider();
    else if (phase2 === undefined && this.phaseProvider) phase2 = this.phaseProvider()[1];
    const hidden = this.stealth ? 'hidden' : '';
    const round2 = document.getElementById('round-section-2');
    const rest2 = document.getElementById('rest-section-2');
    if (round2) round2.style.visibility = hidden;
    if (rest2) rest2.style.visibility = this.stealth && phase2 !== PHASES.REST ? 'hidden' : '';
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
    if (this.statusBarEl) this.statusBarEl.style.visibility = hidden;
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
   * State label under the timers. Names the states that otherwise look alike
   * from across the mat (Ready / Paused / Finished) and, while editing, the
   * control lines a coach needs. Running and idle show nothing. A notice is a
   * short message the input handler shows for a moment, then restores.
   * @param {'clock'|'ready'|'running'|'paused'|'finished'|'editing'|'notice'|'menu'|'training'|'competition'|'hidden'} mode
   * @param {{field?: string, text?: string}} [detail] - Editing: field name; notice: the message
   */
  updateStatusBar(mode, detail) {
    if (!this.statusBarEl) return;
    // Overlays cover the label; keep whatever state it showed before
    if (mode === 'menu' || mode === 'training' || mode === 'competition') return;
    let html = '';
    const row = (cls, state, hint) =>
      `<span class="sb-state ${cls}">${state}</span><span class="sb-hint">${hint}</span>`;
    if (mode === 'ready') html = row('sb-ready', t('state.ready'), t('hint.ready'));
    else if (mode === 'paused') html = row('sb-paused', t('state.paused'), t('hint.paused'));
    else if (mode === 'finished') html = row('sb-finished', t('state.finished'), t('hint.finished'));
    else if (mode === 'editing') {
      const field = detail && detail.field ? t('state.editingField', { field: escapeHtml(detail.field) }) : t('state.editing');
      html = row('sb-editing', field, t('hint.edit'));
    } else if (mode === 'notice') {
      html = `<span class="sb-state sb-notice">${escapeHtml(detail.text)}</span>`;
    }
    this._lastStatus = { mode, detail };
    if (this.statusBarEl.innerHTML !== html) this.statusBarEl.innerHTML = html;
    this.statusBarEl.classList.toggle('active', html !== '');
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
    let html;
    if (current === 0) {
      html = total === 0
        ? `${ICONS.repeat('width="1em" height="1em" viewBox="0 0 24 24" style="vertical-align:-0.15em;margin-right:0.3em;"')}${t('label.repeat')}`
        : (total === 1 ? t('label.round1') : t('label.rounds', { n: total }));
    } else {
      html = total === 0 ? t('label.roundN', { c: current }) : t('label.roundOf', { c: current, t: total });
    }
    this._lastCounter = { current, total };
    if (this.roundCounterEl.innerHTML !== html) this.roundCounterEl.innerHTML = html;
  }

  /**
   * Update the preset label above the round timer.
   * Shows the preset name with an icon, or "Custom" with a gear icon.
   * @param {string|null} name - Preset name or null for custom
   */
  updatePresetLabel(name) {
    if (!this.presetLabelEl) return;
    const _s = 'width="1.2em" height="1.2em" viewBox="0 0 24 24"';
    const html = name
      ? `${presetIcon(name, _s)}${escapeHtml(presetDisplayName(name))}`
      : `${ICONS.gear(_s)}${t('label.custom')}`;
    this._lastPreset = name;
    if (this.presetLabelEl.innerHTML !== html) this.presetLabelEl.innerHTML = html;
  }

  /**
   * Show the round list panel with per-round durations.
   * Highlights the current round and dims past rounds.
   * @param {number[]} durations - Array of round durations in seconds
   * @param {number} currentRound - Current round (1-based, 0 = idle/prep)
   * @param {string} [presetName] - Optional preset name to show as header
   */
  updateRoundList(durations, currentRound, presetName, restDurations, restDurationSec, remainingClassSec, currentRemainingSec, phase) {
    if (!this.roundListEl) return;
    if (!durations || durations.length === 0) {
      this.hideRoundList();
      return;
    }
    this.roundListEl.classList.add('active');
    let html = '';
    if (presetName) {
      const _s = 'width="1.2em" height="1.2em" viewBox="0 0 24 24" style="vertical-align:-0.2em;margin-right:0.4em;"';
      const icon = presetIcon(presetName, _s);
      const totalSec = durations.reduce((a, b) => a + b, 0);
      const totalMin = Math.round(totalSec / 60);
      html += `<div style="color:var(--accent-green);font-weight:700;margin-bottom:0.5em;">${icon}${escapeHtml(presetDisplayName(presetName))} <span style="font-weight:400;color:var(--text-muted);font-size:0.8em;">${totalMin}m</span></div>`;
    }

    // Calculate time from NOW until each round ends to find overtime.
    // Rounds already completed are excluded; the current round contributes only
    // its remaining time (during REST, the remaining rest + the next round).
    let overtimeMinutes = []; // per-round: 0 if not overtime, else minutes over
    if (remainingClassSec > 0) {
      const inRest = phase === PHASES.REST;
      const startRound = currentRound > 0 ? (inRest ? currentRound + 1 : currentRound) : 1;
      let cumulative = 0;
      for (let i = 0; i < durations.length; i++) {
        const roundNum = i + 1;
        if (roundNum < startRound) {
          overtimeMinutes.push(0);
          continue;
        }
        if (roundNum === startRound && currentRound > 0 && typeof currentRemainingSec === 'number') {
          cumulative += inRest ? currentRemainingSec + durations[i] : currentRemainingSec;
        } else {
          if (roundNum > startRound) {
            const restIdx = i - 1;
            cumulative += restDurations ? restDurations[restIdx % restDurations.length] : (restDurationSec || 0);
          }
          cumulative += durations[i];
        }
        if (cumulative > remainingClassSec) {
          overtimeMinutes.push(Math.ceil((cumulative - remainingClassSec) / 60));
        } else {
          overtimeMinutes.push(0);
        }
      }
    }

    // The current and next rounds in large type; the full list stays below
    // for the overview.
    if (currentRound > 0) {
      const nextDur = durations[currentRound]; // 0-based: the round after the current one
      html += `<div class="round-now">` +
        `<span class="round-now-cur">${t('list.now', { n: currentRound, t: formatTime(durations[currentRound - 1]) })}</span>` +
        (nextDur !== undefined ? `<span class="round-now-next">${t('list.next', { n: currentRound + 1, t: formatTime(nextDur) })}</span>` : `<span class="round-now-next">${t('list.last')}</span>`) +
        `</div>`;
    }
    durations.forEach((dur, i) => {
      const roundNum = i + 1;
      let cls = 'round-item';
      if (roundNum < currentRound) cls += ' past';
      else if (roundNum === currentRound) cls += ' current';
      const ot = overtimeMinutes[i] || 0;
      const overtimeTag = ot > 0 ? ` <span class="overtime-badge">${t('list.overtime', { n: ot })}</span>` : '';
      html += `<div class="${cls}"><span class="round-num">R${roundNum}</span> ${formatTime(dur)}${overtimeTag}</div>`;
    });
    // The list only changes on round transitions or when the class-remaining
    // minute ticks over, so skip the re-parse when the markup is identical.
    if (html !== this._lastRoundListHtml) {
      this._lastRoundListHtml = html;
      this.roundListEl.innerHTML = html;
    }
  }

  /**
   * Remaining seconds in the current active class (0 when none).
   * @returns {number}
   */
  getRemainingClassSec() {
    if (typeof this.remainingClassSecProvider !== 'function') return 0;
    const sec = this.remainingClassSecProvider();
    return Number.isFinite(sec) && sec > 0 ? sec : 0;
  }

  /**
   * Hide the round list panel.
   */
  hideRoundList() {
    if (!this.roundListEl) return;
    this.roundListEl.classList.remove('active');
    if (this._lastRoundListHtml !== '') {
      this._lastRoundListHtml = '';
      this.roundListEl.innerHTML = '';
    }
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
      countdownStr = `${days}d ${remH}h`;
    } else if (hours > 0) {
      countdownStr = `${hours}h ${mins}m`;
    } else {
      countdownStr = `${mins}m`;
    }

    // Show day only if the class is actually within the next 24h — a same-weekday
    // class that already passed today wrapped to next week and is NOT "today"
    const isToday = nextClass.dayOfWeek === todayName && minutesUntil < 24 * 60;
    const dayLabel = isToday ? '' : `${t('day.' + nextClass.dayOfWeek)} `;
    const countdownPart = isToday ? ` <span class="next-countdown">(${t('sched.in', { x: countdownStr })})</span>` : '';

    const fmtTime = (t) => {
      const [h, m] = t.split(':').map(Number);
      const suffix = h >= 12 ? 'PM' : 'AM';
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const time = m === 0 ? `${h12}` : `${h12}:${m.toString().padStart(2, '0')}`;
      return `${time}<span class="clock-ampm">${suffix}</span>`;
    };

    this.nextClassDisplayEl.innerHTML =
      `<span class="next-title">${t('sched.next', { title: escapeHtml(classDisplayName(nextClass.title)) })}</span><br>` +
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
        `<span class="class-title" style="color: var(--accent-red);">${escapeHtml(errorMsg)}</span>`;
      return;
    }

    // Active class: show title, classType, remaining time
    if (activeClass) {
      const now = new Date();
      const remainingMin = Math.max(0, Math.ceil((classInstant(now, activeClass.endTime) - now) / 60000));
      const remainH = Math.floor(remainingMin / 60);
      const remainM = remainingMin % 60;
      const remainStr = remainH > 0
        ? t('sched.remainingHM', { h: remainH, m: remainM })
        : t('sched.remainingM', { m: remainM });

      this.scheduleDisplayEl.innerHTML =
        `<span class="class-title">${escapeHtml(classDisplayName(activeClass.title))}</span> ` +
        `<span class="class-type">${escapeHtml(activeClass.classType)}</span><br>` +
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
        `<span class="class-title">${t('sched.next', { title: escapeHtml(classDisplayName(nextClass.title)) })}</span> ` +
        `<span class="class-type">${escapeHtml(nextClass.classType)}</span><br>` +
        `<span class="class-time">${t('sched.dayAt', { day: t('day.' + nextClass.dayOfWeek), time: fmtTime(nextClass.startTime) })}</span>`;
      return;
    }

    // Schedule off: show nothing. Schedule on but empty: say so.
    this.scheduleDisplayEl.innerHTML = APP_SETTINGS.scheduleEnabled
      ? `<span class="class-time">${t('sched.none')}</span>`
      : '';
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
    // Render at device resolution so the ring and logo stay crisp on HiDPI
    // TVs; the CSS size stays at the markup's width/height.
    if (this.canvas) {
      const cssSize = this.canvas.width || 250;
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      this.canvas.style.width = `${cssSize}px`;
      this.canvas.style.height = `${cssSize}px`;
      this.canvas.width = Math.round(cssSize * dpr);
      this.canvas.height = Math.round(cssSize * dpr);
    }
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
      const now = new Date();
      const start = classInstant(now, this._activeClass.startTime);
      const end = classInstant(now, this._activeClass.endTime);
      const totalMin = (end - start) / 60000;

      if (totalMin > 0) {
        const totalSlices = totalMin;
        const elapsed = Math.max(0, (now - start) / 60000);
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

          const sliceOpacity = 1.0 - this._logoScale;
          ctx.globalAlpha = sliceOpacity;

          // Draw one continuous arc for all remaining time (no gaps)
          const arcStart = startAngle + slicesGone * sliceAngle;
          const arcEnd = startAngle + totalSlices * sliceAngle;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.arc(cx, cy, radius, arcStart, arcEnd);
          ctx.closePath();
          ctx.fillStyle = fillColor;
          ctx.fill();

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
    this._open = false;
    this._mode = null; // 'competition' | 'training' | 'training-*' | 'chainsaw-*' | 'schedule' | 'credits' | ...
    this._inputBuffer = '';
    this._advancedCallback = null;
    this._advancedConfig = null;
    this._trainingMode = null; // 'pyramid' | 'inv_pyramid' | 'ladder_up' | 'ladder_down'
    this._trainingRounds = 0;
    this._lastTrainingRestSec = 30;
    this._chainsawOddRoundSec = 0;
    this._chainsawOddRestSec = 0;
    this._chainsawEvenRoundSec = 0;
    this._chainsawEvenRestSec = 0;
    this._chainsawDefaultRounds = 0;
    this._selIndex = 0; // Highlighted row in list-style overlays
    this._durSec = 0; // Duration picker value (seconds)
    this._durField = 'min'; // Duration picker: 'min' | 'sec'
    this._mainMenuItems = null; // Set while navigating from the main menu (Menu = back)
    this._confirm = null; // Pending yes/no prompt: { title, body, yes, onYes }
    this._chainsawStepDone = {}; // Steps already confirmed (back then forward keeps the value)
    this._scheduleDay = 0; // Selected column in the schedule overlay
    // Supplies remaining seconds in the active class for preset defaults
    this.remainingClassSecProvider = null;
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
    if (this._tetris) { this._tetris.stop(); this._tetris = null; }
    this._open = false;
    this._mode = null;
    this._inputBuffer = '';
    this._advancedCallback = null;
    this._advancedConfig = null;
    this._trainingMode = null;
    this._trainingRounds = 0;
    this._selIndex = 0;
    this._mainMenuItems = null;
    this._confirm = null;
    if (this.overlayEl) {
      this.overlayEl.classList.remove('active');
      this.overlayEl.innerHTML = '';
    }
  }

  /**
   * Yes/no prompt for a destructive action. The highlight starts on "No" so
   * a stray OK press does nothing; Menu also declines.
   * @param {{title: string, body?: string, yes: string, onYes: function}} opts
   */
  showConfirm(opts) {
    this._open = true;
    this._mode = 'confirm-action';
    this._confirm = opts;
    this._selIndex = 0;
    this._renderConfirmAction();
  }

  _renderConfirmAction() {
    if (!this.overlayEl || !this._confirm) return;
    const sel = (i) => i === this._selIndex ? ' mg-sel' : '';
    const c = this._confirm;
    this.overlayEl.innerHTML =
      `<div class="advanced-menu overlay-content" style="text-align:center;">` +
        `<div class="menu-title" style="margin-bottom:1vh;">${escapeHtml(c.title)}</div>` +
        (c.body ? `<div class="menu-body">${escapeHtml(c.body)}</div>` : '') +
        `<div class="menu-grid" style="grid-template-columns:1fr;margin-bottom:1vh;">` +
          `<span class="mg-name mg-first mg-last${sel(0)}">${t('confirm.no')}</span>` +
          `<span class="mg-name mg-first mg-last${sel(1)}">${escapeHtml(c.yes)}</span>` +
        `</div>` +
      `</div>`;
    this.overlayEl.classList.add('active');
  }

  /**
   * Open the Tetris game. Menu quits back to the main menu.
   * @param {{onLines?: function(number)}} [opts]
   */
  showTetris(opts) {
    this._open = true;
    this._mode = 'tetris';
    if (!this.overlayEl) return;
    this.overlayEl.innerHTML = `<div class="advanced-menu overlay-content tetris-overlay"><div class="menu-title">${t('menu.tetris')}</div><div class="tetris-root"></div></div>`;
    this.overlayEl.classList.add('active');
    this._tetris = new TetrisGame(this.overlayEl.querySelector('.tetris-root'), opts);
    this._tetris.start();
  }

  /**
   * Maintenance list: install an update (asks first) or re-sync the class
   * schedule. Reached from the main menu.
   */
  showMaintenance() {
    this._open = true;
    this._mode = 'confirm-update';
    this._updateOrigin = 'maintenance';
    this._selIndex = 0;
    this._renderConfirmUpdate();
  }

  /**
   * Display the main menu: one list that reaches every secondary screen so
   * the remote only needs ring + OK + Menu.
   * @param {Array<{id:string, name:string, note?:string|function, icon?:string, action:function, submenu?:boolean, toggle?:boolean}>} items
   *   `toggle` items run their action and stay on the menu (note is re-read).
   */
  showMainMenu(items) {
    this._open = true;
    this._mode = 'main';
    this._mainMenuItems = items;
    this._selIndex = 0;
    this._renderMainMenu();
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
    this._selIndex = 0;
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
    this._selIndex = 0;
    this._renderTrainingMenu();
  }

  /**
   * Display the credits / system screen.
   */
  showCredits() {
    this._open = true;
    this._mode = 'credits';
    this._updateOrigin = 'credits';
    this._renderCredits();
  }

  /**
   * Ask before updating the app from the main menu. The highlight starts on
   * "No" so a stray OK press never triggers a download.
   */
  showUpdateConfirm() {
    this._open = true;
    this._mode = 'confirm-app-update';
    this._updateOrigin = 'main';
    this._selIndex = 0;
    this._renderUpdateConfirm();
  }

  /**
   * Menu button: step back one level, or close when there is nowhere to go.
   * @private
   */
  _back() {
    const m = this._mode;
    if (m === 'confirm-app-update' && this._updateOrigin !== 'main') {
      // Declined the install: back to the list it was picked from
      this._mode = 'confirm-update';
      this._selIndex = 0;
      this._renderConfirmUpdate();
      return;
    }
    if ((m === 'confirm-update' || m === 'update-error') && this._updateOrigin === 'credits') {
      this._mode = 'credits';
      this._renderCredits();
      return;
    }
    if (m === 'update-error' && this._updateOrigin === 'maintenance') {
      this._mode = 'confirm-update';
      this._selIndex = 0;
      this._renderConfirmUpdate();
      return;
    }
    if (m === 'tetris' && this._tetris) { this._tetris.stop(); this._tetris = null; }
    if (this._wizardBack()) return;
    if ((m && m.startsWith('training-')) || (m && m.startsWith('chainsaw-'))) {
      // First step: back to the preset list, keeping the highlighted preset
      this._mode = 'training';
      this._inputBuffer = '';
      this._renderTrainingMenu();
      return;
    }
    if (m !== 'main' && this._mainMenuItems) {
      const items = this._mainMenuItems;
      this.showMainMenu(items);
      return;
    }
    this.closeOverlay();
  }

  /**
   * Menu inside a wizard: return to the previous prompt with its value
   * instead of abandoning every step. Returns false on the first step.
   * @private
   */
  _wizardBack() {
    const m = this._mode;
    const bufferFor = (value, def) => (value === def ? '' : String(value));
    if (m === 'training-rounds') {
      this._mode = 'training-minutes';
      this._inputBuffer = bufferFor(this._trainingTotalMinutes, this._trainingDefaultMinutes);
      this._renderTrainingSubEntry(this._trainingPrompt(), '');
      return true;
    }
    if (m === 'training-rest') {
      this._mode = 'training-rounds';
      this._inputBuffer = bufferFor(this._trainingRounds, TRAINING_DEFAULT_ROUNDS);
      this._renderTrainingSubEntry(this._trainingPrompt(), '');
      return true;
    }
    const chain = { 'chainsaw-odd-rest': ['chainsaw-odd-round', () => this._chainsawOddRoundSec],
      'chainsaw-even-round': ['chainsaw-odd-rest', () => this._chainsawOddRestSec],
      'chainsaw-even-rest': ['chainsaw-even-round', () => this._chainsawEvenRoundSec],
      'chainsaw-rounds': ['chainsaw-even-rest', () => this._chainsawEvenRestSec] };
    if (chain[m]) {
      this._mode = chain[m][0];
      this._inputBuffer = '';
      this._startDuration(chain[m][1]());
      this._renderChainsawEntry(this._chainsawPrompt(), '');
      return true;
    }
    return false;
  }

  /**
   * Handle a key press while the overlay is open.
   * Routes to the appropriate handler based on current mode.
   * @param {string} key - Normalized key ('0'-'9', 'Enter', 'Menu', 'ArrowUp', ...)
   */
  handleKey(key) {
    if (!this._open) return;

    const modal = this._mode === 'credits' || this._mode === 'updating' ||
      this._mode === 'update-error' || this._mode === 'confirm-update' ||
      this._mode === 'confirm-app-update' || this._mode === 'confirm-action';

    if (this._mode === 'updating') return; // Ignore keys while updating

    // Menu steps back everywhere (except while an update is in flight)
    if (key === 'Menu') {
      this._back();
      return;
    }

    // Schedule overlay: ◀▶ pick the day shown large; any other non-ring key goes back
    if (this._mode === 'schedule') {
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        this._scheduleDay = moveSelection(this._scheduleDay, key === 'ArrowRight' ? 1 : -1, 7);
        this._renderSchedule();
        return;
      }
      if (key.startsWith('Arrow') || key === 'StepUp' || key === 'StepDown') return;
      this._back();
      return;
    }

    if (this._mode === 'confirm-action') {
      if (key === 'ArrowUp' || key === 'ArrowDown') {
        this._selIndex = moveSelection(this._selIndex, key === 'ArrowUp' ? -1 : 1, 2);
        this._renderConfirmAction();
      } else if (key === 'Enter') {
        if (this._selIndex === 1) {
          const onYes = this._confirm && this._confirm.onYes;
          this.closeOverlay();
          if (onYes) onYes();
        } else {
          this._back();
        }
      }
      return;
    }

    // Legacy numpad: * or / closes any overlay (except the credits/update
    // screens, which handle their own keys, and training, where / opens credits)
    if (key === '*' && !modal) {
      this.closeOverlay();
      return;
    }
    if (key === '/' && !modal && this._mode !== 'training') {
      this.closeOverlay();
      return;
    }

    if (this._mode === 'tetris') {
      if (this._tetris) this._tetris.handleKey(key);
      return;
    }

    if (this._mode === 'main') {
      this._handleMainMenuKey(key);
    } else if (this._mode === 'competition') {
      this._handleCompetitionKey(key);
    } else if (this._mode === 'training') {
      this._handleTrainingKey(key);
    } else if (this._mode === 'training-minutes' || this._mode === 'training-rounds' || this._mode === 'training-rest') {
      this._handleTrainingSubKey(key);
    } else if (this._mode && this._mode.startsWith('chainsaw-')) {
      this._handleChainsawKey(key);
    } else if (this._mode === 'credits') {
      if (key === '*' || key === 'ArrowRight') {
        // Hidden system menu: press * (or ring Right) twice
        this._creditsStarCount = (this._creditsStarCount || 0) + 1;
        if (this._creditsStarCount >= 2) {
          this._creditsStarCount = 0;
          this._mode = 'confirm-update';
          this._selIndex = 0;
          this._renderConfirmUpdate();
        }
      } else if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'StepUp' || key === 'StepDown') {
        this._creditsStarCount = 0;
      } else {
        this._creditsStarCount = 0;
        this._back();
      }
    } else if (this._mode === 'confirm-update') {
      if (key === 'ArrowUp' || key === 'ArrowDown') {
        this._selIndex = moveSelection(this._selIndex, key === 'ArrowUp' ? -1 : 1, 2);
        this._renderConfirmUpdate();
      } else if (key === '1' || (key === 'Enter' && this._selIndex === 0)) {
        // Installing restarts the timer: ask first, highlight on No
        this._mode = 'confirm-app-update';
        this._selIndex = 0;
        this._renderUpdateConfirm();
      } else if (key === '2' || (key === 'Enter' && this._selIndex === 1)) {
        this._performUpdate('/sync-schedule', t('maint.fetching'));
      } else {
        this._back();
      }
    } else if (this._mode === 'confirm-app-update') {
      if (key === 'ArrowUp' || key === 'ArrowDown') {
        this._selIndex = moveSelection(this._selIndex, key === 'ArrowUp' ? -1 : 1, 2);
        this._renderUpdateConfirm();
      } else if (key === '2' || (key === 'Enter' && this._selIndex === 1)) {
        this._performUpdate('/update', t('maint.downloading'));
      } else if (key === '1' || key === 'Enter') {
        this._back(); // "No"
      }
    } else if (this._mode === 'update-error') {
      // Any key goes back to where the update was started from
      this._back();
    }
  }

  // --- Main menu internals ---

  _handleMainMenuKey(key) {
    const items = this._mainMenuItems || [];
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      this._selIndex = moveSelection(this._selIndex, key === 'ArrowUp' ? -1 : 1, items.length);
      this._renderMainMenu();
      return;
    }
    let index = -1;
    if (key === 'Enter') index = this._selIndex;
    else if (key >= '1' && key <= '9') index = parseInt(key, 10) - 1;
    const item = items[index];
    if (!item) return;
    if (item.toggle) {
      // In-place setting: run the action and redraw so the note shows the new state
      item.action();
      this._renderMainMenu();
      return;
    }
    if (!item.submenu) this.closeOverlay();
    item.action();
  }

  /**
   * Flip the weekly-schedule features, persist it, and notify the listener.
   * @returns {boolean} the new enabled state
   */
  toggleSchedule() {
    const enabled = !APP_SETTINGS.scheduleEnabled;
    APP_SETTINGS.scheduleEnabled = enabled;
    try {
      localStorage.setItem('bjj-timer-schedule-enabled', String(enabled));
    } catch (e) {
      // localStorage unavailable — setting applies for this session only
    }
    if (this._onScheduleToggle) this._onScheduleToggle(enabled);
    return enabled;
  }

  /**
   * Flip the holiday decorations theme, persist it, and notify the listener.
   * @returns {boolean} the new enabled state
   */
  toggleHolidayTheme() {
    const enabled = !APP_SETTINGS.holidayThemeEnabled;
    APP_SETTINGS.holidayThemeEnabled = enabled;
    try {
      localStorage.setItem('bjj-timer-holiday-theme', String(enabled));
    } catch (e) {
      // localStorage unavailable — setting applies for this session only
    }
    if (this._onHolidayToggle) this._onHolidayToggle(enabled);
    return enabled;
  }

  /**
   * Flip quiet visuals (edge flash, steady outlines), persist it and apply
   * the body class. The class travels to the secondary with the snapshot.
   * @returns {boolean} the new enabled state
   */
  toggleQuietVisuals() {
    const enabled = !APP_SETTINGS.quietVisuals;
    APP_SETTINGS.quietVisuals = enabled;
    try {
      localStorage.setItem('bjj-timer-quiet-visuals', String(enabled));
    } catch (e) {
      // localStorage unavailable — setting applies for this session only
    }
    document.body.classList.toggle('quiet-visuals', enabled);
    return enabled;
  }

  /**
   * Flip the match scoreboard for competition presets, persist it and tell
   * the app to show or hide the panels.
   * @returns {boolean} the new enabled state
   */
  toggleScoreboard() {
    const enabled = !APP_SETTINGS.scoreboard;
    APP_SETTINGS.scoreboard = enabled;
    try {
      localStorage.setItem('bjj-timer-scoreboard', String(enabled));
    } catch (e) {
      // localStorage unavailable — setting applies for this session only
    }
    if (this._onScoreboardToggle) this._onScoreboardToggle(enabled);
    return enabled;
  }

  /**
   * Cycle the UI language (English → Portuguese → English), persist it and
   * tell the app to re-label what is on screen.
   * @returns {string} the language now in effect
   */
  toggleLanguage() {
    const i = LANGUAGES.indexOf(APP_SETTINGS.language);
    const next = setLanguage(LANGUAGES[(i + 1) % LANGUAGES.length]);
    if (this._onLanguageChange) this._onLanguageChange(next);
    return next;
  }

  _renderMainMenu() {
    if (!this.overlayEl) return;
    const _s = 'width="1.5em" height="1.5em" viewBox="0 0 24 24" style="vertical-align:-0.2em;"';
    const items = this._mainMenuItems || [];
    let rows = '';
    items.forEach((it, i) => {
      const sel = i === this._selIndex ? ' mg-sel' : '';
      const icon = it.icon && ICONS[it.icon] ? ICONS[it.icon](_s, '#aaa') : '';
      const note = typeof it.note === 'function' ? it.note() : it.note;
      rows += `<span class="mg-icon mg-first${sel}">${icon}</span>` +
              `<span class="mg-name${sel}">${escapeHtml(it.name)}</span>` +
              `<span class="mg-note mg-last${sel}">${note ? escapeHtml(note) : ''}</span>`;
    });
    this.overlayEl.innerHTML =
      `<div class="advanced-menu overlay-content">` +
        `<div class="menu-title">${t('menu.title')}</div>` +
        `<div class="menu-grid">${rows}</div>` +
      `</div>`;
    this.overlayEl.classList.add('active');
  }

  // --- Advanced Menu internals ---

  _handleCompetitionKey(key) {
    const presetNames = Object.keys(APP_SETTINGS.competitionPresets);
    // Row 0 is the Scoreboard toggle, the presets follow
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      this._selIndex = moveSelection(this._selIndex, key === 'ArrowUp' ? -1 : 1, presetNames.length + 1);
      this._renderCompetitionMenu();
      return;
    }
    if (key === 'Enter' && this._selIndex === 0) {
      this.toggleScoreboard();
      this._renderCompetitionMenu();
      return;
    }
    const presetIndex = key === 'Enter' ? this._selIndex - 1 : parseInt(key, 10);
    if (isNaN(presetIndex)) return;
    if (presetIndex >= 0 && presetIndex < presetNames.length) {
      const name = presetNames[presetIndex];
      const preset = APP_SETTINGS.competitionPresets[name];
      this._applyPreset(preset.roundDurationSec, preset.restDurationSec, preset.numRounds, name);
    }
  }

  _handleTrainingKey(key) {
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      this._selIndex = moveSelection(this._selIndex, key === 'ArrowUp' ? -1 : 1, TRAINING_MENU_ITEMS.length);
      this._renderTrainingMenu();
      return;
    }
    if (key === 'Enter') key = TRAINING_MENU_ITEMS[this._selIndex].key;
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
      case '/':
        this._mode = 'credits';
        this._renderCredits();
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

  // --- Training Preset internals ---

  _startTrainingPreset(mode) {
    this._trainingMode = mode;
    this._trainingTotalMinutes = 0;
    this._trainingRounds = TRAINING_DEFAULT_ROUNDS;
    // Calculate default minutes from remaining class time (nearest multiple of 5, rounded down)
    const remainingSec = this._getRemainingClassSec();
    this._trainingDefaultMinutes = remainingSec > 0 ? Math.floor(remainingSec / 60 / 5) * 5 : 0;
    if (this._trainingDefaultMinutes <= 0) this._trainingDefaultMinutes = TRAINING_DEFAULT_MINUTES;
    this._mode = 'training-minutes';
    this._inputBuffer = '';
    this._renderTrainingSubEntry(this._trainingPrompt(), '');
  }

  _handleTrainingSubKey(key) {
    // Rest is a duration: the MM:SS picker handles ◀▶ / ▲▼
    if (this._mode === 'training-rest' && this._handleDurationKey(key)) {
      this._renderTrainingSubEntry(this._trainingPrompt(), '');
      return;
    }
    if (key === 'Enter') {
      const raw = this._inputBuffer;
      // Allow empty input on minutes step to accept default
      if (this._mode === 'training-minutes' && raw === '') {
        this._trainingTotalMinutes = this._trainingDefaultMinutes;
        this._mode = 'training-rounds';
        this._inputBuffer = '';
        this._renderTrainingSubEntry(this._trainingPrompt(), '');
        return;
      }
      if (this._mode === 'training-rest') {
        this._lastTrainingRestSec = this._durSec;
        this._finishTrainingPreset(this._durSec);
        return;
      }
      // Allow empty input on rounds step to accept the default (remote: OK, OK)
      if (this._mode === 'training-rounds' && raw === '') {
        this._trainingRounds = TRAINING_DEFAULT_ROUNDS;
        this._enterTrainingRest();
        return;
      }
      if (!isNumeric(raw) || raw === '') {
        this._renderTrainingSubEntry(this._trainingPrompt(), t('wizard.enterNumber'));
        this._inputBuffer = '';
        return;
      }
      const value = parseInt(raw, 10);

      if (this._mode === 'training-minutes') {
        if (value < 1) {
          this._renderTrainingSubEntry(this._trainingPrompt(), t('wizard.min1minute'));
          this._inputBuffer = '';
          return;
        }
        this._trainingTotalMinutes = value;
        this._mode = 'training-rounds';
        this._inputBuffer = '';
        this._renderTrainingSubEntry(this._trainingPrompt(), '');
      } else if (this._mode === 'training-rounds') {
        if (value < 2) {
          this._renderTrainingSubEntry(this._trainingPrompt(), t('wizard.min2rounds'));
          this._inputBuffer = '';
          return;
        }
        this._trainingRounds = value;
        this._enterTrainingRest();
      }
    } else if (key === 'Clear') {
      this._inputBuffer = '';
      this._renderTrainingSubEntry(this._trainingPrompt(), '');
    } else if (key === 'Backspace') {
      this._inputBuffer = this._inputBuffer.slice(0, -1);
      this._renderTrainingSubEntry(this._trainingPrompt(), '');
    } else if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'StepUp' || key === 'StepDown') {
      // Ring steps the value; hold (StepUp/StepDown) takes bigger steps
      const dir = key === 'ArrowUp' || key === 'StepUp' ? 1 : -1;
      const big = key === 'StepUp' || key === 'StepDown';
      let base, step, min;
      if (this._mode === 'training-minutes') { base = this._trainingDefaultMinutes || TRAINING_DEFAULT_MINUTES; step = big ? 5 : 1; min = 1; }
      else { base = TRAINING_DEFAULT_ROUNDS; step = big ? 5 : 1; min = 2; }
      this._inputBuffer = stepNumericBuffer(this._inputBuffer, base, dir * step, min);
      this._renderTrainingSubEntry(this._trainingPrompt(), '');
    } else if (key >= '0' && key <= '9') {
      this._inputBuffer += key;
      this._renderTrainingSubEntry(this._trainingPrompt(), '');
    }
  }

  _enterTrainingRest() {
    this._mode = 'training-rest';
    this._inputBuffer = '';
    this._startDuration(this._lastTrainingRestSec);
    this._renderTrainingSubEntry(this._trainingPrompt(), '');
  }

  // --- Duration picker (shared by every MM:SS prompt) ---

  /**
   * Begin editing a duration with the same control as the main page:
   * ◀▶ pick minutes or seconds, ▲▼ adjust (minutes ±1, seconds ±5),
   * held ring ×5 / ×3. The selected group blinks like time-setting mode.
   * @param {number} sec - Starting value
   */
  _startDuration(sec) {
    this._durSec = Math.max(0, sec | 0);
    this._durField = 'min';
  }

  /**
   * Handle a navigation / adjustment key for the duration picker.
   * @returns {boolean} true when the key was consumed (caller re-renders)
   */
  _handleDurationKey(key) {
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      this._durField = this._durField === 'min' ? 'sec' : 'min';
      return true;
    }
    if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'StepUp' || key === 'StepDown' || key === '+' || key === '-') {
      const dir = key === 'ArrowUp' || key === 'StepUp' || key === '+' ? 1 : -1;
      const big = key === 'StepUp' || key === 'StepDown';
      let mins = Math.floor(this._durSec / 60);
      let secs = this._durSec % 60;
      if (this._durField === 'min') {
        mins = Math.min(30, Math.max(0, mins + dir * (big ? 5 : 1)));
      } else {
        secs = (((secs + dir * (big ? 15 : 5)) % 60) + 60) % 60; // wraps 55 → 0 → 55
      }
      this._durSec = mins * 60 + secs;
      return true;
    }
    return false;
  }

  /**
   * Render the duration picker, styled like the main round / rest box.
   * @param {'round'|'rest'} kind
   */
  _renderDurationControl(kind) {
    const mins = String(Math.floor(this._durSec / 60)).padStart(2, '0');
    const secs = String(this._durSec % 60).padStart(2, '0');
    const minSel = this._durField === 'min';
    return `<div class="overlay-duration-wrap">` +
      `<div class="overlay-duration dur-${kind} time-setting-${minSel ? 'minutes' : 'seconds'}">` +
      `<span class="ts-minutes">${mins}</span>:<span class="ts-seconds">${secs}</span></div>` +
      `<div class="overlay-duration-labels">` +
        `<span class="${minSel ? 'dur-label-sel' : ''}">${t('wizard.minutes')}</span>` +
        `<span class="${minSel ? '' : 'dur-label-sel'}">${t('wizard.seconds')}</span>` +
      `</div></div>`;
  }

  /**
   * Shared wizard frame: fixed-size box, title, prompt, body, error, hint.
   */
  _renderWizard(titleHtml, prompt, bodyHtml, errorMsg, step) {
    if (!this.overlayEl) return;
    const stepHtml = step ? `<span class="overlay-wizard-step">${t('wizard.step', { n: step[0], m: step[1] })}</span>` : '';
    this.overlayEl.innerHTML =
      `<div class="overlay-content overlay-wizard">` +
      `<div class="overlay-wizard-title">${titleHtml}${stepHtml}</div>` +
      `<div class="overlay-prompt">${prompt}</div>` +
      `<div class="overlay-wizard-body">${bodyHtml}</div>` +
      `<div class="overlay-error">${errorMsg}</div>` +
      `<div class="overlay-wizard-nav">${step && step[0] > 1 ? t('wizard.prev') : t('wizard.back')} · ${t('wizard.nav')}</div>` +
      `</div>`;
    this.overlayEl.classList.add('active');
  }

  /** Big numeric display for counts (minutes total, rounds). */
  _renderNumberControl(display, dim) {
    return `<div class="overlay-input${dim ? ' overlay-input-dim' : ''}">${display}</div>` +
      (dim ? `<div class="overlay-default-note">${t('wizard.suggested')}</div>` : '');
  }

  /** Training wizard step index for the current mode. */
  _trainingStep() {
    return [{ 'training-minutes': 1, 'training-rounds': 2, 'training-rest': 3 }[this._mode] || 1, 3];
  }

  /** Chainsaw wizard step index for the current mode. */
  _chainsawStep() {
    const order = ['chainsaw-odd-round', 'chainsaw-odd-rest', 'chainsaw-even-round', 'chainsaw-even-rest', 'chainsaw-rounds'];
    return [Math.max(0, order.indexOf(this._mode)) + 1, order.length];
  }

  _renderTrainingSubEntry(prompt, errorMsg) {
    if (!this.overlayEl) return;
    const mode = TRAINING_MODES[this._trainingMode] || TRAINING_MODES.ladder_down;
    const _s = 'width="1.5em" height="1.5em" viewBox="0 0 24 24" style="vertical-align:-0.25em;margin-right:0.4em;"';
    const title = `${ICONS[mode.icon](_s)}${escapeHtml(presetDisplayName(mode.label))}`;
    if (this._mode === 'training-rest') {
      this._renderWizard(title, prompt, this._renderDurationControl('rest'), errorMsg, this._trainingStep());
      return;
    }
    // Empty input shows the value OK would accept, marked as suggested
    let display = this._inputBuffer;
    let dim = false;
    if (!display) {
      dim = true;
      if (this._mode === 'training-minutes') display = String(this._trainingDefaultMinutes || TRAINING_DEFAULT_MINUTES);
      else display = String(TRAINING_DEFAULT_ROUNDS);
    }
    this._renderWizard(title, prompt, this._renderNumberControl(display, dim), errorMsg, this._trainingStep());
  }

  _trainingPrompt() {
    if (this._mode === 'training-minutes') return t('wizard.totalMinutes');
    if (this._mode === 'training-rounds') return t('wizard.howManyRounds');
    return t('wizard.restBetween');
  }

  _finishTrainingPreset(restSec) {
    const availableSec = this._trainingTotalMinutes * 60;

    const totalRestSec = (this._trainingRounds - 1) * restSec;
    // Rounds snap to a 30s minimum each — if rest eats the budget the plan would
    // silently exceed the requested total, so reject and re-prompt instead.
    if (availableSec - totalRestSec < this._trainingRounds * 30) {
      this._renderTrainingSubEntry(this._trainingPrompt(), t('wizard.restTooLong'));
      this._inputBuffer = '';
      return;
    }
    const totalTrainingSec = Math.max(availableSec - totalRestSec, this._trainingRounds); // at least 1s per round

    const durations = generateRoundDurations(this._trainingMode, this._trainingRounds, totalTrainingSec);

    // Build config update with training data
    const cfg = { ...this._advancedConfig };
    cfg.restDurationSec = restSec;
    cfg.numRounds = this._trainingRounds;
    cfg.roundDurations = durations;
    cfg.presetName = (TRAINING_MODES[this._trainingMode] || TRAINING_MODES.ladder_down).label;

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
    this._chainsawStepDone = {};
    this._startDuration(CHAINSAW_DEFAULT_ROUND_SEC);
    this._renderChainsawEntry(this._chainsawPrompt(), '');
  }

  _chainsawIsDurationStep() {
    return this._mode === 'chainsaw-odd-round' || this._mode === 'chainsaw-odd-rest' ||
      this._mode === 'chainsaw-even-round' || this._mode === 'chainsaw-even-rest';
  }

  _handleChainsawKey(key) {
    if (this._chainsawIsDurationStep()) {
      if (this._handleDurationKey(key)) {
        this._renderChainsawEntry(this._chainsawPrompt(), '');
        return;
      }
      if (key !== 'Enter') return;
      const sec = this._durSec;
      const done = this._chainsawStepDone;
      done[this._mode] = true;
      // A step already confirmed once (then revisited with Menu) keeps its value
      const startFrom = (mode, stored, fallback) => this._startDuration(done[mode] ? stored : fallback);
      if (this._mode === 'chainsaw-odd-round') {
        if (sec === 0) { this._renderChainsawEntry(this._chainsawPrompt(), t('chainsaw.needDuration')); return; }
        this._chainsawOddRoundSec = sec;
        this._mode = 'chainsaw-odd-rest';
        startFrom(this._mode, this._chainsawOddRestSec, CHAINSAW_DEFAULT_REST_SEC);
      } else if (this._mode === 'chainsaw-odd-rest') {
        this._chainsawOddRestSec = sec;
        this._mode = 'chainsaw-even-round';
        startFrom(this._mode, this._chainsawEvenRoundSec, this._chainsawOddRoundSec); // even round starts from odd round
      } else if (this._mode === 'chainsaw-even-round') {
        if (sec === 0) { this._renderChainsawEntry(this._chainsawPrompt(), t('chainsaw.needDuration')); return; }
        this._chainsawEvenRoundSec = sec;
        this._mode = 'chainsaw-even-rest';
        startFrom(this._mode, this._chainsawEvenRestSec, this._chainsawOddRestSec); // even rest starts from odd rest
      } else {
        this._chainsawEvenRestSec = sec;
        // Calculate default rounds from remaining class time
        this._chainsawDefaultRounds = this._calcChainsawDefaultRounds() || TRAINING_DEFAULT_ROUNDS;
        this._mode = 'chainsaw-rounds';
        this._inputBuffer = '';
      }
      this._renderChainsawEntry(this._chainsawPrompt(), '');
      return;
    }

    // Rounds step: a plain count
    if (key === 'Enter') {
      const raw = this._inputBuffer;
      if (raw === '') {
        this._finishChainsaw(this._chainsawEvenRestSec, this._chainsawDefaultRounds || TRAINING_DEFAULT_ROUNDS);
        return;
      }
      if (!isNumeric(raw) || raw === '') {
        this._renderChainsawEntry(this._chainsawPrompt(), t('chainsaw.enterNumber'));
        this._inputBuffer = '';
        return;
      }
      const rounds = parseInt(raw, 10);
      if (rounds < 1) {
        this._renderChainsawEntry(this._chainsawPrompt(), t('chainsaw.min1round'));
        this._inputBuffer = '';
        return;
      }
      this._finishChainsaw(this._chainsawEvenRestSec, rounds);
    } else if (key === 'Clear') {
      this._inputBuffer = '';
      this._renderChainsawEntry(this._chainsawPrompt(), '');
    } else if (key === 'Backspace') {
      this._inputBuffer = this._inputBuffer.slice(0, -1);
      this._renderChainsawEntry(this._chainsawPrompt(), '');
    } else if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'StepUp' || key === 'StepDown') {
      const dir = key === 'ArrowUp' || key === 'StepUp' ? 1 : -1;
      const big = key === 'StepUp' || key === 'StepDown';
      this._inputBuffer = stepNumericBuffer(this._inputBuffer, this._chainsawDefaultRounds || TRAINING_DEFAULT_ROUNDS, dir * (big ? 5 : 1), 1);
      this._renderChainsawEntry(this._chainsawPrompt(), '');
    } else if (key >= '0' && key <= '9') {
      this._inputBuffer += key;
      this._renderChainsawEntry(this._chainsawPrompt(), '');
    }
  }

  _chainsawPrompt() {
    if (this._mode === 'chainsaw-odd-round') return t('chainsaw.oddRound');
    if (this._mode === 'chainsaw-odd-rest') return t('chainsaw.oddRest');
    if (this._mode === 'chainsaw-even-round') return t('chainsaw.evenRound');
    if (this._mode === 'chainsaw-even-rest') return t('chainsaw.evenRest');
    return t('chainsaw.rounds');
  }

  _renderChainsawEntry(prompt, errorMsg) {
    if (!this.overlayEl) return;
    const title = ICONS.chainsaw('width="1.5em" height="1.5em" viewBox="0 0 24 24" style="vertical-align:-0.25em;margin-right:0.4em;"') + escapeHtml(presetDisplayName('Chainsaw'));
    if (this._chainsawIsDurationStep()) {
      const kind = this._mode === 'chainsaw-odd-round' || this._mode === 'chainsaw-even-round' ? 'round' : 'rest';
      this._renderWizard(title, prompt, this._renderDurationControl(kind), errorMsg, this._chainsawStep());
      return;
    }
    let display = this._inputBuffer;
    let dim = false;
    if (!display) {
      dim = true;
      display = String(this._chainsawDefaultRounds || TRAINING_DEFAULT_ROUNDS);
    }
    this._renderWizard(title, prompt, this._renderNumberControl(display, dim), errorMsg, this._chainsawStep());
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
    if (typeof this.remainingClassSecProvider !== 'function') return 0;
    const sec = this.remainingClassSecProvider();
    return Number.isFinite(sec) && sec > 0 ? sec : 0;
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
    const presetNames = Object.keys(APP_SETTINGS.competitionPresets);
    let rows = '';
    // Header row
    rows += `<span></span><span></span>` +
            `<span class="mg-note" style="color:var(--text-round);font-weight:700;">${t('label.round')}</span>` +
            `<span class="mg-note" style="color:var(--text-rest);font-weight:700;">${t('label.rest')}</span>`;
    const tsel = this._selIndex === 0 ? ' mg-sel' : '';
    rows += `<span class="mg-icon mg-first${tsel}">${ICONS.trophy(_s)}</span>` +
            `<span class="mg-name${tsel}">${escapeHtml(t('menu.scoreboard'))}</span>` +
            `<span class="mg-note${tsel}">${APP_SETTINGS.scoreboard ? t('menu.on') : t('menu.off')}</span>` +
            `<span class="mg-note mg-last${tsel}"></span>`;
    presetNames.forEach((name, i) => {
      const p = APP_SETTINGS.competitionPresets[name];
      const icon = presetIcon(name, _s) || ICONS.belt(_s, '#aaa');
      const sel = i + 1 === this._selIndex ? ' mg-sel' : '';
      rows += `<span class="mg-icon mg-first${sel}">${icon}</span>` +
              `<span class="mg-name${sel}">${escapeHtml(presetDisplayName(name))}</span>` +
              `<span class="mg-note${sel}" style="color:var(--text-round);">${formatTime(p.roundDurationSec)}</span>` +
              `<span class="mg-note mg-last${sel}" style="color:var(--text-rest);">${formatTime(p.restDurationSec)}</span>`;
    });

    this.overlayEl.innerHTML =
      `<div class="advanced-menu overlay-content">` +
        `<div class="menu-title">${t('competition.title')}</div>` +
        `<div class="menu-grid-5">${rows}</div>` +
      `</div>`;
    this.overlayEl.classList.add('active');
  }

  _renderTrainingMenu() {
    if (!this.overlayEl) return;

    const _s = 'width="1.5em" height="1.5em" viewBox="0 0 24 24" style="vertical-align:-0.2em;"';
    let rows = '';
    TRAINING_MENU_ITEMS.forEach((it, i) => {
      const sel = i === this._selIndex ? ' mg-sel' : '';
      rows += `<span class="mg-icon mg-first${sel}">${ICONS[it.icon](_s)}</span>` +
              `<span class="mg-name${sel}">${escapeHtml(presetDisplayName(it.name))}</span>` +
              `<span class="mg-note mg-last${sel}">${escapeHtml(t('note.' + it.name))}</span>`;
    });

    this.overlayEl.innerHTML =
      `<div class="advanced-menu overlay-content">` +
        `<div class="menu-title">${t('training.title')}</div>` +
        `<div class="menu-grid">${rows}</div>` +
      `</div>`;
    this.overlayEl.classList.add('active');
  }

  _renderCredits() {
    if (!this.overlayEl) return;
    this._creditsStarCount = 0;
    this._updateOrigin = 'credits'; // Maintenance reached from here returns here
    this.overlayEl.innerHTML =
      `<div class="overlay-content" style="text-align:center;">` +
        `<div style="margin-bottom:2vh;">` +
          `<img src="paco.png" alt="Paco" style="width:clamp(6rem,15vw,12rem);height:clamp(6rem,15vw,12rem);border-radius:50%;object-fit:cover;border:3px solid rgba(255,255,255,0.2);">` +
        `</div>` +
        `<div style="font-size:clamp(1.5rem,3.5vw,3.5rem);color:var(--text-primary);margin-bottom:3vh;">${t('credits.title')}</div>` +
        `<div style="font-size:clamp(1rem,2vw,2rem);color:var(--text-label);display:grid;grid-template-columns:auto 1fr;gap:0.8vh 1.5vw;text-align:left;">` +
          `<span style="color:var(--accent-green);font-weight:700;">Paco</span><span>${t('credits.good')}</span>` +
          `<span style="color:var(--accent-green);font-weight:700;">Reevu</span><span>${t('credits.hard')}</span>` +
          `<span style="color:var(--accent-green);font-weight:700;">Vy</span><span>${t('credits.ugly')}</span>` +
        `</div>` +
      `</div>`;
    this.overlayEl.classList.add('active');
  }

  _renderConfirmUpdate() {
    if (!this.overlayEl) return;
    const sel = (i) => i === this._selIndex ? ' mg-sel' : '';
    this.overlayEl.innerHTML =
      `<div class="advanced-menu overlay-content" style="text-align:center;">` +
        `<div class="menu-title">${t('maint.title')}</div>` +
        `<div class="menu-grid" style="grid-template-columns:1fr;margin-bottom:1vh;">` +
          `<span class="mg-name mg-first mg-last${sel(0)}">${t('maint.install')}</span>` +
          `<span class="mg-name mg-first mg-last${sel(1)}">${t('maint.sync')}</span>` +
        `</div>` +
      `</div>`;
    this.overlayEl.classList.add('active');
  }

  /**
   * Trigger a server action (git pull or sync schedule).
   * @param {string} endpoint - '/update' or '/sync-schedule'
   * @param {string} description - Display text for the progress screen
   */
  _renderUpdateConfirm() {
    if (!this.overlayEl) return;
    const sel = (i) => i === this._selIndex ? ' mg-sel' : '';
    this.overlayEl.innerHTML =
      `<div class="advanced-menu overlay-content" style="text-align:center;">` +
        `<div class="menu-title" style="margin-bottom:1vh;">${t('maint.confirmTitle')}</div>` +
        `<div class="menu-body">${t('maint.confirmBody')}</div>` +
        `<div class="menu-grid" style="grid-template-columns:1fr;margin-bottom:1vh;">` +
          `<span class="mg-name mg-first mg-last${sel(0)}">${t('confirm.no')}</span>` +
          `<span class="mg-name mg-first mg-last${sel(1)}">${t('maint.yes')}</span>` +
        `</div>` +
      `</div>`;
    this.overlayEl.classList.add('active');
  }

  _performUpdate(endpoint, description) {
    if (!navigator.onLine) {
      this._showUpdateError(t('maint.noWifi'));
      return;
    }

    this._mode = 'updating';
    if (!this.overlayEl) return;
    this.overlayEl.innerHTML =
      `<div class="overlay-content" style="text-align:center;">` +
        `<div style="font-size:clamp(1.5rem,3.5vw,3.5rem);color:var(--text-primary);margin-bottom:3vh;">${t('maint.updating')}</div>` +
        `<div style="font-size:clamp(1rem,2vw,2rem);color:var(--text-muted);">${escapeHtml(description)}</div>` +
        `<div style="margin-top:3vh;">` +
          `<div style="width:clamp(10rem,30vw,20rem);height:4px;background:rgba(255,255,255,0.1);border-radius:2px;margin:0 auto;overflow:hidden;">` +
            `<div style="width:100%;height:100%;background:var(--accent-green);border-radius:2px;animation:progress-bar 2s ease-in-out infinite;"></div>` +
          `</div>` +
        `</div>` +
      `</div>`;

    // Add progress bar animation
    if (!document.getElementById('update-progress-style')) {
      const style = document.createElement('style');
      style.id = 'update-progress-style';
      style.textContent = `@keyframes progress-bar { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }`;
      document.head.appendChild(style);
    }

    // Abort if the server hangs — otherwise the 'updating' overlay swallows all
    // keys forever and only a manual page reload recovers the kiosk.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    fetch(`http://localhost:3001${endpoint}`, {
      method: 'POST',
      headers: { 'X-Update-Request': APP_SETTINGS.relay.sharedKey },
      signal: controller.signal
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          const done = endpoint === '/update' ? t('maint.installed') : t('maint.synced');
          this.overlayEl.innerHTML =
            `<div class="overlay-content" style="text-align:center;">` +
              `<div style="font-size:clamp(1.5rem,3.5vw,3.5rem);color:var(--accent-green);margin-bottom:2vh;">✓ ${done}</div>` +
              `<div style="margin-top:2vh;font-size:clamp(1rem,2vw,2rem);color:var(--text-label);">${t('maint.restarting')}</div>` +
            `</div>`;
          setTimeout(() => window.location.reload(), 1500);
        } else {
          this._showUpdateError(data.error || t('maint.unknown'));
        }
      })
      .catch(err => {
        this._showUpdateError(err.name === 'AbortError' ? t('maint.timeout') : (err.message || t('maint.connFailed')));
      })
      .finally(() => clearTimeout(timeoutId));
  }

  _showUpdateError(message) {
    this._mode = 'update-error';
    if (!this.overlayEl) return;
    this.overlayEl.innerHTML =
      `<div class="overlay-content" style="text-align:center;">` +
        `<div style="font-size:clamp(1.5rem,3.5vw,3.5rem);color:var(--accent-red);margin-bottom:2vh;">${t('maint.failed')}</div>` +
        `<div style="font-size:clamp(0.9rem,1.8vw,1.8rem);color:var(--text-muted);max-width:60vw;word-break:break-word;">${escapeHtml(message)}</div>` +
        `<div style="margin-top:3vh;font-size:clamp(0.8rem,1.5vw,1.5rem);color:var(--text-muted);">${t('maint.menuReturn')}</div>` +
      `</div>`;
  }

  showSchedule(schedule) {
    this._open = true;
    this._mode = 'schedule';
    this._scheduleData = schedule;
    const jsDay = new Date().getDay(); // 0 = Sunday
    this._scheduleDay = jsDay === 0 ? 6 : jsDay - 1; // Monday-first column
    this._renderSchedule();
  }

  _renderSchedule() {
    if (!this.overlayEl) return;
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const dayAbbr = {};
    days.forEach(d => { dayAbbr[d] = t('dayAbbr.' + d); });
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

    const jsDay = new Date().getDay();
    const todayIdx = jsDay === 0 ? 6 : jsDay - 1;
    const selIdx = Math.min(6, Math.max(0, this._scheduleDay | 0));
    let cols = '';
    days.forEach((d, i) => {
      let cells = '';
      byDay[d].forEach(e => {
        cells += `<div class="sched-class">`
          + `<span class="sched-time">${fmt(e.startTime)} - ${fmt(e.endTime)}</span>`
          + `<span class="sched-title">${escapeHtml(classDisplayName(e.title))}</span>`
          + `</div>`;
      });
      if (!byDay[d].length) cells = `<div class="sched-class sched-empty">${t('sched.empty')}</div>`;
      const cls = 'sched-day' + (i === selIdx ? ' sched-sel' : '') + (i === todayIdx ? ' sched-today' : '');
      cols += `<div class="${cls}"><div class="sched-day-name">${dayAbbr[d]}</div>${cells}</div>`;
    });

    // Selected day in large type (◀▶ moves the selection; starts on today)
    const selDay = days[selIdx];
    let detail = '';
    byDay[selDay].forEach(e => {
      detail += `<div class="sched-detail-row">`
        + `<span class="sched-detail-time">${fmt(e.startTime)} - ${fmt(e.endTime)}</span>`
        + `<span class="sched-detail-title">${escapeHtml(classDisplayName(e.title))}</span>`
        + `</div>`;
    });
    if (!byDay[selDay].length) detail = `<div class="sched-detail-row sched-detail-none">${t('sched.noClasses')}</div>`;

    this.overlayEl.innerHTML =
      `<div class="schedule-overlay overlay-content">`
      + `<div class="schedule-title">${t('sched.title')}</div>`
      + `<div class="schedule-grid">${cols}</div>`
      + `<div class="sched-detail">`
      + `<div class="sched-detail-day">◀ ${t('day.' + selDay)}${selIdx === todayIdx ? ` · ${t('sched.today')}` : ''} ▶</div>`
      + detail
      + `</div>`
      + `</div>`;
    this.overlayEl.classList.add('active');
  }



}

// --- Scoreboard ---

/** Field order the ring walks: ◀ goes down the list index, ▶ up. */
const SCORE_FIELDS = ['bluePen', 'blueAdv', 'bluePoints', 'whitePoints', 'whiteAdv', 'whitePen'];
const SCORE_HOME = { blue: 2, white: 3 };
const SCORE_BURST_MS = 2000;

/**
 * IBJJF-style match score for one competition round: points, advantages and
 * penalties per side, a cursor over the six fields and a short-lived
 * "burst" superscript showing the net change of the last few presses.
 * Pure state plus a render into the static #scoreboard markup, so the
 * second TV mirrors it through the ordinary snapshot.
 */
class Scoreboard {
  /**
   * @param {HTMLElement|null} rootEl - The #scoreboard element (may be null in tests)
   */
  constructor(rootEl) {
    this.rootEl = rootEl;
    this._burstTimer = null;
    this.reset();
  }

  /** Back to 0-0 with the cursor on Blue points. */
  reset() {
    this.values = {};
    for (const f of SCORE_FIELDS) this.values[f] = 0;
    this.focus = SCORE_HOME.blue;
    this._clearBurst();
    this.render();
  }

  get focusField() { return SCORE_FIELDS[this.focus]; }

  /** ◀ / ▶: one field along the ring order, stopping at the ends. */
  move(dir) {
    this.focus = Math.max(0, Math.min(SCORE_FIELDS.length - 1, this.focus + dir));
    this.render();
  }

  /** ▲ / ▼: +1 / -1 on the focused value (floor 0); ADV / PEN changes send the cursor home. */
  adjust(delta) {
    const field = this.focusField;
    const next = Math.max(0, this.values[field] + delta);
    const applied = next - this.values[field];
    this.values[field] = next;
    if (this.burst && this.burst.field === field) this.burst.delta += applied;
    else this.burst = { field, delta: applied };
    this.burst.seq = (this._burstSeq = (this._burstSeq || 0) + 1); // every press restarts the fade
    if (this._burstTimer) clearTimeout(this._burstTimer);
    this._burstTimer = setTimeout(() => { this._burstTimer = null; this.burst = null; this.render(); }, SCORE_BURST_MS);
    if (!field.endsWith('Points')) this.focus = field.startsWith('blue') ? SCORE_HOME.blue : SCORE_HOME.white;
    this.render();
    return applied !== 0;
  }

  /** Handle a normalised ring key. Returns true when consumed. */
  handleKey(key) {
    switch (key) {
      case 'ArrowLeft': this.move(-1); return true;
      case 'ArrowRight': this.move(1); return true;
      case 'ArrowUp': this.adjust(1); return true;
      case 'ArrowDown': this.adjust(-1); return true;
      default: return false;
    }
  }

  _clearBurst() {
    if (this._burstTimer) { clearTimeout(this._burstTimer); this._burstTimer = null; }
    this.burst = null;
  }

  destroy() { this._clearBurst(); }

  render() {
    if (!this.rootEl) return;
    const labels = { Points: t('score.points'), Adv: t('score.adv'), Pen: t('score.pen') };
    this.rootEl.querySelectorAll('.sb-field').forEach(el => {
      const field = el.dataset.field;
      const value = el.querySelector('.sb-value');
      const text = String(this.values[field]);
      if (value.textContent !== text) value.textContent = text;
      const label = el.querySelector('.sb-label');
      const kind = field.replace(/^(blue|white)/, '');
      if (label.textContent !== labels[kind]) label.textContent = labels[kind];
      el.classList.toggle('sb-focus', field === this.focusField);
      el.classList.toggle('sb-pen-hot', kind === 'Pen' && this.values[field] > 0);
      const sup = el.querySelector('.sb-sup');
      const burstText = this.burst && this.burst.field === field
        ? (this.burst.delta > 0 ? '+' + this.burst.delta : String(this.burst.delta)) : '';
      if (sup.textContent !== burstText) sup.textContent = burstText;
      if (burstText === '') {
        sup.classList.remove('show');
        delete sup.dataset.seq;
      } else if (sup.dataset.seq !== String(this.burst.seq)) {
        // Restart the CSS fade so it runs from the latest press, not the first
        sup.classList.remove('show');
        void sup.offsetWidth;
        sup.dataset.seq = String(this.burst.seq);
        sup.classList.add('show');
      }
    });
  }
}

// --- TetrisGame ---

const TETRIS_COLS = 10;
const TETRIS_ROWS = 20;
const TETRIS_SHAPES = {
  I: [[1, 1, 1, 1]],
  O: [[1, 1], [1, 1]],
  T: [[0, 1, 0], [1, 1, 1]],
  S: [[0, 1, 1], [1, 1, 0]],
  Z: [[1, 1, 0], [0, 1, 1]],
  J: [[1, 0, 0], [1, 1, 1]],
  L: [[0, 0, 1], [1, 1, 1]]
};
const TETRIS_LINE_SCORES = [0, 100, 300, 500, 800];
const TETRIS_SCORES_KEY = 'bjj-timer-tetris-scores';
const TETRIS_SCORES_MAX = 5;
const TETRIS_RANKS = ['1ST', '2ND', '3RD', '4TH', '5TH'];
const TETRIS_NAME_LENGTH = 3;
const TETRIS_NAME_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ';
const TETRIS_DEFAULT_NAME = 'AAA';

/** Three characters from TETRIS_NAME_CHARS, upper-cased and padded with spaces. */
function normalizeTetrisName(name) {
  const chars = String(name == null ? '' : name).toUpperCase().split('')
    .filter(ch => TETRIS_NAME_CHARS.includes(ch)).slice(0, TETRIS_NAME_LENGTH);
  while (chars.length < TETRIS_NAME_LENGTH) chars.push(' ');
  return chars.join('');
}

/**
 * High scores kept in localStorage: at most TETRIS_SCORES_MAX entries,
 * best first. Missing, corrupted or unavailable storage reads as empty.
 * @returns {{score: number, lines: number, date: string}[]}
 */
function loadTetrisScores() {
  try {
    const list = JSON.parse(readStorage(TETRIS_SCORES_KEY) || '[]');
    if (!Array.isArray(list)) return [];
    return list
      .filter(e => e && Number.isFinite(e.score) && e.score > 0)
      .map(e => ({ name: normalizeTetrisName(e.name), score: Math.floor(e.score), lines: Number.isFinite(e.lines) ? Math.floor(e.lines) : 0, date: typeof e.date === 'string' ? e.date : '' }))
      .sort((a, b) => b.score - a.score)
      .slice(0, TETRIS_SCORES_MAX);
  } catch (e) {
    return [];
  }
}

function saveTetrisScores(list) {
  try { localStorage.setItem(TETRIS_SCORES_KEY, JSON.stringify(list)); } catch (e) { /* storage unavailable */ }
}

/**
 * Insert a finished game into the table. Ties keep the older entry ahead.
 * @returns {{scores: object[], rank: number}} rank is the 0-based row of the new entry, or -1 when it did not make the table
 */
function recordTetrisScore(list, entry) {
  if (!entry || !(entry.score > 0)) return { scores: list.slice(), rank: -1 };
  let rank = list.findIndex(e => entry.score > e.score);
  if (rank === -1) rank = list.length;
  if (rank >= TETRIS_SCORES_MAX) return { scores: list.slice(), rank: -1 };
  const scores = list.slice();
  scores.splice(rank, 0, entry);
  return { scores: scores.slice(0, TETRIS_SCORES_MAX), rank };
}

/**
 * A deliberately small Tetris rendered as a grid of divs (so it mirrors to
 * the second TV like every other overlay) and driven by the remote. Paco
 * sits in the corner and barks whenever a line clears.
 */
class TetrisGame {
  /**
   * @param {HTMLElement} rootEl - Container to render into
   * @param {{onLines?: function(number), random?: function(): number}} [opts]
   */
  constructor(rootEl, opts) {
    this.rootEl = rootEl;
    this.onLines = (opts && opts.onLines) || (() => {});
    this._random = (opts && opts.random) || Math.random;
    this._timerId = null;
    this._barkTimer = null;
    this._now = (opts && opts.now) || (() => new Date());
    this.highScores = loadTetrisScores();
    this.newRank = -1;
    this.entering = false;
    this.reset();
  }

  reset() {
    this.board = Array.from({ length: TETRIS_ROWS }, () => new Array(TETRIS_COLS).fill(''));
    this.score = 0;
    this.lines = 0;
    this.over = false;
    this.paused = false;
    this.newRank = -1;
    this.entering = false;
    this.next = this._randomPiece();
    this._spawn();
  }

  get level() { return Math.floor(this.lines / 10) + 1; }
  get interval() { return Math.max(120, 800 - (this.level - 1) * 70); }

  _randomPiece() {
    const types = Object.keys(TETRIS_SHAPES);
    const type = types[Math.floor(this._random() * types.length) % types.length];
    return { type, shape: TETRIS_SHAPES[type].map(r => r.slice()) };
  }

  _spawn() {
    const piece = this.next;
    this.next = this._randomPiece();
    this.cur = { type: piece.type, shape: piece.shape, x: Math.floor((TETRIS_COLS - piece.shape[0].length) / 2), y: 0 };
    if (this._collides(this.cur.shape, this.cur.x, this.cur.y)) {
      this.over = true;
      this.stop();
      this._recordHighScore();
    }
  }

  /**
   * Game over: when the score makes the table, insert it and open arcade
   * initials entry (▲▼ letter, ◀▶ position, OK confirm). The row is saved
   * once the name is confirmed, or with whatever was typed if the player
   * quits mid-entry.
   */
  _recordHighScore() {
    const entry = { name: TETRIS_DEFAULT_NAME, score: this.score, lines: this.lines, date: this._now().toISOString().slice(0, 10) };
    const { scores, rank } = recordTetrisScore(this.highScores, entry);
    this.newRank = rank;
    if (rank >= 0) {
      this.highScores = scores;
      this.entering = true;
      this.nameChars = TETRIS_DEFAULT_NAME.split('');
      this.namePos = 0;
    }
  }

  _handleNameKey(key) {
    const step = (dir) => {
      const i = TETRIS_NAME_CHARS.indexOf(this.nameChars[this.namePos]);
      const n = TETRIS_NAME_CHARS.length;
      this.nameChars[this.namePos] = TETRIS_NAME_CHARS[(i + dir + n) % n];
    };
    switch (key) {
      case 'ArrowUp': step(1); break;
      case 'ArrowDown': step(-1); break;
      case 'ArrowLeft': this.namePos = Math.max(0, this.namePos - 1); break;
      case 'ArrowRight': this.namePos = Math.min(TETRIS_NAME_LENGTH - 1, this.namePos + 1); break;
      case 'Enter': this._commitName(); break;
      default: return;
    }
    this.render();
  }

  /** Store the typed initials on the new row and persist the table. */
  _commitName() {
    if (!this.entering) return;
    this.entering = false;
    const row = this.highScores[this.newRank];
    if (row) row.name = normalizeTetrisName(this.nameChars.join(''));
    saveTetrisScores(this.highScores);
  }

  _collides(shape, x, y) {
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        const bx = x + c, by = y + r;
        if (bx < 0 || bx >= TETRIS_COLS || by >= TETRIS_ROWS) return true;
        if (by >= 0 && this.board[by][bx]) return true;
      }
    }
    return false;
  }

  /** Start (or restart after game over) the falling timer. */
  start() {
    if (this.over) this.reset();
    this.paused = false;
    this._schedule();
    this.render();
  }

  stop() {
    this._commitName();
    if (this._timerId !== null) { clearInterval(this._timerId); this._timerId = null; }
    if (this._barkTimer) { clearTimeout(this._barkTimer); this._barkTimer = null; }
  }

  _schedule() {
    if (this._timerId !== null) clearInterval(this._timerId);
    this._timerId = setInterval(() => this.tick(), this.interval);
  }

  togglePause() {
    if (this.over) return;
    this.paused = !this.paused;
    if (this.paused) { clearInterval(this._timerId); this._timerId = null; } else this._schedule();
    this.render();
  }

  move(dx) {
    if (this.over || this.paused) return;
    if (!this._collides(this.cur.shape, this.cur.x + dx, this.cur.y)) { this.cur.x += dx; this.render(); }
  }

  rotate() {
    if (this.over || this.paused) return;
    const s = this.cur.shape;
    const rotated = s[0].map((_, c) => s.map(row => row[c]).reverse());
    // Try in place, then nudged left / right (wall kick)
    for (const dx of [0, -1, 1, -2, 2]) {
      if (!this._collides(rotated, this.cur.x + dx, this.cur.y)) {
        this.cur.shape = rotated; this.cur.x += dx; this.render(); return;
      }
    }
  }

  /** One step down; locks the piece when it cannot move. */
  tick() {
    if (this.over || this.paused) return;
    if (!this._collides(this.cur.shape, this.cur.x, this.cur.y + 1)) {
      this.cur.y += 1;
    } else {
      this._lock();
    }
    this.render();
  }

  softDrop() { if (!this.over && !this.paused) { this.tick(); } }

  hardDrop() {
    if (this.over || this.paused) return;
    while (!this._collides(this.cur.shape, this.cur.x, this.cur.y + 1)) this.cur.y += 1;
    this._lock();
    this.render();
  }

  _lock() {
    const { shape, x, y, type } = this.cur;
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (shape[r][c] && y + r >= 0) this.board[y + r][x + c] = type;
      }
    }
    const kept = this.board.filter(row => row.some(cell => !cell));
    const cleared = TETRIS_ROWS - kept.length;
    if (cleared > 0) {
      while (kept.length < TETRIS_ROWS) kept.unshift(new Array(TETRIS_COLS).fill(''));
      this.board = kept;
      const before = this.level;
      this.lines += cleared;
      this.score += TETRIS_LINE_SCORES[cleared] * before;
      if (this.level !== before && this._timerId !== null) this._schedule();
      this._bark(cleared);
      this.onLines(cleared);
    }
    this._spawn();
  }

  _bark(cleared) {
    this._barkText = cleared >= 4 ? t('tetris.bigBark') : t('tetris.bark');
    this._barking = true;
    if (this._barkTimer) clearTimeout(this._barkTimer);
    this._barkTimer = setTimeout(() => { this._barking = false; this._barkTimer = null; this.render(); }, cleared >= 4 ? 1400 : 800);
  }

  /** Handle a normalised remote key. Returns true when consumed. */
  handleKey(key) {
    if (this.over) {
      if (this.entering) this._handleNameKey(key);
      else if (key === 'Enter' || key === 'Play') this.start();
      return true;
    }
    switch (key) {
      case 'ArrowLeft': this.move(-1); return true;
      case 'ArrowRight': this.move(1); return true;
      case 'ArrowUp': this.rotate(); return true;
      case 'ArrowDown': this.softDrop(); return true;
      case 'StepDown': case 'Enter': this.hardDrop(); return true;
      case 'Play': this.togglePause(); return true;
      default: return false;
    }
  }

  /** Board with the falling piece painted in. */
  _cells() {
    const cells = this.board.map(row => row.slice());
    if (!this.over) {
      const { shape, x, y, type } = this.cur;
      for (let r = 0; r < shape.length; r++) {
        for (let c = 0; c < shape[r].length; c++) {
          if (shape[r][c] && y + r >= 0 && y + r < TETRIS_ROWS) cells[y + r][x + c] = type;
        }
      }
    }
    return cells;
  }

  render() {
    if (!this.rootEl) return;
    if (!this.rootEl.querySelector('.tetris-board')) this._build();
    const cellEls = this.rootEl.querySelectorAll('.tetris-board .tc');
    const cells = this._cells();
    let i = 0;
    for (let r = 0; r < TETRIS_ROWS; r++) {
      for (let c = 0; c < TETRIS_COLS; c++) {
        const cls = cells[r][c] ? `tc tc-${cells[r][c]}` : 'tc';
        if (cellEls[i].className !== cls) cellEls[i].className = cls;
        i++;
      }
    }
    const nextEls = this.rootEl.querySelectorAll('.tetris-next .tc');
    const ns = this.next.shape;
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 4; c++) {
        const on = ns[r] && ns[r][c];
        const cls = on ? `tc tc-${this.next.type}` : 'tc';
        const el = nextEls[r * 4 + c];
        if (el.className !== cls) el.className = cls;
      }
    }
    const set = (sel, text) => { const el = this.rootEl.querySelector(sel); if (el && el.textContent !== String(text)) el.textContent = String(text); };
    set('.tetris-score', this.score);
    set('.tetris-lines', this.lines);
    set('.tetris-level', this.level);
    const status = this.rootEl.querySelector('.tetris-status');
    const overText = this.entering ? `${t('tetris.newHigh')} · ${t('tetris.enterName')}`
      : (this.newRank >= 0 ? `${t('tetris.newHigh')} · ${t('tetris.restart')}` : `${t('tetris.over')} · ${t('tetris.restart')}`);
    const statusText = this.over ? overText : (this.paused ? t('tetris.paused') : '');
    if (status && status.textContent !== statusText) status.textContent = statusText;
    this._renderHighScores();
    const dog = this.rootEl.querySelector('.tetris-dog');
    if (dog) dog.classList.toggle('barking', !!this._barking);
    set('.tetris-bubble', this._barking ? this._barkText : '');
  }

  _build() {
    const cell = '<span class="tc"></span>';
    this.rootEl.innerHTML =
      `<div class="tetris-wrap">` +
        `<div class="tetris-board">${cell.repeat(TETRIS_ROWS * TETRIS_COLS)}</div>` +
        `<div class="tetris-side">` +
          `<div class="tetris-stat"><span class="tetris-stat-label">${t('tetris.score')}</span><span class="tetris-score">0</span></div>` +
          `<div class="tetris-stat"><span class="tetris-stat-label">${t('tetris.lines')}</span><span class="tetris-lines">0</span></div>` +
          `<div class="tetris-stat"><span class="tetris-stat-label">${t('tetris.level')}</span><span class="tetris-level">1</span></div>` +
          `<div class="tetris-stat"><span class="tetris-stat-label">${t('tetris.next')}</span><div class="tetris-next">${cell.repeat(8)}</div></div>` +
          `<div class="tetris-status"></div>` +
          `<div class="tetris-bottom">` +
            `<div class="tetris-dog-wrap"><span class="tetris-bubble"></span><img class="tetris-dog" src="paco.png" alt="Paco"></div>` +
            `<div class="tetris-hiscore"><div class="tetris-hiscore-title">${escapeHtml(t('tetris.high'))}</div>` +
              TETRIS_RANKS.map(r => `<div class="tetris-hiscore-row"><span class="hs-rank">${r}</span><span class="hs-name">${'<span class="hs-ch"></span>'.repeat(TETRIS_NAME_LENGTH)}</span><span class="hs-score"></span></div>`).join('') +
            `</div>` +
          `</div>` +
        `</div>` +
      `</div>` +
      `<div class="tetris-hint">${t('tetris.hint')}</div>`;
  }

  /** Arcade-style table: rank, initials, zero-padded score; empty rows show dashes. */
  _renderHighScores() {
    const rows = this.rootEl.querySelectorAll('.tetris-hiscore-row');
    rows.forEach((row, i) => {
      const e = this.highScores[i];
      const typing = this.entering && i === this.newRank;
      const name = typing ? this.nameChars.join('') : (e ? e.name : '---');
      const score = e ? String(e.score).padStart(6, '0') : '------';
      row.querySelectorAll('.hs-ch').forEach((ch, k) => {
        const text = name[k] === ' ' ? '\u00a0' : name[k];
        if (ch.textContent !== text) ch.textContent = text;
        ch.classList.toggle('hs-cursor', typing && k === this.namePos);
      });
      const sc = row.querySelector('.hs-score');
      if (sc.textContent !== score) sc.textContent = score;
      row.classList.toggle('hs-new', this.over && i === this.newRank && !typing);
      row.classList.toggle('hs-entering', typing);
      row.classList.toggle('hs-empty', !e);
    });
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
    this._defaultConfigCallback = null; // Set externally: returns the config a reset lands on
    this._pausedAt = 0; // Timestamp when paused via key 0
    this._enterDownTime = 0; // Timestamp when Enter was pressed
    this._enterLongPressTimer = null; // Timer for long-press detection
    this._enterHandledAsLong = false; // Whether current Enter press was handled as long-press
    this._enterDownHandled = false; // Whether Enter keydown was handled by main handler
    this._holdKey = null; // Which hold-capable key ('Enter' | 'Play' | 'Menu') is currently down
    this._ready = false; // Whether timer area is enlarged but not yet started
    this._timeSettingMode = false; // Whether we're in arrow-key time setting mode
    this._timeSettingField = null; // 'round-min' | 'round-sec' | 'rest-min' | 'rest-sec'
    this._timeSettingSnapshot = null; // Config snapshot for cancel (key 0)
    // Dual timer support
    this._dualMode = false;
    this._dualState = null;
    this._dualEngine = null;
    this._dualRendererEls = null;
    this.overlayManager._dualTimerCallback = () => this._activateDualMode();
    // Match scoreboard for competition presets (ring keys while a round is live)
    this.scoreboard = new Scoreboard(document.getElementById('scoreboard'));
    this.overlayManager._onScoreboardToggle = () => this._updateScoreboardVisibility();
    this._updateScoreboardVisibility();
    // A release that lands in another window (or after the page is hidden)
    // never reaches us, so the pending hold must not fire on its own.
    this._onFocusLost = () => this._cancelHold();
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onFocusLost);
    document.addEventListener('visibilitychange', this._onFocusLost);
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

    // Remote (Apple Remote via Flirc) keystrokes — see TRAINING_MENU_ITEMS header
    if (key === ' ' || code === 'Space' || key === 'MediaPlayPause') return 'Play';
    if (key === 'Escape') return 'Menu';
    if (key === 'PageUp') return 'StepUp';
    if (key === 'PageDown') return 'StepDown';

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
    // Ctrl+H cycles through holiday theme previews (testing aid)
    if (event.ctrlKey && (event.key === 'h' || event.key === 'H')) {
      event.preventDefault();
      if (this._holidayTheme) this._holidayTheme.cycle();
      return;
    }

    const key = this._normalizeKey(event);
    if (key === null) return; // Unrecognized key — ignore

    // A different key while ▶/OK/Menu is held (e.g. Flirc's long-press key
    // arriving mid-hold) cancels that hold so its release does nothing.
    if (this._holdKey && key !== this._holdKey) this._cancelHold();

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
      if (event.repeat && effectiveKey !== 'ArrowUp' && effectiveKey !== 'ArrowDown') return;
      this.overlayManager.handleKey(effectiveKey);
      // If that key closed the overlay, restore the status bar hints
      if (!this.overlayManager.isOpen()) this._restoreStatusBar();
      return;
    }

    // --- Time-setting mode ---
    if (this._timeSettingMode) {
      event.preventDefault();
      if (event.repeat && (effectiveKey === 'Enter' || effectiveKey === 'Play' || effectiveKey === 'Menu')) return;
      this._handleTimeSettingKey(effectiveKey);
      return;
    }

    // Ring enters time-setting mode, only while nothing is running or paused:
    // a live round is never edited or stopped by the ring
    if (effectiveKey === 'ArrowUp' || effectiveKey === 'ArrowDown' || effectiveKey === 'ArrowLeft' || effectiveKey === 'ArrowRight' ||
        effectiveKey === 'StepUp' || effectiveKey === 'StepDown') {
      event.preventDefault();
      if (this._sessionLive()) {
        // Scoreboard on: the ring keeps score instead of complaining
        if (this._scoreboardActive() && !event.repeat) {
          if (this.scoreboard.handleKey(effectiveKey)) this.audioManager.playMuffle();
        } else if (!this._scoreboardActive()) {
          this._showNotice('notice.stopFirst');
        }
      }
      // A preset with per-round durations has no single value to edit
      else if (this.state.roundDurations) this._showNotice('notice.presetLocked');
      else this._enterTimeSetting();
      return;
    }

    // Overlay is closed — handle main controls
    event.preventDefault();
    switch (effectiveKey) {
      case 'Enter':
      case 'Play':
      case 'Menu':
        // Tap vs hold: defer the action until keyup or the hold timeout
        if (event.repeat) break; // Ignore key repeat events
        this._beginHold(effectiveKey, event);
        break;
      case '0':
        // Stop → ready state, or ready → default state
        this._handleZeroPress();
        break;
      case 'Clear':
        // Delete (Flirc: hold Menu) → full reset, same as holding OK
        this._handleEnterLongPress();
        break;
      case '/':
        // Toggle competition presets menu (only when idle)
        if (this.state.phase !== PHASES.IDLE) break;
        if (this.overlayManager.isOpen()) {
          this.overlayManager.closeOverlay();
          this.renderer.updateStatusBar(this._ready ? 'ready' : 'clock');
        } else {
          this.overlayManager.showCompetitionMenu({ ...this.state.config }, (updatedConfig) => {
            this._applyMenuConfig(updatedConfig);
          });
          this.renderer.updateStatusBar('competition');
        }
        break;
      case '*':
        // Toggle training presets menu (only when idle)
        if (this.state.phase !== PHASES.IDLE) break;
        if (this.overlayManager.isOpen()) {
          this.overlayManager.closeOverlay();
          this.renderer.updateStatusBar(this._ready ? 'ready' : 'clock');
        } else {
          this.overlayManager.showTrainingMenu({ ...this.state.config }, (updatedConfig) => {
            this._applyMenuConfig(updatedConfig);
          });
          this.renderer.updateStatusBar('training');
        }
        break;
      case '9':
        // Show the weekly schedule overlay (only when idle)
        if (this.state.phase !== PHASES.IDLE) break;
        this.overlayManager.showSchedule(this._scheduleManager ? this._scheduleManager._schedule : []);
        this.renderer.updateStatusBar('hidden');
        break;
      case '7':
        // Cycle dual-screen display mode (mirror → clock+timer → split)
        if (this._displayModeCallback) this._displayModeCallback();
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
    if (this._dualMode || this.state.phase !== PHASES.IDLE) return;
    this._dualMode = true;

    // Clear any active training/competition preset — otherwise Timer 1 keeps the
    // preset's per-round durations and finite round count under the Dual label
    this._cancelPreset();
    // Remember the configured round count so deactivating restores it instead of
    // persisting the forced 0
    this._dualSavedNumRounds = this.state.config.numRounds;

    const config2 = { ...StorageManager.load() };
    this._dualState = createTimerState(config2);
    this._dualState.config.numRounds = 0;
    this._dualState.config.prepDurationSec = this.state.config.prepDurationSec;
    this.state.config.numRounds = 0;
    this.state._presetName = 'Dual Timer';

    const panel2 = document.getElementById('timer-panel-2');
    if (panel2) panel2.style.display = '';
    const container = document.getElementById('dual-timer-container');
    if (container) container.classList.add('dual-mode');

    const timerArea = document.getElementById('timer-area');
    if (timerArea) timerArea.classList.add('dual-timer-active');

    this._dualRendererEls = {
      roundTimerEl: document.getElementById('round-timer-2'),
      restTimerEl: document.getElementById('rest-timer-2'),
    };

    const dualState = this._dualState;
    this._dualEngine = new TimerEngine(dualState,
      (s) => {
        if (this.renderer.stealth) this.renderer.applyStealth(this.state.phase, s.phase);
        if (s.phase === PHASES.ROUND) {
          this._updateTimer2Display(this._dualRendererEls.roundTimerEl, s.remainingSec, true);
          this._updateTimer2Display(this._dualRendererEls.restTimerEl, s.config.restDurationSec, false);
        } else if (s.phase === PHASES.REST) {
          this._updateTimer2Display(this._dualRendererEls.roundTimerEl, s.config.roundDurationSec, false);
          this._updateTimer2Display(this._dualRendererEls.restTimerEl, s.remainingSec, true);
        } else if (s.phase === PHASES.PREP) {
          // Show the upcoming durations (inactive) instead of freezing stale values
          this._updateTimer2Display(this._dualRendererEls.roundTimerEl, s.config.roundDurationSec, false);
          this._updateTimer2Display(this._dualRendererEls.restTimerEl, s.config.restDurationSec, false);
        }
      },
      (_s, _oldPhase, newPhase) => {
        if (newPhase === PHASES.ROUND) {
          this._dualEngine.emitTransitionCue(() => this.audioManager.playRoundStartFanfare());
        }
      }
    );

    const origTick2 = this._dualEngine.tick.bind(this._dualEngine);
    this._dualEngine.tick = () => {
      const alert = origTick2();
      if (alert.type === 'end_round') this._dualEngine.emitTransitionCue(() => this.audioManager.playEndOfRoundBeepT2());
      else if (alert.type === 'end_rest') this._dualEngine.emitTransitionCue(() => this.audioManager.playEndOfRestBeepT2());
      else if (alert.type === 'countdown' && !this._dualEngine.silent) this.audioManager.playCountdownBeepT2();
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
    this._updateScoreboardVisibility();
    if (this._dualEngine) { this._dualEngine.stop(); this._dualEngine = null; }
    this._dualState = null;
    // Restore the round count that activation forced to 0
    if (typeof this._dualSavedNumRounds === 'number') {
      this.state.config.numRounds = this._dualSavedNumRounds;
      this._dualSavedNumRounds = undefined;
    }
    if (this.state._presetName === 'Dual Timer') {
      this.state._presetName = null;
      this.renderer.updatePresetLabel(null);
    }
    const panel2 = document.getElementById('timer-panel-2');
    if (panel2) panel2.style.display = 'none';
    const container = document.getElementById('dual-timer-container');
    if (container) container.classList.remove('dual-mode');
    const timerArea = document.getElementById('timer-area');
    if (timerArea) timerArea.classList.remove('dual-timer-active');
    this._dualRendererEls = null;
    // Split display mode requires dual timers — let the app fall back to mirror
    if (this._onDualDeactivated) this._onDualDeactivated();
  }

  _updateTimer2Display(el, remainingSec, isActive) {
    if (!el) return;
    Renderer.setDigits(el, remainingSec);
    el.classList.toggle('timer-active', !!isActive);
  }

  /**
   * Enter time-setting mode, starting at round minutes.
   */
  _enterTimeSetting() {
    this._timeSettingMode = true;
    this._timeSettingField = 'round-min';
    // Snapshot so key 0 can cancel and revert any adjustments
    this._timeSettingSnapshot = {
      config: { ...this.state.config },
      dualConfig: this._dualState ? { ...this._dualState.config } : null,
      presetName: this.state._presetName || null
    };
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
    this._timeSettingSnapshot = null;
    this.renderer.roundTimerEl.classList.remove('time-setting-minutes', 'time-setting-seconds');
    this.renderer.restTimerEl.classList.remove('time-setting-minutes', 'time-setting-seconds');
    if (this.renderer.roundCounterEl) this.renderer.roundCounterEl.classList.remove('time-setting-active');
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
    this._restoreStatusBar();
  }

  /**
   * Render the timer display with span-wrapped digit groups for selective blinking.
   */
  _renderTimeSettingDisplay() {
    this.renderer.updateRoundDisplay(this.state.config.roundDurationSec, false);
    this.renderer.updateRestDisplay(this.state.config.restDurationSec, false);
    this.renderer.updateRoundCounter(0, this.state.config.numRounds);

    this.renderer.roundTimerEl.classList.remove('time-setting-minutes', 'time-setting-seconds');
    this.renderer.restTimerEl.classList.remove('time-setting-minutes', 'time-setting-seconds');
    if (this.renderer.roundCounterEl) this.renderer.roundCounterEl.classList.remove('time-setting-active');

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
    else if (field === 'rounds') {
      if (this.renderer.roundCounterEl) this.renderer.roundCounterEl.classList.add('time-setting-active');
    } else if (this._dualRendererEls) {
      const rt2 = this._dualRendererEls.roundTimerEl;
      const xt2 = this._dualRendererEls.restTimerEl;
      if (field === 't2-round-min' && rt2) rt2.classList.add('time-setting-minutes');
      else if (field === 't2-round-sec' && rt2) rt2.classList.add('time-setting-seconds');
      else if (field === 't2-rest-min' && xt2) xt2.classList.add('time-setting-minutes');
      else if (field === 't2-rest-sec' && xt2) xt2.classList.add('time-setting-seconds');
    }
  }

  /**
   * Editing feedback: the top header bar stays empty (element kept for display
   * sync); the state label under the timers names the field and the controls.
   */
  _updateTimeSettingBar() {
    const bar = document.getElementById('edit-instruction-bar');
    if (bar) { bar.innerHTML = ''; bar.classList.remove('active'); }
    if (!this._timeSettingMode) return;
    const f = this._timeSettingField || '';
    const base = f.startsWith('t2-') ? f.slice(3) : f;
    const name = base ? t('field.' + base) : '';
    const field = f.startsWith('t2-') ? t('field.timer2', { field: name }) : name;
    this.renderer.updateStatusBar('editing', { field: field.trim() });
  }

  /**
   * Handle a key press while in time-setting mode.
   */
  _handleTimeSettingKey(key) {
    const field = this._timeSettingField;

    // ◀▶ walk one linear sequence of fields (timer 2's fields follow when dual)
    if (key === 'ArrowRight' || key === 'ArrowLeft') {
      const order = ['round-min', 'round-sec', 'rest-min', 'rest-sec', 'rounds'];
      if (this._dualMode) order.push('t2-round-min', 't2-round-sec', 't2-rest-min', 't2-rest-sec');
      const i = Math.max(0, order.indexOf(field));
      this._timeSettingField = order[moveSelection(i, key === 'ArrowRight' ? 1 : -1, order.length)];
      this._renderTimeSettingDisplay(); this._updateTimeSettingBar(); return;
    }

    // ▲▼ adjust the selected field; held ring (StepUp/StepDown) takes big steps
    if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'StepUp' || key === 'StepDown' || key === '+' || key === '-') {
      const up = key === 'ArrowUp' || key === 'StepUp' || key === '+';
      this._adjustTimeSettingValue(up ? 1 : -1, key === 'StepUp' || key === 'StepDown');
      return;
    }

    if (key === 'Menu') key = '0'; // Menu cancels, like 0

    if (key === '0') {
      // Cancel: revert any adjustments
      const snap = this._timeSettingSnapshot;
      if (snap) {
        this.state.config = { ...snap.config };
        if (this._dualState && snap.dualConfig) {
          this._dualState.config = { ...snap.dualConfig };
        }
        this.state._presetName = snap.presetName;
        this.renderer.updatePresetLabel(snap.presetName);
        this._updateScoreboardVisibility();
      }
      this.state.remainingSec = this.state.config.roundDurationSec;
      if (this._dualState) this._dualState.remainingSec = this._dualState.config.roundDurationSec;
      this._exitTimeSetting();
      this.renderer.updateRoundDisplay(this.state.config.roundDurationSec, false);
      this.renderer.updateRestDisplay(this.state.config.restDurationSec, false);
      this.renderer.updateRoundCounter(0, this.state.config.numRounds);
      if (this._dualMode && this._dualState && this._dualRendererEls) {
        this._updateTimer2Display(this._dualRendererEls.roundTimerEl, this._dualState.config.roundDurationSec, false);
        this._updateTimer2Display(this._dualRendererEls.restTimerEl, this._dualState.config.restDurationSec, false);
      }
      if (this._onTimeSettingClosed) this._onTimeSettingClosed(false);
      return;
    }

    // Save: OK goes to Ready, ▶ starts, * and / open the preset menus
    if (key === 'Enter' || key === 'Play' || key === '*' || key === '/') {
      StorageManager.save(this.state.config);
      this.state.remainingSec = this.state.config.roundDurationSec;
      if (this._dualState) this._dualState.remainingSec = this._dualState.config.roundDurationSec;
      const start = key === 'Play' && this.state.config.roundDurationSec > 0;
      if (key === 'Enter' || key === 'Play') {
        this._ready = true;
        document.body.classList.remove('timer-idle');
      }
      this._exitTimeSetting();
      if (this._onTimeSettingClosed) this._onTimeSettingClosed(true);

      if (start) {
        this._ready = false;
        this.scoreboard.reset(); // every match starts 0-0, from this path too
        this.engine.start();
        if (this._dualMode && this._dualEngine) this._dualEngine.start();
        this._refreshTimerDisplay();
        this.renderer.updateStatusBar('running');
      } else if (key === 'Play') {
        this.audioManager.playMuffle(); // a 0:00 round can't start
      } else if (key === '*') {
        this.overlayManager.showTrainingMenu({ ...this.state.config }, (updatedConfig) => {
          this._applyMenuConfig(updatedConfig);
        });
        this.renderer.updateStatusBar('training');
      } else if (key === '/') {
        this.overlayManager.showCompetitionMenu({ ...this.state.config }, (updatedConfig) => {
          this._applyMenuConfig(updatedConfig);
        });
        this.renderer.updateStatusBar('competition');
      }
      return;
    }
  }

  /**
   * Adjust the value of the currently selected time-setting field.
   * @param {number} direction - +1 or -1
   * @param {boolean} [big] - Held ring: minutes ±5, seconds ±15, rounds ±5
   */
  _adjustTimeSettingValue(direction, big) {
    const field = this._timeSettingField;

    // Rounds adjustment
    if (field === 'rounds') {
      let rounds = this.state.config.numRounds + direction * (big ? 5 : 1);
      if (rounds < 0) rounds = 0;
      this.state.config.numRounds = rounds;
      // An explicit edit while in dual mode wins over the count saved at
      // activation, so leaving dual mode does not silently revert it
      if (this._dualMode) this._dualSavedNumRounds = undefined;
      this._cancelPreset();
      this.renderer.updateRoundCounter(0, rounds);
      this._renderTimeSettingDisplay();
      return;
    }

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
      mins += direction * (big ? 5 : 1);
      if (mins < 0) mins = 0;
      if (mins > 30) mins = 30;
    } else {
      secs = (((secs + direction * (big ? 15 : 5)) % 60) + 60) % 60; // wraps 55 → 0 → 55
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
    this._updateScoreboardVisibility();
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
    this.renderer.updateStatusBar(this._ready ? 'ready' : 'clock');
  }
  _cancelPreset() {
    this.state._presetName = null;
    this.state.roundDurations = null;
    this.state.restDurations = null;
    this.renderer.updatePresetLabel(null);
    this.renderer.hideRoundList();
    this._updateScoreboardVisibility();
  }



  /**
   * Remove the keydown listener (for cleanup/testing).
   */
  /**
   * Handle keyup events for Enter long-press detection.
   * @param {KeyboardEvent} event
   */
  _onKeyUp(event) {
    const key = this._normalizeKey(event);
    if (key !== 'Enter' && key !== 'Play' && key !== 'Menu') return;
    if (key !== this._holdKey) return; // Release of a key whose hold was cancelled
    if (this._enterLongPressTimer) {
      clearTimeout(this._enterLongPressTimer);
      this._enterLongPressTimer = null;
    }
    // Ignore if the keydown was consumed by an overlay
    if (!this._enterDownHandled) { this._holdKey = null; return; }
    this._enterDownHandled = false;
    this._holdKey = null;
    if (!this._enterHandledAsLong) this._handleTap(key);
    this._enterHandledAsLong = false;
  }

  /**
   * Start tap-vs-hold detection for ▶ (Play), OK (Enter) or Menu.
   * A relayed gesture from the secondary display arrives complete, with
   * `relayHeldMs` on the keydown event.
   * @private
   */
  _beginHold(key, event) {
    this._holdKey = key;
    this._enterDownTime = Date.now();
    this._enterHandledAsLong = false;
    this._enterDownHandled = true;
    if (Number.isFinite(event.relayHeldMs)) {
      if (event.relayHeldMs >= HOLD_MS) {
        this._enterHandledAsLong = true;
        this._handleHold(key);
      }
      return;
    }
    this._enterLongPressTimer = setTimeout(() => {
      this._enterLongPressTimer = null;
      this._enterHandledAsLong = true;
      this._handleHold(key);
    }, HOLD_MS);
  }

  /** @private */
  _cancelHold() {
    if (this._enterLongPressTimer) {
      clearTimeout(this._enterLongPressTimer);
      this._enterLongPressTimer = null;
    }
    this._holdKey = null;
    this._enterDownHandled = false;
    this._enterHandledAsLong = false;
  }

  /** @private */
  _handleTap(key) {
    if (key === 'Menu') this._openMainMenu();
    else this._handleEnterShortPress();
  }

  /** @private */
  _handleHold(key) {
    if (key === 'Play') this._handleZeroPress(); // hold ▶ = stop
    else this._handleEnterLongPress(); // hold OK / Menu = reset (or stop to Ready while running)
  }

  /** True when the scoreboard setting is on and a competition preset is loaded (never in dual mode). */
  _scoreboardActive() {
    return !!APP_SETTINGS.scoreboard && !this._dualMode &&
      !!this.state._presetName && Object.prototype.hasOwnProperty.call(APP_SETTINGS.competitionPresets, this.state._presetName);
  }

  /** Show or hide the panels; the body class travels to the second TV with the snapshot. */
  _updateScoreboardVisibility() {
    const active = this._scoreboardActive();
    document.body.classList.toggle('scoreboard', active);
    if (!active) this.scoreboard.reset();
  }

  /** True while either timer is running or paused. */
  _sessionLive() {
    return this.state.phase !== PHASES.IDLE ||
      !!(this._dualMode && this._dualEngine && this._dualState && this._dualState.phase !== PHASES.IDLE);
  }

  /**
   * Show a short message in the state label for two seconds, then put back
   * the label it replaced, unless something else has changed the label since.
   * @param {string} key - STRINGS key
   * @private
   */
  _showNotice(key) {
    const last = this.renderer._lastStatus;
    if (!last || last.mode !== 'notice') this._noticeRestore = last || null;
    clearTimeout(this._noticeTimer);
    this.renderer.updateStatusBar('notice', { text: t(key) });
    this._noticeTimer = setTimeout(() => {
      this._noticeTimer = null;
      const now = this.renderer._lastStatus;
      if (!now || now.mode !== 'notice') return;
      const prev = this._noticeRestore;
      if (prev) this.renderer.updateStatusBar(prev.mode, prev.detail);
      else this._restoreStatusBar();
    }, NOTICE_MS);
  }

  /**
   * Restore the status bar for the current timer state after an overlay or
   * time-setting mode closes.
   * @private
   */
  _restoreStatusBar() {
    const dualActive = this._dualMode && this._dualEngine && this._dualState &&
      this._dualState.phase !== PHASES.IDLE;
    if (this.state.phase !== PHASES.IDLE || dualActive) {
      const paused = this.state.paused || (dualActive && this._dualState.paused);
      this.renderer.updateStatusBar(paused ? 'paused' : 'running');
    } else {
      this.renderer.updateStatusBar(this._ready ? 'ready' : 'clock');
    }
  }

  /**
   * Menu tap: open the main menu. While idle it lists presets, schedule and
   * settings; while a timer runs it is Pause/Resume first (a stray OK must
   * never discard the session), then Stop and keep settings, Restore defaults
   * (asks first) and Hide display. While idle, "Restore defaults" leads only
   * when the app is not already in its default state.
   */
  _openMainMenu() {
    if (this.overlayManager.isOpen()) return;
    const dualActive = this._dualMode && this._dualEngine && this._dualState &&
      this._dualState.phase !== PHASES.IDLE;
    const idle = this.state.phase === PHASES.IDLE && !dualActive;
    const items = [];
    const hideItem = { id: 'blank', icon: 'eyeOff', name: t('menu.hide'), note: t('menu.hide.note'), action: () => {
      this.renderer.toggleStealth();
      this.renderer.applyStealth(this.state.phase);
    } };
    if (!idle) {
      // While a timer runs the menu is a short action list; every item closes it.
      const paused = this.state.paused || (dualActive && this._dualState.paused);
      items.push({ id: 'pause', icon: paused ? 'play' : 'pause', name: paused ? t('menu.resume') : t('menu.pause'), action: () => {
        this._handleEnterShortPress();
      } });
      items.push({ id: 'reset-timer', icon: 'stop', name: t('menu.stopKeep'), action: () => {
        this._handleZeroPress(); // stop → back to the ready state with the same settings
      } });
      if (this._scoreboardActive()) {
        items.push({ id: 'reset-score', icon: 'trophy', name: t('menu.resetScore'), action: () => {
          this.scoreboard.reset();
        } });
      }
      items.push(this._resetMenuItem(true));
      items.push(hideItem);
      this.overlayManager.showMainMenu(items);
      this.renderer.updateStatusBar('menu');
      return;
    }
    // Ordered by how often a coach reaches for each row: presets first, then
    // the session reset, schedule and display rows, settings, and the
    // rarely-used language / maintenance / about rows last.
    const onOff = (v) => (v ? t('menu.on') : t('menu.off'));
    items.push({ id: 'training', icon: 'ladderUp', name: t('menu.training'), submenu: true, action: () => {
      this.overlayManager.showTrainingMenu({ ...this.state.config }, (cfg) => this._applyMenuConfig(cfg));
    } });
    items.push({ id: 'competition', icon: 'belt', name: t('menu.competition'), submenu: true, action: () => {
      this.overlayManager.showCompetitionMenu({ ...this.state.config }, (cfg) => this._applyMenuConfig(cfg));
    } });
    if (this.state._presetName && Object.prototype.hasOwnProperty.call(APP_SETTINGS.competitionPresets, this.state._presetName)) {
      items.push({ id: 'scoreboard', icon: 'trophy', name: t('menu.scoreboard'), toggle: true,
        note: () => onOff(APP_SETTINGS.scoreboard),
        action: () => { this.overlayManager.toggleScoreboard(); } });
    }
    if (!this._isDefaultState()) items.push(this._resetMenuItem(false));
    items.push({ id: 'schedule', icon: 'calendar', name: t('menu.schedule'), submenu: true, action: () => {
      this.overlayManager.showSchedule(this._scheduleManager ? this._scheduleManager._schedule : []);
    } });
    if (this._displayModeCallback) {
      items.push({ id: 'screens', icon: 'dual', name: t('menu.screens'), toggle: true,
        note: () => (this._displayModeLabelCallback ? this._displayModeLabelCallback() : ''),
        action: () => { this._displayModeCallback(); } });
    }
    items.push(hideItem);
    items.push({ id: 'schedule-toggle', icon: 'clock', name: t('menu.followSchedule'), toggle: true,
      note: () => onOff(APP_SETTINGS.scheduleEnabled),
      action: () => { this.overlayManager.toggleSchedule(); } });
    items.push({ id: 'holiday', icon: 'snow', name: t('menu.holiday'), toggle: true,
      note: () => onOff(APP_SETTINGS.holidayThemeEnabled),
      action: () => { this.overlayManager.toggleHolidayTheme(); } });
    items.push({ id: 'quiet', icon: 'moon', name: t('menu.quiet'), toggle: true,
      note: () => onOff(APP_SETTINGS.quietVisuals),
      action: () => { this.overlayManager.toggleQuietVisuals(); } });
    items.push({ id: 'language', icon: 'globe', name: t('menu.language'), toggle: true,
      note: () => LANGUAGE_NAMES[APP_SETTINGS.language] || APP_SETTINGS.language,
      action: () => {
        // Every row name changes language, so rebuild the menu in place and
        // keep the highlight on this row
        const sel = this.overlayManager._selIndex;
        this.overlayManager.toggleLanguage();
        this.overlayManager.closeOverlay();
        this._openMainMenu();
        this.overlayManager._selIndex = sel;
      } });
    items.push({ id: 'maintenance', icon: 'wrench', name: t('menu.maintenance'), submenu: true, action: () => {
      this.overlayManager.showMaintenance();
    } });
    items.push({ id: 'credits', icon: 'info', name: t('menu.about'), submenu: true, action: () => {
      this.overlayManager.showCredits();
    } });
    items.push({ id: 'tetris', icon: 'gamepad', name: t('menu.tetris'), submenu: true, action: () => {
      this.overlayManager.showTetris({ onLines: (n) => this.audioManager.playBark(n >= 4 ? 2 : 1) });
    } });
    this.overlayManager.showMainMenu(items);
    this.renderer.updateStatusBar('menu');
  }

  /**
   * Immediately refresh the timer display to reflect current phase.
   */
  _refreshTimerDisplay() {
    const s = this.state;
    if (s.phase === PHASES.ROUND) {
      this.renderer.updateRoundDisplay(s.remainingSec, true);
      const restSec = s.restDurations
        ? s.restDurations[(s.currentRound - 1) % s.restDurations.length]
        : s.config.restDurationSec;
      this.renderer.updateRestDisplay(restSec, false);
    } else if (s.phase === PHASES.REST) {
      const roundSec = s.roundDurations
        ? s.roundDurations[s.currentRound % s.roundDurations.length]
        : s.config.roundDurationSec;
      this.renderer.updateRoundDisplay(roundSec, false);
      this.renderer.updateRestDisplay(s.remainingSec, true);
    }
  }

  /**
   * Main-menu "Restore defaults" row: stop any running timer, drop the
   * selection and go back to the default state (app defaults or the active
   * class preset). While a session is live it asks first.
   * @param {boolean} confirm
   */
  _resetMenuItem(confirm) {
    const restore = () => {
      this._handleZeroPress();        // stop a running timer (no-op while idle & not ready)
      if (this._ready) this._ready = false;
      this._handleEnterLongPress();   // idle full reset to defaults
    };
    if (!confirm) return { id: 'reset', icon: 'undo', name: t('menu.restore'), action: restore };
    return { id: 'reset', icon: 'undo', name: t('menu.restore'), submenu: true, action: () => {
      this.overlayManager.showConfirm({
        title: t('confirm.restore.title'),
        body: t('confirm.restore.body'),
        yes: t('confirm.restore.yes'),
        onYes: restore
      });
    } };
  }

  /**
   * True when nothing is running or selected: idle, not in the ready state,
   * no dual timer, no custom round list and the config equals the default
   * (DEFAULT_CONFIG, or the active class preset via _defaultConfigCallback).
   */
  _isDefaultState() {
    const dualActive = this._dualMode && this._dualEngine && this._dualState &&
      this._dualState.phase !== PHASES.IDLE;
    if (this.state.phase !== PHASES.IDLE || dualActive || this._dualMode) return false;
    if (this._ready || this.state.roundDurations || this.state.restDurations) return false;
    const def = this._defaultConfigCallback ? this._defaultConfigCallback() : { ...DEFAULT_CONFIG, presetName: null };
    const c = this.state.config;
    return c.roundDurationSec === def.roundDurationSec &&
      c.restDurationSec === def.restDurationSec &&
      c.numRounds === def.numRounds &&
      c.prepDurationSec === (def.prepDurationSec ?? DEFAULT_CONFIG.prepDurationSec) &&
      (this.state._presetName || null) === (def.presetName || null);
  }

  /**
   * Handle key 0: stop → ready, or ready → default.
   */
  _handleZeroPress() {
    if (this.overlayManager.isOpen()) return;

    if (this._sessionLive()) {
      this._stopToReady();
    } else if (this._ready) {
      // Ready state → go back to default (shrunk)
      this._ready = false;
      document.body.classList.add('timer-idle');
      this.renderer.updateStatusBar('clock');
      this.audioManager.playCancel();
    } else {
      // Already in default state → full reset (same as long-press Enter)
      this._handleEnterLongPress();
    }
  }

  /**
   * Stop a running or paused session and stay in the ready state (enlarged)
   * with the same settings. Every stop gesture lands here.
   * @private
   */
  _stopToReady() {
    const dualActive = this._dualMode && this._dualEngine && this._dualState &&
      this._dualState.phase !== PHASES.IDLE;
    // Timer 2 may still be running after Timer 1 finished its rounds — stop it too.
    if (this.state.paused || (dualActive && this._dualState.paused)) {
      this.renderer.hidePauseOverlay();
    }
    if (this.state.phase !== PHASES.IDLE) {
      this.state._cancelledByUser = true;
      this.engine.stop();
    }
    if (dualActive) {
      this._dualState._cancelledByUser = true;
      this._dualEngine.stop();
    }
    this.audioManager.playCancel();
    this.scoreboard.reset();
    const rd = this.state.roundDurations;
    this.renderer.updateRoundDisplay(rd ? rd[0] : this.state.config.roundDurationSec, false);
    this.renderer.updateRestDisplay(this.state.config.restDurationSec, false);
    this.renderer.updateRoundCounter(0, rd ? rd.length : this.state.config.numRounds);
    this._ready = true;
    document.body.classList.remove('timer-idle');
    this.renderer.updateStatusBar('ready');
    if (this._dualMode && this._dualRendererEls) {
      this._updateTimer2Display(this._dualRendererEls.roundTimerEl, this._dualState.config.roundDurationSec, false);
      this._updateTimer2Display(this._dualRendererEls.restTimerEl, this._dualState.config.restDurationSec, false);
    }
  }

  /**
   * Short press Enter: start / pause / resume.
   */
  _handleEnterShortPress() {
    if (this.overlayManager.isOpen()) return;
    const dualActive = this._dualMode && this._dualEngine && this._dualState &&
      this._dualState.phase !== PHASES.IDLE;
    if (this.state.phase === PHASES.IDLE && !dualActive) {
      // Don't start if round duration is 0
      if (this.state.config.roundDurationSec === 0) {
        this.audioManager.playMuffle();
        return;
      }
      // First Enter: enlarge timer area (ready state)
      if (!this._ready) {
        this._ready = true;
        document.body.classList.remove('timer-idle');
        this.renderer.updateStatusBar('ready');
        return;
      }
      // Second Enter: start the timer; every match starts 0-0
      this._ready = false;
      this.scoreboard.reset();
      this.engine.start();
      if (this._dualMode && this._dualEngine) this._dualEngine.start();
      this._refreshTimerDisplay();
      this.renderer.updateStatusBar('running');
    } else if (this.state.paused || (dualActive && this._dualState.paused)) {
      this.engine.resume();
      if (this._dualMode && this._dualEngine) this._dualEngine.resume();
      this.renderer.hidePauseOverlay();
      this._refreshTimerDisplay();
      this.renderer.updateStatusBar('running');
      this.audioManager.playResume();
    } else {
      this.engine.pause();
      if (this._dualMode && this._dualEngine) this._dualEngine.pause();
      this.renderer.showPauseOverlay();
      this.renderer.updateStatusBar('paused');
      this.audioManager.playMuffle();
    }
  }

  /**
   * Long press Enter: reset (when idle) or stop to Ready (when running/paused).
   */
  _handleEnterLongPress() {
    if (this.overlayManager.isOpen()) return;
    if (!this._sessionLive()) {
      // Reset ready state
      this._ready = false;
      document.body.classList.add('timer-idle');
      this.renderer.updateStatusBar('clock');
      // Same as Clear/Reset — also deactivate dual mode
      this._deactivateDualMode();
      this.state.roundDurations = null;
      this.state.restDurations = null;
      this.state._presetName = null;
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
      this.renderer.updateRoundDisplay(this.state.config.roundDurationSec, false);
      this.renderer.updateRestDisplay(this.state.config.restDurationSec, false);
      this.renderer.updateRoundCounter(0, this.state.config.numRounds);
      this.renderer.updatePresetLabel(this.state._presetName);
      this.renderer.hidePrepCountdown();
      this.renderer.hideRoundList();
      this.renderer.hidePauseOverlay();
      this._updateScoreboardVisibility();
      this.audioManager.playCancel();
    } else {
      this._stopToReady(); // same place as every other stop
    }
  }

  destroy() {
    this._cancelHold();
    this.scoreboard.destroy();
    clearTimeout(this._noticeTimer);
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onFocusLost);
    document.removeEventListener('visibilitychange', this._onFocusLost);
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
const SYNCED_SCHEDULE_FILE = 'schedule.json';

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
      if (isValidSeconds(override.roundDurationSec)) {
        this._presets[classType].roundDurationSec = override.roundDurationSec;
      }
      if (isValidSeconds(override.restDurationSec)) {
        this._presets[classType].restDurationSec = override.restDurationSec;
      }
      if (isValidSeconds(override.numRounds)) {
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

// Resolve recurring local times on the actual date, including DST offset changes.
// Ambiguous fall-back times use the first occurrence (Date's local-time policy).
function classInstant(date, time) {
  const [h, m] = time.split(':').map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m);
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
  async loadConfig(initialConfig) {
    try {
      const response = initialConfig ? { ok: true, json: async () => initialConfig } : await fetch('config.json', { cache: 'no-store' });
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

      // The Gymdesk sync writes the live schedule to an untracked
      // schedule.json so git pulls never conflict with it. When present and
      // valid it replaces the schedule bundled in config.json.
      const synced = await this._fetchSyncedSchedule();
      const scheduleEntries = synced || data.schedule;

      // Validate entries
      const validEntries = [];
      scheduleEntries.forEach((entry, index) => {
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
   * Fetch schedule.json (written by sync-schedule.js). Returns the schedule
   * array, or null when the file is absent or malformed.
   * @returns {Promise<Array|null>}
   * @private
   */
  async _fetchSyncedSchedule() {
    try {
      const response = await fetch(SYNCED_SCHEDULE_FILE, { cache: 'no-store' });
      if (!response.ok) return null;
      const data = await response.json();
      return data && Array.isArray(data.schedule) ? data.schedule : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Seconds left in the class active at `now`, or 0 when no class is active.
   * @param {Date} now
   * @returns {number}
   */
  getRemainingClassSec(now) {
    const active = this.getActiveClass(now);
    if (!active) return 0;
    return Math.max(0, Math.ceil((classInstant(now, active.endTime) - now) / 1000));
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
          this._schedule = cached.schedule.filter(entry => this.validateEntry(entry).valid);
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

    for (const entry of this._schedule) {
      if (entry.dayOfWeek === dayName && now >= classInstant(now, entry.startTime) && now < classInstant(now, entry.endTime)) {
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
// --- HolidayThemeManager ---

/**
 * Determine which US holiday (if any) is celebrated on the given date.
 * Ranges roughly match when people actually decorate/celebrate.
 * @param {Date} date
 * @returns {'christmas'|'newyear'|'halloween'|'july4'|'thanksgiving'|'valentine'|null}
 */
function getActiveHoliday(date) {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  if (m === 12 && d <= 26) return 'christmas';
  if ((m === 12 && d >= 31) || (m === 1 && d <= 2)) return 'newyear';
  if (m === 10 && d >= 25) return 'halloween';
  if (m === 7 && d <= 4) return 'july4';
  if (m === 2 && d >= 12 && d <= 14) return 'valentine';
  if (m === 11) {
    // Thanksgiving is the 4th Thursday of November; decorate Monday through Thursday
    const firstDay = new Date(date.getFullYear(), 10, 1).getDay(); // 0 = Sunday
    const firstThursday = 1 + ((4 - firstDay + 7) % 7);
    const thanksgiving = firstThursday + 21;
    if (d >= thanksgiving - 3 && d <= thanksgiving) return 'thanksgiving';
  }
  return null;
}

// Visual config per holiday particle animation.
// kind: 'snow' (white dots) | 'confetti' (colored slips) | 'glyph' (emoji/char)
// mode: 'fall' (default) | 'rise' | 'drift' (horizontal)
// accents: larger emoji occasionally mixed into the animation (e.g. a snowman
// falling among the snowflakes); accentRatio is the chance a spawned particle
// is an accent.
const HOLIDAY_THEMES = {
  christmas: { label: 'Christmas', particles: { kind: 'snow', count: 45, accents: ['⛄', '🎄'], accentRatio: 0.08 } },
  newyear: { label: "New Year's", particles: { kind: 'confetti', count: 25, colors: ['#ffd700', '#ffedb3', '#ffffff'], accents: ['🎊', '🎆'], accentRatio: 0.12 } },
  halloween: { label: 'Halloween', particles: { kind: 'glyph', count: 6, glyphs: ['🦇'], mode: 'drift', alpha: 0.35, accents: ['🎃', '👻'], accentRatio: 0.35 } },
  july4: { label: 'July 4th', particles: { kind: 'confetti', count: 25, colors: ['#ff4d4d', '#ffffff', '#4d79ff'], accents: ['🎆'], accentRatio: 0.12 } },
  thanksgiving: { label: 'Thanksgiving', particles: { kind: 'glyph', count: 14, glyphs: ['🍂', '🍁'], alpha: 0.5, accents: ['🦃'], accentRatio: 0.1 } },
  valentine: { label: "Valentine's Day", particles: { kind: 'glyph', count: 12, glyphs: ['♥'], colors: ['#ff8fa3', '#ff5c7a'], mode: 'rise', alpha: 0.4, accents: ['💕'], accentRatio: 0.15 } }
};

/**
 * Renders subtle holiday decorations as a low-opacity full-screen particle
 * animation on a canvas, with occasional larger accent emoji (snowman, ghost,
 * turkey, ...) mixed in among the base particles.
 * Off by default; toggled from the credits page and persisted in localStorage.
 */
class HolidayThemeManager {
  constructor() {
    this.layerEl = document.getElementById('holiday-layer');
    this.canvasEl = document.getElementById('holiday-canvas');
    this.ctx = this.canvasEl ? this.canvasEl.getContext('2d') : null;
    this._holiday = null;
    this._forcedHoliday = null; // Debug override via ?holiday=<name> or Ctrl+H cycling
    this._toastTimer = null;
    this._particles = [];
    this._rafId = null;
    this._lastTs = 0;
    this._onResize = () => this._resizeCanvas();
  }

  /**
   * Apply the current theme and re-evaluate hourly so decorations
   * appear/disappear at day boundaries without a reload.
   */
  start() {
    this.refresh();
    this._refreshId = setInterval(() => this.refresh(), 60 * 60 * 1000);
  }

  /**
   * Stop the hourly re-evaluation and any running particle animation.
   */
  stop() {
    if (this._refreshId) {
      clearInterval(this._refreshId);
      this._refreshId = null;
    }
    this._stopParticles();
  }

  /**
   * Re-evaluate the enabled flag and today's date, updating the display.
   */
  refresh() {
    const holiday = this._forcedHoliday ||
      (APP_SETTINGS.holidayThemeEnabled ? getActiveHoliday(new Date()) : null);
    if (holiday === this._holiday) return;
    this._holiday = holiday;
    this._apply(holiday);
  }

  /**
   * Cycle through each theme as a forced preview (testing aid, Ctrl+H).
   * After the last theme, returns to automatic date-based behavior.
   */
  cycle() {
    const names = Object.keys(HOLIDAY_THEMES);
    const idx = this._forcedHoliday ? names.indexOf(this._forcedHoliday) : -1;
    this._forcedHoliday = idx + 1 < names.length ? names[idx + 1] : null;
    this.refresh();
    this._showCycleToast();
  }

  _showCycleToast() {
    const toast = document.getElementById('holiday-cycle-toast');
    if (!toast) return;
    toast.textContent = this._forcedHoliday
      ? `Holiday preview: ${HOLIDAY_THEMES[this._forcedHoliday].label}`
      : 'Holiday preview: off (automatic)';
    toast.classList.add('visible');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => toast.classList.remove('visible'), 2000);
  }

  _apply(holiday) {
    if (!this.layerEl) return;
    if (!holiday) {
      this.layerEl.classList.remove('active');
      this._stopParticles();
      return;
    }
    const theme = HOLIDAY_THEMES[holiday];
    this.layerEl.classList.add('active');
    this._startParticles(theme.particles);
  }

  _resizeCanvas() {
    if (!this.canvasEl) return;
    this.canvasEl.width = window.innerWidth;
    this.canvasEl.height = window.innerHeight;
  }

  _startParticles(cfg) {
    this._stopParticles();
    if (!this.ctx) return;
    this._resizeCanvas();
    window.addEventListener('resize', this._onResize);
    const w = this.canvasEl.width;
    const h = this.canvasEl.height;
    this._particles = [];
    for (let i = 0; i < cfg.count; i++) {
      this._particles.push(this._spawnParticle(cfg, w, h, true));
    }
    this._lastTs = 0;
    const loop = (ts) => {
      this._rafId = requestAnimationFrame(loop);
      const dt = this._lastTs ? Math.min((ts - this._lastTs) / 1000, 0.1) : 0.016;
      this._lastTs = ts;
      this._drawFrame(cfg, dt);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  _stopParticles() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    window.removeEventListener('resize', this._onResize);
    this._particles = [];
    if (this.ctx && this.canvasEl) {
      this.ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
    }
  }

  /**
   * Create one particle. When `anywhere` is true the particle is scattered
   * across the screen (initial fill); otherwise it starts just off-screen on
   * the edge it enters from.
   */
  _spawnParticle(cfg, w, h, anywhere) {
    const mode = cfg.mode || 'fall';
    const isAccent = !!(cfg.accents && Math.random() < (cfg.accentRatio || 0.08));
    const p = {
      x: anywhere ? Math.random() * w : (mode === 'drift' ? -40 : Math.random() * w),
      y: anywhere || mode === 'drift' ? Math.random() * h : (mode === 'rise' ? h + 30 : -30),
      size: 0,
      speed: 0,
      phase: Math.random() * Math.PI * 2,
      sway: 15 + Math.random() * 25,
      rot: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 2,
      alpha: 0,
      color: null,
      glyph: null
    };
    if (isAccent) {
      // Larger emoji drifting slowly among the base particles (snowman, ghost, ...)
      p.glyph = cfg.accents[Math.floor(Math.random() * cfg.accents.length)];
      p.size = 20 + Math.random() * 12;
      p.speed = 10 + Math.random() * 10;
      p.alpha = 0.3 + Math.random() * 0.2;
      p.sway = 8 + Math.random() * 10;
      return p;
    }
    p.color = cfg.colors ? cfg.colors[Math.floor(Math.random() * cfg.colors.length)] : null;
    if (cfg.kind === 'snow') {
      p.size = 1 + Math.random() * 2.5;
      p.speed = 15 + Math.random() * 30;
      p.alpha = 0.15 + Math.random() * 0.35;
    } else if (cfg.kind === 'confetti') {
      p.size = 3 + Math.random() * 4;
      p.speed = 20 + Math.random() * 30;
      p.alpha = 0.2 + Math.random() * 0.3;
    } else {
      p.glyph = cfg.glyphs ? cfg.glyphs[Math.floor(Math.random() * cfg.glyphs.length)] : null;
      p.size = 10 + Math.random() * 8;
      p.speed = 12 + Math.random() * 18;
      p.alpha = (cfg.alpha || 0.5) * (0.6 + Math.random() * 0.4);
    }
    if (mode === 'drift') p.speed = 8 + Math.random() * 12;
    return p;
  }

  _drawFrame(cfg, dt) {
    const ctx = this.ctx;
    const w = this.canvasEl.width;
    const h = this.canvasEl.height;
    const mode = cfg.mode || 'fall';
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < this._particles.length; i++) {
      const p = this._particles[i];
      p.phase += dt;
      if (mode === 'rise') {
        p.y -= p.speed * dt;
        p.x += Math.sin(p.phase) * p.sway * dt;
      } else if (mode === 'drift') {
        p.x += p.speed * dt;
        p.y += Math.sin(p.phase) * 10 * dt;
      } else {
        p.y += p.speed * dt;
        p.x += Math.sin(p.phase) * p.sway * dt;
      }
      p.rot += p.rotSpeed * dt;
      const off = 40;
      const gone = mode === 'rise' ? p.y < -off : mode === 'drift' ? p.x > w + off : p.y > h + off;
      if (gone) {
        this._particles[i] = this._spawnParticle(cfg, w, h, false);
        continue;
      }
      ctx.globalAlpha = p.alpha;
      if (p.glyph) {
        // Emoji/char particles: base glyphs and larger accents (snowman, ghost, ...)
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.sin(p.phase) * 0.3);
        ctx.font = `${Math.round(p.size)}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (p.color) ctx.fillStyle = p.color;
        ctx.fillText(p.glyph, 0, 0);
        ctx.restore();
      } else if (cfg.kind === 'snow') {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }
}

// --- DisplaySync (dual-screen support) ---

// Display modes for the two-TV setup (key 7 cycles):
//   mirror     — both screens show the same content
//   clocktimer — screen 1 shows the timer, screen 2 a dedicated big clock
//   split      — dual-timer mode with one timer fullscreen per screen
const DISPLAY_MODES = ['mirror', 'clocktimer', 'split'];
const DISPLAY_MODE_LABELS = {
  mirror: 'Mirror',
  clocktimer: 'Clock + Timer',
  split: 'Split Timers'
};
const DISPLAY_MODE_STORAGE_KEY = 'bjj-timer-display-mode';

/**
 * Return the display mode after `mode` in the cycle.
 * Unknown input starts the cycle at the first mode.
 * @param {string} mode
 * @returns {string}
 */
function nextDisplayMode(mode) {
  const idx = DISPLAY_MODES.indexOf(mode);
  return DISPLAY_MODES[(idx + 1) % DISPLAY_MODES.length];
}

// Elements of the primary's DOM mirrored to secondary displays. These are
// deliberately small leaves (the timer digits, the status bar, ...) so a tick
// only re-sends and re-parses the few elements that actually changed. The
// wall clock, class-progress canvas, and holiday canvas are NOT synced —
// secondaries render those locally (they're derived from wall time).
const SYNC_SECTION_IDS = [
  'preset-label', 'round-timer', 'rest-timer', 'round-counter', 'scoreboard',
  'round-timer-2', 'rest-timer-2',
  'overlay', 'edit-instruction-bar', 'prep-overlay', 'screen-flash',
  'round-list', 'next-class-display', 'status-bar', 'schedule-display',
  'stealth-hint', 'temperature'
];

// Containers whose class/style attributes carry layout state (dual mode,
// paused grayscale, time-setting) but whose children are synced above.
const SYNC_ATTR_IDS = [
  'timer-area', 'dual-timer-container', 'timer-panel-1', 'timer-panel-2'
];

const SYNC_HEARTBEAT_MS = 10000;
const SYNC_DEBOUNCE_MS = 40;

/**
 * Serialize the synced parts of a document into a snapshot object.
 * @param {Document} doc
 * @param {function} getMeta - Returns non-DOM state to include (mode, stealth, ...)
 * @param {string} sessionId
 * @returns {Object}
 */
function buildSyncSnapshot(doc, getMeta, sessionId) {
  const sections = {};
  for (const id of SYNC_SECTION_IDS) {
    const el = doc.getElementById(id);
    if (el) sections[id] = el.outerHTML;
  }
  const attrs = {};
  for (const id of SYNC_ATTR_IDS) {
    const el = doc.getElementById(id);
    if (el) attrs[id] = { class: el.getAttribute('class') || '', style: el.getAttribute('style') || '' };
  }
  return {
    sessionId,
    sentAt: Date.now(),
    flashSequence: Number(doc.getElementById('screen-flash')?.dataset.flashSequence || 0),
    bodyClass: doc.body.className,
    sections,
    attrs,
    meta: getMeta ? getMeta() : {}
  };
}

/**
 * Update an existing element in place from serialized outerHTML: attributes
 * are reconciled and children replaced, but the element object itself is
 * kept so cached references (Renderer, stealth handling) stay valid.
 * @param {Element} el
 * @param {string} html - outerHTML of the same element from the primary
 */
// Relay markup is an untrusted wire format. Keep only the inert tags and
// attributes used by the kiosk; never copy handlers, URLs, custom elements,
// embedded documents or executable SVG into the live document.
function safeSyncStyle(doc, css) {
  const probe = doc.createElement('span');
  probe.style.cssText = typeof css === 'string' ? css : '';
  for (const name of Array.from(probe.style)) {
    const value = probe.style.getPropertyValue(name);
    if (/url|image-set|expression|@|\\|\/\*/i.test(value) || name.startsWith('--')) probe.style.removeProperty(name);
  }
  return probe.style.cssText;
}

function syncElementFromHtml(el, html) {
  if (typeof html !== 'string') return;
  const tpl = el.ownerDocument.createElement('template');
  tpl.innerHTML = html;
  const src = tpl.content.firstElementChild;
  if (!src || tpl.content.childElementCount !== 1 || src.id !== el.id || src.localName !== el.localName) return;
  const tags = new Set(['div', 'span', 'b', 'strong', 'em', 'small', 'br', 'p', 'img', 'svg', 'path', 'circle', 'line', 'polyline', 'polygon', 'rect', 'g']);
  if (!tags.has(src.localName)) return;
  const attributes = new Set(['class', 'style', 'title', 'role', 'aria-hidden', 'aria-label', 'width', 'height', 'viewbox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'd', 'cx', 'cy', 'r', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'rx', 'points', 'opacity', 'alt', 'data-flash-sequence']);
  for (const node of [src, ...src.querySelectorAll('*')]) {
    if (!tags.has(node.localName)) { node.remove(); continue; }
    for (const attr of Array.from(node.attributes)) {
      if (attr.name === 'id') continue;
      if (attr.name === 'src' && node.localName === 'img' && attr.value === 'paco.png') continue;
      if (!attributes.has(attr.name.toLowerCase()) || /url\s*\(|expression|javascript:|\\/i.test(attr.value)) node.removeAttribute(attr.name);
      else if (attr.name === 'style') node.setAttribute('style', safeSyncStyle(el.ownerDocument, attr.value));
    }
  }
  for (const attr of Array.from(el.attributes)) {
    if (!src.hasAttribute(attr.name)) el.removeAttribute(attr.name);
  }
  for (const attr of Array.from(src.attributes)) {
    if (el.getAttribute(attr.name) !== attr.value) el.setAttribute(attr.name, attr.value);
  }
  if (el.innerHTML !== src.innerHTML) el.replaceChildren(...src.childNodes);
}

/**
 * Apply a snapshot to a secondary document. `applied` remembers what was
 * last written per element so unchanged sections are skipped.
 * @param {Document} doc
 * @param {Object} snap
 * @param {Object} applied - Mutable cache: { sections: {}, attrs: {} }
 */
function applySyncSnapshot(doc, snap, applied) {
  if (!snap || typeof snap !== 'object') return;
  applied.sections = applied.sections || {};
  applied.attrs = applied.attrs || {};
  const sections = snap.sections || {};
  for (const id of Object.keys(sections)) {
    if (!SYNC_SECTION_IDS.includes(id)) continue;
    if (applied.sections[id] === sections[id]) continue;
    const el = doc.getElementById(id);
    if (!el) continue;
    syncElementFromHtml(el, sections[id]);
    applied.sections[id] = sections[id];
  }
  const attrs = snap.attrs || {};
  for (const id of Object.keys(attrs)) {
    if (!SYNC_ATTR_IDS.includes(id) || !attrs[id] || typeof attrs[id].class !== 'string') continue;
    const key = `${attrs[id].class} ${attrs[id].style}`;
    if (applied.attrs[id] === key) continue;
    const el = doc.getElementById(id);
    if (!el) continue;
    if (attrs[id].class) el.setAttribute('class', attrs[id].class); else el.removeAttribute('class');
    if (attrs[id].style) el.setAttribute('style', safeSyncStyle(doc, attrs[id].style)); else el.removeAttribute('style');
    applied.attrs[id] = key;
  }
  doc.body.className = typeof snap.bodyClass === 'string' ? snap.bodyClass : 'timer-idle';
  if (Number.isSafeInteger(snap.flashSequence) && snap.flashSequence > 0 &&
      (applied.sessionId !== snap.sessionId || applied.flashSequence !== snap.flashSequence)) {
    const flash = doc.getElementById('screen-flash');
    if (flash) {
      flash.classList.remove('active');
      void flash.offsetWidth;
      flash.classList.add('active');
    }
  }
  applied.sessionId = snap.sessionId;
  applied.flashSequence = snap.flashSequence;
}

/**
 * Relays UI state from the primary kiosk window to secondary display windows
 * through the update server (port 3001), which fans snapshots out over SSE.
 * An HTTP relay is used instead of BroadcastChannel because the two kiosk
 * windows run as separate Chromium instances with separate profiles.
 */
class DisplaySyncManager {
  constructor() {
    this._sessionId = null;
    this._seq = 0;
    this._lastPayload = '';
    this._lastSentAt = 0;
    this._pending = null;
    this._observer = null;
    this._getMeta = null;
    this._timerId = null;
    this._es = null;
    this._keyListeners = null;
    this._keyQueue = Promise.resolve();
    this._stopped = false;
  }

  /**
   * Disconnect observers, timers, event streams and relayed key listeners.
   */
  stop() {
    this._stopped = true;
    if (this._observer) { this._observer.disconnect(); this._observer = null; }
    if (this._timerId !== null) { clearInterval(this._timerId); this._timerId = null; }
    if (this._pending !== null) { clearTimeout(this._pending); this._pending = null; }
    if (this._es) { if (typeof this._es.close === 'function') this._es.close(); this._es = null; }
    if (this._keyListeners) {
      document.removeEventListener('keydown', this._keyListeners.down);
      document.removeEventListener('keyup', this._keyListeners.up);
      window.removeEventListener('blur', this._keyListeners.clearEnter);
      document.removeEventListener('visibilitychange', this._keyListeners.clearEnter);
      this._keyListeners = null;
    }
  }

  /**
   * Start broadcasting UI snapshots. A MutationObserver on the synced
   * elements triggers a (debounced) broadcast whenever they change, and a
   * 10s heartbeat keeps late-joining secondaries fresh. Falls back to
   * polling when MutationObserver is unavailable.
   * @param {function} getMeta - Returns non-DOM state to include (mode, stealth, ...)
   */
  startPrimary(getMeta) {
    this._sessionId = String(Date.now()) + '-' + Math.random().toString(36).slice(2);
    this._getMeta = getMeta;

    if (typeof MutationObserver === 'function') {
      this._observer = new MutationObserver(() => this.requestBroadcast());
      const opts = { childList: true, subtree: true, attributes: true, characterData: true };
      for (const id of SYNC_SECTION_IDS.concat(SYNC_ATTR_IDS)) {
        const el = document.getElementById(id);
        if (el) this._observer.observe(el, opts);
      }
      this._observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      this._timerId = setInterval(() => this._broadcast(true), SYNC_HEARTBEAT_MS);
    } else {
      this._timerId = setInterval(() => this._broadcast(false), 250);
    }
    this._broadcast(true);

    // Replay keys pressed on a secondary window (relayed via the server) as if
    // they were typed here — keeps the keyboard working whichever kiosk
    // window happens to hold focus.
    const es = new EventSource('http://localhost:3001/key-events');
    this._es = es;
    es.onmessage = (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch (err) { return; }
      if (!data || typeof data !== 'object') return;
      if (data.type === 'press' && Number.isFinite(data.heldMs) && data.heldMs >= 0) {
        const down = new KeyboardEvent('keydown', { key: data.key, code: data.code, cancelable: true });
        Object.defineProperty(down, 'relayHeldMs', { value: data.heldMs });
        document.dispatchEvent(down);
        document.dispatchEvent(new KeyboardEvent('keyup', { key: data.key, code: data.code, cancelable: true }));
        return;
      }
      if (data.type !== 'keydown' && data.type !== 'keyup') return;
      document.dispatchEvent(new KeyboardEvent(data.type, {
        key: data.key, code: data.code, ctrlKey: !!data.ctrlKey,
        repeat: !!data.repeat, cancelable: true
      }));
    };
  }

  /**
   * Coalesce a burst of DOM mutations (one tick touches several elements)
   * into a single broadcast.
   */
  requestBroadcast() {
    if (this._pending !== null) return;
    this._pending = setTimeout(() => {
      this._pending = null;
      this._broadcast(false);
    }, SYNC_DEBOUNCE_MS);
  }

  /**
   * Serialize and POST the current snapshot. Unchanged payloads are skipped
   * unless `force` is set (heartbeat) or the last send is older than the
   * heartbeat interval.
   * @param {boolean} force
   */
  _broadcast(force) {
    const snapshot = buildSyncSnapshot(document, this._getMeta, this._sessionId);
    const comparison = JSON.stringify({ ...snapshot, sentAt: 0 });
    const now = Date.now();
    if (!force && comparison === this._lastPayload && now - this._lastSentAt < SYNC_HEARTBEAT_MS) return;
    // POSTs run concurrently; the sequence number lets the server and the
    // secondary drop a slow older snapshot that lands after a newer one.
    snapshot.seq = ++this._seq;
    const payload = JSON.stringify(snapshot);
    this._lastPayload = comparison;
    this._lastSentAt = now;
    fetch('http://localhost:3001/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Update-Request': APP_SETTINGS.relay.sharedKey },
      body: payload
    }).catch(() => {});
  }

  /**
   * Subscribe to primary snapshots. EventSource auto-reconnects if the
   * server restarts, and the server replays the last snapshot on connect.
   * @param {function} onSnapshot - Called with each parsed snapshot
   */
  startSecondary(onSnapshot) {
    const status = document.getElementById('sync-status');
    let receivedAt = null;
    let hasConnected = false;
    let lastSeen = null; // { sessionId, seq } of the newest snapshot applied
    const showStale = () => {
      const stale = hasConnected && (receivedAt === null || performance.now() - receivedAt >= SYNC_HEARTBEAT_MS * 2.5);
      if (status) status.hidden = !stale;
      document.documentElement.classList.toggle('sync-stale', stale);
    };
    showStale();
    this._timerId = setInterval(showStale, 1000);
    const es = new EventSource('http://localhost:3001/sync-events');
    this._es = es;
    es.onerror = () => { receivedAt = null; showStale(); };
    es.onmessage = (e) => {
      let snap;
      try { snap = JSON.parse(e.data); } catch (err) { return; }
      if (!snap || typeof snap !== 'object' || !Number.isFinite(snap.sentAt) ||
          Math.abs(Date.now() - snap.sentAt) > SYNC_HEARTBEAT_MS * 2.5) return;
      if (lastSeen && Number.isFinite(snap.seq) && snap.sessionId === lastSeen.sessionId && snap.seq < lastSeen.seq) return;
      if (Number.isFinite(snap.seq)) lastSeen = { sessionId: snap.sessionId, seq: snap.seq };
      receivedAt = performance.now();
      hasConnected = true;
      onSnapshot(snap);
      showStale();
    };

    // Deliver events in order. Hold-capable keys (OK / ▶ / Menu) travel as one
    // completed gesture so a slow/lost keyup request cannot invent a long
    // press on the primary.
    let enterDown = null;
    let enterKey = null;
    const clearEnter = () => { enterDown = null; enterKey = null; };
    const isHoldKey = (e) => e.key === 'Enter' || e.code === 'NumpadEnter' || e.key === ' ' || e.code === 'Space' || e.key === 'Escape';
    const relay = (data) => {
      this._keyQueue = this._keyQueue.then(async () => {
        if (this._stopped) return;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        try {
          await fetch('http://localhost:3001/keys', {
            method: 'POST', signal: controller.signal,
            headers: { 'Content-Type': 'application/json', 'X-Update-Request': APP_SETTINGS.relay.sharedKey },
            body: JSON.stringify(data)
          });
        } catch (e) { /* The next gesture can still be delivered. */ }
        finally { clearTimeout(timeout); }
      });
    };
    const dataFor = (type, e) => ({ type, key: e.key, code: e.code, ctrlKey: e.ctrlKey, repeat: e.repeat });
    const down = (e) => {
      e.preventDefault();
      // A different key mid-hold (e.g. Flirc's long-press key) cancels the
      // pending gesture, mirroring the primary, so its release relays nothing.
      if (enterDown !== null && !e.repeat && e.key !== enterKey) clearEnter();
      if (isHoldKey(e)) {
        if (!e.repeat && enterDown === null) { enterDown = performance.now(); enterKey = e.key; }
      } else relay(dataFor('keydown', e));
    };
    const up = (e) => {
      if (isHoldKey(e)) {
        const heldMs = enterDown === null || enterKey !== e.key ? null : performance.now() - enterDown;
        // Lost releases or suspended pages must not invent a long press.
        if (heldMs !== null && heldMs >= 0 && heldMs <= 10000) relay({ ...dataFor('press', e), heldMs });
        clearEnter();
      } else relay(dataFor('keyup', e));
    };
    this._keyListeners = { down, up, clearEnter };
    document.addEventListener('keydown', down);
    document.addEventListener('keyup', up);
    window.addEventListener('blur', clearEnter);
    document.addEventListener('visibilitychange', clearEnter);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { formatTime, isValidSeconds, isNumeric, escapeHtml, generateRoundDurations, DEFAULT_CONFIG, APP_SETTINGS, applyConfigSettings, PHASES, prepBeepSecond, STORAGE_KEY, StorageManager, createTimerState, TimerEngine, AudioManager, ICONS, presetIcon, TRAINING_MODES, Renderer, ClassProgressRenderer, OverlayManager, InputHandler, ClassPresetManager, ScheduleManager, WeatherManager, HolidayThemeManager, HOLIDAY_THEMES, getActiveHoliday, VALID_DAYS, VALID_CLASS_TYPES, SCHEDULE_STORAGE_KEY, SYNCED_SCHEDULE_FILE, DISPLAY_MODES, DISPLAY_MODE_LABELS, DISPLAY_MODE_STORAGE_KEY, nextDisplayMode, DisplaySyncManager, SYNC_SECTION_IDS, SYNC_ATTR_IDS, buildSyncSnapshot, applySyncSnapshot, syncElementFromHtml, HOLD_MS, TRAINING_MENU_ITEMS, moveSelection, stepNumericBuffer, STRINGS, LANGUAGES, t, setLanguage, applyStaticTranslations, presetDisplayName, classDisplayName, CLASS_TITLES, Scoreboard, SCORE_FIELDS, SCORE_BURST_MS, TetrisGame, TETRIS_COLS, TETRIS_ROWS, TETRIS_SCORES_KEY, TETRIS_SCORES_MAX, TETRIS_NAME_CHARS, loadTetrisScores, recordTetrisScore, normalizeTetrisName };
}

// --- Application Initialization ---
// Only run in browser (not in Node.js test environment)
if (typeof window !== 'undefined' && typeof document !== 'undefined') {

  /**
   * Boot a secondary display window (?screen=2). Runs no timer engines and no
   * input handling — timer UI arrives as DOM snapshots from the primary via
   * the sync relay, while wall-clock/class-progress/holiday rendering (all
   * derived from local time and config.json) runs locally.
   */
  function initSecondaryDisplay(urlParams) {
    applyStaticTranslations();
    const renderer = new Renderer();
    const presetManager = new ClassPresetManager();
    const classProgress = new ClassProgressRenderer();
    document.body.classList.add('timer-idle');

    const scheduleManager = new ScheduleManager(
      presetManager,
      (activeClass) => {
        classProgress.setActiveClass(APP_SETTINGS.scheduleEnabled ? activeClass : null);
      },
      () => {}
    );
    scheduleManager.loadConfig().then(() => scheduleManager.startPolling());

    const holidayTheme = new HolidayThemeManager();
    const forcedHoliday = urlParams.get('holiday');
    if (forcedHoliday && HOLIDAY_THEMES[forcedHoliday]) {
      holidayTheme._forcedHoliday = forcedHoliday;
    }
    holidayTheme.start();

    renderer.updateClockDisplay();
    const clockId = setInterval(() => {
      renderer.updateClockDisplay();
      classProgress.draw();
    }, 1000);

    const applied = { sections: {}, attrs: {} };
    let seenSessionId = null;
    const sync = new DisplaySyncManager();
    sync.startSecondary((snap) => {
      // Primary reloaded (e.g. after a git update) — reload to match its code
      if (seenSessionId && snap.sessionId !== seenSessionId) {
        window.location.reload();
        return;
      }
      seenSessionId = snap.sessionId;

      applySyncSnapshot(document, snap, applied);

      const meta = snap.meta || {};
      const root = document.documentElement;
      const mode = DISPLAY_MODES.includes(meta.displayMode) ? meta.displayMode : 'mirror';
      DISPLAY_MODES.forEach(m => root.classList.remove('mode-' + m));
      root.classList.add('mode-' + mode);
      root.classList.toggle('editing', meta.editing === true);
      if (LANGUAGES.includes(meta.language) && meta.language !== APP_SETTINGS.language) setLanguage(meta.language);

      if (typeof meta.scheduleEnabled === 'boolean' && meta.scheduleEnabled !== APP_SETTINGS.scheduleEnabled) {
        APP_SETTINGS.scheduleEnabled = meta.scheduleEnabled;
        classProgress.setActiveClass(meta.scheduleEnabled ? scheduleManager.getActiveClass(new Date()) : null);
      }
      if (typeof meta.holidayThemeEnabled === 'boolean' && meta.holidayThemeEnabled !== APP_SETTINGS.holidayThemeEnabled) {
        APP_SETTINGS.holidayThemeEnabled = meta.holidayThemeEnabled;
        holidayTheme.refresh();
      }
      // Stealth hides locally-rendered elements (clock, progress circle);
      // synced sections already carry the primary's inline visibility styles
      renderer.stealth = !!meta.stealth;
      renderer.applyStealth(meta.phase, meta.phase2);
    });

    // Handle for tests/tooling to shut the instance down cleanly
    window.__bjjApp = {
      teardown() {
        clearInterval(clockId);
        scheduleManager.stopPolling();
        holidayTheme.stop();
        sync.stop();
        window.__bjjApp = null;
      }
    };
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);

    // --- Dual-screen support (opt-in only) ---
    // Plain URL = original single-screen app, untouched by any of this.
    // ?screen=2 boots the display-only secondary window; ?dual=1 makes the
    // primary broadcast state and enables the key-7 display mode cycle.
    const isSecondaryDisplay = urlParams.get('screen') === '2';
    const dualScreenEnabled = urlParams.get('dual') === '1';
    if (isSecondaryDisplay) {
      document.documentElement.classList.add('screen2');
      initSecondaryDisplay(urlParams);
      return;
    }
    if (dualScreenEnabled) {
      document.documentElement.classList.add('screen1');
    }

    // --- Debug mode ---
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

    // Load defaults before constructing either timer (including saved Split mode).
    let initialConfig;
    const configAbort = new AbortController();
    const configTimeout = setTimeout(() => configAbort.abort(), 5000);
    try {
      const response = await fetch('config.json', { cache: 'no-store', signal: configAbort.signal });
      if (response.ok) initialConfig = await response.json();
    } catch (e) { /* Offline boot uses validated storage/built-in defaults. */ }
    finally { clearTimeout(configTimeout); }
    applyConfigSettings(initialConfig);

    // 1. Saved values take precedence over the now-loaded defaults.
    const config = StorageManager.load();

    // 2. Create timer state from config
    const state = createTimerState(config);

    // 3. Create UI and audio components
    const renderer = new Renderer();
    const audioManager = new AudioManager();
    // Eagerly create AudioContext so it's ready for end-of-class ring, and
    // fetch the bell files so the first ring does not wait on the network
    audioManager._ensureContext();
    audioManager.preload();
    const presetManager = new ClassPresetManager();
    const classProgress = new ClassProgressRenderer();

    // Set initial idle state for layout
    document.body.classList.add('timer-idle');
    document.body.classList.toggle('quiet-visuals', APP_SETTINGS.quietVisuals);
    applyStaticTranslations();

    // 4. Pending class type for deferred preset loading (Req 19.3, 19.4)
    let pendingClass = null;
    let hadActiveClass = false; // Track for end-of-class ring
    let lastActiveClassKey = null; // Preserve ring identity across schedule toggles
    let _inputHandlerRef = null; // Set after InputHandler is created

    /**
     * Apply a class preset that arrived while the timer was busy (running,
     * paused or being edited). Open Mat gets its preset but does not auto-start.
     */
    const applyPendingClass = () => {
      if (!pendingClass) return;
      const s = state;
      const preset = pendingClass.classType === 'open_mat' ? APP_SETTINGS.competitionPresets['Blue Belt'] : presetManager.getPreset(pendingClass.classType);
      if (preset) {
        s.config.roundDurationSec = preset.roundDurationSec;
        s.config.restDurationSec = preset.restDurationSec;
        s.config.numRounds = preset.numRounds;
        s.remainingSec = preset.roundDurationSec;
        s.roundDurations = null;
        s.restDurations = null;
        s._presetName = pendingClass.title;
        renderer.updatePresetLabel(s._presetName);
        inputHandler._updateScoreboardVisibility();
        StorageManager.save(s.config);
        renderer.updateRoundDisplay(s.config.roundDurationSec, false);
        renderer.updateRestDisplay(s.config.restDurationSec, false);
        renderer.updateRoundCounter(0, s.config.numRounds);
      }
      pendingClass = null;
    };

    // 5. Create TimerEngine with tick and phase-change callbacks
    const engine = new TimerEngine(state,
      // onTick — update displays each second (the wall clock has its own
      // one-second interval, so it is not repainted here)
      (s) => {
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
          renderer.updateRoundList(s.roundDurations, s.currentRound, s._presetName, s.restDurations, s.config.restDurationSec, renderer.getRemainingClassSec(), s.remainingSec, s.phase);
        }
        // Re-apply stealth visibility each tick (rest shows/hides based on phase)
        if (renderer.stealth) renderer.applyStealth(s.phase);
      },
      // onPhaseChange — handle transitions and deferred preset loading
      (s, oldPhase, newPhase) => {
        if (newPhase === PHASES.ROUND) {
          engine.emitTransitionCue(() => audioManager.playRoundStartFanfare());
        }
        if (oldPhase === PHASES.PREP && newPhase === PHASES.ROUND) {
          renderer.hidePrepCountdown();
        }
        // Show the prep overlay immediately on session start (the first tick
        // would otherwise leave it blank for a second and never show the full value)
        if (newPhase === PHASES.PREP) {
          renderer.showPrepCountdown(s.remainingSec);
        }
        // Hide the prep overlay if the session is stopped mid-prep
        if (newPhase === PHASES.IDLE) {
          renderer.hidePrepCountdown();
        }
        // "Rounds Over" — go to ready state (enlarged) instead of showing overlay
        if (newPhase === PHASES.IDLE && oldPhase === PHASES.ROUND && !s._cancelledByUser) {
          const rd = s.roundDurations;
          renderer.updateRoundDisplay(rd ? rd[0] : s.config.roundDurationSec, false);
          renderer.updateRestDisplay(s.config.restDurationSec, false);
          renderer.updateRoundCounter(0, rd ? rd.length : s.config.numRounds);
        }
        // When session stops and there's a pending class preset, apply it (Req 19.3, 19.4)
        if (newPhase === PHASES.IDLE) applyPendingClass();
        // Reset round list to preview when session ends (preserve if preset active)
        if (newPhase === PHASES.IDLE) {
          if (s.roundDurations) {
            renderer.updateRoundList(s.roundDurations, 0, s._presetName, s.restDurations, s.config.restDurationSec, renderer.getRemainingClassSec());
          } else {
            renderer.hideRoundList();
          }
        }
        // Update status bar based on new phase
        if (newPhase === PHASES.IDLE) {
          if (_inputHandlerRef && _inputHandlerRef._ready) {
            renderer.updateStatusBar('ready');
          } else {
            renderer.updateStatusBar('clock');
          }
        } else {
          renderer.updateStatusBar(state.paused ? 'paused' : 'running');
        }
        // Toggle idle class for layout animation
        // Stay enlarged (ready state) when rounds end naturally
        if (newPhase === PHASES.IDLE && oldPhase === PHASES.ROUND && !state._cancelledByUser) {
          document.body.classList.remove('timer-idle');
          if (_inputHandlerRef) _inputHandlerRef._ready = true;
          // Rounds ran out: say so, instead of looking like a restarted timer
          renderer.updateStatusBar('finished');
        } else {
          document.body.classList.toggle('timer-idle', newPhase === PHASES.IDLE && !state.paused);
        }
        // Clear the cancel flag last — both guards above read it
        s._cancelledByUser = false;
      }
    );

    // 6. Wrap tick to integrate alert-driven audio and visual feedback
    const originalTick = engine.tick.bind(engine);
    engine.tick = function() {
      const currentPhase = state.phase;
      const alert = originalTick();

      if (alert.type === 'end_round' || alert.type === 'end_rest') {
        engine.emitTransitionCue(() => {
          if (alert.type === 'end_round') audioManager.playEndOfRoundBeep();
          else audioManager.playEndOfRestBeep();
          renderer.applyScreenFlash();
        });
      }
      if (engine.silent) return alert;

      // Prep countdown beeps
      const prepSecond = prepBeepSecond(currentPhase, alert.remainingSec, state.config.prepDurationSec);
      if (prepSecond !== null) {
        audioManager.playPrepBeep(prepSecond, state.config.prepDurationSec);
      }

      // Round/rest countdown alerts
      if (alert.type === 'countdown') {
        audioManager.playCountdownBeep();
        if (state.phase === PHASES.ROUND) renderer.applyFlash(renderer.roundTimerEl);
        if (state.phase === PHASES.REST) renderer.applyFlash(renderer.restTimerEl);
      }

      // Uplifting fanfare when transitioning from PREP to ROUND — handled in onPhaseChange

      return alert;
    };

    // 7. Create overlay and input handler
    const overlayManager = new OverlayManager();
    const inputHandler = new InputHandler(engine, overlayManager, renderer, audioManager, state);
    // Everything the app schedules or subscribes to, so the instance can be
    // shut down (used by the boot tests; harmless in the kiosk)
    const intervals = [];
    let displaySync = null;
    let weatherManager = null;

    // Holiday decorations (off by default; toggled from the main menu).
    // ?holiday=<christmas|newyear|halloween|july4|thanksgiving|valentine> forces
    // a theme for previewing outside its date range.
    const holidayTheme = new HolidayThemeManager();
    const forcedHoliday = urlParams.get('holiday');
    if (forcedHoliday && HOLIDAY_THEMES[forcedHoliday]) {
      holidayTheme._forcedHoliday = forcedHoliday;
    }
    holidayTheme.start();
    overlayManager._onHolidayToggle = () => holidayTheme.refresh();
    inputHandler._holidayTheme = holidayTheme; // Ctrl+H cycles theme previews
    _inputHandlerRef = inputHandler;
    renderer.phaseProvider = () => [state.phase, inputHandler._dualState?.phase];

    // 7b. Dual-screen display mode (only with ?dual=1: key 7 cycles modes and
    // state is broadcast to the secondary window via the sync relay). Without
    // the flag none of this runs and the app behaves exactly as single-screen.
    const initDisplayMode = () => {
      if (!dualScreenEnabled) return;
      renderer.showScreensKey = true;
      if (state.phase === PHASES.IDLE) renderer.updateStatusBar('clock');
      let displayMode = null;
      let displayModeToastTimer = null;
      const setDisplayMode = (mode, opts) => {
        let requested = DISPLAY_MODES.includes(mode) ? mode : 'mirror';
        if (requested === 'split' && !inputHandler._dualMode && state.phase !== PHASES.IDLE) {
          if (displayMode !== null) return;
          requested = 'mirror';
        }
        displayMode = requested;
        try {
          localStorage.setItem(DISPLAY_MODE_STORAGE_KEY, displayMode);
        } catch (e) {
          // localStorage unavailable — mode applies for this session only
        }
        const root = document.documentElement;
        DISPLAY_MODES.forEach(m => root.classList.remove('mode-' + m));
        root.classList.add('mode-' + displayMode);
        // Split mode shows one dual-mode panel per screen, so it needs dual timers
        if (displayMode === 'split' && !inputHandler._dualMode) {
          inputHandler._activateDualMode();
        }
        if (!opts || !opts.silent) {
          const toast = document.getElementById('display-mode-toast');
          if (toast) {
            toast.textContent = t('screens.toast', { mode: t('screens.' + displayMode) });
            toast.classList.add('visible');
            clearTimeout(displayModeToastTimer);
            displayModeToastTimer = setTimeout(() => toast.classList.remove('visible'), 2000);
          }
        }
      };
      inputHandler._displayModeCallback = () => setDisplayMode(nextDisplayMode(displayMode));
      inputHandler._displayModeLabelCallback = () => t('screens.' + displayMode);
      inputHandler._onDualDeactivated = () => {
        if (displayMode === 'split') setDisplayMode('mirror');
      };
      setDisplayMode(readStorage(DISPLAY_MODE_STORAGE_KEY), { silent: true });

      displaySync = new DisplaySyncManager();
      displaySync.startPrimary(() => ({
        displayMode,
        stealth: renderer.stealth,
        phase: state.phase,
        phase2: inputHandler._dualState?.phase,
        scheduleEnabled: APP_SETTINGS.scheduleEnabled,
        holidayThemeEnabled: APP_SETTINGS.holidayThemeEnabled,
        language: APP_SETTINGS.language,
        // The second TV shows the menus / editing highlight while they are up,
        // even in Clock + Timer or Split mode, since it relays the remote
        editing: overlayManager.isOpen() || inputHandler._timeSettingMode
      }));
    };

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
          const activeClassKey = JSON.stringify([activeClass.title, classInstant(now, activeClass.startTime).getTime()]);
          if (activeClassKey !== lastActiveClassKey && APP_SETTINGS.audio.classStartSound) {
            audioManager.playStartOfClassRing();
          }
          lastActiveClassKey = activeClassKey;
          hadActiveClass = true;
          // The editor waits the class out like a running timer does, so
          // the coach's values never change underneath them
          if (state.phase === PHASES.IDLE && !inputHandler._timeSettingMode) {
            state.roundDurations = null;
            state.restDurations = null;
            renderer.hideRoundList();
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
              inputHandler._updateScoreboardVisibility();
            }
          } else {
            // Defer preset loading until the session stops or the editor
            // closes (Req 19.3)
            pendingClass = activeClass;
          }
        } else {
          if (hadActiveClass) {
            if (APP_SETTINGS.audio.classEndSound) {
              audioManager.playEndOfClassRing();
            }
            hadActiveClass = false;
          }
          pendingClass = null;
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

    // 8b. Wire up the schedule overlay (key 9), schedule toggle, and long-press
    // reset (use active class preset or fall back to DEFAULT_CONFIG)
    inputHandler._scheduleManager = scheduleManager;

    // Remaining class time feeds the round list's overtime badges and the
    // training/chainsaw default lengths
    const remainingClassSec = () =>
      APP_SETTINGS.scheduleEnabled ? scheduleManager.getRemainingClassSec(new Date()) : 0;
    renderer.remainingClassSecProvider = remainingClassSec;
    overlayManager.remainingClassSecProvider = remainingClassSec;

    /**
     * Repaint the class banner and next-class panel (and optionally the
     * progress ring) from the schedule. No-op while the schedule is disabled.
     * @param {boolean} withProgress
     */
    const refreshScheduleUI = (withProgress) => {
      if (!APP_SETTINGS.scheduleEnabled) return;
      const now = new Date();
      const active = scheduleManager.getActiveClass(now);
      const next = scheduleManager.getNextClass(now);
      renderer.updateScheduleDisplay(active, next, null);
      renderer.updateNextClassDisplay(active ? next : null);
      if (withProgress) classProgress.setActiveClass(active);
    };

    // Language switch: re-label everything currently on screen
    overlayManager._onLanguageChange = () => {
      applyStaticTranslations();
      inputHandler.scoreboard.render();
      const c = renderer._lastCounter;
      if (c) renderer.updateRoundCounter(c.current, c.total);
      renderer.updatePresetLabel(renderer._lastPreset || null);
      if (renderer._lastTemperature !== undefined) renderer.updateTemperature(renderer._lastTemperature);
      const st = renderer._lastStatus;
      if (st) renderer.updateStatusBar(st.mode, st.detail);
      if (state.roundDurations) {
        renderer.updateRoundList(state.roundDurations, state.currentRound, state._presetName, state.restDurations, state.config.restDurationSec, renderer.getRemainingClassSec(), state.remainingSec, state.phase);
      }
      refreshScheduleUI(false);
      if (!APP_SETTINGS.scheduleEnabled) renderer.updateScheduleDisplay(null, null, null);
    };

    overlayManager._onScheduleToggle = (enabled) => {
      if (enabled) {
        scheduleManager._lastActiveClassTitle = null;
        refreshScheduleUI(true);
        scheduleManager.startPolling();
      } else {
        pendingClass = null;
        hadActiveClass = false;
        renderer.updateScheduleDisplay(null, null, null);
        renderer.updateNextClassDisplay(null);
        classProgress.setActiveClass(null);
      }
    };
    const defaultConfig = () => {
      const now = new Date();
      const active = APP_SETTINGS.scheduleEnabled ? scheduleManager.getActiveClass(now) : null;
      const preset = active ? presetManager.getPreset(active.classType) : null;
      const src = preset || { ...DEFAULT_CONFIG };
      return { ...src, prepDurationSec: src.prepDurationSec ?? DEFAULT_CONFIG.prepDurationSec, presetName: active ? active.title : null };
    };
    inputHandler._defaultConfigCallback = defaultConfig;
    // A class that started while the editor was open applies on cancel; a
    // saved edit is the coach's choice and wins over it
    inputHandler._onTimeSettingClosed = (saved) => {
      if (saved) pendingClass = null;
      else applyPendingClass();
    };
    inputHandler._resetCallback = () => {
      const src = defaultConfig();
      state.config.roundDurationSec = src.roundDurationSec;
      state.config.restDurationSec = src.restDurationSec;
      state.config.numRounds = src.numRounds;
      state.config.prepDurationSec = src.prepDurationSec;
      state.remainingSec = src.roundDurationSec;
      state._presetName = src.presetName;
      StorageManager.save(state.config);
    };

    // 9. Initial render
    renderer.updateClockDisplay();
    renderer.updateRoundDisplay(state.config.roundDurationSec, false);
    renderer.updateRestDisplay(state.config.restDurationSec, false);
    renderer.updateRoundCounter(0, state.config.numRounds);
    renderer.updatePresetLabel(null);
    renderer.updateStatusBar('clock');

    // 10. Load schedule from config.json and start polling
    const initSchedule = isDebug && debugScheduleEntry
      ? Promise.resolve().then(() => {
          // Inject debug entry directly into schedule manager
          scheduleManager._schedule = [debugScheduleEntry];
          scheduleManager._checkActiveClass();
        })
      : scheduleManager.loadConfig(initialConfig);

    initSchedule.then(() => {
      initDisplayMode();
      refreshScheduleUI(true);
      scheduleManager.startPolling();

      // 10b. Start weather polling (after config loaded so overrides are applied)
      weatherManager = new WeatherManager((tempStr) => {
        renderer.updateTemperature(tempStr);
      });
      weatherManager.start();
    });

    // 11. Wall clock update every second
    intervals.push(setInterval(() => {
      renderer.updateClockDisplay();
      classProgress.draw();
    }, 1000));

    // 12. Re-read config.json every 30 minutes to pick up schedule syncs.
    // refreshScheduleUI honours the schedule toggle, so a disabled schedule
    // no longer reappears after the reload.
    intervals.push(setInterval(() => {
      scheduleManager.loadConfig().then(() => refreshScheduleUI(true));
    }, 30 * 60 * 1000));

    // 13. Refresh schedule and next class displays every 60 seconds
    intervals.push(setInterval(() => refreshScheduleUI(false), 60000));

    const suspendTimers = () => {
      engine.suspend();
      if (inputHandler._dualEngine) inputHandler._dualEngine.suspend();
    };
    const resumeTimers = () => {
      engine.resumeFromSuspend();
      if (inputHandler._dualEngine) inputHandler._dualEngine.resumeFromSuspend();
    };
    document.addEventListener('freeze', suspendTimers);
    document.addEventListener('resume', resumeTimers);
    window.addEventListener('pagehide', suspendTimers);
    window.addEventListener('pageshow', resumeTimers);

    // 14. Handle for tests/tooling to shut the instance down cleanly
    window.__bjjApp = {
      state,
      engine,
      inputHandler,
      scheduleManager,
      teardown() {
        document.removeEventListener('freeze', suspendTimers);
        document.removeEventListener('resume', resumeTimers);
        window.removeEventListener('pagehide', suspendTimers);
        window.removeEventListener('pageshow', resumeTimers);
        engine.stop();
        if (inputHandler._dualEngine) inputHandler._dualEngine.stop();
        inputHandler.destroy();
        intervals.forEach(clearInterval);
        scheduleManager.stopPolling();
        if (weatherManager) weatherManager.stop();
        holidayTheme.stop();
        if (displaySync) displaySync.stop();
        window.__bjjApp = null;
      }
    };
  });
}
