import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

// ADMIN SCREENSHOT 2026-08-07: the Preview tab rendered E2B's "Closed Port Error" for port 3000 while
// the app was genuinely serving on port 5000. Two root causes, both locked here:
//
// 1) CLIENT PRECEDENCE — `url || foundUrl` let the SAVED historical URL outrank the URL a Diagnose
//    had just booted AND page-verified. The watchdog would find the real port, adopt it into
//    `foundUrl`… and the iframe kept the dead one. Fresh, verified truth must win; a NEW build's
//    published `url` reclaims the lead by clearing `foundUrl` when the prop changes.
//
// 2) SERVER DETERMINISM — a `process.env.PORT || <default>` server binds whatever the ambient
//    sandbox env implies, so the SAME app landed on different ports in different sandboxes while its
//    saved URL stayed pinned to history. Answered FIRST by pinning the app's port, and since
//    2026-08-09 by discovering it instead — see the superseded-block note below for why the pin was
//    the wrong half of the fix and what replaced it.

const SURFACE = readFileSync(
  fileURLToPath(new URL('../src/components/agentv3/PreviewSurface.tsx', import.meta.url)), 'utf8');
const ROUTE = readFileSync(
  fileURLToPath(new URL('../src/server/routes/agentv3.ts', import.meta.url)), 'utf8');

describe('fresh verified URL beats the saved one (client)', () => {
  it('effectiveUrl prefers the Diagnose-verified foundUrl', () => {
    expect(SURFACE).toContain('const effectiveUrl = foundUrl || url;');
    expect(SURFACE).not.toContain('const effectiveUrl = url || foundUrl;');
  });

  it('a NEW build\'s published url reclaims the lead — foundUrl is cleared when the prop changes', () => {
    expect(SURFACE).toContain("if (url) setFoundUrl('')");
  });

  it('foundUrl is only ever adopted from a diagnose that VERIFIED the app (ok + url)', () => {
    expect(SURFACE).toContain("data?.ok && typeof data?.previewUrl === 'string'");
  });
});

/**
 * SUPERSEDED 2026-08-09 — this block used to require the OPPOSITE of what it now requires.
 *
 * Root cause 2 above was answered twice: the client fix (root cause 1, still asserted above) made a
 * freshly VERIFIED url outrank the saved one, and a server-side pin additionally wrote a fixed PORT
 * into the app's dev .env so the app could not move. The client fix addressed the cause; the pin
 * addressed the symptom, by changing the user's app.
 *
 * The admin caught the cost of that on 2026-08-09: "report me likha hai app port 3000 par, lekin
 * mitrify to port 5000 par hai." The report was accurate — the app was on 3000 because we put it
 * there. Forcing the port contradicts everything else in the user's project that names the real one
 * (README, OAuth redirect URIs, a hardcoded proxy or CORS origin), and on an import turn instructed
 * to change nothing, moving the app's port is exactly the change we promised not to make.
 *
 * So the pin is gone and the import boot now DISCOVERS the port instead — the app's own boot log
 * first, then the ports the sandbox OS reports as listening, visiting candidates until one genuinely
 * serves. The determinism the pin bought is replaced by evidence, which is stronger: it is right even
 * for an app that ignores PORT entirely. `tests/importAutopsyMitrify.test.ts` carries the detail.
 */
describe('the import boot DISCOVERS the port — it never assigns one (server)', () => {
  it('no fixed PORT is written into the user\'s app', () => {
    expect(ROUTE).not.toMatch(/provided\.PORT\s*=\s*['"`]\d+/);
  });

  it('an empty PORT is not written either — dotenv would define it and `Number(\'\')` binds port 0', () => {
    expect(ROUTE).not.toMatch(/provided\.PORT\s*=\s*''/);
  });

  it('the boot ranks real candidates instead of trusting one guess', () => {
    const at = ROUTE.indexOf('const { up, port } = parseDevServerHealthCheck(combined);');
    expect(at).toBeGreaterThan(-1);
    expect(ROUTE.slice(at, at + 3000)).toContain('rankPortCandidates(');
  });
});
