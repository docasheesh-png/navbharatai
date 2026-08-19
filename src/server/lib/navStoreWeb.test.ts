import { describe, it, expect } from 'vitest';
import {
  evaluateWebPublish, hashAppPassword, verifyAppPassword, toPublicWebApp,
  MAX_SNAPSHOT_FILES, MAX_SNAPSHOT_FILE_BYTES, MAX_SNAPSHOT_TOTAL_BYTES, describeOversizeFile,
  sanitizeScreenshots, MAX_SCREENSHOTS, MAX_SCREENSHOT_LEN,
  type WebStoreApp,
} from './navStoreWeb';
import { scanTextForSecrets } from '../AgentV3/EnvSecretValueAnalysis';

/**
 * KADAM 0 of the web-app store (admin-approved plan, 2026-08-15) — the publish gate.
 *
 * Everything here decides what ships to strangers' browsers, so the tests are about the two ways the
 * gate could betray someone: LETTING THROUGH what must not ship (a secret, a .env, an app the browser
 * cannot run), and REFUSING what should ship (a clean app blocked by a false positive). Both
 * directions are exercised — a gate is only trustworthy if it is tested from both sides.
 */

/** A minimal, genuinely browser-runnable Vite app — what the prover is known to vouch for. */
const cleanApp = (): Record<string, string> => ({
  'package.json': JSON.stringify({ dependencies: { react: '18.3.1', 'react-dom': '18.3.1' } }),
  'index.html': '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
  'src/main.tsx': "import { createRoot } from 'react-dom/client'; createRoot(document.getElementById('root')!).render(<h1>hi</h1>);",
  'src/App.tsx': 'export default function App(){ return <div className="app"><h1>Notes</h1></div>; }',
});

describe('what may ship', () => {
  it('a clean browser-runnable app passes, with its exact files', () => {
    const r = evaluateWebPublish(cleanApp());
    expect(r.ok).toBe(true);
    expect(Object.keys(r.files).sort()).toEqual(['index.html', 'package.json', 'src/App.tsx', 'src/main.tsx']);
  });

  it('an env TEMPLATE may ship — placeholders are the point of the file', () => {
    const r = evaluateWebPublish({ ...cleanApp(), '.env.example': 'VITE_API_URL=your-url-here' });
    expect(r.ok).toBe(true);
    expect(r.files['.env.example']).toBeDefined();
  });
});

