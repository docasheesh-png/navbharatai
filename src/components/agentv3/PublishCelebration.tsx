// The moment a user's first app goes live.
//
// ADMIN 2026-08-21: "jab user ke pahli baar mitrify link milta hai — 2-3 second ke liye firework,
// aur website link + Open button, jisse user ko accha feel ho." Before this, a first-ever live link
// arrived as one line of grey text, identical to the fiftieth publish.
//
// THE DECISIONS LIVE IN src/lib/firstPublish.ts (pure, tested). This file is the surface, and it holds
// exactly four judgements of its own:
//
//   1. PORTALLED TO document.body, WITH AN EXPLICIT z-index. `position: fixed` stops being
//      viewport-relative the moment ANY ancestor has a transform/filter/backdrop-filter — and this
//      card is launched from inside the publish sheet, which is full of both. That is a bug this
//      codebase has already paid for once (the App Mart player), so it is not repeated here.
//   2. NO ANIMATION LIBRARY. A confetti package is a dependency, a bundle cost, and an update to
//      track, for something that is 30 lines of CSS. The particles are plain spans on a transparent
//      background — nothing to install, nothing to break.
//   3. THE PARTICLES ARE DECORATION, THE CARD IS THE CONTENT. They are aria-hidden and rendered
//      behind, so a screen reader hears the link and the buttons, not 24 dots. If the animation never
//      runs, the user has lost nothing that matters.
//   4. NO SOUND. Unasked-for audio is the fastest way to make a delightful moment hostile — at night,
//      in an office, on a bus.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Copy, Check, X, Share2 } from 'lucide-react';
import { FIREWORK_MS, prettyUrl, whatsappShareUrl, type CelebrationKind } from '../../lib/firstPublish';

/**
 * Above every other layer this app stacks.
 *
 * The publish sheet sits at z-60 and the global mobile nav at 150 (see WebAppPlayer, which had to
 * learn this). A celebration that appears BEHIND the sheet that launched it is worse than none.
 */
const CELEBRATION_Z = 300;

/** How many particles. Enough to read as a burst, few enough to stay smooth on a cheap phone. */
const PARTICLES = 24;

export interface PublishCelebrationProps {
  kind: CelebrationKind;
  url: string;
  /** The app's name, when known — it makes the share message personal. */
  appName?: string;
  /**
   * Is this the user's first-ever live link? Wording only.
   *
   * Since 2026-08-25 EVERY successful publish shows this screen, so the flag stopped deciding whether
   * the user sees their link and now decides only how it is introduced. The difference is worth
   * keeping: "your app is on the internet" is a moment the first time and a statement of the obvious
   * the tenth, and a product that says the same sentence every time stops being read.
   */
  firstPublish?: boolean;
  onClose: () => void;
}

