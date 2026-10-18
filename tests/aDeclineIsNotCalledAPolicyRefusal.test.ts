// Autopsy 707f8e56 (2026-10-18): "Create attractive animated HD viral video" — the model said it cannot render an
// MP4 here and offered an HTML5 animation. The report called that "REFUSED this request on policy grounds".
// `modelAnswer.declined` (turnAnswer.ts looksLikeRefusal) covers both a refusal and a capability limit, so the
// UPSELL_SUPPRESSED line must not assert a policy refusal.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('a decline is not reported as a policy refusal', () => {
  const src = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  it('the UPSELL_SUPPRESSED wording for a declined turn names no policy', () => {
    expect(src).not.toMatch(/REFUSED this request on policy grounds/);
    expect(src).toMatch(/the engine DECLINED this request and wrote no files — a refusal, or an honest/);
  });
});
