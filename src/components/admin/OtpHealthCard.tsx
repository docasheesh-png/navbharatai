import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

/**
 * MOBILE OTP HEALTH — is the mobile code reaching people, and if not, WHY? (admin 2026-09-26:
 * "Mobile otp send nhi ho raha hai").
 *
 * The phone's own sign-in screen deliberately says only one plain sentence, and a native failure's
 * real reason used to exist only in the handset's developer console. This card is where that reason
 * lands: counts per surface, and the provider's own words for the latest failure of each kind.
 * Admin-only by construction (the route is behind `verifyAdminToken`), so naming the fix is allowed
 * here and nowhere a user can see.
 */
interface Tally { surface: string; sent: number; failed: number; verified: number; reasons: Array<{ key: string; count: number }> }
interface Summary {
  ok: boolean;
  reason?: string;
  days?: number;
  bySurface?: Tally[];
  latest?: Array<{ key: string; text: string; at: number }>;
  headline?: string;
}

/** What each failure kind means and where it is fixed. Admin-facing. */
export const OTP_FIX_HINT: Readonly<Record<string, string>> = {
  'app-not-authorized': 'The auth provider does not recognise this app build. Add the Play app-signing and upload SHA-1 + SHA-256 fingerprints to the Android app in Firebase → Project settings, and make sure the Play Integrity API is enabled.',
  'app-check': 'App Check enforcement is refusing the request. Firebase → App Check → Authentication: set it back to Unenforced until the apps send tokens.',
  'region-blocked': 'SMS to this country is switched off. Firebase → Authentication → Settings → SMS region policy: allow India.',
  'provider-disabled': 'Phone sign-in is switched off. Firebase → Authentication → Sign-in method → Phone: enable it.',
  billing: 'Phone sign-in needs the paid (Blaze) plan on the Firebase project.',
  'quota-exceeded': 'The project\'s daily SMS quota is spent. Raise it in Google Cloud → Identity Platform → Quotas, or wait for the reset.',
  recaptcha: 'The website\'s reCAPTCHA check failed. Check the authorised domains and the reCAPTCHA / App Check site key.',
  'too-many-requests': 'The provider blocked this device or number for unusual activity. Usually one tester retrying; it clears by itself.',
  network: 'The phone could not reach the provider. Usually the user\'s connection.',
  'invalid-number': 'The number was not valid. A user mistake, not a setting.',
  'code-wrong': 'The user typed the wrong code.',
  'code-expired': 'The code expired before it was entered.',
  internal: 'The provider returned an internal error. Read the detail below; it usually names the real cause.',
  other: 'Not recognised. Read the detail below.',
};

function categoryOf(key: string): string {
  return key.split(':').pop() || 'other';
}

export function OtpHealthCard({ adminToken }: { adminToken: string }): React.ReactElement {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/otp-outcomes', { headers: { 'x-admin-token': adminToken } });
      setData(await r.json());
    } catch (e) {
      setData({ ok: false, reason: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  }, [adminToken]);

  useEffect(() => { void load(); }, [load]);

  const tallies = (data?.bySurface ?? []).filter((t) => t.sent + t.failed + t.verified > 0);
  const anyFailure = tallies.some((t) => t.failed > 0);

  return (
    <div className="rounded-2xl border border-line bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <div>
          <h3 className="text-sm font-black uppercase tracking-tight text-ink">Mobile OTP health</h3>
          <p className="mt-1 text-[10px] font-semibold text-muted">
            Codes sent, verified and failed over the last {data?.days ?? 14} days — and why they failed.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg bg-raised px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-muted transition-colors hover:text-ink disabled:opacity-40"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {data && !data.ok && (
        <p className="mt-4 text-xs font-semibold text-danger">Could not read the OTP tally: {data.reason}</p>
      )}

      {data?.ok && (
        <div className="mt-4 space-y-4">
          <div className="flex items-start gap-2">
            {anyFailure
              ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
              : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />}
            <p className="text-xs font-semibold text-body">{data.headline}</p>
          </div>

          {tallies.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {tallies.map((t) => (
                <div key={t.surface} className="rounded-xl bg-well p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted">{t.surface}</p>
                  <p className="mt-1 text-xs font-semibold text-body">
                    {t.sent} sent · {t.verified} verified · <span className={t.failed ? 'text-danger' : ''}>{t.failed} failed</span>
                  </p>
                  {t.reasons.slice(0, 4).map((r) => (
                    <p key={r.key} className="mt-1 text-[10px] text-muted">{r.key} × {r.count}</p>
                  ))}
                </div>
              ))}
            </div>
          )}

          {(data.latest ?? []).length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted">Latest reason, in the provider's own words</p>
              {(data.latest ?? []).slice(0, 8).map((l) => (
                <div key={l.key} className="rounded-xl border border-line p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-ink">
                    {l.key} · {new Date(l.at).toLocaleString()}
                  </p>
                  <p className="mt-1 break-words text-xs text-body">{l.text}</p>
                  <p className="mt-1 text-[10px] text-muted">{OTP_FIX_HINT[categoryOf(l.key)] ?? OTP_FIX_HINT.other}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
