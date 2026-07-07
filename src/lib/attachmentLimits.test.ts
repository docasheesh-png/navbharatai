import { describe, it, expect } from 'vitest';
import { checkAttachmentSizes, MAX_ATTACHMENT_BYTES, MAX_TOTAL_ATTACHMENT_BYTES } from './attachmentLimits';

// Fix 36a — "zip upload band ho gayi" (2026-07-07): an oversized zip died at the platform request
// cap with only a stall banner. The guard must refuse it BEFORE sending, with an actionable reason.
describe('checkAttachmentSizes', () => {
  it('accepts normal files', () => {
    expect(checkAttachmentSizes([{ name: 'app.zip', size: 5 * 1024 * 1024 }]).ok).toBe(true);
    expect(checkAttachmentSizes([]).ok).toBe(true);
  });
  it('refuses a single oversized zip with the honest reason + alternatives', () => {
    const v = checkAttachmentSizes([{ name: 'navbharat-ai.zip', size: MAX_ATTACHMENT_BYTES + 1 }]);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('navbharat-ai.zip');
    expect(v.reason).toContain('node_modules');
    expect(v.reason).toContain('GitHub URL');
  });
  it('refuses when the COMBINED size crosses the cap (the two-zips-at-once case)', () => {
    const each = Math.floor(MAX_TOTAL_ATTACHMENT_BYTES / 2) + 1024;
    const v = checkAttachmentSizes([
      { name: 'a.zip', size: each },
      { name: 'b.zip', size: each },
    ]);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('combined');
  });
});
