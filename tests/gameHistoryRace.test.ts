import { beforeEach, describe, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ cells: [] as any[], at: 0 }));
vi.mock('react', () => ({
  useCallback: (fn: any) => fn,
  useEffect: () => {},
  useRef: (value: any) => { const i = hooks.at++; return hooks.cells[i] ??= { current: value }; },
  useState: (initial: any) => {
    const i = hooks.at++;
    if (!(i in hooks.cells)) hooks.cells[i] = typeof initial === 'function' ? initial() : initial;
    return [hooks.cells[i], (next: any) => { hooks.cells[i] = typeof next === 'function' ? next(hooks.cells[i]) : next; }];
  },
}));
vi.mock('../src/lib/firebase', () => ({ auth: { currentUser: null } }));
vi.mock('../src/lib/authHeaders', () => ({ authedHeaders: async () => ({}), authJsonHeaders: async () => ({ 'Content-Type': 'application/json' }), signInRefusalMessage: (m: string) => m }));
import { useAgentV3Build } from '../src/hooks/useAgentV3Build';
const render = (owner = 'alice') => { hooks.at = 0; return useAgentV3Build(owner); };
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise<any>(r => { resolve = r; }); return { resolve, promise }; };
const response = (workspaceId: string) => ({ ok: true, status: 200, json: async () => ({ conversation: { workspaceId, messages: [], framework: 'vite-react' } }) });
beforeEach(() => { hooks.cells = []; hooks.at = 0; vi.unstubAllGlobals(); });
describe('actual hook history promises do not overwrite newer scope', () => {
  it('reset while response waits preserves the new empty project', async () => {
    const wait = deferred(); const fetch = vi.fn(() => wait.promise); vi.stubGlobal('fetch', fetch);
    const hook = render(); const load = hook.loadConversation({ id: 'old', userId: 'alice' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    hook.reset(); wait.resolve(response('old-workspace'));
    expect(await load).toBeNull(); expect(render().state.workspaceId).toBeUndefined();
  });
  it('second requested history wins even if the older request resolves first', async () => {
    const first = deferred(), second = deferred();
    const fetch = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', fetch); const hook = render();
    const a = hook.loadConversation({ id: 'a', userId: 'alice' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const b = hook.loadConversation({ id: 'b', userId: 'alice' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    first.resolve(response('workspace-a')); expect(await a).toBeNull();
    expect(render().state.workspaceId).toBeUndefined();
    second.resolve(response('workspace-b')); expect((await b)?.workspaceId).toBe('workspace-b');
  });
  it('account change invalidates an outstanding old owner response, even after switching back', async () => {
    const wait = deferred(); const fetch = vi.fn(() => wait.promise); vi.stubGlobal('fetch', fetch);
    const load = render().loadConversation({ id: 'old', userId: 'alice' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    render('bob'); render('alice'); wait.resolve(response('alice-old'));
    expect(await load).toBeNull(); expect(render().state.workspaceId).toBeUndefined();
  });
});
