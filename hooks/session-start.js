#!/usr/bin/env node
// SessionStart hook — drain messages that were waiting while no session was open.
// Fires when a session starts or resumes (e.g. opening Claude in VSCode), so
// waiting mail is surfaced before the user even types.
import { registerSession, drain, readStdin } from './drain.js';

try {
  const { session_id: sessionId, transcript_path: transcriptPath } = await readStdin();
  await registerSession(transcriptPath, sessionId);
  const { count, context } = await drain();
  if (count > 0) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context },
      }),
    );
  }
} catch {
  // Hub unreachable — stay silent.
}
process.exit(0);
