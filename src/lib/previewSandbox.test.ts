import { describe, it, expect } from 'vitest';
import { UNTRUSTED_PREVIEW_SANDBOX } from './previewSandbox';

describe('UNTRUSTED_PREVIEW_SANDBOX', () => {
  it('NEVER grants allow-same-origin (the property that isolates untrusted preview code)', () => {
    // allow-same-origin + allow-scripts would let previewed Figma/AI code read platform auth tokens.
    expect(UNTRUSTED_PREVIEW_SANDBOX).not.toContain('allow-same-origin');
  });
  it('does grant allow-scripts so the preview still runs', () => {
    expect(UNTRUSTED_PREVIEW_SANDBOX.split(/\s+/)).toContain('allow-scripts');
  });
});
