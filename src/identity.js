// Identity resolution — the ONLY thing that changes between one-machine dev and
// a real tailnet deployment.
//   dev (default):      trust the X-Hub-User header (fine on localhost)
//   HUB_TAILSCALE=1:    resolve the caller's IP via `tailscale whois` — the header
//                       is ignored, so identity can't be spoofed by tailnet peers.
import { execFile } from 'node:child_process';

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

export async function resolveUser(req) {
  if (process.env.HUB_TAILSCALE === '1') {
    const ip = req.socket.remoteAddress?.replace(/^::ffff:/, '');
    if (!ip) return null;
    if (!whoisCache.has(ip)) whoisCache.set(ip, await tailscaleWhois(ip));
    return whoisCache.get(ip);
  }
  return req.headers['x-hub-user'] ?? null;
}
