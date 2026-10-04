// "AI in this app" — the owner's control over their app's built-in assistant (Keys & Secrets sheet).
//
// Admin 2026-10-04: the owner must be told their app's AI runs on NavBharatAI and is charged to their
// balance, must be able to switch it off whenever they like, and may use their own key instead. This card
// shows exactly that, from `GET /api/app-ai/settings`. It never shows a key — only which engine answers.
import { useCallback, useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { authJsonHeaders } from '../../lib/authHeaders';

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

const OWN_KEY_NAME = { openai: 'your OpenAI key', anthropic: 'your Anthropic key' } as const;

export function AppAiSettingsView({ view, busy, error, onToggle }: { view: AppAiSettingsView | null; busy?: boolean; error?: string; onToggle?: (enabled: boolean) => void }) {
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

  return <AppAiSettingsView view={view} busy={busy} error={error} onToggle={onToggle} />;
}
