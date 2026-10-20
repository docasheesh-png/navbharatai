import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// A small hook harness exercises the actual consent loader and click handlers without a DOM.
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, effects: [] as Array<() => unknown> }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState(initial: unknown) {
    const index = hooks.index++;
    if (!(index in hooks.state)) hooks.state[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.state[index], (value: unknown) => { hooks.state[index] = value; }];
  },
  useEffect(effect: () => unknown) { hooks.effects.push(effect); },
}));
vi.mock('../src/lib/adminFetch', () => ({ adminHeaders: () => ({ 'x-admin-token': 'test-only' }) }));
import { FailedReportOAuthConsent } from '../src/components/admin/FailedReportOAuthConsent';

const read = 'failed-reports:read';
const dual = `${read} failed-reports:autopsy`;
const fetchMock = vi.fn();
const assign = vi.fn();
const render = () => { hooks.index = 0; return FailedReportOAuthConsent({ token: 'test-only' }); };
function buttons(node: ReactNode): React.ReactElement<{ children?: ReactNode; onClick?: () => void }>[] {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!React.isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) return [];
  return [...(node.type === 'button' ? [node] : []), ...buttons(node.props.children)];
}
async function load(body: unknown, ok = true) {
  fetchMock.mockResolvedValueOnce({ ok, json: async () => body });
  render(); hooks.effects.shift()!();
  await vi.waitFor(() => expect(hooks.state[1] !== null || hooks.state[2] !== '').toBe(true));
  return render();
}
beforeEach(() => {
  hooks.state = []; hooks.index = 0; hooks.effects = [];
  fetchMock.mockReset(); assign.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('window', { location: { search: '?oauth_request=review-id', assign } });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('OAuth consent tells the truth about the requested permission', () => {
  it('read-only consent does not claim to grant writes', async () => {
    const tree = await load({ clientName: 'Read client', redirectUri: 'https://client.example/callback', scope: read });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('requests read-only access');
    expect(html).toContain('private user build data');
    expect(html).toContain('Approve read-only access');
    expect(html).not.toContain('Approve report reads and autopsy writes');
    expect(html).not.toContain('Autopsy write access allows');
  });

  it('dual consent explains separate metadata writes and excluded powers, then submits exactly that scope', async () => {
    const tree = await load({ clientName: 'Review client', redirectUri: 'https://client.example/callback', scope: dual });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('permission to update their separate autopsy metadata');
    expect(html).toContain('review status, root-cause findings, fix and test evidence, and completion notes');
    expect(html).toContain('cannot change or delete the original reports');
    expect(html).toContain('modify application or engine code');
    expect(html).toContain('manage administrator settings or connections');
    expect(html).toContain('Approve report reads and autopsy writes');
    expect(html).not.toContain('Approve read-only access');
    expect(html).toContain('30 days');
    expect(html).toContain('revoke it below');
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ redirect: 'https://client.example/callback?code=accepted' }) });
    buttons(tree)[0].props.onClick!();
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('https://client.example/callback?code=accepted'));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ approve: true, scope: dual });
    expect(fetchMock.mock.calls[1][1].headers['x-admin-token']).toBe('test-only');
  });

  it('denial is explicit and never calls the approval branch', async () => {
    const tree = await load({ clientName: 'Review client', redirectUri: 'https://client.example/callback', scope: dual });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ redirect: 'https://client.example/callback?error=access_denied' }) });
    buttons(tree)[1].props.onClick!();
    await vi.waitFor(() => expect(assign).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ approve: false, scope: dual });
  });

  it.each([undefined, null, '', 'admin', 'failed-reports:autopsy', [read], `${read} unknown`])('unknown/missing scope %j never becomes read-only consent', async scope => {
    const tree = await load({ clientName: 'Unknown client', redirectUri: 'https://client.example/callback', scope });
    expect(renderToStaticMarkup(tree)).toContain('Unreadable connection permissions');
    expect(buttons(tree)).toHaveLength(0);
  });

  it('an HTTP error body cannot become consent even when shaped like a success', async () => {
    const tree = await load({ clientName: 'Review client', redirectUri: 'https://client.example/callback', scope: dual }, false);
    expect(renderToStaticMarkup(tree)).toContain('Connection request or admin sign-in expired');
    expect(buttons(tree)).toHaveLength(0);
  });

  it('server-side rendering does not invent a pending connection', () => {
    vi.stubGlobal('window', undefined);
    expect(renderToStaticMarkup(render())).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
