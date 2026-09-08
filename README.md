# shared-claude-session

**Session Hub** — cross-account messaging into a central Claude Code session.
*"SendMessage for other people's agents."*

Collaborators (humans or their agents) on **other accounts** contribute to one
person's live Claude Code session. The central session stays authoritative: messages
arrive as labelled, untrusted suggestions that its agent mediates — never as
injected turns. Design doc: `~/Code/scratch/session-hub-design.md`.

Zero dependencies — Node ≥ 18, no `npm install`, no build step.

## Components

| Path | Role |
|------|------|
| `src/server.js` | Hub HTTP API (send / inbox / ack / session-view / status) |
| `src/store.js` | append-only event log → messages table, idempotent by id, `unread → delivered → acted` |
| `src/tailer.js` | derives the curated session view from the session JSONL (read-only, fails soft) |
| `hooks/user-prompt-submit.js` | deterministic delivery: drains inbox on every prompt, injects as untrusted context, acks `delivered` |
| `statusline/unread.js` | the visible nudge: `📥 N unread` in the statusline |
| `bin/hub.js` | CLI door for contributors and the central agent |
| `src/mcp.js` | MCP door for external agents — stateless streamable-HTTP JSON-RPC, hand-rolled (no SDK) |
| `src/identity.js` | identity: dev header on localhost, `tailscale whois` when `HUB_TAILSCALE=1` |
| `src/fork.js` | experimental fork-for-context: redacted, causally-rebuilt session file a joiner can resume |
| `public/index.html` | web UI for human contributors (send, inbox, session view, messages table) |

## Testing on ONE machine

Everything is localhost — one machine is the natural test bench. Three terminals:

**Terminal 1 — the Hub**
```bash
cd shared-claude-session
npm start          # http://127.0.0.1:4780
```

**Terminal 2 — the central session** (Jeremy)
```bash
cd shared-claude-session/dev/central
claude
```
`dev/central/.claude/settings.json` wires up the hook + statusline and sets
`HUB_USER=central`. The statusline shows the unread count; every prompt you submit
drains the Hub inbox first.

**Terminal 3 — the contributor** (Alice) — pick any door:
```bash
# (a) a second Claude session as Alice's agent, over REAL MCP
cd dev/contributor && claude       # .mcp.json connects to the hub's /mcp endpoint
                                   # tools: send_message, list_inbox, ack
                                   # resource: session://central/view

# (b) the web UI (human door) — open http://127.0.0.1:4780/

# (c) raw CLI — fastest way to poke the system
node bin/hub.js view
node bin/hub.js send --as alice --to central "cap retries at 3 with jitter"
node bin/hub.js inbox --as alice --all                 # watch unread → delivered → acted
```

**The loop to observe:** send from Terminal 3 → central statusline flips to
`📥 1 unread` → type anything in Terminal 2 → the hook injects the message
(watch `<external-messages>` influence the response) → the central agent replies +
acks `acted` → Terminal 3's inbox shows the receipt.

Behind-the-scenes at any time: `node bin/hub.js status` or `curl :4780/api/status`.

Two-accounts-on-one-machine is honest because identity is a header (`X-Hub-User`)
in dev mode — the *only* thing multi-machine adds is Tailscale-verified identity,
which replaces `resolveUser()` in `src/server.js` and nothing else.

## Automated test

```bash
npm test    # test/e2e.sh — full loop + MCP handshake/tools/resources + web + fork, 26 checks
```

## Going multi-machine (Tailscale)

Run the hub with verified identity and share it over the tailnet:

```bash
HUB_TAILSCALE=1 npm start          # identity via `tailscale whois` — header ignored
tailscale serve 4780               # expose to your tailnet over HTTPS
```

Contributors point `.mcp.json` / `HUB_URL` / their browser at the tailnet address.
Nothing else changes — identity was the only localhost shortcut.

## Idle coverage (`/loop` recipe)

Hooks only fire when a turn happens. For an idle central session, run in it:

```
/loop check the hub inbox and mediate anything that arrived
```

and let it self-pace (lazy cadence). Each wakeup is a normal turn, so the same
UserPromptSubmit hook drains the inbox on its way in.

## Fork-for-context (experimental)

A contributor who wants deep context instead of the curated summary:

```bash
cd <their project dir>
node <hub>/bin/hub.js fork         # writes a redacted session file locally
claude --resume <printed id>      # their own Claude resumes it, full context
```

Redaction strips all tool calls/results (where secrets live) and rebuilds the
uuid chain. Forks never merge back — contributions still go through `send_message`.

## Status / roadmap

- [x] M1 — messaging core: store, HTTP API, hook, statusline, CLI, e2e
- [x] M2 — MCP server for external agents (same store, second door)
- [x] M3 — web UI for human contributors
- [x] Tailscale identity (`tailscale whois`) behind `HUB_TAILSCALE=1`
- [x] `/loop` idle-drain recipe (documented above)
- [x] fork-for-context (experimental): redacted session file a joiner can resume locally
- [ ] curated-view redaction rules (currently: text-only filter; no per-reader scoping)
- [ ] live smoke test with two real Claude Code sessions
