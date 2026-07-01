import { useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { AgentV3Panel } from './AgentV3Panel';
import type { FilesPanelProps } from '../panels/FilesPanel';

type V3Resume = { sessionId: string; messages: Array<{ role: 'user' | 'agent'; text: string; ts: number }>; nonce: number } | null;

/**
 * NavBharatAI Pro v3.0 surface — the single Pro builder, replacing the retired Pro v2.0.
 *
 * v3.0 is rolled out per-account (AGENTV3_ENABLED + allowlist). This wrapper asks the server
 * whether v3.0 is enabled for THIS user (the same /api/agentv3/status probe the launcher uses):
 *  • enabled  → the real v3.0 builder (AgentV3Panel).
 *  • not yet  → an honest "rolling out" message (NEVER a broken/empty builder, so the app never
 *    looks broken for a user who isn't on the v3.0 batch yet).
 */
export function ProV3Surface({ userId, email, resume, freshOpenNonce, onFilesSync, onBeforeBuild, onOpenInIDE, onPreviewState, pendingFix, filesPanel }: { userId?: string; email?: string; resume?: V3Resume; freshOpenNonce?: number; onFilesSync?: (files: Record<string, string>) => void; onBeforeBuild?: () => Promise<void>; onOpenInIDE?: (path: string) => void; onPreviewState?: (s: { previewUrl?: string; workspaceId?: string; framework?: string; running?: boolean }) => void; pendingFix?: { text: string; nonce: number } | null; filesPanel?: FilesPanelProps }) {
  const [state, setState] = useState<'loading' | 'enabled' | 'disabled'>('loading');

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (userId) params.set('userId', userId);
    if (email) params.set('email', email);
    const qs = params.toString() ? `?${params.toString()}` : '';
    fetch(`/api/agentv3/status${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) setState(j && j.enabled ? 'enabled' : 'disabled'); })
      .catch(() => { if (!cancelled) setState('disabled'); });
    return () => { cancelled = true; };
  }, [userId, email]);

  if (state === 'loading') {
    return (
      <div className="h-full flex items-center justify-center text-zinc-500">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  if (state === 'enabled') {
    return <AgentV3Panel userId={userId} email={email} resume={resume} freshOpenNonce={freshOpenNonce} onFilesSync={onFilesSync} onBeforeBuild={onBeforeBuild} onOpenInIDE={onOpenInIDE} onPreviewState={onPreviewState} pendingFix={pendingFix} filesPanel={filesPanel} />;
  }

  return (
    <div className="h-full flex flex-col items-center justify-center p-8 text-center gap-4 bg-zinc-950 text-zinc-100">
      <div className="w-14 h-14 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
        <Sparkles className="w-7 h-7 text-indigo-400" />
      </div>
      <h2 className="text-lg font-bold">NavBharatAI Pro v3.0</h2>
      <p className="max-w-sm text-sm text-zinc-400 leading-relaxed">
        Pro v3.0 — the new agentic app builder — is rolling out to accounts in batches. It will appear
        here automatically as soon as it's enabled for your account.
      </p>
    </div>
  );
}
