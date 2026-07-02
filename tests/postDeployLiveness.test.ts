import { describe, it, expect } from 'vitest';
import { livenessLine } from '../src/server/AgentV3/PostDeployLiveness';

/** P-PIPE.116 — post-deploy liveness line (pure, honest wording). */

describe('livenessLine', () => {
  it('2xx/3xx → "live"', () => {
    expect(livenessLine({ kind: 'http', status: 200 })).toContain('your site is live');
    expect(livenessLine({ kind: 'http', status: 301 })).toContain('your site is live');
    expect(livenessLine({ kind: 'http', status: 200 })).toContain('HTTP 200');
  });
  it('4xx/5xx → reachable-but-HTTP-N, never claims healthy or failed', () => {
    const s = livenessLine({ kind: 'http', status: 500 });
    expect(s).toContain('reachable but returned HTTP 500');
    expect(s).not.toContain('is live');
    expect(s.toLowerCase()).not.toContain('deploy failed');
  });
  it('transport failure → "not reachable yet", explicitly NOT a deploy failure', () => {
    const s = livenessLine({ kind: 'unreachable', reason: 'timed out after 5s' });
    expect(s).toContain("isn't reachable yet");
    expect(s).toContain('timed out after 5s');
    expect(s).toContain('not a deploy failure');
  });
});
