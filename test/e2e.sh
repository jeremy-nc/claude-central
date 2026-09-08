#!/bin/bash
# e2e: full message loop on one machine, no Claude Code required.
# send → statusline count → hook drain (simulated stdin) → delivered ack →
# reply + acted ack → contributor receipt → session view from a fake transcript.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=4799
DATA=$(mktemp -d)
TRANSCRIPT="$DATA/fake-session.jsonl"
export HUB_URL="http://127.0.0.1:$PORT"
HUB="node bin/hub.js"

# fake Claude Code session JSONL (the shape the tailer parses)
cat > "$TRANSCRIPT" <<'EOF'
{"type":"user","message":{"role":"user","content":"let's plan the vendor API migration"},"timestamp":"2026-09-08T01:00:00Z"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Cut-over is done. Open decision: the retry policy."}]},"timestamp":"2026-09-08T01:00:05Z"}
EOF

HUB_PORT=$PORT HUB_DATA=$DATA HUB_TRANSCRIPT_ROOT=$DATA node src/server.js & SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT
for _ in $(seq 1 20); do curl -sf "$HUB_URL/api/status" >/dev/null 2>&1 && break; sleep 0.1; done

pass=0; fail=0
check() { # check <description> <actual> <expected-substring>
  if [[ "$2" == *"$3"* ]]; then echo "  ✓ $1"; pass=$((pass+1));
  else echo "  ✗ $1"; echo "    expected substring: $3"; echo "    got: $2"; fail=$((fail+1)); fi
}

echo "1. alice sends a suggestion"
OUT=$($HUB send --as alice --to central "cap retries at 3 with jitter")
check "message queued" "$OUT" "sent m-"
MSG_ID=$(echo "$OUT" | grep -o 'm-[a-f0-9]*')

echo "2. statusline sees 1 unread"
OUT=$(echo '{}' | HUB_USER=central node statusline/unread.js)
check "statusline shows unread" "$OUT" "📥 1 unread"

echo "3. hook fires on central's next prompt (simulated stdin)"
OUT=$(printf '{"session_id":"test-s1","transcript_path":"%s","prompt":"lock in retry policy"}' "$TRANSCRIPT" \
      | HUB_USER=central node hooks/user-prompt-submit.js)
check "context injected"        "$OUT" "external-messages"
check "message body present"    "$OUT" "cap retries at 3 with jitter"
check "untrusted framing"       "$OUT" "untrusted"
check "reply instructions"      "$OUT" "bin/hub.js send"

echo "4. hook auto-acked delivered"
OUT=$($HUB inbox --as central --all)
check "status is delivered" "$OUT" "[delivered]"

echo "5. central replies and acks acted"
$HUB send --as central --to alice --reply-to "$MSG_ID" "good catch — incorporated" >/dev/null
OUT=$($HUB ack "$MSG_ID" acted incorporated --as central)
check "acted recorded" "$OUT" "acted (incorporated)"

echo "6. alice sees the receipt"
OUT=$($HUB inbox --as alice)
check "reply arrived"     "$OUT" "good catch — incorporated"
check "linked to original" "$OUT" "reply to $MSG_ID"

echo "7. statusline back to zero"
OUT=$(echo '{}' | HUB_USER=central node statusline/unread.js)
check "no unread left" "$OUT" "0 unread"

echo "8. curated session view (from the registered transcript)"
OUT=$($HUB view --as central --owner central)
check "view derived from JSONL" "$OUT" "retry policy"

echo "9. idempotency — resend with same id converges"
curl -s -X POST "$HUB_URL/api/send" -H 'content-type: application/json' -H 'x-hub-user: alice' \
  -d "{\"to\":\"central\",\"body\":\"dup\",\"id\":\"$MSG_ID\"}" >/dev/null
OUT=$($HUB status)
check "no duplicate row" "$(echo "$OUT" | grep -c "$MSG_ID")" "1"

mcp() { # mcp <json-rpc body> — POST to the MCP endpoint as bob
  curl -s -X POST "$HUB_URL/mcp" -H 'content-type: application/json' -H 'x-hub-user: bob' -d "$1"
}

echo "10. MCP: initialize handshake"
OUT=$(mcp '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"e2e","version":"0"}}}')
check "protocol negotiated" "$OUT" '"protocolVersion":"2025-06-18"'
check "server named"        "$OUT" '"session-hub"'

echo "11. MCP: notification gets 202, no body"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$HUB_URL/mcp" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}')
check "202 accepted" "$CODE" "202"

echo "12. MCP: tools/list and tools/call"
OUT=$(mcp '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
check "three tools" "$(echo "$OUT" | grep -o '"name"' | wc -l | tr -d ' ')" "3"  # send_message, list_inbox, ack
OUT=$(mcp '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"send_message","arguments":{"to":"central","body":"MCP says hello"}}}')
check "send via MCP" "$OUT" "sent m-"
OUT=$($HUB inbox --as central)
check "MCP message in central inbox" "$OUT" "MCP says hello"

echo "13. MCP: resources/read returns the session view"
OUT=$(mcp '{"jsonrpc":"2.0","id":4,"method":"resources/read","params":{"uri":"session://central/view"}}')
check "view over MCP" "$OUT" "retry policy"

echo "14. MCP: identity enforced on tools"
OUT=$(curl -s -X POST "$HUB_URL/mcp" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"send_message","arguments":{"to":"central","body":"x"}}}')
check "anonymous rejected" "$OUT" "identity required"

echo "15. web UI served"
OUT=$(curl -s "$HUB_URL/")
check "html page" "$OUT" "SESSION"

echo "16. fork: redacted + causally rebuilt"
OUT=$(curl -s -H 'x-hub-user: alice' "$HUB_URL/api/fork?owner=central")
check "fork produced"      "$OUT" '"turns": 2'
check "new session id"     "$OUT" '"sessionId"'
check "text survived"      "$OUT" "retry policy"
OUT=$(curl -s -H 'x-hub-user: alice' "$HUB_URL/api/fork?owner=nobody")
check "unknown owner 404s" "$OUT" "no forkable session"

echo "17. Stop hook: blocks the stop when messages arrived mid-turn"
$HUB send --as alice --to hookee "arrived while you were working" >/dev/null
OUT=$(echo '{"stop_hook_active":false}' | HUB_USER=hookee node hooks/stop.js)
check "stop blocked"            "$OUT" '"decision":"block"'
check "messages handed over"    "$OUT" "arrived while you were working"
check "disposition rule stated" "$OUT" "Disposition EVERY message"

echo "18. Stop hook: allows stop when inbox is empty / already delivered"
OUT=$(echo '{"stop_hook_active":false}' | HUB_USER=hookee node hooks/stop.js)
check "no block on empty inbox" "x${OUT}x" "xx"

echo "19. Stop hook: loop safety — stop_hook_active never re-blocks"
$HUB send --as alice --to hookee "second message" >/dev/null
OUT=$(echo '{"stop_hook_active":true}' | HUB_USER=hookee node hooks/stop.js)
check "no re-block when active" "x${OUT}x" "xx"

echo "20. SessionStart hook: drains waiting mail on session open"
OUT=$(printf '{"session_id":"s2","transcript_path":"%s"}' "$TRANSCRIPT" | HUB_USER=hookee node hooks/session-start.js)
check "context injected on start" "$OUT" '"hookEventName":"SessionStart"'
check "waiting message included"  "$OUT" "second message"

echo "21. addressing convention taught in injected context"
$HUB send --as alice --to hookee "third" >/dev/null
OUT=$(printf '{"session_id":"s2","transcript_path":"%s","prompt":"x"}' "$TRANSCRIPT" | HUB_USER=hookee node hooks/user-prompt-submit.js)
check "relay rule present" "$OUT" '@<name>'

echo "22. serve-mode identity: Tailscale-User-Login wins over X-Hub-User"
PORT2=4798
DATA2=$(mktemp -d)
HUB_PORT=$PORT2 HUB_DATA=$DATA2 HUB_TRANSCRIPT_ROOT=$DATA2 HUB_TAILSCALE=serve node src/server.js & SERVER2_PID=$!
trap 'kill $SERVER_PID $SERVER2_PID 2>/dev/null' EXIT
for _ in $(seq 1 20); do curl -sf "http://127.0.0.1:$PORT2/api/status" >/dev/null 2>&1 && break; sleep 0.1; done
OUT=$(curl -s -X POST "http://127.0.0.1:$PORT2/api/send" -H 'content-type: application/json' \
  -H 'Tailscale-User-Login: real@tailnet.example' -H 'X-Hub-User: spoofed-name' \
  -d '{"to":"central","body":"identity test"}')
check "tailscale identity used" "$OUT" '"from": "real@tailnet.example"'
OUT=$(curl -s -X POST "http://127.0.0.1:$PORT2/api/send" -H 'content-type: application/json' \
  -H 'X-Hub-User: local-hook' -d '{"to":"central","body":"local fallback"}')
check "local header fallback works" "$OUT" '"from": "local-hook"'

echo "23. transcript endpoints require identity"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$HUB_URL/api/session-view?owner=central")
check "session-view anonymous rejected" "$CODE" "401"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$HUB_URL/api/fork?owner=central")
check "fork anonymous rejected" "$CODE" "401"
OUT=$(curl -s -X POST "$HUB_URL/api/register-session" -H 'content-type: application/json' \
  -d "{\"owner\":\"central\",\"transcriptPath\":\"$TRANSCRIPT\"}")
check "register anonymous rejected" "$OUT" "identity required"

echo "24. register-session: owner must be the caller"
OUT=$(curl -s -X POST "$HUB_URL/api/register-session" -H 'content-type: application/json' \
  -H 'x-hub-user: mallory' -d "{\"owner\":\"central\",\"transcriptPath\":\"$TRANSCRIPT\"}")
check "owner mismatch rejected" "$OUT" "owner must be the calling identity"
OUT=$($HUB view --as central --owner central)
check "central's view unchanged" "$OUT" "retry policy"

echo "25. register-session: path contained under the transcript root"
OUTSIDE=$(mktemp -d)/outside.jsonl
echo '{"type":"user","message":{"role":"user","content":"secret from another session"},"timestamp":"2026-09-08T02:00:00Z"}' > "$OUTSIDE"
OUT=$(curl -s -X POST "$HUB_URL/api/register-session" -H 'content-type: application/json' \
  -H 'x-hub-user: mallory' -d "{\"owner\":\"mallory\",\"transcriptPath\":\"$OUTSIDE\"}")
check "path outside root rejected" "$OUT" "must be an existing file under"
OUT=$(curl -s -H 'x-hub-user: mallory' "$HUB_URL/api/session-view?owner=mallory")
check "nothing served for mallory" "$OUT" '"available": false'

echo "26. register-session: symlink out of the root is refused"
ln -s "$OUTSIDE" "$DATA/escape.jsonl"
OUT=$(curl -s -X POST "$HUB_URL/api/register-session" -H 'content-type: application/json' \
  -H 'x-hub-user: mallory' -d "{\"owner\":\"mallory\",\"transcriptPath\":\"$DATA/escape.jsonl\"}")
check "symlink escape rejected" "$OUT" "must be an existing file under"

echo "27. register-session: own contained path still works"
OUT=$(curl -s -X POST "$HUB_URL/api/register-session" -H 'content-type: application/json' \
  -H 'x-hub-user: alice' -d "{\"owner\":\"alice\",\"transcriptPath\":\"$TRANSCRIPT\"}")
check "legitimate register accepted" "$OUT" '"ok": true'
OUT=$($HUB view --as alice --owner alice)
check "alice's own view available" "$OUT" "retry policy"

echo
echo "── $pass passed, $fail failed"
[[ $fail -eq 0 ]]
