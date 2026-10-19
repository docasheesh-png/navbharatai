import { describe, it, expect } from 'vitest';
import { previewRefreshIsRedundant } from '../src/server/AgentV3/ToolDispatcher';

// r6–r10 autopsy: update_preview re-called on the same port with nothing changed re-ran the whole publish path.
describe('an unchanged preview is not republished', () => {
  it('same port, no change since the last publish → redundant', () => {
    expect(previewRefreshIsRedundant({ port: 5173, changes: 7 }, 5173, 7, {})).toBe(true);
  });
  it('a file changed since → not redundant', () => {
    expect(previewRefreshIsRedundant({ port: 5173, changes: 7 }, 5173, 8, {})).toBe(false);
  });
  it('a different port → not redundant', () => {
    expect(previewRefreshIsRedundant({ port: 5173, changes: 7 }, 3000, 7, {})).toBe(false);
  });
  it('never published → not redundant', () => {
    expect(previewRefreshIsRedundant(null, 5173, 0, {})).toBe(false);
  });
  it('AGENTV3_SKIP_UNCHANGED_PREVIEW=off restores the old path', () => {
    expect(previewRefreshIsRedundant({ port: 5173, changes: 7 }, 5173, 7, { AGENTV3_SKIP_UNCHANGED_PREVIEW: 'off' })).toBe(false);
  });
});
