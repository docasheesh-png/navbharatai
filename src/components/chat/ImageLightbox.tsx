// ONE IMAGE LIGHTBOX — the free chat and Doctor AI used to carry a copy each.
//
// 🔴 WHY THIS FILE EXISTS (admin 2026-09-22: "navbharatai me bahut se popup hai, jo crop ho rahe hai
// header se ya footer se"). The two copies had already drifted — one faded in, one did not — and they
// shared one bug that mattered: the close button sat at `-top-3 -right-3`, i.e. 12px ABOVE the card's
// top edge. The card was capped at `max-h-[92dvh]`, so on a tall image its top landed ~34px down a
// 852px screen, and the ✕ landed ~22px down — inside a 47–59px notch. The one control that closes the
// lightbox was the one thing you could not reach.
//
// 🔑 WHAT CHANGED, and the two edits that looked obvious and were wrong:
//
//  1. The sheet contract (index.css): `nb-sheet-overlay` reserves the notch and the home indicator,
//     and `nb-sheet-over-nav` because z-200 paints ABOVE the tab bar, so it must not hold a strip for
//     a bar it covers. `nb-sheet` caps the card at the room that is really left.
//     ⚠️ The old `p-4` is gone: a padding utility beats the overlay class on source order and zeroes
//     every reserve (the bug that was live in NavAppStore's two sheets).
//
//  2. The close button moved INSIDE the card (`top-2 right-2`). Anything hanging outside the card's
//     box is outside the reserve too, so it can still land in the notch whatever the overlay does.
//
//  ⚠️ NOT `h-full` on the card — that was the obvious way to give the image a definite height to
//     shrink into, and a regression: the card would fill the screen, so tapping the empty space around
//     a SMALL image would hit the card (which stops propagation) instead of the backdrop, and the
//     lightbox could no longer be dismissed that way. The card stays content-sized; `nb-sheet` gives it
//     a max-height, and a flex item with `min-h-0` shrinks to fit that — the same mechanism verified on
//     ComponentLibrary's preview.
//
//  3. Portalled to the body, SSR-safely: a sheet that carries the contract must be out of reach of an
//     ancestor's transform or blur (tests/theSheetOpensOverTheScreenNotInsideAFooter.test.ts).

import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export interface LightboxImage { src: string; name: string }

export function ImageLightbox({ image, onClose }: { image: LightboxImage | null; onClose: () => void }) {
  if (!image) return null;
  const sheet = (
    <div
      className="nb-sheet-overlay nb-sheet-over-nav fixed inset-0 z-[200] bg-scrim flex items-center justify-center animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div className="nb-sheet relative max-w-full flex flex-col items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <img
          src={image.src}
          alt={image.name}
          className="min-h-0 max-w-full rounded-2xl shadow-2xl object-contain"
        />
        <p className="shrink-0 text-[10px] text-muted font-mono truncate max-w-full">{image.name}</p>
        <button
          onClick={onClose}
          aria-label="Close image"
          className="absolute top-2 right-2 w-8 h-8 bg-raised hover:bg-raised-hover rounded-full flex items-center justify-center text-ink transition-colors border border-line"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
  // No document ⇒ nothing to portal into (a server render), so render in place.
  return typeof document === 'undefined' ? sheet : createPortal(sheet, document.body);
}
