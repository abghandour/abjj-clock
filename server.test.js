/**
 * Tests for the update/sync relay server and the Gymdesk schedule sync parser.
 * The server is started on an ephemeral loopback port with a stubbed exec.
 */
// @vitest-environment node
import { createRequire } from 'node:module';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { createUpdateServer } = require('./update-server.js');
const { parseEvents, inferType, addMinutes, decode } = require('./sync-schedule.js');

// When the sandbox forbids listen(), exercise the actual server request
// listener with HTTP-compatible streams. No security/route logic is mocked.
function dispatch(server, method, path, headers, onWrite, onEnd) {
  const req = new EventEmitter();
  Object.assign(req, { method, url: path, headers: Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v])) });
  req.destroy = () => req.emit('close');
  const res = new EventEmitter();
  res.headers = {};
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.writeHead = (status, values = {}) => {
    res.statusCode = status;
    for (const [k, v] of Object.entries(values)) res.setHeader(k, v);
  };
  res.write = data => onWrite(data);
  res.end = data => { if (data) onWrite(data); onEnd?.(res); };
  server.emit('request', req, res);
  return { req, res };
}

function request(port, method, path, { body, headers } = {}) {
  if (typeof port === 'object') {
    return new Promise(resolve => {
      let data = '';
      const { req } = dispatch(port, method, path, headers, chunk => { data += chunk; }, res => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      if (body) req.emit('data', body);
      req.emit('end');
    });
  }
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: headers || {} }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/** Open an SSE subscription and resolve with the first `data:` payload. */
function subscribe(port, path) {
  if (typeof port === 'object') {
    const messages = [];
    let consumed = 0, waiter;
    const { req, res } = dispatch(port, 'GET', path, {}, chunk => {
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        messages.push(line.slice(6));
        if (waiter) { const done = waiter; waiter = null; done(messages[consumed++]); }
      }
    });
    return Promise.resolve({ res, messages, close: () => req.destroy(), next: () => messages.length > consumed ? Promise.resolve(messages[consumed++]) : new Promise(resolve => { waiter = resolve; }) });
  }
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path }, (res) => {
      const messages = [];
      let consumed = 0;
      let waiter = null;
      let buffer = '';
      const handle = {
        res,
        messages,
        // Resolve with the next unread message, whether it already arrived or not
        next: () => {
          if (messages.length > consumed) return Promise.resolve(messages[consumed++]);
          return new Promise((r) => { waiter = r; });
        },
        close: () => req.destroy()
      };
      res.on('data', (chunk) => {
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const line = frame.split('\n').find((l) => l.startsWith('data: '));
          if (line) {
            messages.push(line.slice(6));
            if (waiter) { const w = waiter; waiter = null; w(messages[consumed++]); }
          }
        }
      });
      resolve(handle);
    });
    req.on('error', reject);
    req.end();
  });
}

