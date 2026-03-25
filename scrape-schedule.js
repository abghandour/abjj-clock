#!/usr/bin/env node
/**
 * Fetches the class schedule from https://abmarbjjacademy.com/schedule
 * and updates the "schedule" array in config.json.
 *
 * Usage:  node scrape-schedule.js
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');

function inferClassType(title) {
  const t = title.toLowerCase();
  if (t.includes('kid') && t.includes('advanced'))  return 'kids_advanced';
  if (t.includes('kid') && (t.includes('no-gi') || t.includes('nogi'))) return 'kids_nogi';
  if (t.includes('kid'))                            return 'kids';
  if (t.includes('advanced'))                       return 'adult_advanced';
  if (t.includes('all level'))                      return 'adult_all_levels';
  if (t.includes('drill'))                          return 'drill';
  if (t.includes('marathon'))                       return 'marathon_roll';
  if (t.includes('open mat') || t.includes('open')) return 'open_mat';
  return 'adult_basics';
}

function to24h(timeStr) {
  const m = timeStr.trim().match(/^(\d+):?(\d*)([ap]m)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ampm = m[3].toLowerCase();
  if (ampm === 'am' && h === 12) h = 0;
  if (ampm === 'pm' && h !== 12) h += 12;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, rejectUnauthorized: false }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

(async () => {
  try {
    console.log('Fetching https://abmarbjjacademy.com/schedule …');
    const html = await fetchUrl('https://abmarbjjacademy.com/schedule');

    const entries = [];
    const seen = new Set();

    // Pattern: title in <em data-test-id="schedule-event-detail-title">TITLE</em>
    // followed by datetime in: DayName, Month DD <b>&middot;</b>\n  HH:MMam - HH:MMpm
    const re = /<em[^>]*data-test-id="schedule-event-detail-title"[^>]*>([^<]+)<\/em>[\s\S]*?<div[^>]*data-test-id="schedule-event-detail-datetime"[^>]*>\s*(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[^<]*<b>&middot;<\/b>\s*([\d:]+[ap]m)\s*-\s*([\d:]+[ap]m)/gi;

    let match;
    while ((match = re.exec(html)) !== null) {
      const title   = match[1].trim();
      const day     = match[2];
      const start   = to24h(match[3]);
      const end     = to24h(match[4]);

      if (!start || !end) continue;

      const key = `${day}|${start}|${title}`;
      if (seen.has(key)) continue;
      seen.add(key);

      entries.push({
        dayOfWeek: day,
        startTime: start,
        endTime:   end,
        title:     title,
        classType: inferClassType(title)
      });
    }

    if (entries.length === 0) {
      throw new Error('No classes found — page structure may have changed');
    }

    const dayOrder = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    entries.sort((a, b) => {
      const di = dayOrder.indexOf(a.dayOfWeek) - dayOrder.indexOf(b.dayOfWeek);
      return di !== 0 ? di : a.startTime.localeCompare(b.startTime);
    });

    // Update config.json
    const configPath = path.join(__dirname, 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.schedule = entries;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    console.log(`Updated config.json with ${entries.length} classes:`);
    entries.forEach(e => console.log(`  ${e.dayOfWeek.padEnd(10)} ${e.startTime}–${e.endTime}  ${e.title} (${e.classType})`));
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
