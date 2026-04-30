#!/usr/bin/env node
/**
 * Tiny HTTP server that runs `git pull` when POST /update is called.
 * Runs on port 3001 alongside the main static server on port 3000.
 */
const http = require('http');
const { exec } = require('child_process');
const path = require('path');

const PORT = 3001;
const REPO_DIR = __dirname;

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/update') {
    console.log(`[${new Date().toISOString()}] Git pull requested...`);

    exec('git pull', { cwd: REPO_DIR, timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        console.error(`[${new Date().toISOString()}] Git pull failed:`, error.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message, stderr }));
        return;
      }

      console.log(`[${new Date().toISOString()}] Git pull success:`, stdout.trim());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, output: stdout.trim() }));
    });
  } else if (req.method === 'POST' && req.url === '/sync-schedule') {
    console.log(`[${new Date().toISOString()}] Sync schedule requested...`);

    exec('node sync-schedule.js', { cwd: REPO_DIR, timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        const msg = stdout.trim() || stderr.trim() || error.message;
        console.error(`[${new Date().toISOString()}] Sync schedule failed:`, msg);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: msg }));
        return;
      }

      console.log(`[${new Date().toISOString()}] Sync schedule success:`, stdout.trim());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, output: stdout.trim() }));
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Update server listening on port ${PORT}`);
});
