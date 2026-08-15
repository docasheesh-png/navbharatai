import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * THE SECURITY LINE OF THE WEB-APP STORE (Kadam 1, admin plan 2026-08-15).
 *
 * A store app is a STRANGER'S code running in the viewer's browser. The entire trust model rests on
 * one iframe attribute: the player's sandbox must NOT contain `allow-same-origin`. With it, a srcDoc
 * iframe inherits the parent page's origin — and the stranger's code can read the viewer's
 * localStorage, Firebase session included. Without it, the frame has an OPAQUE origin and can touch
 * nothing of the platform's.
 *
 * This was PROVEN to work before the player was written (2026-08-15, real Chromium): an
 * `allow-scripts`-only srcdoc iframe successfully dynamic-import()s a module served with
 * `Access-Control-Allow-Origin: *` — which /api/esm/* sends — and fails without the header. So the
 * opaque origin costs the player nothing, and the old "modules break without allow-same-origin"
 * belief (still true of the PREVIEW's comment, whose framed code is the viewer's own) does not apply.
 *
 * A source-level pin, because the failure mode is silent: adding `allow-same-origin` here would break
 * nothing visible — every app would still run — while quietly handing every store app the viewer's
 * session. Nothing but this test would object.
 */

const player = readFileSync(join(process.cwd(), 'src/components/ide/WebAppPlayer.tsx'), 'utf8');

describe('the store player never grants a stranger the viewer\'s origin', () => {
  it('the sandbox constant exists and allows scripts', () => {
    expect(player).toMatch(/const PLAYER_SANDBOX = '[^']*allow-scripts[^']*'/);
  });

  it('allow-same-origin appears NOWHERE in the player as an applied flag', () => {
    // Strip comments first: the header explains WHY the flag is absent and necessarily names it.
    const code = player.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('allow-same-origin');
  });

  it('the iframe uses the constant, not an inline attribute that could drift', () => {
    expect(player).toMatch(/sandbox=\{PLAYER_SANDBOX\}/);
  });

  it('the app html arrives via srcDoc, never a same-origin src URL', () => {
    // A same-origin src= page would execute the app ON the platform origin regardless of srcdoc
    // reasoning. The player must inject the compiled page inline.
    expect(player).toMatch(/srcDoc=\{html\}/);
    expect(player).not.toMatch(/<iframe[^>]*src=\{(?!.*srcDoc)/);
  });
});

describe('the mirror the player depends on stays CORS-open', () => {
  it('/api/esm/* still sends Access-Control-Allow-Origin: *', () => {
    /**
     * The other half of the proof above. The opaque-origin iframe can only import modules because the
     * mirror says so; removing this header would blank every store app (and the in-browser preview's
     * cross-origin mode) with nothing failing server-side.
     */
    const mirror = readFileSync(join(process.cwd(), 'src/server/routes/esmMirror.ts'), 'utf8');
    expect(mirror).toMatch(/Access-Control-Allow-Origin['"]?\s*,\s*['"]\*/);
  });
});

describe('the share deep link stays wired end to end', () => {
  it('App.tsx routes /store/app/<id> into the store view', () => {
    const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(app).toContain("startsWith('/store/app/')");
  });

  it('NavAppStore opens the player straight from the link', () => {
    const store = readFileSync(join(process.cwd(), 'src/components/ide/NavAppStore.tsx'), 'utf8');
    expect(store).toMatch(/\/store\\\/app\\\//);
    expect(store).toContain('WebAppPlayer');
  });

  it('the SPA fallback serves the store path (it defers only real API routes)', () => {
    // /store/app/<id> must land on index.html for the SPA to route it; /api/nav-store/* must NOT.
    const fallback = readFileSync(join(process.cwd(), 'src/server/lib/spaFallback.ts'), 'utf8');
    expect(fallback).toContain("'/api/'");
  });
});
