// Derives the curated session view from a Claude Code session JSONL.
// Read-only, on-demand, defensive: the JSONL format is Claude Code's private
// state — unknown line shapes are skipped, never fatal. The transcript is
// derived, not stored (design doc: "the log is theirs, the view is ours").
import { existsSync, readFileSync } from 'node:fs';

const MAX_TURNS = 50;
const MAX_TEXT = 600;

export function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n');
  }
  return '';
}

export function sessionView(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) {
    return { available: false, turns: [], reason: 'no transcript registered or file missing' };
  }
  const turns = [];
  for (const line of readFileSync(transcriptPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // partial line mid-write — skip, never fail
    }
    if (entry.type !== 'user' && entry.type !== 'assistant') continue;
    if (entry.isMeta) continue;
    const text = extractText(entry.message?.content).trim();
    if (!text) continue; // tool_use / tool_result blocks — not part of the curated view
    turns.push({
      role: entry.type,
      text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text,
      ts: entry.timestamp ?? null,
    });
  }
  return {
    available: true,
    totalTurns: turns.length,
    turns: turns.slice(-MAX_TURNS),
    updatedAt: turns.at(-1)?.ts ?? null,
  };
}
