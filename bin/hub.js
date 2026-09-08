#!/usr/bin/env node
// Session Hub CLI — the contributor's (and central agent's) door until the MCP
// server lands. Identity via --as or HUB_USER env.
//
//   hub send  --as alice --to central [--reply-to m-1] "body text"
//   hub inbox --as alice [--all]
//   hub ack   <id> <delivered|acted> [detail]  --as central
//   hub view  [--owner central]
//   hub status
//   hub watch [--as central] [--interval ms]  # blocks until a message arrives, then exits
//   hub fork  [--owner central]   # experimental: redacted session copy, resumable locally
const HUB_URL = process.env.HUB_URL ?? 'http://127.0.0.1:4780';

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[++i];
    else positional.push(argv[i]);
  }
  return { flags, positional };
}

async function call(method, path, { user, body } = {}) {
  const res = await fetch(`${HUB_URL}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(user && { 'x-hub-user': user }) },
    ...(body && { body: JSON.stringify(body) }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

const [command, ...rest] = process.argv.slice(2);
const { flags, positional } = parseArgs(rest);
const user = flags.as ?? process.env.HUB_USER;

try {
  switch (command) {
    case 'send': {
      const msg = await call('POST', '/api/send', {
        user,
        body: { to: flags.to, body: positional.join(' '), replyTo: flags['reply-to'] },
      });
      console.log(`sent ${msg.id} → ${msg.to}`);
      break;
    }
    case 'inbox': {
      const msgs = await call('GET', `/api/inbox${'all' in flags ? '?all=1' : ''}`, { user });
      if (!msgs.length) console.log('(inbox empty)');
      for (const m of msgs) {
        const status = `${m.status}${m.actedDetail ? `:${m.actedDetail}` : ''}`;
        console.log(`${m.id} [${status}] from ${m.from}: ${m.body}${m.replyTo ? `  (reply to ${m.replyTo})` : ''}`);
      }
      break;
    }
    case 'ack': {
      const [id, level, ...detail] = positional;
      const msg = await call('POST', '/api/ack', { user, body: { id, level, detail: detail.join(' ') || undefined } });
      console.log(`${msg.id} → ${msg.status}${msg.actedDetail ? ` (${msg.actedDetail})` : ''}`);
      break;
    }
    case 'view': {
      const view = await call('GET', `/api/session-view?owner=${flags.owner ?? 'central'}`);
      if (!view.available) {
        console.log(`no session view: ${view.reason}`);
        break;
      }
      console.log(`session view (${view.totalTurns} turns, showing last ${view.turns.length}):\n`);
      for (const t of view.turns) console.log(`  ${t.role === 'user' ? '❯' : '⏺'} ${t.text.replaceAll('\n', '\n    ')}`);
      break;
    }
    case 'watch': {
      // Background watcher: sits quietly until a message arrives, then EXITS.
      // Run it as a background task from a Claude session — the task exiting is
      // what wakes the agent (event-driven idle coverage, no polling turns).
      const who = user ?? 'central';
      const intervalMs = Number(flags.interval ?? 2000);
      console.log(`watching inbox for ${who} — exiting on first unread message`);
      for (;;) {
        try {
          const { count } = await call('GET', `/api/unread?user=${who}`);
          if (count > 0) {
            const msgs = await call('GET', '/api/inbox', { user: who });
            console.log(`\n${count} message(s) arrived for ${who}:`);
            for (const m of msgs) console.log(`  ${m.id} from ${m.from}: ${m.body}`);
            console.log('\nACTION: drain and disposition these (reply + ack acted), then restart this watcher in the background.');
            process.exit(0);
          }
        } catch {
          // hub restarting — keep watching
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }
    case 'fork': {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      const { homedir } = await import('node:os');
      const fork = await call('GET', `/api/fork?owner=${flags.owner ?? 'central'}`);
      const projectDir = `${homedir()}/.claude/projects/${process.cwd().replaceAll(/[/.]/g, '-')}`;
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(`${projectDir}/${fork.sessionId}.jsonl`, fork.jsonl);
      console.log(`forked ${fork.turns} redacted turns → ${projectDir}/${fork.sessionId}.jsonl`);
      console.log(`resume it from this directory with:  claude --resume ${fork.sessionId}`);
      console.log('(experimental: forks never merge back — contribute via send_message)');
      break;
    }
    case 'status': {
      const { messages, sessions } = await call('GET', '/api/status');
      console.log(`registered sessions: ${sessions.join(', ') || '(none)'}`);
      for (const m of messages) {
        console.log(`${m.id} ${m.from}→${m.to} [${m.status}${m.actedDetail ? `:${m.actedDetail}` : ''}] ${m.body}`);
      }
      break;
    }
    default:
      console.log('usage: hub <send|inbox|ack|view|status> — see file header for flags');
      process.exitCode = 1;
  }
} catch (err) {
  console.error(`hub: ${err.message}`);
  process.exitCode = 1;
}
