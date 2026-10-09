// UI-3 — a stranger's window.postMessage must not reach a preview handler.
// The handler that records a crash also starts a paid auto-repair, so an
// unauthenticated POST is the same hole.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync('src/components/agentv3/PreviewSurface.tsx', 'utf8');

describe('preview listeners only hear our frames', () => {
  it('every message handler rejects a foreign source before it reads the payload', () => {
    const listeners = src.match(/addEventListener\(\s*'message'/g) ?? [];
    const starts = [...src.matchAll(/\(e: MessageEvent\) => \{\n([^\n]*)/g)].map((m) => m[1].trim());
    expect(listeners.length).toBeGreaterThan(0);
    expect(starts.length).toBe(listeners.length);
    for (const line of starts) {
      expect(line.startsWith('if (!isFromOurPreviewFrame(')).toBe(true);
    }
  });

  it('the preview-error POST is authenticated and still keepalive', () => {
    const at = src.indexOf("fetch('/api/agentv3/preview-error'");
    expect(at).toBeGreaterThan(-1);
    const call = src.slice(at, at + 450);
    expect(call).toContain('headers: await authJsonHeaders()');
    expect(call).toContain('keepalive: true');
    expect(call).not.toContain("headers: { 'Content-Type': 'application/json' }");
  });
});
