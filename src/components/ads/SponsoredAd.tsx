// What a person sees of an admin house ad: a small "Sponsored" banner, or a tile that sits between App Mart's
// app tiles (admin 2026-10-20).
//
// THREE RULES THIS FILE HOLDS, because the screens that use it cannot:
//   1. IT IS NEVER AN OVERLAY. A banner is an ordinary block in the page flow, below the content it follows —
//      never positioned over it, never a popup, never full screen. The admin ruled out full-screen ads.
//   2. IT SAYS WHAT IT IS. Every ad carries a visible "Sponsored" label. An advertisement that looked like
//      content would be the one dishonest thing an ad can be.
//   3. IT DRAWS NOTHING WHEN ANYTHING IS WRONG. No ad, a paid account, a failed read, or a picture that will not
//      load — each renders `null`, so there is never an empty frame or a broken-image box on a screen. And with
//      no link the card is plain text and a picture: there is no button that goes nowhere.

import { useState, type ReactNode } from 'react';
import { resolveApiHref } from '../../lib/apiBase';
import type { HouseAdPlacement, ServedHouseAd } from '../../lib/houseAds';
import { useHouseAd } from './useHouseAd';

function SponsoredLabel() {
  return (
    <span className="self-start px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wide bg-raised text-muted border border-line">
      Sponsored
    </span>
  );
}

/** The picture, hiding the WHOLE ad (via `onBroken`) if it cannot be shown — never a broken-image box. */
function AdPicture({ ad, onBroken }: { ad: ServedHouseAd; onBroken: () => void }) {
  return (
    <img
      // The admin's live preview hands in the picture it just cropped (a data: URL); a served ad hands in a server path.
      src={ad.imageUrl.startsWith('data:') ? ad.imageUrl : resolveApiHref(ad.imageUrl, window)}
      alt=""
      width={1200}
      height={300}
      loading="lazy"
      decoding="async"
      onError={onBroken}
      className="block w-full aspect-[4/1] object-cover bg-raised"
    />
  );
}

/** Link wrapper when the ad has a link; a plain block when it has none. */
function AdFrame({ ad, className, children }: { ad: ServedHouseAd; className: string; children: ReactNode }) {
  if (!ad.linkUrl) return <div className={className}>{children}</div>;
  return (
    <a href={ad.linkUrl} target="_blank" rel="noopener noreferrer sponsored" className={className}>
      {children}
    </a>
  );
}

/** One small banner, below whatever it follows. `ad` may be passed in (the admin preview); otherwise it is fetched. */
export function SponsoredBanner({ placement, ad: given, className = '' }: { placement: HouseAdPlacement; ad?: ServedHouseAd | null; className?: string }) {
  const fetched = useHouseAd(placement, given === undefined);
  const ad = given === undefined ? fetched : given;
  const [broken, setBroken] = useState(false);
  if (!ad || broken) return null;
  return (
    <aside aria-label="Sponsored" className={`w-full max-w-xl mx-auto ${className}`}>
      <AdFrame ad={ad} className="block rounded-xl border border-line bg-card overflow-hidden hover:border-accent transition-colors">
        <AdPicture ad={ad} onBroken={() => setBroken(true)} />
        <div className="flex flex-col gap-1 px-3 py-2.5">
          <SponsoredLabel />
          <p className="text-sm font-semibold text-ink leading-snug line-clamp-1">{ad.name}</p>
          <p className="text-xs text-muted leading-snug line-clamp-2">{ad.description}</p>
        </div>
      </AdFrame>
    </aside>
  );
}

/** The App Mart tile: same card shape as the app tiles around it, so it sits in the grid as one more cell. */
export function SponsoredTile({ ad }: { ad: ServedHouseAd }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return (
    <aside aria-label="Sponsored" className="flex flex-col rounded-xl bg-card border border-line overflow-hidden">
      <AdPicture ad={ad} onBroken={() => setBroken(true)} />
      <div className="flex flex-col gap-1.5 p-3 flex-1 min-w-0">
        <SponsoredLabel />
        <p className="text-sm font-semibold text-ink leading-snug line-clamp-2">{ad.name}</p>
        <p className="text-[11px] text-faint leading-tight line-clamp-3">{ad.description}</p>
      </div>
      {ad.linkUrl && (
        <a
          href={ad.linkUrl}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="m-3 mt-0 flex items-center justify-center px-3 py-2 rounded-lg bg-accent hover:opacity-90 text-on-accent text-xs font-bold transition-opacity"
        >
          Learn more
        </a>
      )}
    </aside>
  );
}
