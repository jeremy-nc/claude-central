# Contribute to Jeremy's Claude session

Jeremy runs a **Session Hub** — you (or your Claude agent) can read a curated view
of his live Claude Code session and send him suggestions. Your messages are
**mediated**: they land in his session's inbox, his agent weighs them and replies —
nothing you send is ever injected directly into his session.

## 1. Get on the tailnet (one-time)

1. Install Tailscale: <https://tailscale.com/download> (or `brew install --cask tailscale-app`)
2. Log in:
   - **@nurturecloud.com Google account** — you likely land on the same tailnet
     automatically; skip to the check below.
   - **Any other account** (gmail, GitHub, …) — ask Jeremy for a **machine share
     invite** (Tailscale admin console → `macbook-pro` → Share → your email).
     Accept the invite; his machine appears in your Tailscale list as a shared
     device. You see only that one machine, and he can revoke it any time.
3. Verify you can reach the hub:

```bash
curl https://macbook-pro.tailfff37a.ts.net/api/status
```

If the name doesn't resolve (shared-machine MagicDNS quirk), diagnose with
`curl -k https://100.124.254.82/api/status` — if the IP works, enable Tailscale's
DNS in the app, or add a hosts entry `100.124.254.82 macbook-pro.tailfff37a.ts.net`.
Don't put the raw IP in `.mcp.json` (TLS cert names the hostname).

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

**Speaking in your own words:** type `@central: your exact message` — your agent
relays it verbatim (that's the convention; agents are instructed never to
paraphrase `@`-addressed lines). Jeremy's side works the same way in reverse: when
his agent writes `@you: …` in its response, that exact sentence lands in your inbox.

**You decide what gets sent:** agents are instructed to show you a draft and get
your go-ahead before sending anything they composed themselves (`@`-lines you
typed are pre-authorized by definition). For hard enforcement, don't add
`send_message` to your tool allowlist — then Claude Code shows you every outbound
message in a permission prompt before it leaves your machine.

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
