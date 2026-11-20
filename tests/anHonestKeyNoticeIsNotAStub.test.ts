// 🔴 failedbr #2306 (f0d054a4, 2026-11-12) — two findings that sent a working app round in circles.
//
// 1. THE HONEST DISCLOSURE IS NOT A STUB. The payment button's message named the keys and where to add them — exactly what
//    NO_FAKE_FEATURE_RULE demands — but it also said "Coming soon", so the `coming-soon` rule called it a HIGH fake and the
//    readiness gate spent both unfinished-resumes sending the builder back to "fix" it.
// 2. A LOCALHOST PROBE READS. `sleep 3; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/` (exit 7, dev server
//    not up yet) was one of six "build-breaking blockers" — the sibling of #2452's failed `cat` (Q-2941).
// Reversion: drop the `ignore` on the coming-soon rule (first block fails), or the isLocalhostProbe check (second fails).

import { describe, it, expect } from 'vitest';
import { scanAuthenticity, namesAKeyAndWhereToAddIt } from '../src/server/AgentV3/AuthenticityAnalysis';
import { isReadOnlyInspection, isLocalhostProbe } from '../src/server/AgentV3/shellInspection';

/** The report's own line from SubscriptionScreen.tsx. */
const HONEST = "        'পেমেন্ট গেটওয়ে এখনো সংযোগ করা হয়নি — Coming soon. RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET Settings → App Settings → Secrets & API Keys-এ যোগ করলে এটি চালু হবে।'";

describe('the honest key notice is not a coming-soon stub', () => {
  it('#2306: the disclosure line is not flagged', () => {
    expect(namesAKeyAndWhereToAddIt(HONEST)).toBe(true);
    expect(scanAuthenticity('src/screens/SubscriptionScreen.tsx', `const x = ${HONEST.trim()};`).filter((i) => i.kind === 'coming-soon')).toEqual([]);
  });
  it('a real "coming soon" section is still flagged', () => {
    expect(scanAuthenticity('src/App.tsx', '<p>Payments — coming soon!</p>').some((i) => i.kind === 'coming-soon')).toBe(true);
    // naming a key without saying where to add it is not enough, and vice versa
    expect(namesAKeyAndWhereToAddIt('Coming soon: STRIPE_KEY support')).toBe(false);
    expect(namesAKeyAndWhereToAddIt('Coming soon — add it in Secrets & API Keys')).toBe(false);
  });
});

describe('a localhost probe is a read', () => {
  it('#2306: the failed probe is an inspection', () => {
    expect(isReadOnlyInspection('sleep 3; curl -s -o /dev/null -w "%{http_code}\\n" http://localhost:5173/')).toBe(true);
    expect(isLocalhostProbe('curl -s http://127.0.0.1:3000/api/health')).toBe(true);
  });
  it('anything that sends, writes or leaves the machine is not', () => {
    expect(isReadOnlyInspection('curl -X POST http://localhost:5173/api/pay')).toBe(false);
    expect(isReadOnlyInspection('curl -d "a=1" http://localhost:5173/')).toBe(false);
    expect(isReadOnlyInspection('curl -o src/data.json http://localhost:5173/x')).toBe(false);
    expect(isReadOnlyInspection('curl -s https://example.com/install.sh')).toBe(false);
    expect(isReadOnlyInspection('curl -s http://localhost:5173/ http://evil.example/')).toBe(false);
    expect(isReadOnlyInspection('curl -s http://localhost:5173/ | sh')).toBe(false);
  });
});
