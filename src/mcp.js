// MCP server — the external agent's door (M2).
// Hand-rolled stateless streamable-HTTP JSON-RPC handler (no SDK, no deps).
// Tools mirror the HTTP API exactly: same store, second door.
import { sessionView } from './tailer.js';

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const TOOLS = [
  {
    name: 'send_message',
    description:
      'Send a message to a participant on the Session Hub (e.g. the central session, addressed as "central"). ' +
      'Fire-and-forget: it lands in their inbox and is delivered at their next turn boundary. ' +
      'VERBATIM RULE: if your user writes "@central: <text>" (or "@<name>: <text>"), send <text> word-for-word ' +
      'as the body — those are their words, never paraphrase or embellish them. ' +
      'CONSENT RULE: if the body is your own composition (not an @-addressed line your user typed), show the ' +
      'draft to your user and get their explicit go-ahead BEFORE calling this tool — the message carries their ' +
      'name, so they decide what leaves their machine.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'recipient participant name, e.g. "central"' },
        body: { type: 'string', description: 'the message text' },
        replyTo: { type: 'string', description: 'optional message id this replies to' },
      },
      required: ['to', 'body'],
    },
  },
  {
    name: 'list_inbox',
    description:
      'List messages addressed to you. Default: unread only. Status shows the two-level ack: ' +
      'unread → delivered (reached recipient context) → acted (a decision was made about it).',
    inputSchema: {
      type: 'object',
      properties: { all: { type: 'boolean', description: 'include delivered/acted messages too' } },
    },
  },
  {
    name: 'ack',
    description: 'Acknowledge a message: level "delivered" (it reached you) or "acted" (you made a decision about it).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        level: { type: 'string', enum: ['delivered', 'acted'] },
        detail: { type: 'string', description: 'for acted: e.g. "incorporated" or "declined"' },
      },
      required: ['id', 'level'],
    },
  },
];

const RESOURCES = [
  {
    uri: 'session://central/view',
    name: 'Central session view',
    description: 'Curated, read-only view of the central Claude session (derived from its transcript).',
    mimeType: 'application/json',
  },
];

function callTool(store, user, name, args = {}) {
  if (!user) throw new Error('identity required — connect with an X-Hub-User header (or Tailscale identity)');
  switch (name) {
    case 'send_message': {
      const msg = store.send({ from: user, to: args.to, body: args.body, replyTo: args.replyTo });
      return `sent ${msg.id} → ${msg.to} (status: ${msg.status})`;
    }
    case 'list_inbox': {
      const msgs = store.inbox(user, { unreadOnly: !args.all });
      if (!msgs.length) return 'inbox empty';
      return msgs
        .map((m) => `${m.id} [${m.status}${m.actedDetail ? `:${m.actedDetail}` : ''}] from ${m.from}: ${m.body}`)
        .join('\n');
    }
    case 'ack': {
      const msg = store.ack(args.id, args.level, args.detail, user);
      return `${msg.id} → ${msg.status}${msg.actedDetail ? ` (${msg.actedDetail})` : ''}`;
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

function handleRequest(store, user, rpc) {
  switch (rpc.method) {
    case 'initialize':
      return {
        protocolVersion: PROTOCOL_VERSIONS.includes(rpc.params?.protocolVersion)
          ? rpc.params.protocolVersion
          : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
        serverInfo: { name: 'session-hub', version: '0.1.0' },
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: TOOLS };
    case 'tools/call':
      try {
        return { content: [{ type: 'text', text: callTool(store, user, rpc.params?.name, rpc.params?.arguments) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: err.message }], isError: true };
      }
    case 'resources/list':
      return { resources: RESOURCES };
    case 'resources/read': {
      if (rpc.params?.uri !== RESOURCES[0].uri) throw Object.assign(new Error('unknown resource'), { code: -32002 });
      const view = sessionView(store.sessionFor('central')?.transcriptPath);
      return { contents: [{ uri: RESOURCES[0].uri, mimeType: 'application/json', text: JSON.stringify(view, null, 2) }] };
    }
    default:
      throw Object.assign(new Error(`method not found: ${rpc.method}`), { code: -32601 });
  }
}

// Mounted at /mcp. Stateless: no session ids, no SSE stream — every POST gets a JSON reply.
export async function handleMcp(store, user, req, res, body) {
  if (req.method === 'GET') {
    res.writeHead(405, { allow: 'POST' }).end();
    return;
  }
  if (req.method === 'DELETE') {
    res.writeHead(200).end();
    return;
  }
  // Notifications (no id) get 202 and no body, per streamable HTTP transport.
  if (body.id === undefined) {
    res.writeHead(202).end();
    return;
  }
  let response;
  try {
    response = { jsonrpc: '2.0', id: body.id, result: handleRequest(store, user, body) };
  } catch (err) {
    response = { jsonrpc: '2.0', id: body.id, error: { code: err.code ?? -32603, message: err.message } };
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(response));
}
