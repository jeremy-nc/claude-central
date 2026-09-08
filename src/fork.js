// Fork-for-context (experimental) — a REDACTED session file a joiner can resume
// locally, so their agent gets deep context instead of a summary. Forks never
// merge back (a transcript is a causal chain); contributions still return as
// messages through the Hub.
//
// Redaction: only user/assistant text survives. Tool calls, tool results, and
// meta entries — where secrets live — are stripped. Because dropping entries
// breaks the uuid/parentUuid chain, the chain is rebuilt as a fresh linear
// history under a new session id.
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { readCapped } from './transcripts.js';

export function forkSession(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return null;
  const sessionId = randomUUID();
  const lines = [];
  let parentUuid = null;

  for (const line of readCapped(transcriptPath).split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if ((entry.type !== 'user' && entry.type !== 'assistant') || entry.isMeta) continue;

    let content = entry.message?.content;
    if (Array.isArray(content)) {
      content = content.filter((b) => b?.type === 'text' && typeof b.text === 'string');
      if (!content.length) continue; // tool-only entry — redacted away entirely
    } else if (typeof content !== 'string' || !content.trim()) {
      continue;
    }

    const uuid = randomUUID();
    lines.push(
      JSON.stringify({
        type: entry.type,
        message: { role: entry.message.role, content },
        uuid,
        parentUuid,
        sessionId,
        timestamp: entry.timestamp ?? new Date().toISOString(),
      }),
    );
    parentUuid = uuid;
  }

  return lines.length ? { sessionId, jsonl: lines.join('\n') + '\n', turns: lines.length } : null;
}
