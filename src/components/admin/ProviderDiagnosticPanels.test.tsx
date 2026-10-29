import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
const hooks = vi.hoisted(() => ({ values: [] as any[], cursor: 0, refs: [] as any[], refCursor: 0 }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: any) => { const n = hooks.cursor++; if (!(n in hooks.values)) hooks.values[n] = typeof initial === 'function' ? initial() : initial; return [hooks.values[n], (v: any) => { hooks.values[n] = typeof v === 'function' ? v(hooks.values[n]) : v; }]; },
  useRef: (initial: any) => { const n = hooks.refCursor++; return hooks.refs[n] ?? (hooks.refs[n] = { current: initial }); },
}));
import { ProviderDiagnosticPanels, ProviderDiagnosticBot, ProviderDiagnosticResult } from './ProviderDiagnosticPanels';
import { ADMIN_TABS } from '../../lib/adminTabs';
const id = '11111111-1111-4111-8111-111111111111';
const reset = () => { hooks.values = []; hooks.refs = []; hooks.cursor = 0; hooks.refCursor = 0; };
function render(component = 'bot', token = 'synthetic-admin') { hooks.cursor = 0; hooks.refCursor = 0; return component !== 'panels' ? ProviderDiagnosticBot({ provider: 'surplus', adminToken: token, ready: true }) : ProviderDiagnosticPanels({ adminToken: token }); }
function nodes(node: any): any[] { return Array.isArray(node) ? node.flatMap(nodes) : React.isValidElement(node) ? [node, ...nodes((node.props as any).children)] : []; }
const find = (tree: any, label: string) => nodes(tree).find(n => n.type === 'button' && (Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children) === label);
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
const response = (data: any, ok = true) => ({ ok, json: async () => data });
const result = { runId: id, provider: 'surplus' as const, model: 'test', startedAt: '2026-10-28T00:00:00Z', elapsedMs: 300,
  firstByteMs: null, firstTokenMs: null, outputTokensPerSecond: null, retryCount: 0 as const, text: '<script>literal provider reply</script>',
  usage: { inputTokens: 1, outputTokens: 2, cachedTokens: null }, supplierCost: { status: 'unavailable' as const }, walletCharge: { status: 'not_charged' as const }, accounting: 'unknown_liability' as const,
  timeline: [{ stage: 'response' as const, reason: 'rate_limited' as const, elapsedMs: 300, httpStatus: 429 }], provesBuilderHealth: false as const };
