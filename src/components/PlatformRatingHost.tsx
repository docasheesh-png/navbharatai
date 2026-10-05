/**
 * RATE NAVBHARATAI — the one listener and the card (admin 2026-10-05: "rating system banao! jab bhi user
 * ki app badhiya bane, user usko deploy kare successfully, tabhi rating ka notification aa jaye! jis user
 * ne rating nahi kari hai, uske liye!!").
 *
 * Mounted ONCE at the app root. It waits for `RATING_MOMENT_EVENT` (raised only after a publish that went
 * live — see src/lib/platformRating.ts), asks the server whether THIS user may be asked, and only then
 * shows the card. A user who has rated is never asked again; "Not now", the close button, Escape and a tap
 * outside all record a pause on the server, so the next publish does not ask straight away.
 *
 * Every rating is saved in `platform_ratings` and read by the admin on Admin → User Reports → Ratings. A
 * rating that could not be saved says so and keeps the card open — it never thanks the user for nothing.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Star, X } from 'lucide-react';
import { authJsonHeaders } from '../lib/authHeaders';
import { writeFailure } from '../lib/serverAnswer';
import { nativePlatformName } from '../lib/mobileNative';
import {
  RATING_MOMENT_EVENT, RATING_COMMENT_MAX, readRatingStatus, offeredThisSession, markOfferedThisSession,
  starLabel, commentPrompt,
} from '../lib/platformRating';

/** Above the publish celebration (300) and the global tab bar, so nothing covers the card. */
const RATING_Z = 310;

function ratingPlatform(): 'web' | 'android' | 'ios' {
  const p = nativePlatformName();
  return p === 'android' || p === 'ios' ? p : 'web';
}

