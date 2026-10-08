#!/usr/bin/env node
// Fetches the live class schedule from Gymdesk and writes it to schedule.json.
//
// schedule.json is untracked (see .gitignore) and overrides the schedule
// bundled in config.json when the app loads, so a sync never dirties the git
// working tree and `git pull` on the kiosk cannot conflict with it.

const fs = require('fs');
const path = require('path');

const CONFIG = path.join(__dirname, 'config.json');
const SCHEDULE_FILE = path.join(__dirname, 'schedule.json');
const ENDPOINT = 'https://abmarbjjacademy.com/schedule/getevents';
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// First match wins — specific patterns before general ones.
const TYPE_RULES = [
  [/kids.*no.?gi/i, 'kids_nogi'],   [/kids.*adv/i, 'kids_advanced'],
  [/kids/i, 'kids'],                 [/marathon/i, 'marathon_roll'],
  [/drill/i, 'drill'],              [/open.mat/i, 'open_mat'],
  [/advanced/i, 'adult_advanced'],   [/all.level/i, 'adult_all_levels'],
];

const inferType = (title) => (TYPE_RULES.find(([re]) => re.test(title)) || [])[1] || 'adult_basics';

const addMinutes = (hhmm, mins) => {
  const t = +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5) + mins;
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

const decode = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

/**
 * Parse Gymdesk's event HTML into the app's schedule entries.
 * @param {string} eventsHtml - The `events` HTML fragment from the API
 * @returns {Array<{dayOfWeek: string, startTime: string, endTime: string, title: string, classType: string}>}
 */
function parseEvents(eventsHtml) {
  return [...String(eventsHtml).matchAll(/data-event-info="([^"]*)"/g)]
    .map(m => JSON.parse(decode(m[1])))
    .filter(e => !e.canceled)
    .map(e => ({
      dayOfWeek: DAYS[(e.day + 6) % 7],  // Gymdesk: 0=Sun → rotate to Mon-first
      startTime: e.start.slice(0, 5),
      endTime: addMinutes(e.start, e.duration),
      title: e.title,
      classType: inferType(e.title),
    }))
    .sort((a, b) => DAYS.indexOf(a.dayOfWeek) - DAYS.indexOf(b.dayOfWeek) || a.startTime.localeCompare(b.startTime));
}

/**
 * Read the schedule the app currently uses: schedule.json when present,
 * otherwise the one bundled in config.json.
 * @returns {Array}
 */
function readCurrentSchedule() {
  try {
    const synced = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
    if (synced && Array.isArray(synced.schedule)) return synced.schedule;
  } catch (e) {
    // No schedule.json yet — fall through to config.json
  }
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    return Array.isArray(config.schedule) ? config.schedule : [];
  } catch (e) {
    return [];
  }
}

async function main() {
  const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
  const { success, events } = await res.json();
  if (!success) { log('Gymdesk returned success=false'); process.exit(1); }

  const schedule = parseEvents(events);
  if (schedule.length === 0) { log('Gymdesk returned no classes — keeping current schedule'); process.exit(1); }

  if (JSON.stringify(readCurrentSchedule()) === JSON.stringify(schedule)) {
    log('Schedule unchanged');
    return;
  }

  fs.writeFileSync(SCHEDULE_FILE, JSON.stringify({ syncedAt: new Date().toISOString(), schedule }, null, 2) + '\n');
  log(`Schedule updated: ${schedule.length} classes`);
}

module.exports = { parseEvents, inferType, addMinutes, decode, readCurrentSchedule, SCHEDULE_FILE };

if (require.main === module) {
  main().catch(e => { log(e.message); process.exit(1); });
}
