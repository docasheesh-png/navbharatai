// Forensic audit 2026-10-04 — a srcDoc frame with `allow-scripts allow-same-origin` IS the parent page:
// it reads the parent's localStorage (the Firebase session, the GitHub token) and calls our API as the
// viewer. Every client srcDoc iframe must use an opaque sandbox — except the ones listed below, each with
// the reason it is still open. A NEW srcDoc frame with allow-same-origin fails this test.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { UNTRUSTED_PREVIEW_SANDBOX } from '../src/lib/previewSandbox';

/**
 * KNOWN, NOT YET CLOSED — recorded, not accepted. The builder's own in-browser preview (the viewer's own
 * app, but also remixed store apps and imported repos) still runs same-origin when no separate preview
 * origin is configured. Its fix needs either `VITE_PREVIEW_ORIGIN` (admin infra, Q-140) or an opaque
 * frame proven in a real browser not to break module loading and app storage. Tracked in
 * BUILD_REPORT_QUEUE.md as Q-140. Removing it from here is the goal; adding to it is not allowed.
 */
const STILL_OPEN: Record<string, number> = {
  'src/components/agentv3/PreviewSurface.tsx': 1,
};

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

describe('census: no srcDoc frame shares our origin', () => {
  it('every <iframe srcDoc=…> uses an opaque sandbox (or is a recorded open item)', () => {
    const found: Record<string, number> = {};
    for (const f of clientFiles()) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/<iframe\b[\s\S]*?\/>/g)) {
        const tag = m[0];
        if (!/srcDoc=/.test(tag)) continue;
        // The sandbox may be a literal or a named constant in the same file — resolve the constant, or a
        // frame hidden behind `sandbox={SOME_CONST}` would slip past (the admin panel's did).
        const ref = tag.match(/sandbox=\{([A-Za-z_$][\w$]*)\}/)?.[1];
        const resolved = ref ? (src.match(new RegExp(`const\\s+${ref}\\s*=\\s*['"\`]([^'"\`]*)['"\`]`))?.[1] ?? '') : '';
        if (/allow-same-origin/.test(tag) || /allow-same-origin/.test(resolved)) found[f] = (found[f] ?? 0) + 1;
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