beforeEach(() => { reset(); const saved = new Map<string, string>(); vi.stubGlobal('sessionStorage', { getItem: (k: string) => saved.get(k), setItem: (k: string, v: string) => saved.set(k, v), removeItem: (k: string) => saved.delete(k) }); vi.stubGlobal('crypto', { randomUUID: () => id }); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => vi.unstubAllGlobals());
it('mounting panels or bots never performs any request', () => { render('panels'); reset(); render(); expect(fetch).not.toHaveBeenCalled(); });
it('excludes non-admin controls and hides bots until server verification', () => {
  expect(render('panels', '')).toBeNull(); reset(); expect(render('bot', '')).toBeNull(); reset();
  expect(nodes(render('panels')).filter(n => n.type === ProviderDiagnosticBot)).toHaveLength(0);
});
it('shows two separate blocked bots only after verified status', async () => {
  vi.mocked(fetch).mockResolvedValue(response({ dispatchReady: false }) as any);
  find(render('panels'), 'Verify admin and read test status').props.onClick(); await flush();
  const tree = render('panels'); const bots = nodes(tree).filter(n => n.type === ProviderDiagnosticBot);
  expect(bots.map(n => n.props.provider)).toEqual(['surplus', 'cheaperinference']); expect(bots.every(n => n.props.ready === false)).toBe(true);
  expect(renderToStaticMarkup(tree!)).toContain('Dispatch blocked'); expect(fetch).toHaveBeenCalledOnce();
});
it('hides bots on authentication failure without rendering raw server errors', async () => {
  vi.mocked(fetch).mockResolvedValue(response({ error: 'secret' }, false) as any);
  find(render('panels'), 'Verify admin and read test status').props.onClick(); await flush();
  const tree = render('panels'); expect(nodes(tree).filter(n => n.type === ProviderDiagnosticBot)).toHaveLength(0);
  expect(renderToStaticMarkup(tree!)).not.toContain('secret');
});
it('synchronous duplicate clicks issue one request and unknown liability blocks replacements', async () => {
  vi.mocked(fetch).mockResolvedValue(response(result) as any);
  nodes(render()).find(n => n.type === 'textarea').props.onChange({ target: { value: 'private prompt' } });
  const click = find(render(), 'Run surplus test').props.onClick; click(); click(); await flush();
  expect(fetch).toHaveBeenCalledOnce(); expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({ idempotencyKey: id, prompt: 'private prompt' });
  expect(find(render(), 'Run surplus test').props.disabled).toBe(true); expect(find(render(), 'Prepare another test').props.disabled).toBe(true);
});
it('remount recovers the same key with a GET and never retransmits the prompt', async () => {
  vi.mocked(fetch).mockRejectedValue(new Error('secret'));
  nodes(render()).find(n => n.type === 'textarea').props.onChange({ target: { value: 'private prompt' } }); find(render(), 'Run surplus test').props.onClick(); await flush(); reset();
  const tree = render(); expect(find(tree, 'Run surplus test').props.disabled).toBe(true);
  vi.mocked(fetch).mockResolvedValue(response({ run: { runId: id, provider: 'surplus', state: 'unknown_liability', actualCostNanoUsd: null } }) as any);
  find(tree, 'Recover original run').props.onClick(); await flush();
  const [url, options] = vi.mocked(fetch).mock.calls[1]; expect(url).toContain(`/runs/${id}`); expect(options?.method).toBe('GET'); expect(options?.body).toBeUndefined();
  expect(renderToStaticMarkup(render()!)).toContain('Actual cost unavailable'); expect(fetch).toHaveBeenCalledTimes(2);
});
it('failed recovery preserves key and prevents a new call', async () => {
  sessionStorage.setItem('admin-diagnostic-pair-20261028:surplus', id); vi.mocked(fetch).mockResolvedValue(response({}, false) as any);
  find(render(), 'Recover original run').props.onClick(); await flush(); expect(find(render(), 'Run surplus test').props.disabled).toBe(true);
});
it('renders cost, safe error evidence and escaped text without invented speed', () => {
  const html = renderToStaticMarkup(<ProviderDiagnosticResult result={result} />);
  for (const text of ['Actual cost unavailable', 'HTTP 429', 'rate_limited', 'Unknown / not measured', '300 ms', 'User wallet', 'Sanitized diagnostic timeline']) expect(html).toContain(text);
  expect(html).not.toContain('<script>'); expect(html).not.toContain('$0');
});
it('keeps exact provider-reported cost separate from wallet charge', () => {
  const html = renderToStaticMarkup(<ProviderDiagnosticResult result={{ ...result, supplierCost: { status: 'reported', amount: '0.000001', currency: 'USD' } }} />);
  expect(html).toContain('0.000001 USD'); expect(html).toContain('Not charged by this test');
});
it('registers admin navigation and keeps the existing admin-only dashboard gate', () => {
  expect(ADMIN_TABS.find(t => t.id === 'engines')?.pages.some(p => p.id === 'provider-diagnostics')).toBe(true);
  const dashboard = readFileSync('src/components/AdminDashboard.tsx', 'utf8'); expect(dashboard).toContain("activeTab === 'provider-diagnostics'");
  const panel = readFileSync('src/components/panels/AdminLoginPanel.tsx', 'utf8'); expect(panel).toContain('!isAdmin'); expect(panel).toContain('<AdminDashboard');
});
it.each([false, true])('recovery permits another test only when settled without overrun (%s)', async overrun => {
  sessionStorage.setItem('admin-diagnostic-pair-20261028:surplus', id);
  vi.mocked(fetch).mockResolvedValue(response({ run: { runId: id, provider: 'surplus', state: 'settled', actualCostNanoUsd: overrun ? 20 : 5, reservedNanoUsd: 10 } }) as any);
  find(render(), 'Recover original run').props.onClick(); await flush();
  expect(find(render(), 'Prepare another test').props.disabled).toBe(overrun);
});

it('manual tests allow editable prompts with provider defaults and another test after settlement', async () => {
  let tree = render('pair');
  expect(fetch).not.toHaveBeenCalled();
  const textarea = nodes(tree).find(n => n.type === 'textarea');
  expect(textarea.props.readOnly).not.toBe(true);
  textarea.props.onChange({ target: { value: 'Custom request' } });
  tree = render('pair');
  vi.mocked(fetch).mockResolvedValue(response({ ...result, accounting: 'settled' }) as any);
  find(tree, 'Run surplus test').props.onClick(); await flush(); tree = render('pair');
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toMatchObject({ prompt: 'Custom request' });
  expect(find(tree, 'Prepare another test').props.disabled).toBe(false);
  find(tree, 'Prepare another test').props.onClick();
  expect(sessionStorage.getItem('admin-diagnostic-pair-20261028:surplus')).toBeFalsy();
});
it('pair manually retries only the same admission key after an unavailable outcome', async () => {
  sessionStorage.setItem('admin-diagnostic-pair-20261028:surplus', id);
  vi.mocked(fetch).mockResolvedValue(response({ ...result, replayed: true }) as any);
  const tree = render('pair'); find(tree, 'Retry original admission with same key').props.onClick(); await flush();
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).idempotencyKey).toBe(id);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('remount retries the exact original prompt with the same key', async () => {
  nodes(render()).find(n => n.type === 'textarea').props.onChange({ target: { value: 'Original custom prompt' } });
  vi.mocked(fetch).mockRejectedValue(new Error('lost acknowledgement'));
  find(render(), 'Run surplus test').props.onClick(); await flush();
  const submitted = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
  reset();
  vi.mocked(fetch).mockResolvedValue(response({ ...result, replayed: true }) as any);
  find(render(), 'Retry original admission with same key').props.onClick(); await flush();
  expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string)).toEqual(submitted);
});

