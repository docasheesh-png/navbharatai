import { useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { LogOut } from 'lucide-react';
import { logoutAllDevices, logoutCurrentDevice } from '../../lib/accountSessions';

/** Kept separate from account deletion. Opening, Cancel and Escape never revoke a session. */
export function LogoutControls({ user }: { user: User | null }) {
  const [confirming, setConfirming] = useState<'current' | 'all' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  if (!user) return null;
  const cancel = () => { if (!inFlight.current) { setConfirming(null); setError(null); } };
  const submit = async () => {
    if (!confirming || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      if (confirming === 'all') await logoutAllDevices(user);
      else await logoutCurrentDevice(user);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Logout could not be confirmed. Please try again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
      setConfirming(null); // a retry must be explicitly confirmed again
    }
  };
  return (
    <section className="mt-4 rounded-xl border border-line bg-card p-4" aria-label="Logout"
      onKeyDown={(event) => { if (event.key === 'Escape') cancel(); }}>
      <h3 className="flex items-center gap-2 text-sm font-bold text-ink"><LogOut className="h-4 w-4" />Logout</h3>
      {!confirming ? (
        <div className="mt-3 flex flex-col gap-2">
          <button type="button" className="rounded-lg border border-line px-3 py-2 text-sm text-ink hover:bg-raised"
            onClick={() => { setError(null); setConfirming('current'); }}>Log out of this device</button>
          <button type="button" className="rounded-lg border border-line px-3 py-2 text-sm text-danger hover:bg-raised"
            onClick={() => { setError(null); setConfirming('all'); }}>Log out of all devices</button>
        </div>
      ) : (
        <div className="mt-3 space-y-3" role="group" aria-label="Confirm logout">
          <p className="text-sm text-body">
            {confirming === 'all'
              ? 'Log out of your NavBharatAI account on all devices, including this one? Other devices lose access on their next request or reconnect. Offline screens may remain visible until they reconnect.'
              : 'Log out of NavBharatAI on this device only?'}
          </p>
          {confirming === 'all' && <p className="text-xs text-muted">Already-running requests may finish. This does not delete your account or revoke developer API keys and external account connections.</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" autoFocus disabled={busy} onClick={cancel}
              className="rounded-lg border border-line px-3 py-2 text-sm text-ink disabled:opacity-50">Cancel</button>
            <button type="button" disabled={busy} onClick={() => { void submit(); }}
              className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-danger disabled:opacity-50">
              {busy ? 'Logging out…' : confirming === 'all' ? 'Confirm logout on all devices' : 'Confirm logout'}
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
    </section>
  );
}
