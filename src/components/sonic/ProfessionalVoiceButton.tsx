// Compact voice-mode button for the PROFESSIONAL chats ONLY (admin 2026-07-14: voice lives
// inside professionals — never NavBharatAI Free, never Pro v3.0). Sits in the professional
// chat input row next to Send; opens the full-screen NavBharatAI Voice surface. Renders
// NOTHING (takes zero space) unless voice is enabled on the server AND the user is signed in
// (voice is a paid, logged-in-only feature — the server enforces the same gate on the WS).

import { useEffect, useState } from 'react';
import { Mic } from 'lucide-react';
import { auth } from '../../lib/firebase';
import { SonicChat, type SonicTurn } from './SonicChat';

/**
 * `professionalId` = which professional this chat is (the server loads that professional's own
 * persona, so the Doctor voice IS the doctor — the client never sends a raw prompt).
 * `getHistory` = a live getter for the current text conversation, read at open time so voice
 * CONTINUES the chat from where the text left off (admin 2026-07-14).
 */
export function ProfessionalVoiceButton({ professionalId, getHistory }: { professionalId?: string; getHistory?: () => SonicTurn[] }) {
  const [enabled, setEnabled] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<SonicTurn[]>([]);

  useEffect(() => {
    let alive = true;
    fetch('/api/sonic/status')
      .then((r) => r.json())
      .then((d) => { if (alive) setEnabled(!!d?.enabled); })
      .catch(() => { if (alive) setEnabled(false); });
    const unsub = auth.onAuthStateChanged((u) => setSignedIn(!!u));
    return () => { alive = false; unsub(); };
  }, []);

  if (!enabled || !signedIn) return null;

  return (
    <>
      <button
        onClick={() => { setHistory(getHistory ? getHistory() : []); setOpen(true); }}
        aria-label="Talk with voice"
        title="Talk with voice"
        className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-indigo-300 hover:text-indigo-200 flex items-center justify-center shrink-0"
      >
        <Mic className="w-4 h-4" />
      </button>
      {open && <SonicChat onClose={() => setOpen(false)} professionalId={professionalId} history={history} />}
    </>
  );
}
