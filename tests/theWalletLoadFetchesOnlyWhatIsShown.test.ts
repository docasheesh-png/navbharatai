/**
 * Q-113: every wallet load fetched `/api/wallet/:uid/logs` into `billingLogs`, which was passed down to the
 * Billing panel and read by nothing — one more round-trip to a cold instance on every login, for a list no
 * screen showed. Removed with its state and prop. This keeps it from coming back unread.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('the wallet load fetches only what a screen shows', () => {
  it('no usage-logs fetch, no billingLogs state or prop anywhere in the client', () => {
    const hook = readFileSync('src/hooks/usePaymentEngine.ts', 'utf8');
    expect(hook).not.toMatch(/\/api\/wallet\/\$\{[^}]+\}\/logs/);
    for (const f of ['src/hooks/usePaymentEngine.ts', 'src/App.tsx', 'src/components/panels/BillingPanel.tsx']) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/\bbillingLogs\b|\bsetBillingLogs\b/);
    }
  });

  it('every call the wallet load still makes has a reader', () => {
    const hook = readFileSync('src/hooks/usePaymentEngine.ts', 'utf8');
    expect(hook).toContain('const [walletR, txsR, usageR] = await Promise.allSettled([');
    for (const r of ['walletR', 'txsR', 'usageR']) expect(hook).toMatch(new RegExp(`if \\(${r}\\.status === 'fulfilled'`));
  });
});
