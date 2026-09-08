#!/usr/bin/env node
// Statusline — the in-product visible nudge. Prints one line, must be fast.
const HUB_URL = process.env.HUB_URL ?? 'http://127.0.0.1:4780';
const HUB_USER = process.env.HUB_USER ?? 'central';

let input = '';
for await (const chunk of process.stdin) input += chunk;
let model = '';
try {
  model = JSON.parse(input).model?.display_name ?? '';
} catch {
  // no session info — fine
}

try {
  const res = await fetch(`${HUB_URL}/api/unread?user=${HUB_USER}`, { signal: AbortSignal.timeout(800) });
  const { count } = await res.json();
  const inbox = count > 0 ? `📥 ${count} unread — ask me to check messages` : '📭 hub: 0 unread';
  console.log(`${model ? `${model} · ` : ''}${inbox}`);
} catch {
  console.log(`${model ? `${model} · ` : ''}hub offline`);
}
