// "AI in this app" — the owner's control over their app's built-in assistant (Keys & Secrets sheet).
//
// Admin 2026-10-04: the owner must be told their app's AI runs on NavBharatAI and is charged to their
// balance, must be able to switch it off whenever they like, and may use their own key instead. This card
// shows exactly that, from `GET /api/app-ai/settings`. It never shows a key — only which engine answers.
import { useCallback, useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { authJsonHeaders } from '../../lib/authHeaders';
import { readSpendHistory, SPEND_HISTORY_DAYS, type SpendHistory } from '../../lib/appAiSpendHistory';

export interface AppAiSettingsView {
  available: boolean;
  usesAi: boolean;
  enabled: boolean;
  ownKey: 'openai' | 'anthropic' | null;
  previewCapInr: number;
  previewSpentTodayInr: number;
  publishedSpentTodayInr: number;
}

/** The owner's view of their app's assistant. Pure fetch; null on any failure. */
export async function fetchAppAiSettings(workspaceId: string): Promise<AppAiSettingsView | null> {
  try {
    const res = await fetch(`/api/app-ai/settings?workspaceId=${encodeURIComponent(workspaceId)}`, { headers: await authJsonHeaders() });
    if (!res.ok) return null;
    const j = (await res.json().catch(() => null)) as AppAiSettingsView | null;
    return j && typeof j === 'object' && typeof j.usesAi === 'boolean' ? j : null;
  } catch {
    return null;
  }
}

/** The last 30 days of this app's AI cost (Q-797). Null on any failure — never an invented ₹0. */
export async function fetchAppAiSpend(workspaceId: string): Promise<(SpendHistory & { known: boolean }) | null> {
  try {
    const res = await fetch(`/api/app-ai/spend?workspaceId=${encodeURIComponent(workspaceId)}`, { headers: await authJsonHeaders() });
    return readSpendHistory(res.ok, await res.json().catch(() => null));
  } catch {
    return null;
  }
}

const OWN_KEY_NAME = { openai: 'your OpenAI key', anthropic: 'your Anthropic key' } as const;

/**
 * WHAT YOUR APP'S AI HAS COST (Q-797, admin 2026-10-11). The owner saw only today's number, so a cost that grew
 * over a week stayed invisible until the balance showed it. The days with any cost are listed, newest first,
 * with the 30-day totals; "could not read" is said as such.
 */
export function AppAiSpendHistory({ history, failed }: { history: (SpendHistory & { known: boolean }) | null; failed: boolean }) {
  const rupees = (n: number) => `₹${n.toFixed(2)}`;
  if (failed || (history && !history.known)) return <p className="mt-2 text-muted">Could not read the last {SPEND_HISTORY_DAYS} days just now — please try again.</p>;
  if (!history) return <p className="mt-2 text-muted">Loading…</p>;
  const spent = history.days.filter((d) => d.publishedInr > 0 || d.previewInr > 0 || d.calls > 0);
  return (
    <div className="mt-2" aria-label={`AI cost, last ${SPEND_HISTORY_DAYS} days`}>
      <p className="text-body">
        Last {SPEND_HISTORY_DAYS} days: published app <strong>{rupees(history.totalPublishedInr)}</strong> · preview <strong>{rupees(history.totalPreviewInr)}</strong> · {history.totalCalls} answer{history.totalCalls === 1 ? '' : 's'}
      </p>
      {spent.length === 0 ? (
        <p className="mt-1 text-muted">No AI cost in the last {SPEND_HISTORY_DAYS} days.</p>
      ) : (
        <ul className="mt-1 max-h-40 overflow-y-auto divide-y divide-line">
          {spent.map((d) => (
            <li key={d.day} className="flex items-center justify-between gap-2 py-1 text-muted">
              <span>{new Date(`${d.day}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' })}</span>
              <span>published {rupees(d.publishedInr)} · preview {rupees(d.previewInr)} · {d.calls}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AppAiSettingsView({ view, busy, error, onToggle, history, historyOpen, historyFailed, onHistory }: {
  view: AppAiSettingsView | null; busy?: boolean; error?: string; onToggle?: (enabled: boolean) => void;
  history?: (SpendHistory & { known: boolean }) | null; historyOpen?: boolean; historyFailed?: boolean; onHistory?: () => void;
}) {
  if (!view || !view.available || !view.usesAi) return null;
  const rupees = (n: number) => `₹${n.toFixed(2)}`;
  return (
    <section className="mx-4 my-3 rounded border border-line bg-card p-3 text-xs" aria-label="AI in this app">
      <div className="flex items-center gap-2 text-sm text-ink">
        <Sparkles className="w-4 h-4 text-accent-text" aria-hidden />
        <span className="font-medium">AI in this app</span>
      </div>
      {view.ownKey ? (
        <p className="mt-2 text-body">
          Your app&rsquo;s assistant answers with <strong>{OWN_KEY_NAME[view.ownKey]}</strong>, on our server. Nothing is charged to your NavBharatAI balance, and the key never goes into the app&rsquo;s page.
        </p>
      ) : (
        <>
          <p className="mt-2 text-body">
            Your app&rsquo;s assistant runs on <strong>NavBharatAI&rsquo;s AI</strong>. Each answer is charged to your balance. No key is put in your app&rsquo;s page.
          </p>
          <label className="mt-3 flex items-center justify-between gap-3 text-body">
            <span>NavBharatAI AI for this app</span>
            <button
              type="button"
              role="switch"
              aria-checked={view.enabled}
              disabled={busy}
              onClick={() => onToggle?.(!view.enabled)}
              className={`px-3 py-1 rounded border touch-manipulation disabled:opacity-50 ${view.enabled ? 'border-line bg-raised text-success' : 'border-line bg-raised text-danger'}`}
            >
              {view.enabled ? 'On' : 'Off'}
            </button>
          </label>
          {!view.enabled && <p className="mt-1 text-muted">Switched off: your app&rsquo;s assistant is not answering in the preview or in the published app.</p>}
          <p className="mt-2 text-muted">
            Today: preview {rupees(view.previewSpentTodayInr)} of {rupees(view.previewCapInr)} · published app {rupees(view.publishedSpentTodayInr)}
          </p>
          {onHistory && (
            <button type="button" onClick={onHistory} className="mt-1 text-accent-text underline touch-manipulation" aria-expanded={!!historyOpen}>
              {historyOpen ? 'Hide' : 'Show'} the last {SPEND_HISTORY_DAYS} days
            </button>
          )}
          {historyOpen && <AppAiSpendHistory history={history ?? null} failed={!!historyFailed} />}
        </>
      )}
      <p className="mt-2 text-muted">
        {view.ownKey
          ? 'Delete that key below to go back to NavBharatAI’s AI.'
          : 'To use your own key instead, add OPENAI_API_KEY or ANTHROPIC_API_KEY below for this app. It is used on our server only.'}
      </p>
      {error && <p className="mt-2 text-danger">{error}</p>}
    </section>
  );
}

export function AppAiSettingsCard({ workspaceId, refreshKey, onSeen }: { workspaceId: string; refreshKey?: unknown; onSeen?: () => void }) {
  const [view, setView] = useState<AppAiSettingsView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<(SpendHistory & { known: boolean }) | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);

  // Read on request, not on every open of the sheet: thirty days is thirty documents.
  const onHistory = useCallback(() => {
    const opening = !historyOpen;
    setHistoryOpen(opening);
    if (opening && !history) {
      setHistoryFailed(false);
      void fetchAppAiSpend(workspaceId).then((h) => { setHistory(h); setHistoryFailed(!h); });
    }
  }, [workspaceId, history, historyOpen]);

  useEffect(() => {
    let cancelled = false;
    void fetchAppAiSettings(workspaceId).then((v) => {
      if (cancelled) return;
      setView(v);
      if (v?.usesAi) onSeen?.();
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, refreshKey]);

  const onToggle = useCallback(async (enabled: boolean) => {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/app-ai/settings', { method: 'POST', headers: await authJsonHeaders(), body: JSON.stringify({ workspaceId, enabled }) });
      if (!res.ok) { setError('Could not save that. Please try again.'); return; }
      setView((v) => (v ? { ...v, enabled } : v));
    } catch {
      setError('Could not save that. Please try again.');
    } finally {
      setBusy(false);
    }
  }, [workspaceId]);

  return <AppAiSettingsView view={view} busy={busy} error={error} onToggle={onToggle} history={history} historyOpen={historyOpen} historyFailed={historyFailed} onHistory={onHistory} />;
}
