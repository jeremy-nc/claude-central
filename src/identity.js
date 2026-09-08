// Identity resolution — the ONLY thing that changes between one-machine dev and
// a real tailnet deployment. Mode via HUB_TAILSCALE:
//
//   (unset)   dev: trust the X-Hub-User header (fine on localhost)
//   "serve"   behind `tailscale serve`: trust the Tailscale-User-Login header the
//             serve proxy injects for tailnet callers (it strips inbound copies,
//             so remote callers can't spoof it). Local processes (hooks, CLI,
//             statusline) don't pass through serve, so they fall back to
//             X-Hub-User — same-machine is the same trust domain. The server
//             MUST bind 127.0.0.1 in this mode so remote traffic can only
//             arrive via the serve proxy.
//   "1"/"whois"  direct tailnet connections: resolve the caller's IP with
//             `tailscale whois` — headers ignored entirely.
import { execFile } from 'node:child_process';

const MODE = process.env.HUB_TAILSCALE ?? 'dev';
const whoisCache = new Map(); // ip -> login name

function tailscaleWhois(ip) {
  return new Promise((resolve) => {
    execFile('tailscale', ['whois', '--json', ip], { timeout: 2000 }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        resolve(JSON.parse(stdout).UserProfile?.LoginName ?? null);
      } catch {
        resolve(null);
      }
    });
  });
}

export function identityMode() {
  return MODE === '1' ? 'whois' : MODE;
}

export async function resolveUser(req) {
  if (identityMode() === 'whois') {
    const ip = req.socket.remoteAddress?.replace(/^::ffff:/, '');
    if (!ip) return null;
    if (!whoisCache.has(ip)) whoisCache.set(ip, await tailscaleWhois(ip));
    return whoisCache.get(ip);
  }
  if (identityMode() === 'serve') {
    return req.headers['tailscale-user-login'] ?? req.headers['x-hub-user'] ?? null;
  }
  return req.headers['x-hub-user'] ?? null;
}
