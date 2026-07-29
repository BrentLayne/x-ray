#!/usr/bin/env node
// Broker for the x-ray Chrome extension sidebar.
// Skill POSTs summary + findings; extension subscribes via SSE.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 47821;
const HOST = '127.0.0.1';
const MAX_PRS = 50;
const STATE_FILE = path.join(os.homedir(), '.claude', 'pr-sidebar', 'state.json');
const SAVE_DEBOUNCE_MS = 500;

const store = new Map();
const subscribers = new Map();

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) throw new Error('state file is not an array');
    for (const pair of entries) {
      if (Array.isArray(pair) && typeof pair[0] === 'string') store.set(pair[0], pair[1]);
    }
    console.log(`loaded ${store.size} PRs from ${STATE_FILE}`);
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('state load failed:', e.message);
  }
}

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const tmp = STATE_FILE + '.tmp';
    try {
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify([...store]));
      fs.renameSync(tmp, STATE_FILE);
    } catch (e) {
      console.warn('state save failed:', e.message);
    }
  }, SAVE_DEBOUNCE_MS);
}

// LRU-on-write: bump existing entries to newest, evict oldest when at cap.
function getEntry(key) {
  if (store.has(key)) {
    const entry = store.get(key);
    store.delete(key);
    store.set(key, entry);
    return entry;
  }
  if (store.size >= MAX_PRS) {
    store.delete(store.keys().next().value);
  }
  const entry = { summary: null, findings: null };
  store.set(key, entry);
  return entry;
}

// Origin allowlist: only GitHub PR pages and our own Chrome extension.
// Requests with no Origin (curl, node) are non-browser and allowed.
function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (origin === 'https://github.com') return true;
  if (origin.startsWith('chrome-extension://')) return true;
  return false;
}

function broadcast(key, event, data) {
  const subs = subscribers.get(key);
  if (!subs) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of subs) res.write(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve(null);
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
  if (origin && isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function sendJson(res, status, body, origin) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...corsHeaders(origin) });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;

  if (req.method === 'OPTIONS') {
    // Reject preflights from disallowed origins so the browser blocks the real request.
    const status = isAllowedOrigin(origin) ? 204 : 403;
    res.writeHead(status, corsHeaders(origin));
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  if (path === '/health' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, prs: store.size }, origin);
    return;
  }

  const match = path.match(/^\/pr\/([^/]+)(?:\/(summary|findings|stream))?$/);
  if (!match) {
    sendJson(res, 404, { error: 'not found' }, origin);
    return;
  }

  const key = decodeURIComponent(match[1]);
  const subpath = match[2];

  if (req.method === 'GET' && !subpath) {
    const entry = store.get(key);
    if (!entry) return sendJson(res, 404, { error: 'no data for this pr' }, origin);
    return sendJson(res, 200, entry, origin);
  }

  if (req.method === 'GET' && subpath === 'stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...corsHeaders(origin),
    });
    res.write(': connected\n\n');

    const entry = store.get(key);
    if (entry?.summary) {
      res.write(`event: summary\ndata: ${JSON.stringify(entry.summary)}\n\n`);
    }
    if (entry?.findings) {
      res.write(`event: findings\ndata: ${JSON.stringify(entry.findings)}\n\n`);
    }

    if (!subscribers.has(key)) subscribers.set(key, new Set());
    subscribers.get(key).add(res);

    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch (_) {}
    }, 25_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      subscribers.get(key)?.delete(res);
      if (subscribers.get(key)?.size === 0) subscribers.delete(key);
    });
    return;
  }

  if (req.method === 'POST' && (subpath === 'summary' || subpath === 'findings')) {
    // Enforce origin allowlist server-side. Blocks the "simple request" CORS bypass
    // (e.g. a malicious page POSTing text/plain to inject sidebar content).
    if (!isAllowedOrigin(origin)) {
      return sendJson(res, 403, { error: 'forbidden origin' }, null);
    }
    const contentType = (req.headers['content-type'] || '').toLowerCase();
    if (!contentType.startsWith('application/json')) {
      return sendJson(res, 415, { error: 'expected application/json' }, origin);
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      return sendJson(res, 400, { error: 'invalid json', detail: e.message }, origin);
    }
    if (!body) return sendJson(res, 400, { error: 'empty body' }, origin);

    const entry = getEntry(key);
    entry[subpath] = body;
    broadcast(key, subpath, body);
    scheduleSave();
    return sendJson(res, 200, { ok: true }, origin);
  }

  sendJson(res, 405, { error: 'method not allowed' }, origin);
});

loadState();

server.listen(PORT, HOST, () => {
  console.log(`pr-sidebar-broker listening on http://${HOST}:${PORT}`);
});