export function RateNavBharatCard({ onDone }: { onDone: () => void }): React.ReactElement {
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [thanked, setThanked] = useState(false);
  const firstStarRef = useRef<HTMLButtonElement>(null);
  const closedRef = useRef(false);
  // The parent's callback is read through a ref, so a parent re-render can never re-run anything here
  // (tests/aParentRenderIsNotAReload.test.ts).
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  useEffect(() => { firstStarRef.current?.focus(); }, []);

  // Closing without rating is a "Not now": the server starts the pause. The answer is read, but the card
  // closes either way — the person asked to close it. A pause that was not saved only means a LATER
  // session may ask again after the next live publish (this session never will: offeredThisSession);
  // it can never make a user who rated be asked, because that is decided from the rating itself.
  const notNow = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    void (async () => {
      try {
        const res = await fetch('/api/platform-rating/dismiss', { method: 'POST', headers: await authJsonHeaders(), body: '{}' });
        const failed = await writeFailure(res, 'pause not saved');
        if (failed) console.warn('[rating] "Not now" was not saved:', failed);
      } catch { /* offline: same outcome as an unsaved pause, see above */ }
    })();
    onDoneRef.current();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !thanked) notNow(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [notNow, thanked]);

  useEffect(() => {
    if (!thanked) return;
    const t = window.setTimeout(() => { closedRef.current = true; onDoneRef.current(); }, 1600);
    return () => window.clearTimeout(t);
  }, [thanked]);

  const submit = async () => {
    if (!stars || saving) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/platform-rating', {
        method: 'POST',
        headers: await authJsonHeaders(),
        body: JSON.stringify({ stars, comment: comment.trim(), platform: ratingPlatform() }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: unknown; error?: unknown } | null;
      if (res.ok && body?.ok === true) {
        setThanked(true);
      } else {
        setError(typeof body?.error === 'string' && body.error ? body.error : 'Your rating could not be saved. Please try again.');
      }
    } catch {
      setError('Could not reach NavBharatAI. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const shown = hover || stars;

  return createPortal(
    <div
      className="nb-sheet-overlay nb-sheet-over-nav fixed inset-0 flex items-end justify-center bg-scrim sm:items-center sm:p-4"
      style={{ zIndex: RATING_Z }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="nb-rate-title"
      onClick={() => { if (!thanked) notNow(); }}
    >
      <div
        className="nb-sheet relative w-full max-w-md overflow-y-auto overscroll-contain rounded-3xl border border-line bg-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {!thanked && (
          <button
            onClick={notNow}
            aria-label="Close"
            className="absolute right-3 top-3 rounded-xl p-2 text-faint hover:bg-raised hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        {thanked ? (
          <div className="py-6 text-center" role="status">
            <div className="flex justify-center gap-1 text-warn" aria-hidden="true">
              {[1, 2, 3, 4, 5].map((n) => <Star key={n} className="h-6 w-6" fill={n <= stars ? 'currentColor' : 'none'} />)}
            </div>
            <p className="mt-3 text-base font-bold text-ink">Thank you for rating NavBharatAI!</p>
            <p className="mt-1 text-sm text-muted">Your rating helps us make it better for everyone.</p>
          </div>
        ) : (
          <>
            <h2 id="nb-rate-title" className="pr-8 text-lg font-bold text-ink">Your app is live! How was building it with NavBharatAI?</h2>
            <p className="mt-1 text-sm text-muted">Your rating helps us make NavBharatAI better for everyone.</p>

            <div className="mt-5 flex justify-center gap-2" role="radiogroup" aria-label="Rating" onMouseLeave={() => setHover(0)}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  ref={n === 1 ? firstStarRef : undefined}
                  role="radio"
                  aria-checked={stars === n}
                  aria-label={`${n} star${n > 1 ? 's' : ''} — ${starLabel(n)}`}
                  onClick={() => { setStars(n); setError(''); }}
                  onMouseEnter={() => setHover(n)}
                  className={`rounded-xl p-1.5 transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${n <= shown ? 'text-warn' : 'text-faint'}`}
                >
                  <Star className="h-9 w-9" fill={n <= shown ? 'currentColor' : 'none'} />
                </button>
              ))}
            </div>
            <p className="mt-1 h-5 text-center text-sm font-semibold text-body" aria-live="polite">{starLabel(shown)}</p>

            {stars > 0 && (
              <div className="mt-3">
                <label htmlFor="nb-rate-comment" className="text-xs font-semibold text-muted">{commentPrompt(stars)}</label>
                <textarea
                  id="nb-rate-comment"
                  value={comment}
                  maxLength={RATING_COMMENT_MAX}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  className="mt-1 w-full resize-none rounded-xl border border-line bg-card p-3 text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent"
                  placeholder="Write a few words…"
                />
              </div>
            )}

            {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={notNow}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-muted hover:bg-raised hover:text-ink"
              >
                Not now
              </button>
              <button
                onClick={() => void submit()}
                disabled={!stars || saving}
                className="rounded-xl bg-accent px-4 py-2 text-sm font-bold text-on-accent disabled:opacity-40"
              >
                {saving ? 'Saving…' : 'Submit rating'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

export const PlatformRatingHost: React.FC = () => {
  const [open, setOpen] = useState(false);
  const checkingRef = useRef(false);

  useEffect(() => {
    const onMoment = () => {
      if (checkingRef.current || offeredThisSession()) return;
      checkingRef.current = true;
      void (async () => {
        try {
          const res = await fetch('/api/platform-rating/status', { headers: await authJsonHeaders() });
          const status = res.ok ? readRatingStatus(await res.json().catch(() => null)) : null;
          if (status?.ask) {
            markOfferedThisSession();
            setOpen(true);
          }
        } catch { /* no answer → no card; asking a user who already rated would be worse */ }
        finally { checkingRef.current = false; }
      })();
    };
    window.addEventListener(RATING_MOMENT_EVENT, onMoment);
    return () => window.removeEventListener(RATING_MOMENT_EVENT, onMoment);
  }, []);

  const close = useCallback(() => setOpen(false), []);
  return open ? <RateNavBharatCard onDone={close} /> : null;
};
