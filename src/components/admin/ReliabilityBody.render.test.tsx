/** Owner improvement #4: the page shows the rate with its 95% interval and its real denominator. */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReliabilityBody } from './TrafficControlPanel';
import { isSloView, sloText, type SloView } from '../../lib/trafficControlView';

const slo: SloView = {
  slo: [{ surface: 'free', days: 7, eligible: 1000, successes: 996, refused: 3, cancelled: 2, rate: 0.996, ci95: { low: 0.9898, high: 0.9984 }, target: 0.995 }],
  recentFailures: [{ atMs: 1, surface: 'free', path: 'legacy', outcome: 'failed', failure: 'unavailable', provider: 'NONE', model: 'none', attempts: 4 }],
  sink: { enabled: true, buffered: 0, dropped: 0 },
};

describe('reliability card', () => {
  it('shows rate, interval, denominator and the target verdict', () => {
    const html = renderToStaticMarkup(<ReliabilityBody slo={slo} error={null} />);
    expect(html).toContain('99.60% (95%: 98.98%–99.84%) of 1,000 eligible requests');
    expect(html).toContain('target 99.5% met');
    expect(html).toContain('not from a sample');
  });
  it('says plainly when nothing is counted yet, and checks the server body', () => {
    expect(renderToStaticMarkup(<ReliabilityBody slo={{ ...slo, slo: [], recentFailures: [] }} error={null} />)).toContain('No requests counted yet');
    expect(sloText({ ...slo.slo[0], eligible: 0, rate: null })).toBe('No eligible requests yet.');
    expect(isSloView({ slo: 'x' })).toBe(false);
  });
});
