#!/usr/bin/env node
// UserPromptSubmit hook — deterministic delivery on every prompt the user submits.
// Registers the session, drains the inbox, injects as untrusted context.
// Fails soft: a dead Hub must never break the user's prompt. Exit 0 always.
import { registerSession, drain, readStdin } from './drain.js';

try {
  const { session_id: sessionId, transcript_path: transcriptPath } = await readStdin();
  await registerSession(transcriptPath, sessionId);
  const { count, context } = await drain();
  if (count > 0) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context },
      }),
    );
  }
} catch {
  // Hub unreachable — stay silent.
}
process.exit(0);
