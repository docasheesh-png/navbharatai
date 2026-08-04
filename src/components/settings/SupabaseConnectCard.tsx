// One-click database — the user-facing half (ROADMAP #1 Phase 1.1, final slice).
//
// Sits ABOVE the manual credential form in Settings → Database. The manual form stays exactly as it
// is: a user who already has a Supabase project, or who prefers to paste keys, loses nothing. This
// card is the shortcut for everyone else — the people who gave up at "go create a project, find two
// keys, come back".
//
// HONESTY RULES THIS CARD FOLLOWS (rule 2 — a control that cannot work must not look like it can):
//  • If the deployment has no OAuth credentials, the card reports itself unavailable and points at
//    the manual form. It never renders a button that would 503.
//  • Every failure the server can return is shown as the server worded it, because those messages
//    are written to tell the user what to DO (the free-plan cap being the important one).
//  • "Creating…" is not "created". The button stays busy until the server confirms the database is
//    genuinely usable — the server earns that verdict by polling, so the UI does not have to guess.
//  • Disconnect says plainly that Supabase must be told separately; we do not imply we revoked it.

import React, { useCallback, useEffect, useState } from 'react';
import { Database, Check, Loader2, ExternalLink, AlertTriangle } from 'lucide-react';
import { authedFetch } from '../../lib/authedFetch';

interface Status {
  available: boolean;
  connected: boolean;
  orgName: string | null;
}

interface Props {
  /** Used only to name the created project so it is recognisable in the user's own dashboard. */
  appLabel?: string;
  /** When given, the app's generated migrations are applied to the new database so it is not empty. */
  workspaceId?: string;
  /** Called after a successful provision so the parent can refresh what it shows. */
  onProvisioned?: () => void;
}

export function SupabaseConnectCard({ appLabel, workspaceId, onProvisioned }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<'connect' | 'create' | 'disconnect' | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const refresh = useCallback(async () => {
    try {
      const res = await authedFetch('/api/integrations/supabase/status');
      setStatus(await res.json());
    } catch {
      // A status check that cannot reach the server must not render a broken-looking card; treat it
      // as "not available" so the user is simply shown the manual form instead.
      setStatus({ available: false, connected: false, orgName: null });
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // The popup tells us when consent finished, so the card updates without the user hunting for a
  // refresh button. Origin is checked because any page can post to an opener.
  useEffect(() => {
    const onMsg = (e: MessageEvent): void => {
      if (e.origin !== window.location.origin) return;
      if ((e.data as { __nbaiSupabaseConnect?: boolean })?.__nbaiSupabaseConnect) void refresh();
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [refresh]);

  const connect = async (): Promise<void> => {
    setBusy('connect'); setError(''); setDone('');
    try {
      const res = await authedFetch('/api/integrations/supabase/start', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data?.url) { setError(data?.error || 'Could not start the connection.'); return; }
      window.open(data.url, 'nbai-supabase', 'width=560,height=760');
    } catch {
      setError('Could not reach NavBharatAI. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  };

  const createDatabase = async (): Promise<void> => {
    setBusy('create'); setError(''); setDone('');
    try {
      // A generous ceiling: the server waits for Supabase to actually bring the database up, which
      // routinely takes over a minute. The default 20s would abort a request that was going fine.
      const res = await authedFetch('/api/integrations/supabase/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appLabel: appLabel ?? '', workspaceId: workspaceId ?? '' }),
      }, 240_000);
      const data = await res.json();
      // The server words these to tell the user what to do next (plan limit, still starting up,
      // reconnect) — passing them through unchanged is more useful than any generic line here.
      if (!res.ok) { setError(data?.error || 'Could not create the database.'); return; }
      // The database and its TABLES are reported separately, because they fail separately. Saying
      // "ready" when the schema did not apply would be the nearly-true claim this feature exists to
      // avoid — the app would be wired to an empty database and every query would fail.
      if (data?.schemaApplied === false) {
        setDone('Your database was created and your app is wired to it, but its tables could not be '
          + 'set up yet. ' + (data?.schemaNote || 'Try "Create database" again in a moment.'));
      } else {
        setDone('Database ready. Your app will use it automatically — no keys to copy.');
      }
      onProvisioned?.();
    } catch {
      setError('Could not reach NavBharatAI. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (): Promise<void> => {
    setBusy('disconnect'); setError(''); setDone('');
    try {
      const res = await authedFetch('/api/integrations/supabase/disconnect', { method: 'POST' });
      const data = await res.json();
      setDone(data?.note || 'Disconnected.');
      await refresh();
    } catch {
      setError('Could not disconnect right now. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  if (!status) return null;               // first paint — say nothing rather than flash a wrong state
  if (!status.available) return null;     // no OAuth app on this deployment → the manual form below is the real path

  return (
    <div className="mb-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0">
          <Database className="w-4.5 h-4.5" />
        </div>
        <div className="min-w-0">
          <h4 className="text-sm font-bold text-white">Create a database in one tap</h4>
          <p className="text-[11px] text-[#8b949e] leading-snug mt-0.5">
            NavBharatAI creates the database inside <b className="text-[#c9d1d9]">your own</b> Supabase
            account, so your data and its billing stay yours. No keys to copy.
          </p>
        </div>
      </div>

      {status.connected ? (
        <>
          <p className="text-[11px] text-emerald-300 flex items-center gap-1.5 mb-3">
            <Check className="w-3.5 h-3.5" />
            Connected{status.orgName ? ` to ${status.orgName}` : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={createDatabase}
              disabled={busy !== null}
              className="flex items-center gap-2 text-xs font-bold px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy === 'create' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
              {busy === 'create' ? 'Creating your database…' : 'Create database'}
            </button>
            <button
              onClick={disconnect}
              disabled={busy !== null}
              className="text-xs font-semibold px-3 py-2 rounded-xl border border-white/10 text-[#8b949e] hover:text-white hover:bg-white/5 disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
          {busy === 'create' && (
            <p className="text-[10px] text-[#8b949e] mt-2 leading-snug">
              This takes a minute or two — Supabase has to start the database before it can be used.
              We wait for it to be genuinely ready before telling you it is done.
            </p>
          )}
        </>
      ) : (
        <button
          onClick={connect}
          disabled={busy !== null}
          className="flex items-center gap-2 text-xs font-bold px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
        >
          {busy === 'connect' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
          Connect Supabase
        </button>
      )}

      {error && (
        <p className="mt-3 text-[11px] text-amber-300 flex items-start gap-1.5 leading-snug">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>{error}</span>
        </p>
      )}
      {done && <p className="mt-3 text-[11px] text-emerald-300 leading-snug">{done}</p>}
    </div>
  );
}

export default SupabaseConnectCard;
