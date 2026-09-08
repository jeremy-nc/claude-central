# claude-central v2 — Federated Peers (concept only)

**Status:** Concept/plan only — no build. v1 is shipped and live
(github.com/jeremy-nc/claude-central); this describes its federated successor.

## Context

v1 works, but it's structurally asymmetric because only ONE machine runs a hub:

| | Jeremy (hub-side) | Alice (remote) |
|---|---|---|
| `@name:` relay | **mechanical** (hub sweeps his transcript) | instruction-following (model obeys the tool description — reliable, not guaranteed) |
| Inbound delivery | hooks + watcher, deterministic | agent must poll `list_inbox` |
| Session view | derived from his JSONL tail | none of hers exists |
| Role | "central", authoritative | "contributor", second-class |

v2's move: **everyone runs a hub.** Each hub tails *its owner's* transcript,
holds *its owner's* inbox, and federates messages hub-to-hub. Both sides get the
mechanical relay, hooks, watcher, and view. "Central" disappears as a concept —
there are only **peers**; addressing becomes `@jeremy:` / `@alice:`.

The new problem this creates — and the heart of v2 — is consent: **which
sessions feed each other must be explicitly agreed.** That agreement is a
first-class object: the **Link**.

## The Link

A Link is a mutual, revocable agreement between two peers binding **one named
session on each side** with **per-direction grants**.

```
link {
  id, peerA: {owner, hubUrl, sessionId}, peerB: {owner, hubUrl, sessionId},
  grants: { AtoB: [view? messages? fork?], BtoA: [view? messages? fork?] },
  status: offered | active | revoked
}
```

Decisions made (user-confirmed):

- **Per-session binding.** A link names an explicit session on each side. Other
  sessions never leak into it. Starting a new session ≠ feeding the link; you
  re-pin deliberately. (A session can feed multiple links; each link is scoped.)
- **Asymmetric grants.** Each direction carries its own set of {view, messages,
  fork}. Supports "read my session and message me, while I only message you"
  (reviewer/mentor shapes) without forcing mutual exposure.

### Handshake (mirrors the Tailscale-share UX that already worked)

1. **Offer**: Jeremy's hub mints a link-offer — his hub URL, his chosen session,
   the grants he proposes each way — as a short token/URL he sends out-of-band.
2. **Accept**: Alice opens it against her hub, picks *her* session to bind (or
   "messages-only, no session"), trims grants down (never up), accepts.
3. **Confirm**: her hub calls his `/federation/link` endpoint; both hubs append a
   `link` event to their stores. Active.
4. **Revoke**: either side, unilaterally, any time — a `link-revoked` event; the
   peer hub honors it on next contact and drops in-flight deliveries.

Consent properties: both humans act before anything flows; grants can only be
narrowed by the accepter; each side's session choice is their own; revocation
needs no cooperation.

## Message flow (symmetric now)

```
jeremy types/agent writes "@alice: …" in HIS session
  → HIS hub sweeps HIS transcript (mechanical, regex — v1's relay.js, unchanged)
  → HIS hub pushes over the tailnet to ALICE's hub  /federation/deliver
  → HER hub inserts into HER inbox (idempotent by id, as today)
  → HER hooks/watcher deliver into HER session at her next turn boundary
  → her verbatim-quote + visible-@reply rules apply — and the loop reverses
```

The v1 trust model survives intact at both ends: mediated inboxes, untrusted-data
framing, verbatim quoting, chat-as-the-reply-channel, two-level acks
(`delivered`/`acted`), consent for agent-composed sends. What changes is that the
**instruction-following relay disappears** — both directions are swept by code.

### Loop guard (new hazard, must be in v2 core)

Two watchers + auto-turns can ping-pong: A's auto-turn replies `@b:`, wakes B's
auto-turn, which replies `@a:`, forever. Rule: relayed messages carry an
`auto: true` flag when the originating turn was an auto-turn (watcher//loop
wake); **auto-turns may ack but never `@`-reply to auto-flagged messages** — only
a human-initiated turn can continue an auto↔auto exchange. Hop-count as backstop.

## What carries over from v1 unchanged

- `store.js` event-sourced log, idempotent sends, monotonic acks — per hub
- `relay.js` sweep + `tailer.js` derived view — now running on every peer
- hooks (SessionStart / UserPromptSubmit / Stop), statusline, watcher — per peer
- Tailscale serve + identity headers — hub-to-hub calls authenticate the same way
  (each hub verifies the *peer machine's* Tailscale identity)
- MCP endpoint + web UI — still each hub's doors for humans/agents *without* a
  hub of their own (v1-style contributors remain supported: a link where one
  side is "messages-only, no session bound" IS the v1 relationship)

## Explicitly deferred

- **Multi-party links** (3+ sessions in one "room") — different consent and loop
  semantics; do pairwise first.
- **Public (non-tailnet) peers** — needs token auth; unchanged from v1's stance.
- **CRDT** — still not needed: every transcript remains single-writer; federation
  is message-passing between coordinators, not shared state. (Position unchanged
  from the original design doc; the doc-centric reframe remains the one place
  CRDTs would legitimately enter.)

## Verification (for this concept)

Nothing to run. "Done" = this doc faithfully captures: everyone-runs-a-hub
symmetry; the Link as per-session, asymmetric-grant, offer/accept/revoke
consent object; hub-to-hub delivery reusing v1's sweep/inbox/ack machinery;
the auto-reply loop guard; and v1 contributors as the degenerate link case.
