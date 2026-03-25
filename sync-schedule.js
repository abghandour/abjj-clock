#!/usr/bin/env node
// Fetches the live class schedule from Gymdesk and updates config.json.

const fs = require('fs');
const path = require('path');

const CONFIG = path.join(__dirname, 'config.json');
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

async function main() {
  const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
  const { success, events } = await res.json();
  if (!success) { log('Gymdesk returned success=false'); process.exit(1); }

  const schedule = [...events.matchAll(/data-event-info="([^"]*)"/g)]
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

  const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  if (JSON.stringify(config.schedule) === JSON.stringify(schedule)) {
    log('Schedule unchanged');
    return;
  }

  config.schedule = schedule;
  fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2) + '\n');
  log(`Schedule updated: ${schedule.length} classes`);
}

main().catch(e => { log(e.message); process.exit(1); });
