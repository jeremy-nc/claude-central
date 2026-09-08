#!/usr/bin/env node
// Stop hook — catches messages that arrived WHILE the agent was working.
// If the inbox is non-empty when the agent tries to finish its response, block
// the stop and hand the messages over, so mid-turn arrivals are handled at the
// end of the same turn instead of waiting for the next user prompt.
//
// Loop safety: when stop_hook_active is set, this continuation was already
// forced once — allow the stop unconditionally rather than risk an infinite loop.
import { drain, readStdin } from './drain.js';

try {
  const { stop_hook_active: stopHookActive } = await readStdin();
  if (!stopHookActive) {
    const { count, context } = await drain();
    if (count > 0) {
      process.stdout.write(
        JSON.stringify({
          decision: 'block',
          reason:
            `${count} Session Hub message(s) arrived while you were working. ` +
            `Before finishing, disposition them:\n${context}`,
        }),
      );
    }
  }
} catch {
  // Hub unreachable — allow the stop.
}
process.exit(0);