describe('update server', () => {
  let server, port, execCalls, execImpl, logs;

  beforeEach(async () => {
    execCalls = [];
    logs = [];
    execImpl = (cmd, opts, cb) => cb(null, `ran ${cmd}\n`, '');
    server = createUpdateServer({
      repoDir: '/tmp/repo',
      allowedOrigins: ['https://kiosk.example'],
      execFn: (cmd, opts, cb) => { execCalls.push({ cmd, opts }); execImpl(cmd, opts, cb); },
      log: (m) => logs.push(m)
    });
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      port = server.address().port;
    } catch (error) {
      if (error.code !== 'EPERM' && error.code !== 'EACCES') throw error;
      port = server;
    }
  });

  afterEach(async () => {
    if (!server.listening) return;
    server.closeAllConnections && server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });

  it('answers CORS preflight and rejects POSTs without the update header', async () => {
    const pre = await request(port, 'OPTIONS', '/update');
    expect(pre.status).toBe(204);
    expect(pre.headers['access-control-allow-headers']).toContain('X-Update-Request');
    const res = await request(port, 'POST', '/update');
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body).success).toBe(false);
    expect(execCalls).toHaveLength(0);
  });

  it.each(['/update', '/sync-schedule', '/sync', '/keys'])('rejects missing or wrong keys on %s', async endpoint => {
    for (const headers of [{}, { 'X-Update-Request': 'wrong' }]) {
      const res = await request(port, 'POST', endpoint, { headers, body: '{}' });
      expect(res.status).toBe(403);
    }
    expect(execCalls).toHaveLength(0);
  });

  it('rejects hostile origins even with the correct key and never advertises wildcard CORS', async () => {
    for (const origin of ['https://evil.example', 'null', 'http://localhost.evil.example', 'http://127.0.0.1.evil.example']) {
      for (const method of ['OPTIONS', 'POST', 'GET']) {
        const res = await request(port, method, method === 'GET' ? '/sync-events' : '/update', { headers: { Origin: origin, 'X-Update-Request': '1' } });
        expect(res.status).toBe(403);
        expect(res.headers['access-control-allow-origin']).toBeUndefined();
      }
    }
    expect(execCalls).toHaveLength(0);
  });

  it.each(['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000', 'https://kiosk.example'])('allows the local or explicitly configured origin %s', async origin => {
    const res = await request(port, 'OPTIONS', '/sync', { headers: { Origin: origin } });
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(origin);
    expect(res.headers.vary).toBe('Origin');
  });

  it('rejects malformed relay bodies and canonicalizes JSON before SSE publication', async () => {
    const headers = { 'X-Update-Request': '1' };
    expect((await request(port, 'POST', '/sync', { headers, body: '{}\n\ndata: {"injected":true}' })).status).toBe(400);
    const sub = await subscribe(port, '/sync-events');
    await request(port, 'POST', '/sync', { headers, body: '{\n"sections": {}\n}' });
    expect(await sub.next()).toBe('{"sections":{}}');
    sub.close();
  });

  it('runs git pull in the repo directory and reports its output', async () => {
    const res = await request(port, 'POST', '/update', { headers: { 'X-Update-Request': '1' } });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true, output: 'ran git pull --autostash' });
    expect(execCalls[0].cmd).toBe('git pull --autostash');
    expect(execCalls[0].opts.cwd).toBe('/tmp/repo');
  });

  it('reports command failures with the most useful message', async () => {
    execImpl = (cmd, opts, cb) => cb(new Error('exit 1'), '', 'fatal: not a git repo');
    const res = await request(port, 'POST', '/sync-schedule', { headers: { 'X-Update-Request': '1' } });
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body).error).toBe('fatal: not a git repo');
    expect(execCalls[0].cmd).toBe('node sync-schedule.js');
  });

  it('refuses a second command while one is still running', async () => {
    let finish;
    execImpl = (cmd, opts, cb) => { finish = () => cb(null, 'done', ''); };
    const first = request(port, 'POST', '/update', { headers: { 'X-Update-Request': '1' } });
    await new Promise((r) => setTimeout(r, 20));
    const second = await request(port, 'POST', '/sync-schedule', { headers: { 'X-Update-Request': '1' } });
    expect(second.status).toBe(409);
    finish();
    expect((await first).status).toBe(200);
  });

  it('fans /sync snapshots out to subscribers and replays the last one to late joiners', async () => {
    const early = await subscribe(port, '/sync-events');
    const payload = JSON.stringify({ sessionId: 'a', sections: {} });
    const post = await request(port, 'POST', '/sync', { body: payload, headers: { 'X-Update-Request': '1', 'Content-Type': 'application/json' } });
    expect(post.status).toBe(200);
    expect(await early.next()).toBe(payload);

    const late = await subscribe(port, '/sync-events');
    expect(await late.next()).toBe(payload);
    early.close();
    late.close();
  });

  it('does not retain key events for late joiners', async () => {
    const keys = JSON.stringify({ type: 'keydown', key: 'Enter' });
    await request(port, 'POST', '/keys', { body: keys, headers: { 'X-Update-Request': '1' } });
    const sub = await subscribe(port, '/key-events');
    await new Promise((r) => setTimeout(r, 30));
    expect(sub.messages).toHaveLength(0);
    await request(port, 'POST', '/keys', { body: keys, headers: { 'X-Update-Request': '1' } });
    expect(await sub.next()).toBe(keys);
    sub.close();
  });

  it('returns 404 for unknown routes', async () => {
    const res = await request(port, 'POST', '/nope', { headers: { 'X-Update-Request': '1' } });
    expect(res.status).toBe(404);
    const get = await request(port, 'GET', '/update');
    expect(get.status).toBe(404);
  });
});

