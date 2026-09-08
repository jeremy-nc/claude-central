// Transcript path containment.
//
// A registered transcriptPath is later read back verbatim by the tailer and the
// fork endpoint, so registration is the control point: anything that gets stored
// here is something the Hub will happily read and serve. Two rules —
//   1. the path must resolve (symlinks followed) inside the transcript root, so
//      a registered owner cannot reach sideways into unrelated files;
//   2. reads are size-capped, because the tailer parses the whole file
//      synchronously on a single-threaded server.
import { realpathSync, statSync, openSync, readSync, closeSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, sep } from 'node:path';

// Claude Code writes session JSONL under ~/.claude/projects. Overridable so the
// e2e suite can point at a fixture directory.
// Resolved through symlinks so the containment check compares like with like:
// on macOS a temp dir is /var/... which really lives at /private/var/....
function realRoot(candidate) {
  const absolute = resolve(candidate);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute; // not created yet — nothing will pass containment until it is
  }
}

export const TRANSCRIPT_ROOT = realRoot(
  process.env.HUB_TRANSCRIPT_ROOT ?? `${homedir()}${sep}.claude${sep}projects`,
);

// Read cap for a single view/fork. The curated view only surfaces the last 50
// turns, so past this size we read the tail rather than refusing outright.
const MAX_READ_BYTES = Number(process.env.HUB_MAX_TRANSCRIPT_BYTES ?? 8 * 1024 * 1024);

/**
 * Resolve a candidate transcript path against the root.
 * Returns the real path, or null when it is missing, not a regular file, or
 * outside the root. Callers treat null as "refuse to store this".
 */
export function containedPath(candidate) {
  if (!candidate || typeof candidate !== 'string') return null;
  let real;
  try {
    real = realpathSync(resolve(candidate));
  } catch {
    return null; // missing, or a broken symlink
  }
  if (real !== TRANSCRIPT_ROOT && !real.startsWith(TRANSCRIPT_ROOT + sep)) return null;
  try {
    if (!statSync(real).isFile()) return null;
  } catch {
    return null;
  }
  return real;
}

/**
 * Read a transcript with a size cap. Files over the cap are read from the tail
 * and the leading partial line is dropped, which suits the tailer and the fork
 * builder since both only care about recent turns. Returns '' when unreadable.
 */
export function readCapped(path) {
  let size;
  try {
    size = statSync(path).size;
  } catch {
    return '';
  }
  if (size <= MAX_READ_BYTES) {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return '';
    }
  }
  const buf = Buffer.allocUnsafe(MAX_READ_BYTES);
  let fd;
  try {
    fd = openSync(path, 'r');
    const bytes = readSync(fd, buf, 0, MAX_READ_BYTES, size - MAX_READ_BYTES);
    const text = buf.subarray(0, bytes).toString('utf8');
    const firstBreak = text.indexOf('\n');
    return firstBreak === -1 ? '' : text.slice(firstBreak + 1);
  } catch {
    return '';
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