it('manual revision-checked toggles do not dispatch or enable the other provider', async () => {
  const off = { enabled: false, revision: 0, dispatchReady: false, reason: 'diagnostics_disabled', missingFields: [] };
  vi.mocked(fetch).mockResolvedValue(response({ dispatchReady: false, providers: { surplus: off, cheaperinference: off } }) as any);
  find(render('panels'), 'Verify admin and read test status').props.onClick(); await flush();
  vi.mocked(fetch).mockResolvedValue(response({ provider: 'surplus', enabled: true, revision: 1 }) as any);
  const click = find(render('panels'), 'Enable surplus diagnostics').props.onClick; click(); click(); await flush();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(vi.mocked(fetch).mock.calls[1][0]).toContain('/surplus/control');
  expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string)).toEqual({ enabled: true, expectedRevision: 0 });
  const tree = render('panels');
  expect(find(tree, 'Disable surplus diagnostics').props.disabled).toBe(false);
  expect(find(tree, 'Enable cheaperinference diagnostics').props.disabled).toBe(false);
  expect(nodes(tree).filter(n => n.type === ProviderDiagnosticBot).every(n => n.props.ready === false)).toBe(true);
});
it('allows disable even when an enabled provider fails preflight and does not claim success on error', async () => {
  const state = { enabled: true, revision: 3, dispatchReady: false, reason: 'config_missing', missingFields: [] };
  vi.mocked(fetch).mockResolvedValue(response({ dispatchReady: false, providers: { surplus: state, cheaperinference: { ...state, enabled: false } } }) as any);
  find(render('panels'), 'Verify admin and read test status').props.onClick(); await flush();
  expect(find(render('panels'), 'Disable surplus diagnostics').props.disabled).toBe(false);
  vi.mocked(fetch).mockRejectedValue(new Error('unconfirmed'));
  find(render('panels'), 'Disable surplus diagnostics').props.onClick(); await flush();
  expect(nodes(render('panels')).filter(n => n.type === ProviderDiagnosticBot)).toHaveLength(0);
});

it('completed unknown supplier cost allows a new explicit manual test without inventing a receipt', async () => {
  vi.mocked(fetch).mockResolvedValue(response({ ...result, completedAt: 1234 }) as any);
  find(render(), 'Run surplus test').props.onClick(); await flush();
  expect(find(render(), 'Prepare another test').props.disabled).toBe(false);
  expect(renderToStaticMarkup(render()!)).toContain('Actual cost unavailable');
});

it('preserves the explicit output bound of a pre-upgrade pending submission on retry', async () => {
  sessionStorage.setItem('admin-diagnostic-pair-20261028:surplus', JSON.stringify({ id, prompt: 'Original', maxOutputTokens: 10000 }));
  vi.mocked(fetch).mockResolvedValue(response({ ...result, replayed: true }) as any);
  find(render(), 'Retry original admission with same key').props.onClick(); await flush();
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({ idempotencyKey: id, prompt: 'Original', maxOutputTokens: 10000 });
});
