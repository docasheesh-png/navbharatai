import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FeatureConfirmCard } from './FeatureConfirmCard';

const plan = { show: true, named: ['search', 'login / authentication'], suggested: ['payments + refunds'], domain: 'ecommerce' };

describe('FeatureConfirmCard', () => {
  const html = renderToStaticMarkup(<FeatureConfirmCard plan={plan} onBuild={() => {}} onCancel={() => {}} />);

  it('shows both lists, under honest headings', () => {
    expect(html).toContain('From your message');
    expect(html).toContain('Usually needed in an app like this');
    for (const l of [...plan.named, ...plan.suggested]) expect(html).toContain(l);
  });

  it('every item starts ticked, and every checkbox has a label a screen reader can read', () => {
    expect((html.match(/type="checkbox"[^>]*checked=""/g) || []).length).toBe(3);
    const ids = [...html.matchAll(/<input id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(3);
    for (const id of ids) expect(html).toContain(`for="${id}"`);
  });

  it('Build is the first action; the "don\'t ask again" option is there', () => {
    expect(html.indexOf('>Build<')).toBeLessThan(html.indexOf('>Cancel<'));
    expect(html).toContain('Don&#x27;t ask again');
  });

  it('a list with no suggestions has no empty heading', () => {
    const only = renderToStaticMarkup(<FeatureConfirmCard plan={{ ...plan, suggested: [] }} onBuild={() => {}} onCancel={() => {}} />);
    expect(only).not.toContain('Usually needed');
  });
});
