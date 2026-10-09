// UI-1 — production must not hand untrusted HTML our origin.
// The DEV ternary is allowed in source: local vite still needs same-origin
// modules. The production arm is UNTRUSTED_PREVIEW_SANDBOX, and production
// without a preview domain shows the security fallback instead of a srcDoc.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { UNTRUSTED_PREVIEW_SANDBOX } from '../src/lib/previewSandbox';

describe('untrusted preview never gets our origin', () => {
  const src = readFileSync('src/components/agentv3/PreviewSurface.tsx', 'utf8');

  it('every srcDoc iframe names the opaque sandbox (a DEV ternary may sit beside it)', () => {
    const tags = [...src.matchAll(/<iframe\b[\s\S]*?\/>/g)].map((m) => m[0]).filter((tag) => /srcDoc=/.test(tag));
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      expect(tag).toContain('UNTRUSTED_PREVIEW_SANDBOX');
      expect(tag).toMatch(/import\.meta\.env\.DEV\s*\?/);
    }
    expect(UNTRUSTED_PREVIEW_SANDBOX).not.toMatch(/allow-same-origin/);
  });

  it('production without a preview domain says why and offers Live preview', () => {
    expect(src).toContain(
      'In-browser preview is turned off for your security until a preview domain is configured. Use Live preview.',
    );
    expect(src).toContain("setChoice('live')");
  });
});
