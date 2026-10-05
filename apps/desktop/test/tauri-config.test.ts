/**
 * The Tauri configuration is not inert: its CSP decides whether the desktop app
 * can reach its own API at all.
 *
 * The bug this exists to prevent already happened. `API_PORT` moved from 3000 to
 * 3010 — 3000 is occupied on this machine by an unrelated app — and
 * `API_PORT`, `VITE_API_URL` and the Zod defaults were changed together. The CSP
 * in `tauri.conf.json` was not, because nothing read it. A desktop build then
 * loaded its shell, rendered the header, and refused every single API call: the
 * webview blocked the connection, so the screen was an empty grid and an error
 * message with no error in the log. Nothing about that failure points at a CSP.
 *
 * The browser deployment has no such gate, which is why the web app worked and
 * the desktop app did not — the bug would survive any test that only looks at the
 * web.
 *
 * `.env.example` is the committed contract, so the assertion is written against
 * it rather than against the developer's own `.env`: a real deployment points
 * `VITE_API_URL` at a LAN server, and a test that read that would fail on
 * purpose.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const tauriConfig = JSON.parse(
  readFileSync(path.join(repoRoot, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'),
) as { app: { security: { csp: string } }; build: { frontendDist: string; devUrl: string } };
const exampleEnv = readFileSync(path.join(repoRoot, '.env.example'), 'utf8');

function envValue(name: string): string {
  const line = exampleEnv.split('\n').find((candidate) => candidate.startsWith(`${name}=`));
  if (!line) {
    throw new Error(`${name} is not in .env.example, so nothing pins the desktop app's API URL`);
  }
  return line.slice(name.length + 1).trim();
}

describe('the Tauri CSP', () => {
  it('allows the API origin the environment points at', () => {
    const apiUrl = new URL(envValue('VITE_API_URL'));
    const csp = tauriConfig.app.security.csp;

    expect(csp).toContain(`connect-src`);
    // Both schemes, because a clinic LAN server is reached over https and a
    // dev machine over http. The CSP allows the origin, never a path: the API
    // keeps its own version prefix and a stricter rule would have to be
    // maintained per route.
    expect(csp).toContain(`http://${apiUrl.host}`);
    expect(csp).toContain(`https://${apiUrl.host}`);
  });

  it('refuses remote script and frame sources', () => {
    const csp = tauriConfig.app.security.csp;

    // The desktop shell runs no third-party script and embeds no remote frame.
    // A CSP that grew `*` or `unsafe-eval` in either directive would be a
    // regression in the desktop app's security posture, and this is the only
    // place it would be visible.
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toContain('*');
    expect(csp).not.toContain('unsafe-eval');
  });

  it('loads bundled assets rather than a dev server in a build', () => {
    // `devUrl` is what `tauri dev` points the webview at, and it is the reason a
    // dev window needs a running Vite server. A standalone binary has no server at
    // all: the assets are embedded at compile time. The pin/run workflow depends on
    // that difference — see `scripts/desktop-pin.mjs`.
    expect(tauriConfig.build.frontendDist).toBe('../dist');
    expect(tauriConfig.build.devUrl).toMatch(/^http:\/\/localhost:/);
  });
});
