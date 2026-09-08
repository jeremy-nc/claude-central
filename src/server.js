// Session Hub — HTTP API + MCP endpoint + web UI.
// Identity lives in identity.js: dev header on localhost, Tailscale whois when
// HUB_TAILSCALE=1. Everything shares one Store — the doors differ, the state doesn't.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { sessionView } from './tailer.js';
import { forkSession } from './fork.js';
import { handleMcp } from './mcp.js';
import { sweepTranscript } from './relay.js';
import { resolveUser, identityMode } from './identity.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HUB_PORT ?? 4780);
const DATA_DIR = process.env.HUB_DATA ?? join(ROOT, 'data');
const store = new Store(DATA_DIR);
const indexHtml = readFileSync(join(ROOT, 'public', 'index.html'));

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body, null, 2));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const user = await resolveUser(req);
  try {
    // web UI for human contributors
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(indexHtml);
    }
    // MCP door for external agents (stateless streamable HTTP)
    if (url.pathname === '/mcp') {
      const body = req.method === 'POST' ? await readBody(req) : {};
      return handleMcp(store, user, req, res, body);
    }
    // POST /api/send {to, body, id?, replyTo?}
    if (req.method === 'POST' && url.pathname === '/api/send') {
      if (!user) return json(res, 401, { error: 'identity required' });
      const { to, body, id, replyTo } = await readBody(req);
      if (!to || !body) return json(res, 400, { error: 'to and body are required' });
      return json(res, 201, store.send({ from: user, to, body, id, replyTo }));
    }
    // GET /api/inbox?all=1 — recipient = caller identity
    if (req.method === 'GET' && url.pathname === '/api/inbox') {
      if (!user) return json(res, 401, { error: 'identity required' });
      return json(res, 200, store.inbox(user, { unreadOnly: !url.searchParams.has('all') }));
    }
    // POST /api/ack {id, level: delivered|acted, detail?}
    if (req.method === 'POST' && url.pathname === '/api/ack') {
      if (!user) return json(res, 401, { error: 'identity required' });
      const { id, level, detail } = await readBody(req);
      return json(res, 200, store.ack(id, level, detail, user));
    }
    // GET /api/unread?user=central — statusline poll (count only, no auth)
    if (req.method === 'GET' && url.pathname === '/api/unread') {
      const who = url.searchParams.get('user') ?? 'central';
      return json(res, 200, { user: who, count: store.unreadCount(who) });
    }
    // POST /api/register-session {owner, transcriptPath, sessionId} — hook self-registration
    if (req.method === 'POST' && url.pathname === '/api/register-session') {
      const { owner, transcriptPath, sessionId } = await readBody(req);
      if (!owner || !transcriptPath) return json(res, 400, { error: 'owner and transcriptPath required' });
      store.registerSession(owner, transcriptPath, sessionId);
      return json(res, 200, { ok: true });
    }
    // GET /api/session-view?owner=central — curated view from the JSONL tail
    if (req.method === 'GET' && url.pathname === '/api/session-view') {
      const owner = url.searchParams.get('owner') ?? 'central';
      return json(res, 200, sessionView(store.sessionFor(owner)?.transcriptPath));
    }
    // GET /api/fork?owner=central — redacted, resumable session JSONL (experimental)
    if (req.method === 'GET' && url.pathname === '/api/fork') {
      const owner = url.searchParams.get('owner') ?? 'central';
      const fork = forkSession(store.sessionFor(owner)?.transcriptPath);
      if (!fork) return json(res, 404, { error: 'no forkable session registered' });
      return json(res, 200, fork);
    }
    // GET /api/status — full messages table (the behind-the-scenes panel)
    if (req.method === 'GET' && url.pathname === '/api/status') {
      return json(res, 200, { messages: store.all(), sessions: [...store.sessions.keys()] });
    }
    return json(res, 404, { error: 'not found' });
  } catch (err) {
    return json(res, err.message?.startsWith('unknown') || err.message?.startsWith('invalid') ? 400 : 500, {
      error: err.message,
    });
  }
});

// Chat-is-the-reply-channel: sweep registered transcripts for `@name:` lines in
// the agent's visible responses and relay them as messages (see relay.js).
const RELAY_MS = Number(process.env.HUB_RELAY_MS ?? 2000);
setInterval(() => {
  for (const owner of store.sessions.keys()) {
    try {
      sweepTranscript(store, owner);
    } catch {
      // transcript mid-write or missing — next sweep catches up
    }
  }
}, RELAY_MS).unref();

// In serve mode remote traffic must only be able to arrive via the local
// `tailscale serve` proxy — bind localhost so the identity header can't be
// spoofed by a direct remote connection.
const BIND = process.env.HUB_BIND ?? (identityMode() === 'serve' ? '127.0.0.1' : '0.0.0.0');
server.listen(PORT, BIND, () => {
  console.log(`session-hub listening on http://${BIND}:${PORT}  (data: ${DATA_DIR})`);
  console.log(`  web UI: http://127.0.0.1:${PORT}/   MCP: http://127.0.0.1:${PORT}/mcp`);
  console.log(`  identity: ${identityMode()}`);
});
