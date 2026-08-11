// The voice button — now on EVERY AI, and it asks before it costs anything.
//
// SCOPE SUPERSEDED 2026-08-10. This used to read "PROFESSIONAL chats ONLY … never NavBharatAI Free,
// never Pro v5.0 (admin 2026-07-14)". The admin replaced that instruction: "ek voice chat ka option
// hai SDA (doctor ai) me — usko bhi paid service bana kar SABHI ME laga do." The earlier restriction
// existed because voice cost NavBharatAI money and earned nothing; now that a call is metered and
// billed per second, the reason for keeping it in one corner is gone. Recording the supersession
// rather than quietly contradicting the old note.
//
// Renders NOTHING (takes zero space) unless voice is enabled on the server AND the user is signed in
// — the server enforces the same gate on the WS, plus an empty-wallet refusal before it dials.
//
// Tapping it opens a CONSENT CARD, not a call: a per-second charge that begins without the user
// agreeing to it is money taken silently, which is exactly the defect just fixed on the ₹1 build-file
// download. The price is stated in the user's own language before anything starts.

import { useEffect, useState, lazy, Suspense } from 'react';
import { Mic } from 'lucide-react';
import { auth } from '../../lib/firebase';
import type { SonicTurn } from './SonicChat';
import { voiceConsent, resolveVoiceLang } from '../../lib/voiceChatBilling';

/**
 * The call surface is LOADED ON DEMAND, and that is a correctness point, not a micro-optimisation.
 *
 * This button now sits on every AI including the free chat, and `SonicChat` drags in the whole audio
 * pipeline — mic capture, PCM resampling, playback scheduling, the waveform. Importing it eagerly put
 * all of that in the main bundle, so someone who only ever types a message downloaded a voice-call
 * engine to do it. CI caught it as a real budget breach (total JS 1300.1 KB against a 1300 KB budget),
 * and raising the budget would have hidden the regression rather than fixed it.
 *
 * It is only ever rendered after the user accepts the consent card, so a lazy import costs nothing:
 * by the time the chunk is needed, the user has already tapped twice.
 */
const SonicChat = lazy(() => import('./SonicChat').then((m) => ({ default: m.SonicChat })));

/** The user's own language for the consent card — read at render, so a change applies immediately. */
const voiceLang = () => resolveVoiceLang((k) => localStorage.getItem(k));

/**
 * `professionalId` = which professional this chat is (the server loads that professional's own
 * persona, so the Doctor voice IS the doctor — the client never sends a raw prompt).
 * `getHistory` = a live getter for the current text conversation, read at open time so voice
 * CONTINUES the chat from where the text left off (admin 2026-07-14).
 */
export function ProfessionalVoiceButton({ professionalId, getHistory, className, icon, title }: {
  professionalId?: string;
  getHistory?: () => SonicTurn[];
  /** Override the trigger button styling (e.g. the emerald SDA theme). */
  className?: string;
  /** Override the icon (defaults to a mic). */
  icon?: React.ReactNode;
  /** Accessible label / tooltip. */
  title?: string;
}) {
  const [enabled, setEnabled] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [open, setOpen] = useState(false);
  /** The consent card is shown BEFORE a call can start — see the button's onClick for why. */
  const [asking, setAsking] = useState(false);
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

  const consent = voiceConsent(voiceLang());

  return (
    <>
      <button
        // THE PRICE IS ASKED BEFORE THE CALL, NOT AFTER (admin 2026-08-10: "user ko dikhega voice chat
        // icon par click karne se — user ki language me ek popup aaye"). Tapping the mic no longer
        // opens a call; it opens the consent card. A per-second charge that starts without the user
        // agreeing to it would be money taken silently — the same defect we just fixed on the ₹1
        // build-file download.
        onClick={() => setAsking(true)}
        aria-label={title || 'Talk with voice'}
        title={title || 'Talk with voice'}
        className={className || 'w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-indigo-300 hover:text-indigo-200 flex items-center justify-center shrink-0'}
      >
        {icon || <Mic className="w-4 h-4" />}
      </button>

      {asking && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-5"
          onClick={() => setAsking(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-2xl bg-[#161b22] border border-white/10 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-indigo-500/15 text-indigo-300 flex items-center justify-center">
              <Mic className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-white text-center mb-2">{consent.title}</h3>
            <p className="text-sm text-[#8b949e] leading-relaxed mb-5">{consent.body}</p>
            <button
              onClick={() => { setAsking(false); setHistory(getHistory ? getHistory() : []); setOpen(true); }}
              className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold"
            >
              {consent.confirm}
            </button>
            <button
              onClick={() => setAsking(false)}
              className="mt-2 w-full py-2 rounded-xl bg-white/5 hover:bg-white/10 text-[#8b949e] text-sm font-semibold"
            >
              {consent.cancel}
            </button>
          </div>
        </div>
      )}

      {/* No fallback UI: the chunk arrives in a moment and the user has just tapped "start" on the
          consent card — a flash of a spinner would read as a second, unexplained loading step. */}
      {open && (
        <Suspense fallback={null}>
          <SonicChat onClose={() => setOpen(false)} professionalId={professionalId} history={history} />
        </Suspense>
      )}
    </>
  );
}
