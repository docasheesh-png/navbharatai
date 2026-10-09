// Forensic audit 2026-10-04 — a srcDoc frame with `allow-scripts allow-same-origin` IS the parent page:
// it reads the parent's localStorage (the Firebase session, the GitHub token) and calls our API as the
// viewer. Every client srcDoc iframe must use an opaque sandbox — except the ones listed below, each with
// the reason it is still open. A NEW srcDoc frame with allow-same-origin fails this test.
//
// PR-05 (UI-1), allowed ratchet change (spec A4):
//   before: STILL_OPEN['src/components/agentv3/PreviewSurface.tsx'] = 1
//   after:  that key is gone (0 open). A tag is not counted when its sandbox is
//           `import.meta.env.DEV ? '…allow-same-origin…' : UNTRUSTED_PREVIEW_SANDBOX`.
//           Production takes the opaque arm. DEV keeps same-origin so local
//           module loading still works.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { UNTRUSTED_PREVIEW_SANDBOX } from '../src/lib/previewSandbox';

/** KNOWN, NOT YET CLOSED. Empty means every srcDoc frame is opaque in production. Adding a key is not allowed. */
const STILL_OPEN: Record<string, number> = {};

function clientFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== 'server') walk(p); continue; }
      if (/\.tsx$/.test(name) && !/\.test\./.test(name)) out.push(p);
    }
  };
  walk('src');
  return out;
}

/** Production path grants allow-same-origin. A DEV-only ternary whose other arm is the opaque sandbox does not. */
function productionGrantsSameOrigin(tag: string, fileSrc: string): boolean {
  if (/UNTRUSTED_PREVIEW_SANDBOX/.test(tag) && /import\.meta\.env\.DEV\s*\?/.test(tag)) return false;
  const ref = tag.match(/sandbox=\{([A-Za-z_$][\w$]*)\}/)?.[1];
  const resolved = ref ? (fileSrc.match(new RegExp(`const\\s+${ref}\\s*=\\s*['"\`]([^'"\`]*)['"\`]`))?.[1] ?? '') : '';
  return /allow-same-origin/.test(tag) || /allow-same-origin/.test(resolved);
}

describe('census: no srcDoc frame shares our origin', () => {
  it('every <iframe srcDoc=…> uses an opaque sandbox (or is a recorded open item)', () => {
    const found: Record<string, number> = {};
    for (const f of clientFiles()) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/<iframe\b[\s\S]*?\/>/g)) {
        const tag = m[0];
        if (!/srcDoc=/.test(tag)) continue;
        if (productionGrantsSameOrigin(tag, src)) found[f] = (found[f] ?? 0) + 1;
      }
    }
    expect(found).toEqual(STILL_OPEN);
  });

  it('the opaque sandbox really omits allow-same-origin', () => {
    expect(UNTRUSTED_PREVIEW_SANDBOX).not.toMatch(/allow-same-origin/);
    expect(UNTRUSTED_PREVIEW_SANDBOX).toMatch(/allow-scripts/);
  });

  it('the admin "Built apps" render of a user\'s app is opaque', () => {
    const src = readFileSync('src/components/admin/BuiltAppsPanel.tsx', 'utf8');
    expect(src).toMatch(/srcDoc=\{preview\.html\}[^>]*sandbox=\{UNTRUSTED_PREVIEW_SANDBOX\}/);
  });
});
