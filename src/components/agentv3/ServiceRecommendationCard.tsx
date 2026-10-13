/**
 * Go-live PR 13 — the inline chat card: "this app needs X" with one Buy or Connect button per item.
 * Presentational only: the buttons call the handlers the chat passes in (Buy → wallet intent deep
 * link, Connect → BYO connect flow). Renders nothing for an empty list, so with
 * AGENTV3_SERVICE_RECO off (no events) the chat is unchanged.
 */
import type { ServiceRecommendationItem } from './agentV3Types';

export interface ServiceRecommendationCardProps {
  items: ServiceRecommendationItem[];
  onBuy: (skuId: string) => void;
  onConnect: (skuId: string) => void;
}

export function ServiceRecommendationCard({ items, onBuy, onConnect }: ServiceRecommendationCardProps) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm" data-testid="service-reco-card">
      <div className="mb-2 font-medium">Your app needs these to run</div>
      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.skuId} className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">{it.name} <span className="opacity-70">· {it.priceLabel}</span></div>
              <div className="opacity-70">{it.reason}</div>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-md bg-orange-500 px-3 py-1 text-white hover:bg-orange-600"
              onClick={() => (it.kind === 'buy' ? onBuy(it.skuId) : onConnect(it.skuId))}
            >
              {it.kind === 'buy' ? 'Buy' : 'Connect'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Where Buy goes: the wallet page's intent deep link (PR 14). */
export function buyIntentHref(skuId: string): string {
  return `/wallet?intent=buy&sku=${encodeURIComponent(skuId)}`;
}
