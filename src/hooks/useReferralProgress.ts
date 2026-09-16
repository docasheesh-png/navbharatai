// The referral progress a screen needs: the four steps, the code, the earnings.
//
// 🔒 ANDROID ONLY, AND IT DOES NOT EVEN ASK ELSEWHERE. On the web this hook returns empty without a
// request, so the website never learns a referral state it has no way to act on and no screen there
// can accidentally start rendering one.
//
// 🔒 IT NEVER DECIDES ANYTHING ABOUT MONEY. It reports what the SERVER said. Every number here has
// already been decided by `referralRewards.ts` and written to a wallet; this is a view of that, and
// nothing in it should ever grow a rule.

import { useCallback, useEffect, useState } from 'react';
import { buildChecklist, type ChecklistRow } from '../lib/referralChecklist';
import { authedHeaders } from '../lib/authHeaders';

export interface ReferralProgress {
  enabled: boolean;
  code: string | null;
  shareMessage: string;
  rows: ChecklistRow[];
  earnedRupees: number;
  capRupees: number;
  capReached: boolean;
  /** True once a code has been applied to this account — the box is then never offered again. */
  referred: boolean;
  /** What the account has actually verified, so a row can say what is missing. Server's answer. */
  emailVerified: boolean;
  phoneVerified: boolean;
  githubLinked: boolean;
  loading: boolean;
}

const EMPTY: ReferralProgress = {
  enabled: false, code: null, shareMessage: '', rows: [],
  earnedRupees: 0, capRupees: 0, capReached: false, referred: false,
  emailVerified: false, phoneVerified: false, githubLinked: false, loading: false,
};

/** The platform, asked once. Kept tiny and separate so a screen can be tested without Capacitor. */
async function currentPlatform(): Promise<string> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    return Capacitor.getPlatform();
  } catch {
    return 'web';
  }
}

export function useReferralProgress(userId: string | null | undefined): ReferralProgress & { refresh: () => void } {
  const [state, setState] = useState<ReferralProgress>({ ...EMPTY, loading: Boolean(userId) });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    if (!userId) { setState({ ...EMPTY }); return; }
    (async () => {
      // The platform gate comes FIRST, so the website makes no request at all.
      if ((await currentPlatform()) !== 'android') {
        if (alive) setState({ ...EMPTY });
        return;
      }
      try {
        // A RELATIVE path on purpose: `installNativeApiRewrite` (lib/apiBase.ts) already rewrites
        // every /api call in the native shell to the production origin, so building an absolute URL
        // here would be a second, drifting copy of that rule.
        const res = await fetch(`/api/referral/${encodeURIComponent(userId)}`, {
          headers: await authedHeaders(),
        });
        const data = await res.json().catch(() => null);
        if (!alive) return;
        if (!res.ok || !data?.ok || !data.enabled) { setState({ ...EMPTY }); return; }
        setState({
          enabled: true,
          code: typeof data.code === 'string' ? data.code : null,
          shareMessage: typeof data.shareMessage === 'string' ? data.shareMessage : '',
          rows: buildChecklist(data.steps),
          earnedRupees: Number(data.earnedRupees) || 0,
          capRupees: Number(data.capRupees) || 0,
          capReached: data.capReached === true,
          referred: data.referred === true,
          emailVerified: data.emailVerified === true,
          phoneVerified: data.phoneVerified === true,
          githubLinked: data.githubLinked === true,
          loading: false,
        });
      } catch {
        // A failed lookup shows NOTHING rather than a wrong or empty-looking checklist. The user's
        // money is unaffected — this is a view, and the next launch tries again.
        if (alive) setState({ ...EMPTY });
      }
    })();
    return () => { alive = false; };
  }, [userId, tick]);

  return { ...state, refresh };
}
