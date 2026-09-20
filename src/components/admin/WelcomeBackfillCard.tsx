import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Gift, Loader2 } from 'lucide-react';
import { adminGet, adminFailed, adminHeaders } from '../../lib/adminFetch';

/**
 * THE ₹250 WELCOME BACKFILL — the people the retirement left with nothing.
 *
 * Admin 2026-09-20: *"woh sare user jinko welcome bonus nahi mila hai, unko sabhi ki 250₹ ke welcome
 * bonus dene hai! admin penal me kuch der ke liye aisi vyabasta kar do!"*
 *
 * 🔒 IT SHOWS THE BILL BEFORE IT SPENDS. The count and the rupee total are read first and nothing is
 * credited until "Credit them" is pressed — a money button whose amount is only known afterwards is
 * not a button anybody can use responsibly.
 *
 * ⚠️ EVERY CALL GOES THROUGH `adminFetch`, because an admin route authenticates on the `x-admin-token`
 * header and on nothing else. Send the bearer header instead and the route answers 401, whose error
 * body then becomes the screen's data — the exact bug `tests/adminFetch.test.ts` exists for, and it
 * caught the first draft of this card.
 *
 * (That test reads a window of source either side of each admin URL, so this paragraph deliberately
 * does not spell the other header beside one — the guard is right, and prose should not have to be
 * exempted from it.)
 *
 * 🔒 AND IT IS SAFE TO PRESS TWICE. Each account carries its own durable marker written in the same
 * transaction as its credit, so a second press pays the people the first press had not reached yet
 * and nobody else. That is also what makes the batching honest rather than a limitation: one press is
 * one bounded run, and "still waiting" says whether to press again.
 */
interface Preview {
  ok: boolean;
  enabled?: boolean;
  grantRupees?: number;
  scanned?: number;
  owed?: number;
  owedRupees?: number;
  alreadyWelcomed?: number;
  alreadyBackfilled?: number;
  noRoom?: number;
  noWallet?: number;
  tooOld?: number;
}

interface RunResult {
  granted: number;
  grantedRupees: number;
  skipped: number;
  failed: number;
  remaining: number;
}

const inr = (n: number | undefined): string =>
  `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export function WelcomeBackfillCard({ adminToken }: { adminToken: string }): React.ReactElement {
  const [data, setData] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    // A failure here can never become the numbers on screen — `adminGet` returns no `data` at all
    // when the call failed, so a zero below is always a real zero.
    const r = await adminGet<Preview>('/api/admin/welcome-backfill', { token: adminToken });
    if (adminFailed(r)) setError(r.message);
    else setData(r.data);
    setLoading(false);
  }, [adminToken]);

  useEffect(() => { void load(); }, [load]);

  const run = async () => {
    setRunning(true);
    setError('');
    try {
      const res = await fetch('/api/admin/welcome-backfill/run', {
        method: 'POST',
        // `adminFetch` has no POST helper, so the header comes from the same one source rather than
        // being spelled out again here.
        headers: { ...adminHeaders(adminToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'The backfill could not run.');
      setResult(json);
      // Re-read rather than adjusting the numbers locally: the server's count is the one that decides
      // whether there is anything left to do.
      await load();
    } catch (e) {
      setError((e as Error)?.message || 'The backfill could not run.');
    } finally {
      setRunning(false);
    }
  };

  const owed = Number(data?.owed) || 0;

  return (
    <div className="rounded-xl border border-line bg-card p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Gift className="h-4 w-4 shrink-0 text-accent-text" />
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-ink">Welcome bonus backfill</h3>
          <p className="text-[11px] leading-snug text-muted">
            Credits {inr(data?.grantRupees ?? 250)} to every account opened after the welcome gift was
            retired and handed nothing. Older accounts were gifted under the old plan and are left
            alone. Each account is paid once, and pressing again only reaches the ones still waiting.
          </p>
        </div>
      </div>

      {data?.enabled === false && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2.5 text-[11px] leading-snug text-warn">
          <AlertTriangle size={14} className="mt-px shrink-0" />
          Switched off by configuration. Nothing will be credited while it stays off.
        </p>
      )}

      {error && (
        <p className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-2.5 text-[11px] leading-snug text-danger">
          <AlertTriangle size={14} className="mt-px shrink-0" /> {error}
        </p>
      )}

      {loading && !data && (
        <p className="flex items-center gap-2 text-[11px] text-faint">
          <Loader2 size={12} className="animate-spin" /> Reading the wallets…
        </p>
      )}

      {data && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Waiting" value={String(owed)} strong />
          <Stat label="To credit" value={inr(data.owedRupees)} strong />
          <Stat label="Older, left alone" value={String(Number(data.tooOld) || 0)} />
          <Stat label="Accounts scanned" value={String(Number(data.scanned) || 0)} />
        </div>
      )}

      {result && (
        <p className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-2.5 text-[11px] leading-snug text-success">
          <CheckCircle2 size={14} className="mt-px shrink-0" />
          Credited {inr(result.grantedRupees)} to {result.granted}{' '}
          {result.granted === 1 ? 'account' : 'accounts'}.
          {result.remaining > 0 && ` ${result.remaining} still waiting — press again.`}
          {result.failed > 0 && ` ${result.failed} could not be credited and were left untouched.`}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void run()}
          disabled={running || loading || owed === 0 || data?.enabled === false}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-on-accent hover:bg-indigo-500 disabled:opacity-40"
        >
          {running ? <Loader2 size={13} className="animate-spin" /> : <Gift size={13} />}
          {running ? 'Crediting…' : owed === 0 ? 'Nobody is waiting' : `Credit ${owed}`}
        </button>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || running}
          className="rounded-lg border border-line px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-muted hover:text-ink disabled:opacity-40"
        >
          Refresh
        </button>
      </div>

      <p className="text-[10px] leading-snug text-faint">
        This does not change what a NEW signup receives — that stays with the referral steps. An account
        can be gifted at most ₹400 in its whole lifetime and this credit counts toward that ceiling, so
        nothing here can ever take an account past ₹400.
      </p>
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }): React.ReactElement {
  return (
    <div className="rounded-lg border border-line bg-well p-2.5">
      <div className={`text-sm font-bold tabular-nums ${strong ? 'text-accent-text' : 'text-ink'}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-faint">{label}</div>
    </div>
  );
}

export default WelcomeBackfillCard;