describe('what must never ship', () => {
  it('a real .env is silently DROPPED, not a reason for refusal', () => {
    /**
     * The order in the gate matters and this is why: the workspace legitimately holds the creator's
     * own .env (the platform writes their saved keys into it for the sandbox). That file must never
     * ship — but its EXISTENCE must not block publishing either, or every app whose build used a key
     * would be unpublishable. Drop first, scan what remains.
     */
    const r = evaluateWebPublish({ ...cleanApp(), '.env': 'OPENAI_API_KEY=sk-abcdef1234567890abcdef' });
    expect(r.ok).toBe(true);
    expect(r.files['.env']).toBeUndefined();
  });

  it('.env.local and .git and node_modules are dropped too', () => {
    const r = evaluateWebPublish({
      ...cleanApp(),
      '.env.local': 'X=1',
      '.git/config': '[core]',
      'node_modules/react/index.js': 'x',
      'dist/bundle.js': 'x',
    });
    expect(r.ok).toBe(true);
    expect(Object.keys(r.files).some((p) => p.includes('.git') || p.includes('node_modules') || p.startsWith('dist/') || p.startsWith('.env'))).toBe(false);
  });

  it('a hardcoded real-format API key REFUSES the publish and names the line', () => {
    /**
     * The key-scan gate — the single most important refusal in the store. Published code is visible
     * to every viewer; a real key in it is the creator's bill in a stranger's hands.
     */
    const r = evaluateWebPublish({
      ...cleanApp(),
      'src/api.ts': "const KEY = 'sk-proj-abcd1234efgh5678ijkl9012';\nexport default KEY;",
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/API key/i);
    expect(r.reason).toContain('src/api.ts:1');
    expect(r.files).toEqual({}); // a refusal publishes NOTHING
  });

  it('the scan catches keys beyond the OpenAI shape', () => {
    for (const [name, line] of [
      ['google', "const k = 'AIzaSyA1234567890abcdefghijklmnopqrs';"],
      ['github', "const t = 'ghp_abcdefghijklmnopqrstuvwxyz012345';"],
      // NOT AWS's documented "AKIAIOSFODNN7EXAMPLE" — the word EXAMPLE in it trips the placeholder
      // filter, and the scanner is RIGHT to skip it. The fixture must look like a real credential.
      ['aws', 'const id = "AKIAQWERTYUIOPASDFGH";'],
    ] as const) {
      const r = evaluateWebPublish({ ...cleanApp(), 'src/k.ts': line });
      expect(r.ok, name).toBe(false);
    }
  });

  it('an app the browser cannot run is refused with the honest reason, not listed broken', () => {
    // A server entry makes the prover say no (its default is no — it vouches, never guesses).
    const r = evaluateWebPublish({
      ...cleanApp(),
      'server/index.ts': "import express from 'express'; import fs from 'node:fs';",
      'package.json': JSON.stringify({ dependencies: { react: '18.3.1', express: '4.18.0', mongoose: '8.0.0' } }),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/browser/i);
  });
});

describe('quotas — day one, because one runaway app must never become our bill', () => {
  it('too many files is an honest refusal', () => {
    const files = cleanApp();
    for (let i = 0; i < MAX_SNAPSHOT_FILES + 1; i++) files[`src/gen/f${i}.ts`] = 'export {};';
    const r = evaluateWebPublish(files);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain(String(MAX_SNAPSHOT_FILES));
  });

  it('one oversized file names ITSELF in the refusal', () => {
    const r = evaluateWebPublish({ ...cleanApp(), 'src/huge.ts': 'x'.repeat(MAX_SNAPSHOT_FILE_BYTES + 1) });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('src/huge.ts');
  });

  it('an empty workspace is "build first", not a crash', () => {
    expect(evaluateWebPublish({}).ok).toBe(false);
    expect(evaluateWebPublish(null).ok).toBe(false);
    expect(evaluateWebPublish(undefined).ok).toBe(false);
  });
});

describe('the private-app password', () => {
  it('round-trips, and a wrong password fails', () => {
    const { hash, salt } = hashAppPassword('mera-app-123');
    expect(verifyAppPassword('mera-app-123', hash, salt)).toBe(true);
    expect(verifyAppPassword('galat', hash, salt)).toBe(false);
  });

  it('missing material NEVER verifies — an unset password is locked, not open', () => {
    expect(verifyAppPassword('anything', undefined, undefined)).toBe(false);
    expect(verifyAppPassword('', 'hash', 'salt')).toBe(false);
  });

  it('two hashes of one password differ (per-app salt), so hashes cannot be cross-matched', () => {
    expect(hashAppPassword('same').hash).not.toBe(hashAppPassword('same').hash);
  });
});

describe('the public view leaks nothing', () => {
  it('password material and owner uid never reach a viewer', () => {
    const app: WebStoreApp = {
      id: 'web_x', status: 'listed', uid: 'owner-uid-secret', name: 'N', description: 'D',
      visibility: 'private', passwordHash: 'H', passwordSalt: 'S', workspaceId: 'agentv3-owner-1',
      fileCount: 3, sizeBytes: 100, runs: 5, remixes: 1, publishedAt: 1, version: 2,
    };
    const pub = toPublicWebApp(app) as unknown as Record<string, unknown>;
    expect(pub.passwordHash).toBeUndefined();
    expect(pub.passwordSalt).toBeUndefined();
    expect(pub.uid).toBeUndefined();
    expect(pub.workspaceId).toBeUndefined();
    expect(pub.requiresPassword).toBe(true);
  });
});

describe('scanTextForSecrets (the generalized scanner both gates share)', () => {
  it('skips placeholder-looking lines, so docs and examples are not refused', () => {
    expect(scanTextForSecrets('a.ts', "const k = 'sk-your-key-here-1234567890';")).toHaveLength(0);
    expect(scanTextForSecrets('a.md', 'Use `sk-xxxxxxxxxxxxxxxxxxxx` as an example')).toHaveLength(0);
  });

  it('never reproduces the whole secret in its own finding', () => {
    // The report must not become a second leak.
    const hits = scanTextForSecrets('a.ts', "const k = 'sk-proj-abcd1234efgh5678ijkl9012';");
    expect(hits).toHaveLength(1);
    expect(hits[0].key.length).toBeLessThan(20);
    expect(hits[0].key).not.toContain('ijkl9012');
  });
});

describe('Firestore query shapes — composite indexes are forbidden by construction', () => {
  /**
   * ROOT CAUSE of the store's FIRST real publish failure (admin's "fail" screenshot, 2026-08-15):
   * `.where(X).orderBy(Y)` on different fields is a composite-index query — Firestore throws
   * FAILED_PRECONDITION on its first production use until the index is created BY HAND in a console
   * no session can reach. `listMyWebApps` ran inside the publish route, so the very first publish
   * hit it and the catch-all turned the real error into "Publishing failed". The fix is the shape:
   * single-field filters (auto-indexed) + in-memory sort. This pin makes the class unshippable —
   * a reintroduced where+orderBy chain in the store's data layer fails CI, not a real user.
   */
  it('no .where(...).orderBy(...) chain in the store data layer', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    for (const f of ['src/server/lib/navStoreWeb.ts', 'src/server/lib/navStoreWebData.ts']) {
      // Comments are stripped first: the files honestly DESCRIBE the forbidden shape in prose
      // (that is how the rule is taught), and prose must never trip the pin — only real code.
      const src = readFileSync(join(process.cwd(), f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(/\.where\([\s\S]{0,300}?\.orderBy\(/.test(src), `${f} contains a composite-index query shape`).toBe(false);
    }
  });
});

describe('the oversize refusal must DIAGNOSE, not guess (admin report 2026-08-16)', () => {
  /**
   * A real publish was refused with: "client/src/pages/admin-dashboard.tsx is larger than 300 KB.
   * Large assets don't belong in published source — move it out." The file was a PAGE COMPONENT our
   * own builder generated: there was nothing to move out, so the advice was unactionable and the cap
   * was refusing the very apps the store exists to carry.
   */
  it('the cap is DERIVED from the real ceiling (Firestore 1 MiB per file doc), not chosen by feel', () => {
    /**
     * Each file is its own Firestore document, and a document may not exceed 1 MiB — Google's wall,
     * not our setting. 950 KB leaves ~75 KB of headroom for the document path, the field name and
     * per-document overhead, which together cost a few HUNDRED bytes. 990 KB would also fit; it buys
     * 4% more room for most of the margin, and no real file lives in that 4%.
     */
    expect(MAX_SNAPSHOT_FILE_BYTES).toBe(950 * 1024);
    expect(MAX_SNAPSHOT_FILE_BYTES, 'must stay clear of the 1 MiB document limit').toBeLessThan(1024 * 1024);
    expect(1024 * 1024 - MAX_SNAPSHOT_FILE_BYTES, 'the margin must dwarf the real overhead').toBeGreaterThan(64 * 1024);
  });

  it('the TOTAL rose with it, or the per-file raise would be theatre', () => {
    // At 3 MB, four large files hit the ceiling anyway and the bigger per-file cap would never be
    // reachable in a real app.
    expect(MAX_SNAPSHOT_TOTAL_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_SNAPSHOT_TOTAL_BYTES / MAX_SNAPSHOT_FILE_BYTES, 'several large files must fit').toBeGreaterThan(8);
  });

  it('an app with a big-but-legitimate page now publishes', () => {
    const app = cleanApp();
    app['src/AdminDashboard.tsx'] = `export default function D(){ return <div>${'x'.repeat(800 * 1024)}</div>; }`;
    expect(evaluateWebPublish(app).ok, 'a page this size used to be refused three times over').toBe(true);
  });

  it('an EMBEDDED IMAGE is named as the cause, with advice that fits it', () => {
    const img = `data:image/png;base64,${'A'.repeat(800 * 1024)}`;
    const msg = describeOversizeFile('src/Logo.tsx', `export const logo = "${img}";`);
    expect(msg).toContain('pasted directly into the code');
    expect(msg).toMatch(/Save it as a real file|point at a URL/);
  });

  it('genuinely large CODE gets different, honest advice — and the reason it matters', () => {
    const msg = describeOversizeFile('src/Big.tsx', 'const a = 1;'.repeat(80 * 1024));
    expect(msg).toContain('of code');
    expect(msg).toContain('split this page into smaller components');
    // The user deserves to know WHY the limit exists, not just that it does.
    expect(msg).toContain("every viewer's browser has to compile this file");
  });

  it('every refusal states the file AND its real size — the old one stated neither', () => {
    const msg = describeOversizeFile('src/Big.tsx', 'x'.repeat(900 * 1024));
    expect(msg).toContain('"src/Big.tsx"');
    expect(msg).toMatch(/\d+ KB/);
  });
});

describe('sanitizeScreenshots — the boundary of what may be stored on a listing', () => {
  const img = (len = 100) => 'data:image/jpeg;base64,' + 'A'.repeat(len);

  it('keeps valid image data URLs, in order, up to the cap', () => {
    const out = sanitizeScreenshots([img(10), img(20), img(30)]);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe(img(10));
    expect(out[2]).toBe(img(30));
  });

  it('caps at MAX_SCREENSHOTS — an over-eager client cannot flood the listing', () => {
    const out = sanitizeScreenshots([img(1), img(2), img(3), img(4), img(5)]);
    expect(out).toHaveLength(MAX_SCREENSHOTS);
  });

  it('drops (never truncates) a non-image, an oversize image, and non-strings', () => {
    const oversize = 'data:image/png;base64,' + 'A'.repeat(MAX_SCREENSHOT_LEN + 1);
    const out = sanitizeScreenshots(['not-a-data-url', 'data:text/html,evil', oversize, 42, null, img(10)]);
    expect(out).toEqual([img(10)]);
  });

  it('a non-array yields no screenshots (never throws)', () => {
    expect(sanitizeScreenshots(undefined)).toEqual([]);
    expect(sanitizeScreenshots('data:image/png;base64,AAA')).toEqual([]);
    expect(sanitizeScreenshots(null)).toEqual([]);
  });

  it('the public view carries a screenshotCount so a card can hint before the images load', () => {
    const base: WebStoreApp = {
      id: 'a', status: 'listed', uid: 'u', name: 'n', description: '', visibility: 'public',
      workspaceId: 'w', fileCount: 1, sizeBytes: 1, runs: 0, remixes: 0, publishedAt: 0, version: 1,
      screenshotCount: 2,
    };
    expect(toPublicWebApp(base).screenshotCount).toBe(2);
    expect(toPublicWebApp({ ...base, screenshotCount: undefined }).screenshotCount).toBe(0);
  });
});
