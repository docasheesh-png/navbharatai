import React, { useCallback, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

/**
 * WHY NO NOTIFICATION ARRIVED — the loud half of a deliberately silent feature.
 *
 * 🔴 WHY THIS CARD EXISTS (admin 2026-09-20: "woh notifications abhi navbharatai me nahi aa rahe
 * hai — isko on karwane ke liye aur kya karna chahiye"). Push notifications are fully built and fully
 * wired, and they still deliver nothing. `sendPushToUser` is fire-and-forget by design — a push must
 * never fail a build — so every way the chain can break produces the same outcome: nothing arrives,
 * nothing errors, nothing is logged. There was no screen anywhere that could tell an app too old to
 * receive from a Cloud Messaging API that was never enabled.
 *
 * TWO BUTTONS, AND THEY ANSWER DIFFERENT QUESTIONS. The check READS (registry, config, and one probe
 * Firebase can only ever refuse) and names the broken link. The test SENDS a real notification to a
 * real account — the only thing that proves the whole chain, because reaching Firebase is not the
 * same as a phone lighting up and only the person holding the phone can confirm the second half.
 *
 * Both are on buttons, like the hosting and referral checks: each makes a real Google call, and a
 * panel that pings Google on every render is a quiet bill and a noisy log.
 */
interface SetupCheck {
  id: string;
  label: string;
  state: 'ok' | 'failed' | 'skipped' | 'unknown';
  detail: string;
  remedy: string;
}

interface SetupReport {
  verdict: 'ready' | 'blocked' | 'incomplete';
  checks: SetupCheck[];
  nextAction: string;
  manual: string[];
}

interface TestResult {
  ok: boolean;
  email?: string;
  tokens?: number;
  sent?: number;
  detail?: string;
  error?: string;
}

export function PushHealthCard({ adminToken }: { adminToken: string }): React.ReactElement {
  const [setup, setSetup] = useState<SetupReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [sending, setSending] = useState(false);

  const checkSetup = useCallback(async () => {
    setChecking(true);
    try {
      const r = await fetch('/api/admin/push/preflight', { headers: { 'x-admin-token': adminToken } });
      const body = (await r.json()) as SetupReport;
      setSetup(Array.isArray(body?.checks) ? body : null);
    } catch (e) {
      setSetup({
        verdict: 'incomplete',
        checks: [{ id: 'fetch', label: 'Notification setup check', state: 'unknown', detail: e instanceof Error ? e.message : String(e), remedy: 'Re-run the check.' }],
        nextAction: 'Re-run the check.',
        manual: [],
      });
    } finally {
      setChecking(false);
    }
  }, [adminToken]);

  const sendTest = useCallback(async () => {
    setSending(true);
    setTest(null);
    try {
      const r = await fetch('/api/admin/push/test', {
        method: 'POST',
        headers: { 'x-admin-token': adminToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      setTest((await r.json()) as TestResult);
    } catch (e) {
      setTest({ ok: false, detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setSending(false);
    }
  }, [adminToken]);

  return (
    <div className="rounded-2xl border border-line bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <div>
          <h3 className="text-sm font-black uppercase tracking-tight text-ink">Notifications</h3>
          <p className="mt-1 text-[10px] font-semibold text-muted">
            Whether a notification can actually reach a phone, and which link is broken if it cannot.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void checkSetup()}
            disabled={checking}
            className="rounded-lg bg-raised px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-muted transition-colors hover:text-ink disabled:opacity-40"
          >
            {checking ? 'Checking…' : 'Check notification setup'}
          </button>
          <button
            onClick={() => void sendTest()}
            disabled={sending}
            className="rounded-lg bg-raised px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-muted transition-colors hover:text-ink disabled:opacity-40"
          >
            {sending ? 'Sending…' : 'Send me a test'}
          </button>
        </div>
      </div>

      {!setup && !test && (
        <p className="mt-4 text-[11px] font-semibold text-muted">
          Press <span className="font-black text-ink">Check notification setup</span> to see whether the
          send path works, or <span className="font-black text-ink">Send me a test</span> to try a real
          notification on your own phone.
        </p>
      )}

      {setup && (
        <div className="mt-4 rounded-xl border border-line bg-surface p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[9px] font-black uppercase tracking-widest text-muted">Setup check</span>
            <span className={`text-[9px] font-black uppercase ${setup.verdict === 'ready' ? 'text-success' : setup.verdict === 'blocked' ? 'text-warn' : 'text-muted'}`}>
              {setup.verdict === 'ready' ? 'Can deliver' : setup.verdict === 'blocked' ? 'Cannot deliver' : 'Not fully checked'}
            </span>
          </div>
          <ul className="space-y-1.5">
            {setup.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-2">
                {c.state === 'ok'
                  ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                  : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />}
                <div>
                  <p className="text-[10px] font-bold text-ink">{c.label}</p>
                  {c.detail && <p className="text-[10px] font-semibold text-muted">{c.detail}</p>}
                  {c.state !== 'ok' && c.remedy && (
                    <p className="text-[10px] font-semibold text-accent-text">{c.remedy}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {setup.nextAction && (
            <p className="mt-2.5 text-[10px] font-bold text-ink">Next: {setup.nextAction}</p>
          )}
          {setup.manual.length > 0 && (
            <div className="mt-3 border-t border-line pt-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-muted">Cannot be checked from here — by hand</p>
              <ul className="mt-1 space-y-1">
                {setup.manual.map((m) => (
                  <li key={m} className="text-[10px] font-semibold leading-relaxed text-muted">• {m}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {test && (
        <div className="mt-4 rounded-xl border border-line bg-surface p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[9px] font-black uppercase tracking-widest text-muted">Test send</span>
            <span className={`text-[9px] font-black uppercase ${test.ok ? 'text-success' : 'text-warn'}`}>
              {test.ok ? 'Accepted by Firebase' : 'Did not send'}
            </span>
          </div>
          <p className="text-[10px] font-semibold text-muted">
            {test.detail || test.error || 'No detail.'}
          </p>
          {test.ok && (
            // Never claimed as proof: Firebase accepting a message is not the phone showing one.
            <p className="mt-1.5 text-[10px] font-bold text-ink">
              If nothing appears on the phone, the app installed there is older than the notification
              feature — a fresh Play release is the fix.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default PushHealthCard;
