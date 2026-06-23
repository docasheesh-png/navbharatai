import { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';

/**
 * AgentV3Launcher — the floating entry point to the v3.0 builder.
 *
 * It asks the server (/api/agentv3/status) whether AgentV3 is enabled for this
 * user. Disabled (the default, non-allowlisted users) → renders NOTHING, so the
 * live app is unchanged. Enabled → a small floating button OPENS v3.0 as a real
 * header tab/view (via onOpen → toggleTab('engine_builder')), NOT a separate
 * overlay — so it shows in the header like every other view, persists across
 * tab-switches, and resumes from History through the one shared surface.
 */
export function AgentV3Launcher({ userId, email, onOpen }: { userId?: string; email?: string; onOpen: () => void }) {
  const [enabled, setEnabled] = useState(false);

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
    <button
      onClick={onOpen}
      title="Open NavBharatAI Pro v3.0"
      className="fixed bottom-5 right-5 z-[60] flex items-center gap-2 px-4 py-2.5 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/40"
    >
      <Bot className="w-4 h-4" />
      <span className="text-sm font-medium">v3.0</span>
    </button>
  );
}
