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
//    saved URL stayed pinned to history. The import boot now writes a real PORT into the dev .env so
//    every boot of a PORT-honoring app binds the same port, in every sandbox.

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

describe('the import boot pins a deterministic PORT (server)', () => {
  it('writes a real PORT into the dev .env when none was provisioned', () => {
    expect(ROUTE).toContain("if (!('PORT' in provided)) provided.PORT = '3000';");
  });

  it('the pin lands BEFORE the .env is written, so it reaches the app', () => {
    const pinAt = ROUTE.indexOf("provided.PORT = '3000'");
    const envWriteAt = ROUTE.indexOf('buildDevEnvContent(declaredEnvVars, provided)');
    expect(pinAt).toBeGreaterThan(-1);
    expect(envWriteAt).toBeGreaterThan(pinAt);
  });

  it('a real value, never an empty placeholder — PORT= (empty string) is itself a hazard: dotenv defines it, `|| default` falls through but parseInt(\'\') is NaN', () => {
    expect(ROUTE).not.toMatch(/provided\.PORT\s*=\s*''/);
  });
});
