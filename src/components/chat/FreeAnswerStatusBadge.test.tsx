import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FreeAnswerStatusBadge } from './FreeAnswerStatusBadge';
const state = vi.hoisted(() => ({ value: null as any, hook: vi.fn() }));
vi.mock('../../hooks/useFreeAnswerStatus', () => ({ useFreeAnswerStatus: (active: boolean) => { state.hook(active); return state.value; } }));
describe('shared Free daily badge', () => {
  it('shows genuine remaining, consumed and pending amounts without promising paid access', () => {
    state.value = { limit: 20, remaining: 18, used: 1, reserved: 1, inProgress: true };
    const html = renderToStaticMarkup(<FreeAnswerStatusBadge />);
    for (const text of ['Shared Free daily ceiling', '18/20 remaining', '1 in progress', '1 used', '12:00 AM IST']) expect(html).toContain(text);
    expect(html).not.toContain('button');
  });
  it('does not invent a fresh daily count while unavailable', () => {
    state.value = null;
    const html = renderToStaticMarkup(<FreeAnswerStatusBadge active={false} />);
    expect(html).toContain('Status unavailable'); expect(html).not.toContain('20');
    expect(state.hook).toHaveBeenLastCalledWith(false);
  });
});

it.each([[47, 50], [8, 10], [0, 20], [0, 0]])('compact counter shows %s/%s from entitlement without a banner', (remaining, limit) => {
  state.value = { limit, remaining, used: limit - remaining, reserved: 0, inProgress: false };
  const html = renderToStaticMarkup(<FreeAnswerStatusBadge compact />);
  expect(html).toContain(`>${remaining}/${limit}</button>`);
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain('aria-haspopup="dialog"');
  expect(html).not.toContain('Shared Free daily ceiling:');
  expect(html).not.toContain('role="dialog"');
});
it('compact unavailable state never invents a quota', () => {
  state.value = null;
  const html = renderToStaticMarkup(<FreeAnswerStatusBadge compact />);
  expect(html).toContain('—/—');
  expect(html).toContain('Status unavailable');
  expect(html).not.toContain('/50');
});
