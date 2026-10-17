#!/usr/bin/env node
/**
 * Tiny HTTP server that runs `git pull` when POST /update is called.
 * Runs on port 3001 alongside the main static server on port 3000.
 *
 * Security: binds to loopback only, and requires the X-Update-Request header
 * with the configured shared value on every mutation. Browser origins are
 * checked separately; only loopback and explicitly configured origins may connect.
 */
const http = require('http');
const { readFileSync } = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = 3001;
const HOST = '127.0.0.1';
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Build the update/sync relay server.
 *
 * Dual-screen sync relay: the primary kiosk window POSTs UI snapshots to
 * /sync; secondary display windows subscribe via SSE on /sync-events. Keys
 * pressed on a focused secondary window are relayed the other way through
 * /keys → /key-events. SSE is used (not BroadcastChannel) because the two
 * kiosk windows run as separate Chromium instances with separate profiles.
 *
 * @param {Object} [options]
 * @param {string} [options.repoDir] - Working directory for git / sync commands
 * @param {function} [options.execFn] - child_process.exec replacement (tests)
 * @param {function} [options.log] - Logger (defaults to console.log)
 * @returns {http.Server}
 */
function createUpdateServer(options) {
  const opts = options || {};
  const repoDir = opts.repoDir || __dirname;
  let relayConfig = {};
  try { relayConfig = JSON.parse(readFileSync(path.join(repoDir, 'config.json'), 'utf8')).relay || {}; } catch (e) { /* Built-in local defaults. */ }
  const sharedKey = opts.sharedKey ?? relayConfig.sharedKey ?? '1';
  const allowedOrigins = new Set(opts.allowedOrigins || relayConfig.allowedOrigins || []);
  function originAllowed(origin) {
    if (!origin) return true; // Non-browser callers still require the shared key.
    if (allowedOrigins.has(origin)) return true;
    try {
      const url = new URL(origin);
      return url.origin === origin && ['http:', 'https:'].includes(url.protocol) &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    } catch (e) { return false; }
  }
  const execFn = opts.execFn || exec;
  const log = opts.log || ((msg) => console.log(`[${new Date().toISOString()}] ${msg}`));

  const channels = {
    sync: { retain: true, last: null, lastSeq: null, clients: new Set() },
    keys: { retain: false, last: null, clients: new Set() },
  };

  // Only one git pull / schedule sync runs at a time; a second request while
  // one is in flight gets a 409 instead of racing the first.
  let commandRunning = false;

  function sseSubscribe(channel, req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('\n');
    channel.clients.add(res);
    if (channel.retain && channel.last !== null) {
      res.write(`data: ${channel.last}\n\n`);
    }
    const drop = () => channel.clients.delete(res);
    req.on('close', drop);
    req.on('error', drop);
  }

  function readBody(req, callback) {
    // Collect raw bytes and decode once: a multi-byte UTF-8 character split
    // across chunks would otherwise decode to replacement characters.
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buf);
      size += buf.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        req.destroy();
      }
    });
    req.on('end', () => { if (!tooLarge) callback(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', () => {});
  }

  function ssePublish(channel, req, res) {
    readBody(req, (body) => {
      // Parse and reserialize to prevent newline/SSE-frame injection.
      let data;
      try {
        data = JSON.parse(body);
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid payload');
        body = JSON.stringify(data);
      } catch (e) {
        json(res, 400, { success: false, error: 'Invalid JSON object' });
        return;
      }
      if (channel.retain) {
        // Concurrent POSTs can finish out of order; a snapshot older than the
        // retained one (same session, lower seq) must not replace it.
        const prev = channel.lastSeq;
        if (prev && Number.isFinite(data.seq) && data.sessionId === prev.sessionId && data.seq < prev.seq) {
          json(res, 200, { success: true, stale: true });
          return;
        }
        if (Number.isFinite(data.seq)) channel.lastSeq = { sessionId: data.sessionId, seq: data.seq };
        channel.last = body;
      }
      for (const client of channel.clients) {
        try {
          client.write(`data: ${body}\n\n`);
        } catch (e) {
          channel.clients.delete(client);
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    });
  }

  function json(res, status, payload) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  }

  function runCommand(res, label, command) {
    if (commandRunning) {
      json(res, 409, { success: false, error: `${label} already in progress` });
      return;
    }
    commandRunning = true;
    log(`${label} requested...`);
    execFn(command, { cwd: repoDir, timeout: 30000 }, (error, stdout, stderr) => {
      commandRunning = false;
      const out = String(stdout || '').trim();
      const err = String(stderr || '').trim();
      if (error) {
        const msg = out || err || error.message;
        log(`${label} failed: ${msg}`);
        json(res, 500, { success: false, error: msg, stderr: err });
        return;
      }
      log(`${label} success: ${out}`);
      json(res, 200, { success: true, output: out });
    });
  }

  const server = http.createServer((req, res) => {
    const origin = req.headers.origin;
    res.setHeader('Vary', 'Origin');
    if (!originAllowed(origin)) {
      json(res, 403, { success: false, error: 'Origin not allowed' });
      return;
    }
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Update-Request');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/sync-events') {
      sseSubscribe(channels.sync, req, res);
      return;
    }

    if (req.method === 'GET' && req.url === '/key-events') {
      sseSubscribe(channels.keys, req, res);
      return;
    }

    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
        (typeof sharedKey !== 'string' || !sharedKey || req.headers['x-update-request'] !== sharedKey)) {
      json(res, 403, { success: false, error: 'Invalid X-Update-Request key' });
      return;
    }

    if (req.method === 'POST' && req.url === '/sync') {
      ssePublish(channels.sync, req, res);
      return;
    }

    if (req.method === 'POST' && req.url === '/keys') {
      ssePublish(channels.keys, req, res);
      return;
    }

    if (req.method === 'POST' && req.url === '/update') {
      // The live schedule lives in the untracked schedule.json, so a pull no
      // longer conflicts with local edits. --autostash still covers kiosks
      // that carry an older locally-modified config.json.
      runCommand(res, 'Git pull', 'git pull --autostash');
      return;
    }

    if (req.method === 'POST' && req.url === '/sync-schedule') {
      runCommand(res, 'Sync schedule', 'node sync-schedule.js');
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.on('error', (err) => {
    log(`Server error: ${err.message}`);
  });

  return server;
}

module.exports = { createUpdateServer, PORT, HOST };

if (require.main === module) {
  const server = createUpdateServer();
  server.listen(PORT, HOST, () => {
    console.log(`Update server listening on ${HOST}:${PORT}`);
  });
}
