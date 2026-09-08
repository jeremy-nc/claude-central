# Contribute to Jeremy's Claude session

Jeremy runs a **Session Hub** — you (or your Claude agent) can read a curated view
of his live Claude Code session and send him suggestions. Your messages are
**mediated**: they land in his session's inbox, his agent weighs them and replies —
nothing you send is ever injected directly into his session.

## 1. Get on the tailnet (one-time)

1. Install Tailscale: <https://tailscale.com/download> (or `brew install --cask tailscale-app`)
2. Log in — **use your @nurturecloud.com Google account**. If that doesn't put you
   on the same tailnet, ask Jeremy to share his machine with you from the Tailscale
   admin console.
3. Verify you can reach the hub:

```bash
curl https://macbook-pro.tailfff37a.ts.net/api/status
```

Your identity is your **Tailscale login** — the network verifies it, so there are no
tokens, and you can't be impersonated (nor impersonate anyone: any name header you
send is ignored and replaced with your real login).

## 2. Pick your door

### A. Browser (humans)

Open **<https://macbook-pro.tailfff37a.ts.net/>**.
Type your Tailscale login email in the "you are" box (it's only used to filter your
inbox view — your *sending* identity is verified by the network regardless).
Send suggestions, watch the messages table, read the session view.

### B. Your Claude agent (MCP)

Drop this into `.mcp.json` in any project (or add via `claude mcp add`):

```json
{
  "mcpServers": {
    "session-hub": {
      "type": "http",
      "url": "https://macbook-pro.tailfff37a.ts.net/mcp"
    }
  }
}
```

Your agent gets:

| Tool / resource | What it does |
|---|---|
| `send_message` | send a suggestion (`to: "central"` = Jeremy's session) |
| `list_inbox` | your replies & receipts |
| `ack` | acknowledge replies you receive |
| `session://central/view` (resource) | curated view of Jeremy's session |

Try: *"read jeremy's session and suggest something useful, then send it to central"*.

### C. CLI (if you clone [the repo](https://github.com/jeremy-nc/claude-central))

```bash
export HUB_URL=https://macbook-pro.tailfff37a.ts.net
node bin/hub.js view
node bin/hub.js send --to central "your suggestion"
node bin/hub.js inbox --all
```

(`--as` is ignored over the tailnet — you are who Tailscale says you are.)

## 3. What to expect

- Your message shows **unread** → **delivered** (it entered his agent's context at a
  turn boundary) → **acted: incorporated / declined** (his agent made a decision).
- Delivery happens at his session's next turn — seconds to minutes if he's active,
  next session-open if he's away. Not instant, by design.
- Replies from his agent land in your inbox (`list_inbox` / the web UI).

Etiquette: read the session view first so your suggestion lands in context.
