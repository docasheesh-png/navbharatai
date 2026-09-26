/**
 * The ₹250 welcome backfill is deleted (admin 2026-09-26: "ab isko har jagah se hata do, bas referral
 * wala chhor do, 100*4 chhorna hai"). The 4 × ₹100 referral ladder is the only welcome credit.
 *
 * This fails if the module, its admin routes, its admin card or a reader of its env keys comes back.
 * The referral ladder is asserted to still be there, so a sweep that went too far fails here too.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('the welcome backfill is gone for good', () => {
  it('has no module and no admin card', () => {
    expect(existsSync(join(root, 'src/server/lib/welcomeBackfill.ts'))).toBe(false);
    expect(existsSync(join(root, 'src/components/admin/WelcomeBackfillCard.tsx'))).toBe(false);
  });

  it('has no admin route and no reader of its env keys', () => {
    const admin = read('src/server/routes/admin.ts');
    expect(admin).not.toMatch(/welcome-backfill/);
    expect(admin).not.toMatch(/welcomeBackfill/);
    for (const f of ['src/server/routes/admin.ts', 'src/components/AdminDashboard.tsx', 'server.ts']) {
      expect(read(f), f).not.toMatch(/WELCOME_BACKFILL/);
    }
    expect(read('src/components/AdminDashboard.tsx')).not.toMatch(/WelcomeBackfill/);
  });

  it('leaves the 4 × ₹100 referral ladder in place', () => {
    expect(existsSync(join(root, 'src/server/lib/referralRewards.ts'))).toBe(true);
    expect(read('src/components/AdminDashboard.tsx')).toContain('<ReferralCostCard');
  });
});
