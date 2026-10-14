import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ServiceRecommendationCard, buyIntentHref } from './ServiceRecommendationCard';
import { agentV3Reducer } from './agentV3Reducer';
import { initialAgentV3State } from './agentV3Types';
import { skuById, skuOffered } from '../../lib/catalogue';
import { serviceRecommendationEvent } from '../../server/analyzer/serviceRecommendation';

const snap = { paths: ['server.ts'], packageJson: JSON.stringify({ dependencies: { express: '4', pg: '8' } }) };
const noop = () => {};

describe('service recommendation (PR 13)', () => {
  it('flag off (the default) ⇒ no event at all', () => {
    expect(serviceRecommendationEvent(snap, {})).toBeNull();
  });
  it('flag on ⇒ only offered SKUs, the free Connect option, no provider names', () => {
    const ev = serviceRecommendationEvent(snap, { AGENTV3_SERVICE_RECO: '1' }, () => 7)!;
    expect(ev.ts).toBe(7);
    for (const r of ev.recommendations) expect(skuOffered(skuById(r.skuId), { AGENTV3_SERVICE_RECO: '1' })).toBe(true);
    expect(ev.recommendations.find((r) => r.kind === 'connect')?.priceLabel).toBe('No charge from us');
    expect(JSON.stringify(ev)).not.toMatch(/cloudrun|gcp|supabase-platform|nbai-/i);
  });
  it('a static app gets no card', () => {
    expect(serviceRecommendationEvent({ paths: ['index.html'] }, { AGENTV3_SERVICE_RECO: '1' })).toBeNull();
  });
  it('the reducer keeps the latest list; initial state is empty', () => {
    const s0 = initialAgentV3State();
    expect(s0.serviceRecommendations).toEqual([]);
    const ev = serviceRecommendationEvent(snap, { AGENTV3_SERVICE_RECO: '1' })!;
    expect(agentV3Reducer(s0, ev).serviceRecommendations).toEqual(ev.recommendations);
  });
  it('the card renders a Buy/Connect button per item and nothing when empty', () => {
    const items = [
      { skuId: 'addon.server', kind: 'buy' as const, name: 'Server', priceLabel: '₹1', reason: 'r' },
      { skuId: 'byo.supabase', kind: 'connect' as const, name: 'Own DB', priceLabel: 'No charge from us', reason: 'r' },
    ];
    const html = renderToStaticMarkup(<ServiceRecommendationCard items={items} onBuy={noop} onConnect={noop} />);
    expect(html).toContain('>Buy<');
    expect(html).toContain('>Connect<');
    expect(renderToStaticMarkup(<ServiceRecommendationCard items={[]} onBuy={noop} onConnect={noop} />)).toBe('');
    expect(buyIntentHref('addon.server')).toBe('/wallet?intent=buy&sku=addon.server');
  });
});