describe('configured relay key', () => {
  it('requires the same configured key on all four mutation endpoints', async () => {
    const server = createUpdateServer({ sharedKey: 'configured-test-key', execFn: (_cmd, _opts, cb) => cb(null, 'ok', ''), log: () => {} });
    for (const endpoint of ['/update', '/sync-schedule', '/sync', '/keys']) {
      expect((await request(server, 'POST', endpoint, { headers: { 'X-Update-Request': '1' }, body: '{}' })).status).toBe(403);
      expect((await request(server, 'POST', endpoint, { headers: { 'X-Update-Request': 'configured-test-key' }, body: '{}' })).status).toBe(200);
    }
  });
});

describe('sync-schedule parser', () => {
  const event = (o) => JSON.stringify(o).replace(/"/g, '&quot;');

  it('parses Gymdesk events into sorted schedule entries', () => {
    const html =
      `<div data-event-info="${event({ day: 2, start: '18:30:00', duration: 60, title: 'Adult Jiu-Jitsu, all levels', canceled: false })}"></div>` +
      `<div data-event-info="${event({ day: 0, start: '12:00:00', duration: 120, title: 'Open Mat', canceled: false })}"></div>` +
      `<div data-event-info="${event({ day: 2, start: '17:30:00', duration: 60, title: 'Kids No-Gi', canceled: false })}"></div>` +
      `<div data-event-info="${event({ day: 2, start: '20:00:00', duration: 30, title: 'Cancelled', canceled: true })}"></div>`;
    const schedule = parseEvents(html);
    expect(schedule).toEqual([
      { dayOfWeek: 'Tuesday', startTime: '17:30', endTime: '18:30', title: 'Kids No-Gi', classType: 'kids_nogi' },
      { dayOfWeek: 'Tuesday', startTime: '18:30', endTime: '19:30', title: 'Adult Jiu-Jitsu, all levels', classType: 'adult_all_levels' },
      { dayOfWeek: 'Sunday', startTime: '12:00', endTime: '14:00', title: 'Open Mat', classType: 'open_mat' },
    ]);
  });

  it('infers class types with specific rules first and a basics fallback', () => {
    expect(inferType('Kids Advanced')).toBe('kids_advanced');
    expect(inferType('Marathon Roll - Adults')).toBe('marathon_roll');
    expect(inferType('Drill Only')).toBe('drill');
    expect(inferType('Adult Advanced')).toBe('adult_advanced');
    expect(inferType("Women's Private Group Class")).toBe('adult_basics');
  });

  it('adds minutes with day wrap and decodes HTML entities', () => {
    expect(addMinutes('23:30', 45)).toBe('00:15');
    expect(addMinutes('09:05', 55)).toBe('10:00');
    expect(decode('Tom &amp; Jerry &#39;s &quot;class&quot; &lt;3')).toBe('Tom & Jerry \'s "class" <3');
  });
});


describe('kiosk launcher cleanup', () => {
  it('terminates only its four recorded child PIDs', () => {
    const script = readFileSync('start-dual-kiosk.sh', 'utf8');
    expect(script).not.toContain('kill 0');
    expect(script.match(/children\+=\("\$!"\)/g)).toHaveLength(4);
    execFileSync('bash', ['-n', 'start-dual-kiosk.sh']);
    const output = execFileSync('bash', ['-c', `
      node() { :; }; npx() { :; }; chromium() { :; }
      curl() { return 0; }; sleep() { :; }; wait() { :; }
      kill() { printf '%s\\n' "$*"; }
      source ./start-dual-kiosk.sh
    `], { encoding: 'utf8' });
    const killed = output.trim().split('\n');
    expect(killed).toHaveLength(4);
    for (const pid of killed) expect(pid).toMatch(/^[1-9][0-9]*$/);
  });
});
