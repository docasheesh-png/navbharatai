/**
 * Admin 2026-11-04: "on/off button kam nahi kar raha hai. off ho hi nahi raha!!" — the confirm form opened below
 * all 22 rows (off-screen on a phone) and its button was disabled until a reason was typed, silently.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProviderSwitchesBody } from './ProviderSwitchesPanel';
import { switchReasonProblem, type ProviderSwitchesView } from '../../lib/providerSwitchesView';

const data: ProviderSwitchesView = {
  revision: 3, updatedAt: 1, syncMs: 10_000, thisInstance: { at: 1, ok: true, enforcingOff: [] },
  providers: [
    { id: 'surplus', name: 'Surplus', on: true, hasKey: true },
    { id: 'kimi', name: 'Kimi / Moonshot', on: true, hasKey: true },
    { id: 'requesty', name: 'Requesty', on: true, hasKey: false },
  ],
  history: [],
};
const noop = () => {};
const render = (over: Partial<Parameters<typeof ProviderSwitchesBody>[0]> = {}) => renderToStaticMarkup(
  <ProviderSwitchesBody data={data} error={null} pending={null} reason="" saving={false} saveError={null} done={null}
    onToggle={noop} onReason={noop} onConfirm={noop} onCancel={noop} {...over} />);

describe('🔴 the confirm form opens where the switch was tapped', () => {
  it('inside the Kimi row — before the next provider’s row, not after the whole list', () => {
    const html = render({ pending: { id: 'kimi', on: false } });
    const kimiRow = html.indexOf('data-testid="provider-switch-kimi"');
    const form = html.indexOf('data-testid="provider-switch-confirm-kimi"');
    const nextRow = html.indexOf('data-testid="provider-switch-requesty"');
    expect(kimiRow).toBeGreaterThan(-1);
    expect(form).toBeGreaterThan(kimiRow);
    expect(form).toBeLessThan(nextRow);
    expect(html.match(/provider-switch-confirm-/g)?.length).toBe(1);
  });
  it('🔴 the Turn off button is never silently disabled for a missing reason', () => {
    const html = render({ pending: { id: 'kimi', on: false }, reason: '' });
    const submit = html.slice(html.indexOf('data-testid="provider-switch-submit"') - 200, html.indexOf('data-testid="provider-switch-submit"') + 200);
    expect(submit).not.toMatch(/disabled=""/);
    expect(html).toContain('Turn off');
  });
  it('a missing reason is said in words', () => {
    expect(switchReasonProblem('')).toMatch(/Type a reason first/);
    expect(switchReasonProblem('  ab ')).toMatch(/Type a reason first/);
    expect(switchReasonProblem('balance finished')).toBeNull();
    expect(switchReasonProblem('x'.repeat(301))).toMatch(/too long/);
    const html = render({ pending: { id: 'kimi', on: false }, saveError: switchReasonProblem('') });
    expect(html).toContain('Type a reason first');
  });
  it('a successful change is confirmed on screen', () => {
    expect(render({ done: 'Kimi / Moonshot is now OFF.' })).toContain('Kimi / Moonshot is now OFF.');
  });
});
