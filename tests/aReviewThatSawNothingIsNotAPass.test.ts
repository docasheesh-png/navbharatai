// Autopsy fde4b7f1 (2026-10-04) — the build wrote 19 files; the green-app reviewer read one, met the re-read
// note "has NOT changed since", and answered "[PASS] No changes detected. The diff is empty". The user was
// shown "✅ Build Review: [PASS]" for a review of nothing. Three causes, three locks.
import { describe, it, expect } from 'vitest';
import { reviewBuild, reviewDeniedTheChanges, formatReview } from '../src/server/AgentV3/ReviewerAgent';
import { repeatedReadNotice } from '../src/server/AgentV3/repeatedReads';
import { roleConfig } from '../src/server/AgentV3/AgentRegistry';

const VERBATIM = '[PASS]\n\nNo changes detected. The diff is empty — all files (`src/lib/ai.ts`, `src/components/ChatMessage.tsx`, `src/components/Header.tsx`, `src/types.ts`) are unchanged from their prior state. The existing AI integration is intact.';

describe('a review that denies the changes did not review them', () => {
  it('recognises the report\'s verbatim answer when files changed', () => {
    expect(reviewDeniedTheChanges(VERBATIM, ['src/App.tsx'])).toBe(true);
  });
  it('is not triggered when nothing changed, or by an ordinary pass', () => {
    expect(reviewDeniedTheChanges(VERBATIM, [])).toBe(false);
    expect(reviewDeniedTheChanges('[PASS] App looks complete. Score: 90', ['src/App.tsx'])).toBe(false);
    expect(reviewDeniedTheChanges('[WARNING] the delete handler changes state twice. Score: 80', ['src/App.tsx'])).toBe(false);
  });
  it('the verdict is not shown to the user as a review', async () => {
    const r = await reviewBuild({
      userRequest: 'Mujhe Ai banana hai', fileTree: ['src/App.tsx', 'src/lib/ai.ts'], fileSample: [],
      changedFiles: ['src/App.tsx', 'src/lib/ai.ts'],
      spawn: async () => ({ ok: true, summary: VERBATIM }),
    } as Parameters<typeof reviewBuild>[0]);
    expect(r.score).toBe(0);
    expect(formatReview(r)).toBe('');
  });
});

describe('the two sentences that produced it', () => {
  it('the handed-in re-read note no longer says "has NOT changed"', () => {
    const n = repeatedReadNotice('src/components/Header.tsx', 2, true, 0, true);
    expect(n).toMatch(/given to you in full in your task/);
    expect(n).not.toMatch(/NOT changed|has not changed/i);
  });
  it('the reviewer is not told to read a diff it is never given', () => {
    expect(roleConfig('reviewer').system).not.toMatch(/diff/i);
    expect(roleConfig('reviewer').system).toMatch(/files your task says this build changed/);
  });
});
