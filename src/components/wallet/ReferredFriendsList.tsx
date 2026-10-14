// FRIENDS WHO USED MY CODE — each one's real verification progress, and nothing invented.
//
// The data is `GET /api/referral/:userId/referred` (the server's own `friendVerificationStatus`), read
// through `readAnswer` + a shape check so a refusal is never drawn as "no friends yet" (Q-680). The
// friend is identified by a MASKED label the server builds — never an address, a number or private
// GitHub data. No ₹ is derived per friend (see referredFriendsView.ts); the account's real earned
// total is shown by the referral card above, from the server.
//
// Loading, empty, error-with-retry and "rewards are off" are four different states and are rendered as
// four different things.

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Circle, Loader2, RefreshCw, Users } from 'lucide-react';
import { authedHeaders } from '../../lib/authHeaders';
import { readAnswer } from '../../lib/serverAnswer';
import {
  friendStatusLabel, parseReferredAnswer, referredTotals, FRIEND_STEPS_TOTAL,
  type ReferredAnswer,
} from '../../lib/referredFriendsView';

type Load = { s: 'loading' } | { s: 'error'; message: string } | { s: 'ready'; answer: ReferredAnswer };

function Step({ done, label }: { done: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${done ? 'text-success' : 'text-muted'}`}>
      {done ? <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden /> : <Circle className="h-4 w-4 shrink-0" aria-hidden />}
      {label}
      <span className="sr-only">{done ? ' — done' : ' — pending'}</span>
    </span>
  );
}

export function ReferredFriendsList({ userId, refreshKey }: { userId: string; refreshKey?: number }) {
  const [state, setState] = useState<Load>({ s: 'loading' });

  const load = useCallback(async () => {
    setState({ s: 'loading' });
    try {
      const res = await fetch(`/api/referral/${encodeURIComponent(userId)}/referred`, { headers: await authedHeaders() });
      const a = await readAnswer(res, (b): b is Record<string, unknown> => parseReferredAnswer(b) !== null);
      if (!a.ok) { setState({ s: 'error', message: a.sentence }); return; }
      const answer = parseReferredAnswer(a.value);
      setState(answer ? { s: 'ready', answer } : { s: 'error', message: 'The server answered in a shape this screen does not know.' });
    } catch (e) {
      setState({ s: 'error', message: e instanceof Error ? e.message : 'Could not reach the server.' });
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  return (
    <section aria-labelledby="referred-friends-heading" className="rounded-2xl border border-line bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="referred-friends-heading" className="flex items-center gap-2 text-sm font-bold text-ink">
            <Users className="h-4 w-4 text-accent-text" aria-hidden /> Friends who joined with your code
          </h3>
          <p className="mt-0.5 text-xs font-semibold text-muted">
            You earn when a friend completes all {FRIEND_STEPS_TOTAL} verifications: email, mobile and GitHub.
          </p>
        </div>
      </div>

      {state.s === 'loading' && (
        <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-muted" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
        </p>
      )}

      {state.s === 'error' && (
        <div className="mt-4 space-y-2" role="alert">
          <p className="text-sm font-semibold text-danger">Could not load this right now. {state.message}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-line bg-raised px-4 text-sm font-bold text-ink hover:bg-raised-hover"
          >
            <RefreshCw className="h-4 w-4" aria-hidden /> Try again
          </button>
        </div>
      )}

      {state.s === 'ready' && !state.answer.enabled && (
        <p className="mt-4 text-sm font-semibold text-muted">Referral rewards are not available right now.</p>
      )}

      {state.s === 'ready' && state.answer.enabled && state.answer.friends.length === 0 && (
        <p className="mt-4 text-sm font-semibold text-muted">
          Nobody has used your code yet. Share it and check back here.
        </p>
      )}

      {state.s === 'ready' && state.answer.enabled && state.answer.friends.length > 0 && (() => {
        const t = referredTotals(state.answer.friends);
        return (
          <>
            <ul className="mt-4 space-y-2.5">
              {state.answer.friends.map((f, i) => (
                <li key={`${f.label}-${i}`} className="rounded-xl border border-line bg-surface p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-all text-sm font-bold text-ink">{f.label}</p>
                      {f.referredAt && !Number.isNaN(Date.parse(f.referredAt)) && (
                        <p className="text-xs font-semibold text-muted">
                          Joined {new Date(f.referredAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </p>
                      )}
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${f.completedCount >= FRIEND_STEPS_TOTAL ? 'bg-success/10 text-success' : 'bg-warn/10 text-warn'}`}>
                      {f.completedCount}/{FRIEND_STEPS_TOTAL}
                    </span>
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
                    <Step done={f.emailVerified} label="Email" />
                    <Step done={f.phoneVerified} label="Mobile" />
                    <Step done={f.githubLinked} label="GitHub" />
                  </div>
                  <p className="mt-2 text-xs font-semibold text-muted">{friendStatusLabel(f)}</p>
                </li>
              ))}
            </ul>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
              {[
                ['Invited', t.total],
                ['Completed', t.completed],
                ['In progress', t.pending],
              ].map(([label, n]) => (
                <div key={String(label)} className="rounded-xl bg-well p-3">
                  <dd className="text-xl font-extrabold text-ink">{n}</dd>
                  <dt className="text-xs font-semibold text-muted">{label}</dt>
                </div>
              ))}
            </dl>
          </>
        );
      })()}
    </section>
  );
}