export function PublishCelebration({ kind, url, appName, firstPublish = false, onClose }: PublishCelebrationProps) {
  const [showParticles, setShowParticles] = useState(kind === 'celebrate');
  const [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  // The fireworks are on a timer. THE CARD IS NOT — see rule 1 in firstPublish.ts. Taking a user's
  // first-ever link off the screen after three seconds, exactly when they want to send it to someone,
  // would be the single most annoying thing this feature could do.
  useEffect(() => {
    if (kind !== 'celebrate') return;
    const t = setTimeout(() => setShowParticles(false), FIREWORK_MS);
    return () => clearTimeout(t);
  }, [kind]);

  // Escape closes, and focus lands on the close button — this is a dialog, and a dialog you cannot
  // dismiss from the keyboard is a trap.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (kind === 'none') return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard refused (permission, insecure context). The link is visible and selectable on the
      // card, so the user is never stuck — but we do not claim a copy that did not happen.
      setCopied(false);
    }
  };

  const pending = kind === 'pending';

  return createPortal(
    <div
      className="nb-sheet-overlay fixed inset-0 flex items-center justify-center"
      style={{ zIndex: CELEBRATION_Z, background: 'rgba(2,6,12,0.72)' }}
      role="dialog"
      aria-modal="true"
      aria-label={pending ? 'Your app is being published' : 'Your app is live'}
      onClick={onClose}
    >
      {/* Particles: transparent, decorative, and BEHIND the card. */}
      {showParticles && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          {Array.from({ length: PARTICLES }).map((_, i) => {
            const angle = (360 / PARTICLES) * i;
            const delay = (i % 6) * 90;
            return (
              <span
                key={i}
                className="nb-spark"
                style={{
                  ['--nb-angle' as string]: `${angle}deg`,
                  ['--nb-delay' as string]: `${delay}ms`,
                  ['--nb-hue' as string]: `${(i * 37) % 360}`,
                }}
              />
            );
          })}
        </div>
      )}

      {/* This card had NO height cap and NO scroll at all (fixed 2026-08-23). Centred inside a
          `fixed inset-0` box that a mobile browser measures against its LARGE viewport, a card taller
          than the visible area overflowed off BOTH ends with nothing to scroll — so on a short phone
          the Open / Copy / Share row, the whole point of the screen, was simply not reachable.
          `nb-sheet` caps it to what is really visible and the card scrolls inside that. */}
      <div
        className="nb-sheet relative w-full max-w-md overflow-y-auto overscroll-contain rounded-3xl border border-white/10 bg-[#0d1117] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          ref={closeRef}
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 rounded-xl p-2 text-zinc-500 hover:bg-white/5 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="text-center">
          <div className="mx-auto mb-3 text-4xl" aria-hidden="true">{pending ? '🚀' : '🎉'}</div>
          <h2 className="text-xl font-black text-white">
            {pending ? 'Your app is on its way' : firstPublish ? 'Your app is live' : 'Update published'}
          </h2>
          <p className="mt-1 text-[12px] leading-relaxed text-zinc-400">
            {pending
              // HONESTY (rule 2): the publish succeeded, but the link did not answer when we checked.
              // Saying "live" here and handing over a link that shows an error would be the worst
              // possible first impression — so we say exactly what we know.
              ? 'It is published and the address below is yours. It can take a minute to answer the first time — try Open in a moment.'
              : firstPublish
                ? 'This is your app, on the internet, at your own address. Anyone you send it to can open it.'
                // A republish is not a lesser event, but it IS a different one: the address has not
                // changed and the person already knows what it is for. Say what actually changed.
                : 'Your latest changes are live at the same address. Anyone with the link sees them now.'}
          </p>
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-center">
          <span className="break-all text-sm font-bold text-emerald-300">{prettyUrl(url)}</span>
        </div>

        {/* Open · Copy · Share. SHARE IS NOT AN AFTERTHOUGHT: the first thing a person does with their
            first link is send it to someone, and on a phone a URL in a card cannot be selected by
            hand. WhatsApp is first among the share targets because that is where this actually goes. */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white hover:bg-emerald-500"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Open
          </a>
          <button
            onClick={copy}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 py-2.5 text-xs font-bold text-zinc-200 hover:bg-white/10"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <a
            href={whatsappShareUrl(url, appName)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 py-2.5 text-xs font-bold text-zinc-200 hover:bg-white/10"
          >
            <Share2 className="h-3.5 w-3.5" /> Share
          </a>
        </div>
      </div>

      {/* Scoped to this component. `nb-reduce-motion` is the class the app's own motion setting puts on
          <html>, so a user who chose reduced motion gets a still card even if this ever renders with
          particles — one setting, honoured in two independent places. */}
      <style>{`
        .nb-spark {
          position: absolute;
          left: 50%;
          top: 45%;
          width: 6px;
          height: 6px;
          border-radius: 9999px;
          background: hsl(var(--nb-hue) 90% 62%);
          box-shadow: 0 0 10px 2px hsl(var(--nb-hue) 90% 62% / 0.7);
          opacity: 0;
          animation: nb-burst 1.5s cubic-bezier(0.15, 0.7, 0.3, 1) var(--nb-delay) 2;
        }
        @keyframes nb-burst {
          0%   { opacity: 0; transform: rotate(var(--nb-angle)) translateY(0) scale(0.6); }
          12%  { opacity: 1; }
          100% { opacity: 0; transform: rotate(var(--nb-angle)) translateY(-42vmin) scale(0.9); }
        }
        .nb-reduce-motion .nb-spark { display: none; }
        @media (prefers-reduced-motion: reduce) { .nb-spark { display: none; } }
      `}</style>
    </div>,
    document.body,
  );
}

export default PublishCelebration;
