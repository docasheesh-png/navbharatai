import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// Execute the component's real fetch/effect/state transitions without a browser or a network.
// The small hook harness only schedules the initial effect; JSX still uses React's real renderer.
const hooks = vi.hoisted(() => ({ values: [] as any[], cursor: 0, effects: [] as (() => void)[] }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: any) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (value: any) => { hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value; }];
  },
  useCallback: (fn: any) => fn,
  useMemo: (fn: () => unknown) => fn(),
  useEffect: (fn: () => void) => { hooks.effects.push(fn); },
}));
vi.mock('./AppPreviewSheet', () => ({ useAppPreview: () => ({ openPreview: vi.fn(), previewSheet: null }) }));
vi.mock('lucide-react', () => Object.fromEntries(['Eye', 'Globe', 'Search', 'ExternalLink', 'Ban', 'RotateCcw'].map(name => [name, () => null])));
vi.mock('./WorkspaceBuildReports', () => ({ WorkspaceBuildReports: () => null }));
import { UserBuiltApps } from './UserBuiltApps';
import { BuiltAppsPanel } from './BuiltAppsPanel';
let panel = false;

function render() {
  hooks.cursor = 0;
  return renderToStaticMarkup(panel
    ? BuiltAppsPanel({ headers: { 'x-admin-token': 'test' }, openAccount: vi.fn(), toast: vi.fn(), onModerate: vi.fn(), moderated: null })
    : UserBuiltApps({ uid: 'u'.repeat(28), headers: { 'x-admin-token': 'test' } }));
}
async function load(answer: unknown, ok = true, reject = false) {
  const fetch = vi.fn(async () => { if (reject) throw new Error('network failure'); return { ok, json: async () => answer }; });
  vi.stubGlobal('fetch', fetch);
  const first = render();
  if (!panel) expect(first).toContain('Loading apps');
  const effects = hooks.effects.splice(0);
  for (const effect of effects) effect();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  return { html: render(), fetch };
}
beforeEach(() => { panel = false; hooks.values = []; hooks.cursor = 0; hooks.effects = []; });
afterEach(() => vi.unstubAllGlobals());

describe('profile apps show read failures, not invented absence', () => {
  it('renders the server failure and never an empty-success sentence', async () => {
    const { html, fetch } = await load({ ok: false, error: 'Could not read this user’s saved apps.' }, false);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Could not read');
    expect(html).not.toContain('No saved apps');
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/apps?q='), { headers: { 'x-admin-token': 'test' } });
  });
  it.each([null, { ok: true, mode: 'all', rows: [] }, { ok: false, mode: 'owner', rows: [] }])('rejects malformed or wrong-mode success %j', async (body) => {
    const { html } = await load(body);
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('No saved apps');
  });
  it('shows a rejected fetch as failure', async () => {
    expect((await load(null, false, true)).html).toContain('role="alert"');
  });
  it('states successful emptiness only as no saved apps, not never built', async () => {
    const { html } = await load({ ok: true, mode: 'owner', rows: [], scanLimited: false });
    expect(html).toContain('No saved apps were found for this user.');
    expect(html).not.toContain('has not built');
  });
  it('an all-filtered bounded scan is explicitly partial, not an empty account', async () => {
    const { html } = await load({ ok: true, mode: 'owner', rows: [], scanLimited: true });
    expect(html).toContain('first 200 saved workspace records');
    expect(html).toContain('More apps may exist');
    expect(html).toContain('No apps were found in the checked records');
    expect(html).not.toContain('No saved apps were found for this user');
  });
});

describe('the existing Apps owner-list sibling', () => {
  it('shows failure rather than a fabricated no-apps list', async () => {
    panel = true;
    const { html } = await load({ ok: false, error: 'Could not read this user’s saved apps.' }, false);
    expect(html).toContain('Could not read');
    expect(html).not.toContain('No built apps yet');
  });
  it('shows the bounded-scan notice even when all checked records were filtered out', async () => {
    panel = true;
    const { html } = await load({ ok: true, mode: 'owner', rows: [], scanLimited: true });
    expect(html).toContain('first 200 saved workspace records');
    expect(html).toContain('No apps were found in the checked records');
  });
});
