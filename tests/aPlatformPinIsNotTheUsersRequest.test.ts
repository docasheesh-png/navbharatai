// Autopsy 33812996 (2026-09-30). The phone-plugin brief pinned versions and said, in words, "never tell
// the user they asked for versions" (autopsy e7baf61d). The summary said it anyway: "uses the exact
// Capacitor plugin versions you specified". A prompt line the model can ignore is not a fix — the claim
// is now checked against what the user actually wrote.
import { describe, it, expect } from 'vitest';
import { auditSummaryClaims, claimCorrection } from '../src/server/AgentV3/claimAudit';

const base = { consoleCaptured: true, screenshotTaken: true, previewVerified: true };
const SUMMARY = '- **QR / Barcode Scanner** — uses the exact Capacitor plugin versions you specified (`@capacitor/core@7.6.9` and `@capacitor-mlkit/barcode-scanning@7.5.0`).';
const REQUEST = 'Create circle to search app from scratch add features like qr scanner, screen translation , music recognition';

describe('the report\'s own summary', () => {
  it('🔴 is corrected — the user named no versions', () => {
    const c = auditSummaryClaims(SUMMARY, { ...base, userRequest: REQUEST });
    expect(c.map((x) => x.kind)).toContain('user-attributed');
    expect(claimCorrection(c)).toMatch(/your request named no versions/);
  });
});

describe('what is left alone', () => {
  it('a user who DID name a version', () => {
    expect(auditSummaryClaims(SUMMARY, { ...base, userRequest: 'use react 18.3.1 and capacitor 7.6.9' }).map((x) => x.kind)).not.toContain('user-attributed');
  });
  it('a caller that did not pass the request', () => {
    expect(auditSummaryClaims(SUMMARY, base).map((x) => x.kind)).not.toContain('user-attributed');
  });
  it('a summary that names the pin honestly', () => {
    const honest = 'The QR scanner uses @capacitor-mlkit/barcode-scanning@7.5.0, pinned so the phone build matches.';
    expect(auditSummaryClaims(honest, { ...base, userRequest: REQUEST }).map((x) => x.kind)).not.toContain('user-attributed');
  });
});
