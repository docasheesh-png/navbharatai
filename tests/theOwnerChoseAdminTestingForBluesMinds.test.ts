import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * OWNER DECISION 2026-11-16. Offered both options (admin-test BluesMinds now, or block it until terms and cost are
 * verified), the owner chose admin testing — "to kro yaar" — and repeated it after a re-block ("abhi bhi nahi chala").
 * Two commits that hard-blocked BluesMinds on the admin Test Chat Bot were reverted on that instruction.
 * User chat is a separate gate and stays OFF until FREE_CHAIN_BLUESMINDS_WRITTEN_APPROVAL=on.
 * Changing this needs the owner, not a reviewer's preference.
 */
describe('the owner chose admin testing for BluesMinds', () => {
  const source = readFileSync('src/server/lib/testChatBot.ts', 'utf8');

  it('the admin test page does not hard-block BluesMinds by id', () => {
    expect(source).not.toMatch(/rungId\s*===\s*'bluesminds'/);
    expect(source).not.toContain('BLUESMINDS_TEST_PENDING');
  });

  it('user-chat policy reasons are not admin-test gates, and the owner decision is recorded at the gate', () => {
    expect(source).toContain("USER_POLICY_REASONS = new Set(['disabled', 'terms-non-production', 'terms-unverified', 'terms-shared-access'])");
    expect(source).toContain('OWNER DECISION — DO NOT RE-BLOCK WITHOUT THE OWNER (2026-11-16)');
  });
});
