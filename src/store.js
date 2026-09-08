// Append-only, event-sourced message store.
// Two event types are ever written: `message` and `ack`. State is rebuilt from
// the log on boot — the log IS the source of truth (the design doc's messages
// table), and idempotency-by-id gives grow-only-set semantics: retries converge.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const STATUS_RANK = { unread: 0, delivered: 1, acted: 2 };

export class Store {
  constructor(dataDir) {
    mkdirSync(dataDir, { recursive: true });
    this.logPath = join(dataDir, 'events.jsonl');
    this.messages = new Map(); // id -> message record
    this.sessions = new Map(); // owner -> { transcriptPath, sessionId, ts }
    this.relayedTurns = new Set(); // assistant-turn uuids already swept for @name relays
    if (existsSync(this.logPath)) {
      for (const line of readFileSync(this.logPath, 'utf8').split('\n')) {
        if (line.trim()) this.#apply(JSON.parse(line));
      }
    }
  }

  #append(event) {
    appendFileSync(this.logPath, JSON.stringify(event) + '\n');
    this.#apply(event);
  }

  #apply(event) {
    if (event.type === 'message') {
      if (this.messages.has(event.id)) return; // idempotent
      this.messages.set(event.id, {
        id: event.id, from: event.from, to: event.to, body: event.body,
        replyTo: event.replyTo ?? null, ts: event.ts,
        status: 'unread', actedDetail: null,
      });
    } else if (event.type === 'ack') {
      const msg = this.messages.get(event.id);
      if (!msg) return;
      if (STATUS_RANK[event.level] > STATUS_RANK[msg.status]) {
        msg.status = event.level;
        if (event.level === 'acted') msg.actedDetail = event.detail ?? null;
      }
    } else if (event.type === 'relay') {
      this.relayedTurns.add(event.uuid);
    } else if (event.type === 'session') {
      this.sessions.set(event.owner, {
        transcriptPath: event.transcriptPath, sessionId: event.sessionId, ts: event.ts,
      });
    }
  }

  send({ from, to, body, id, replyTo }) {
    const msgId = id ?? `m-${randomUUID().slice(0, 8)}`;
    if (!this.messages.has(msgId)) {
      this.#append({ type: 'message', id: msgId, from, to, body, replyTo, ts: new Date().toISOString() });
    }
    return this.messages.get(msgId);
  }

  ack(id, level, detail, by) {
    if (!STATUS_RANK[level] || level === 'unread') throw new Error(`invalid ack level: ${level}`);
    const msg = this.messages.get(id);
    if (!msg) throw new Error(`unknown message: ${id}`);
    this.#append({ type: 'ack', id, level, detail, by, ts: new Date().toISOString() });
    return this.messages.get(id);
  }

  inbox(user, { unreadOnly = true } = {}) {
    return [...this.messages.values()]
      .filter((m) => m.to === user && (!unreadOnly || m.status === 'unread'))
      .sort((a, b) => a.ts.localeCompare(b.ts));
  }

  unreadCount(user) {
    return this.inbox(user).length;
  }

  all() {
    return [...this.messages.values()].sort((a, b) => a.ts.localeCompare(b.ts));
  }

  registerSession(owner, transcriptPath, sessionId) {
    const current = this.sessions.get(owner);
    if (current?.transcriptPath === transcriptPath) return; // no duplicate events
    this.#append({ type: 'session', owner, transcriptPath, sessionId, ts: new Date().toISOString() });
  }

  sessionFor(owner) {
    return this.sessions.get(owner) ?? null;
  }

  isRelayed(uuid) {
    return this.relayedTurns.has(uuid);
  }

  markRelayed(owner, uuid) {
    if (this.relayedTurns.has(uuid)) return;
    this.#append({ type: 'relay', owner, uuid, ts: new Date().toISOString() });
  }
}
