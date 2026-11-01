import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Execute the real callbacks and responses; only the hook scheduler is replaced for this node suite.
const hooks = vi.hoisted(() => ({ values: [] as any[], cursor: 0, effects: [] as (() => void)[] }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: any) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (value: any) => { hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value; }];
  },
  useRef: (initial: any) => {
    const index = hooks.cursor++;
    return hooks.values[index] ??= { current: initial };
  },
  useCallback: (fn: any) => fn,
  useEffect: (fn: () => void) => { hooks.effects.push(fn); },
}));
vi.mock('./PublishToNavStore', () => ({ PublishToNavStore: () => null }));
vi.mock('../../lib/downloadFile', async (original) => ({
  ...await original<typeof import('../../lib/downloadFile')>(), deliverFile: vi.fn(async () => 'downloaded'),
}));
import { deliverFile } from '../../lib/downloadFile';
import { MyBuiltApps } from './MyBuiltApps';

const app = { id: 'saved-app', owner: 'owner', repo: 'app', workflow: 'android-apk.yml', runId: '1', appName: 'My app', createdAt: 0 };
const artifact = { id: 10, name: 'release-aab', sizeBytes: 100 };
let run: any;
let artifacts: any[];
let download: () => Promise<Response>;
let fetcher: ReturnType<typeof vi.fn>;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function render() {
  hooks.cursor = 0;
  return MyBuiltApps({ ghHeaders: async () => ({ 'x-github-token': 'test' }) });
}
function buttons(node: unknown): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!isValidElement(node)) return [];
  const element = node as ReactElement;
  return [...(element.type === 'button' ? [element] : []), ...buttons(element.props.children)];
}
function button(tree: unknown, label: string) {
  const found = buttons(tree).find((item) => item.props['aria-label'] === label || renderToStaticMarkup(item).includes(label));
  expect(found, `Missing button: ${label}`).toBeDefined();
  return found!;
}
async function mount() {
  render();
  for (const effect of hooks.effects.splice(0)) effect();
  await flush();
  return render();
}
async function open() {
  button(await mount(), 'My app').props.onClick();
  await flush();
  return render();
}

beforeEach(() => {
  hooks.values = []; hooks.cursor = 0; hooks.effects = [];
  vi.mocked(deliverFile).mockClear().mockResolvedValue('downloaded');
  run = { id: 1, status: 'completed', conclusion: 'success' };
  artifacts = [artifact];
  download = async () => new Response(new Uint8Array([0x50, 0x4b, 3, 4, 1]), { headers: { 'content-disposition': 'attachment; filename="app-release.aab"' } });
  fetcher = vi.fn(async (url: string) => {
    if (url === '/api/mobile-ship/my-apps') return json({ apps: [app] });
    if (url.includes('/runs?')) return json({ runs: [run] });
    if (url.includes('/artifacts?')) return json({ artifacts });
    if (url.includes('/download?')) return download();
    throw new Error(`Unexpected request ${url}`);
  });
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => vi.unstubAllGlobals());

describe('saved APK builds remain recoverable', () => {
  it('never reaches the charging artifact endpoint for a failed run', async () => {
    run.conclusion = 'failure';
    expect(renderToStaticMarkup(await open())).toContain('This build did not finish');
    expect(fetcher.mock.calls.some(([url]) => url.includes('/artifacts?'))).toBe(false);
  });

  it('refreshes a previously building row when the user checks again', async () => {
    run.status = 'in_progress'; run.conclusion = null;
    const tree = await open();
    expect(renderToStaticMarkup(tree)).toContain('Still building');
    run = { id: 1, status: 'completed', conclusion: 'success' };
    button(tree, 'Check build again').props.onClick();
    await flush();
    expect(renderToStaticMarkup(render())).toContain('Download release-aab');
  });

  it('does not invent expiry when the finished build has no published file yet', async () => {
    artifacts = [];
    const tree = await open();
    expect(renderToStaticMarkup(tree)).toContain('not available yet');
    expect(renderToStaticMarkup(tree)).not.toContain('this one has passed that');
    artifacts = [artifact];
    button(tree, 'Check build again').props.onClick();
    await flush();
    expect(renderToStaticMarkup(render())).toContain('Download release-aab');
  });

  it('saves an AAB under its actual name instead of silently renaming it as APK', async () => {
    button(await open(), 'Download release-aab').props.onClick();
    await flush();
    expect(deliverFile).toHaveBeenCalledWith('app-release.aab', expect.any(Blob));
  });

  it('shows download rejection rather than making the button do nothing', async () => {
    download = async () => json({ error: 'The file expired; build a fresh copy.' }, 404);
    button(await open(), 'Download release-aab').props.onClick();
    await flush();
    const html = renderToStaticMarkup(render());
    expect(html).toContain('role="alert"');
    expect(html).toContain('The file expired');
    expect(deliverFile).not.toHaveBeenCalled();
  });

  it('reports a device-save failure after a successful download', async () => {
    vi.mocked(deliverFile).mockResolvedValue('failed');
    button(await open(), 'Download release-aab').props.onClick();
    await flush();
    expect(renderToStaticMarkup(render())).toContain('Could not save app-release.aab');
  });

  it('keeps the app list visible when refresh hits a temporary connection failure', async () => {
    const tree = await mount();
    fetcher.mockRejectedValueOnce(new Error('Offline'));
    button(tree, 'Refresh list').props.onClick();
    await flush();
    const html = renderToStaticMarkup(render());
    expect(html).toContain('My app');
    expect(html).toContain('Check your connection');
  });

  it('does not invent an empty app list from a malformed success response', async () => {
    const tree = await mount();
    fetcher.mockResolvedValueOnce(json({}));
    button(tree, 'Refresh list').props.onClick();
    await flush();
    const html = renderToStaticMarkup(render());
    expect(html).toContain('My app');
    expect(html).toContain('Could not load your apps');
  });

  it('ignores an older status response after a newer explicit refresh succeeds', async () => {
    let resolveOld!: (response: Response) => void;
    const tree = await mount();
    fetcher.mockImplementationOnce(async () => new Promise<Response>((resolve) => { resolveOld = resolve; }));
    button(tree, 'My app').props.onClick();
    await flush();
    button(render(), 'Refresh list').props.onClick();
    await flush();
    expect(renderToStaticMarkup(render())).toContain('Download release-aab');
    resolveOld(json({ runs: [{ id: 1, status: 'completed', conclusion: 'failure' }] }));
    await flush();
    expect(renderToStaticMarkup(render())).toContain('Download release-aab');
  });
});
