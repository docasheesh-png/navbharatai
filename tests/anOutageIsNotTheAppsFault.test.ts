// GT-11. A dev server that will not stay up is infrastructure. It must not be
// recorded as "the app did not render", and the billing flag must stay.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync('src/server/routes/agentv3.ts', 'utf8');

describe('an outage is not the app\'s fault', () => {
  it('the gate maps a seen non-render, not the billing flag', () => {
    expect(src).toContain(
      "gateEvidence.preview = previewVerifiedRendered ? 'passed' : previewRenderFailed ? 'failed' : 'not-run'",
    );
    expect(src).not.toContain("previewVerifiedFailed ? 'failed'");
  });

  it('every server-down record sets the infra flag, and the billing flag count is unchanged', () => {
    // Observed on main before this change: exactly two `previewVerifiedFailed = true`.
    const trues = src.match(/previewVerifiedFailed = true/g) ?? [];
    expect(trues).toHaveLength(2);
    const downs = [...src.matchAll(/code: 'PREVIEW_SERVER_DOWN'/g)];
    expect(downs.length).toBe(2);
    for (const m of downs) {
      expect(src.slice(m.index, m.index + 600)).toContain('previewServerDown = true');
    }
  });
});
