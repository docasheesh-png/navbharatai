import { useEffect, useState } from 'react';
import { Bot, X } from 'lucide-react';
import { AgentV3Panel } from './AgentV3Panel';

/**
 * AgentV3Launcher — the single, low-risk entry point that surfaces the v3.0
 * builder inside the app without touching the existing navigation.
 *
 * It asks the server (/api/agentv3/status) whether AgentV3 is enabled for this
 * user. Disabled (the default, and for every non-allowlisted user) → it renders
 * NOTHING, so the live app is completely unchanged. Enabled (admin-only now, all
 * logged-in users at GA — D8) → a small floating button opens the full v3.0
 * builder as an overlay. Server-authoritative gating; self-hiding.
 */
export function AgentV3Launcher({ userId, email }: { userId?: string; email?: string }) {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (userId) params.set('userId', userId);
    if (email) params.set('email', email);
    const qs = params.toString() ? `?${params.toString()}` : '';
    fetch(`/api/agentv3/status${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j && typeof j.enabled === 'boolean') setEnabled(j.enabled);
      })
      .catch(() => {
        /* status probe is best-effort; stay hidden on failure */
      });
    return () => {
      cancelled = true;
    };
  }, [userId, email]);

  if (!enabled) return null;

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title="Open NavBharatAI Pro v3.0 (beta)"
          className="fixed bottom-5 right-5 z-[60] flex items-center gap-2 px-4 py-2.5 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/40"
        >
          <Bot className="w-4 h-4" />
          <span className="text-sm font-medium">v3.0</span>
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-[70] bg-black/70 flex flex-col h-[100dvh] max-h-[100dvh]">
          <div className="shrink-0 flex items-center justify-between px-4 py-2 bg-zinc-900 border-b border-zinc-800">
            <span className="text-sm text-zinc-300">NavBharatAI Pro v3.0 — builder (beta)</span>
            <button
              onClick={() => setOpen(false)}
              className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <AgentV3Panel userId={userId} email={email} />
          </div>
        </div>
      )}
    </>
  );
}
