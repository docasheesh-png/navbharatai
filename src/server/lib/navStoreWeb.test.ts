import { describe, it, expect } from 'vitest';
import {
  evaluateWebPublish, hashAppPassword, verifyAppPassword, toPublicWebApp,
  MAX_SNAPSHOT_FILES, MAX_SNAPSHOT_FILE_BYTES,
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
