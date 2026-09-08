// Chat-is-the-reply-channel: the Hub tails the central session's transcript and
// relays lines the agent addressed to contributors in its VISIBLE response:
//
//     @alice: good catch — incorporated.
//
// The agent composes exactly one response — the chat UI renders it for the
// central user, and the Hub delivers the addressed lines to the named
// contributors. No background conversation; what the contributor receives is
// what the user watched the agent say.
//
// Idempotency: each assistant turn is processed once (a `relay` event marks the
// turn uuid), and relayed message ids are derived from (turn uuid, recipient) so
// even a reprocess converges. Heuristic caveat: only line-start `@name:` matches,
// so quoted inbound text can't trigger relays unless quoted at line start.
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extractText } from './tailer.js';

const RELAY_RE = /^@([A-Za-z0-9._@-]+):\s+(.+)$/;

export function extractRelays(text) {
  const relays = new Map(); // recipient -> body
  for (const rawLine of text.split('\n')) {
    const match = RELAY_RE.exec(rawLine.trim());
    if (!match) continue;
    const [, to, body] = match;
    relays.set(to, relays.has(to) ? `${relays.get(to)}\n${body}` : body);
  }
  return relays;
}

export function sweepTranscript(store, owner) {
  const session = store.sessionFor(owner);
  if (!session || !existsSync(session.transcriptPath)) return 0;
  let relayedCount = 0;

  for (const line of readFileSync(session.transcriptPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== 'assistant' || entry.isMeta || !entry.uuid) continue;
    if (store.isRelayed(entry.uuid)) continue;

    const relays = extractRelays(extractText(entry.message?.content));
    for (const [to, body] of relays) {
      if (to === owner) continue;
      const id = `m-r${createHash('sha1').update(`${entry.uuid}|${to}`).digest('hex').slice(0, 8)}`;
      store.send({ from: owner, to, body, id });
      for (const msg of store.all()) {
        if (msg.from === to && msg.to === owner && msg.status === 'delivered') {
          store.ack(msg.id, 'acted', 'replied', owner);
        }
      }
      relayedCount++;
    }
    store.markRelayed(owner, entry.uuid);
  }
  return relayedCount;
}
