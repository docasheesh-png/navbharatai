import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ value: null as any, effect: null as null | (() => (() => void) | void), authChange: null as null | (() => void), user: { uid: 'a' } as { uid: string } | null }));
vi.mock('react', () => ({ useState: () => [state.value, (value: any) => { state.value = value; }], useEffect: (effect: any) => { state.effect = effect; } }));
vi.mock('../lib/firebase', () => ({ auth: { get currentUser() { return state.user; }, onAuthStateChanged: (fn: () => void) => { state.authChange = fn; return vi.fn(); } } }));
vi.mock('../lib/authHeaders', () => ({ authHeader: async () => ({ Authorization: `Bearer ${state.user?.uid ?? 'guest'}` }) }));
import { useFreeAnswerStatus } from './useFreeAnswerStatus';
import { FREE_ANSWER_CHANGED } from '../lib/freeAnswerStatus';
const START = 1_800_000_000_000;
const status = (remaining = 20) => ({ limit: 20, used: 20 - remaining, reserved: 0, remaining, inProgress: false, resetsAt: START + 2000, day: '2027-01-15' });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
let cleanup: (() => void) | void;
let doc: EventTarget & { visibilityState: string };
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(START); state.value = null; state.user = { uid: 'a' };
  vi.stubGlobal('window', new EventTarget()); doc = Object.assign(new EventTarget(), { visibilityState: 'visible' }); vi.stubGlobal('document', doc);
  fetcher = vi.fn(async () => ({ ok: true, json: async () => status() })); vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { if (typeof cleanup === 'function') cleanup(); cleanup = undefined; vi.unstubAllGlobals(); vi.useRealTimers(); });
async function mount(active = true) { useFreeAnswerStatus(active); cleanup = state.effect?.(); await flush(); }
describe('daily status browser lifecycle', () => {
  it('refreshes at midnight and focus, and uses authenticated no-store reads', async () => {
    await mount(); expect(state.value.remaining).toBe(20);
    expect(fetcher).toHaveBeenCalledWith('/api/free-answers/status', { headers: { Authorization: 'Bearer a' }, cache: 'no-store' });
    await vi.advanceTimersByTimeAsync(2100); expect(fetcher).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event('focus')); await flush(); expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('refreshes after submission and settlement invalidation, without trusting a local count', async () => {
    await mount(); fetcher.mockResolvedValue({ ok: true, json: async () => ({ ...status(19), used: 0, reserved: 1, inProgress: true }) });
    window.dispatchEvent(new Event(FREE_ANSWER_CHANGED)); await flush(); expect(state.value).toMatchObject({ remaining: 19, reserved: 1 });
    await vi.advanceTimersByTimeAsync(1000); expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('does not poll hidden or off-screen panes, and refreshes on visibility restoration', async () => {
    await mount(false); expect(fetcher).not.toHaveBeenCalled();
    await mount(); doc.visibilityState = 'hidden'; await vi.advanceTimersByTimeAsync(30_000); expect(fetcher).toHaveBeenCalledTimes(1);
    doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange')); await flush(); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('clears previous account state immediately and ignores responses after unmount', async () => {
    await mount(); let finish!: (value: unknown) => void;
    fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    state.user = { uid: 'b' }; state.authChange?.(); expect(state.value).toBeNull(); await flush();
    if (typeof cleanup === 'function') cleanup(); cleanup = undefined;
    finish({ ok: true, json: async () => status(3) }); await flush(); expect(state.value).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
