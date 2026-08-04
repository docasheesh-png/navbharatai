import React, { useState } from 'react';
import { Download, X, Sparkles } from 'lucide-react';
import { useAppUpdateNotice } from '../lib/appUpdateNotice';
import { updateNoticeFor } from '../lib/updateNoticeI18n';
import { TirangaLoader } from './ui/TirangaLoader';

/**
 * The "app update available" chat notice (admin 2026-07-20). Rendered as the FIRST message at the
 * top of any AI chat thread once the user has started chatting inside the installed mobile app AND
 * the admin has published a newer version to Play / App Store. It looks like a NavBharatAI message
 * bubble, speaks the language the user is typing (`userText`), and its button deep-links straight to
 * the store. Dismiss it (Update or ✕) and it hides across every AI for the session — the rest of the
 * chat stays completely normal ("bas 1st message update ka aaye").
 *
 * Renders nothing on web or on an up-to-date install (the hook returns show=false), so it adds zero
 * surface unless there is genuinely an update to offer.
 */
export function AppUpdateChatNotice({ userText }: { userText?: string }) {
  const { show, dismiss, openStore } = useAppUpdateNotice();
  const [busy, setBusy] = useState(false);
  if (!show) return null;

  const t = updateNoticeFor(userText);

  const onUpdate = async (): Promise<void> => {
    setBusy(true);
    try {
      await openStore();
    } finally {
      setBusy(false);
      dismiss();
    }
  };

  return (
    <div className="flex items-start gap-2.5" role="status" aria-live="polite">
      <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shrink-0 ring-1 ring-white/10">
        <Sparkles className="w-4 h-4 text-white" />
      </div>
      <div className="relative max-w-[85%] rounded-2xl rounded-tl-sm bg-[#161b22] border border-indigo-500/25 px-4 py-3 shadow-lg">
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="absolute top-2 right-2 text-[#586069] hover:text-white transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
        <p className="text-sm text-[#c9d1d9] leading-relaxed pr-4">{t.body}</p>
        <button
          onClick={onUpdate}
          disabled={busy}
          className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-black uppercase tracking-widest transition-colors active:scale-95"
        >
          {busy ? <TirangaLoader className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
          {t.button}
        </button>
      </div>
    </div>
  );
}
