import React, { useCallback, useEffect, useState } from 'react';
import { adminGet, adminFailed, adminHeaders } from '../../lib/adminFetch';

/**
 * MOBILE OTP SIGN-IN — on or suspended (admin 2026-11-21). Every sign-in OTP is a paid SMS, so the admin can
 * suspend OTP *sign-in* here without a deploy. Verifying a mobile number (referral rewards) keeps working.
 * Server: src/server/lib/otpLoginSwitch.ts. Users are only told that mobile sign-in is temporarily
 * unavailable and which ways in still work.
 */
interface Setting { suspended: boolean; updatedAt: number | null }

export function isOtpLoginSetting(b: unknown): b is Setting {
  return !!b && typeof b === 'object' && typeof (b as Setting).suspended === 'boolean';
}

export function OtpLoginSwitchCard({ adminToken }: { adminToken: string }): React.ReactElement {
  const [state, setState] = useState<Setting | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const r = await adminGet<Setting>('/api/admin/otp-login', { token: adminToken });
    if (adminFailed(r)) setError(r.message);
    else if (!isOtpLoginSetting(r.data)) setError('The server sent an unexpected answer.');
    else { setState(r.data); setError(''); }
  }, [adminToken]);
  useEffect(() => { void load(); }, [load]);

  const save = async (suspended: boolean) => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/admin/otp-login', {
        method: 'POST',
        headers: { ...adminHeaders(adminToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ suspended }),
      });
      const json: unknown = await response.json().catch(() => null);
      if (!response.ok || !isOtpLoginSetting(json)) {
        throw new Error((json as { error?: string } | null)?.error || 'Could not save the setting.');
      }
      setState(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the setting.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Mobile OTP sign-in" className="rounded-2xl border border-line bg-card p-6 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-black uppercase tracking-tight text-ink">Mobile OTP sign-in</h3>
          <p className="mt-1 text-xs text-muted" role="status">
            {!state ? 'Checking…' : state.suspended ? 'SUSPENDED — the OTP tab is hidden on the sign-in screen' : 'ON — people can sign in with a mobile OTP'}
          </p>
        </div>
        <button
          type="button"
          disabled={!state || busy}
          onClick={() => state && void save(!state.suspended)}
          className="min-h-11 rounded-lg border border-line bg-raised px-4 py-2 text-xs font-bold text-ink disabled:opacity-50"
        >
          {busy ? 'Saving…' : state?.suspended ? 'Resume OTP sign-in' : 'Suspend OTP sign-in'}
        </button>
      </div>
      <p className="text-xs text-muted">
        Each sign-in OTP is a paid SMS. While suspended, people sign in with email, Google or Apple and are told only that
        mobile sign-in is temporarily unavailable. Verifying a mobile number for referral rewards keeps working.
        Accounts that can sign in only by phone cannot sign in while this is suspended.
      </p>
      {state?.updatedAt && <p className="text-[10px] text-muted">Last changed: {new Date(state.updatedAt).toLocaleString()}</p>}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </section>
  );
}
