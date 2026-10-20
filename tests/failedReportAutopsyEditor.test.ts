import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FailedReportAutopsyInput, FailedReportAutopsyRecord, FailedReportAutopsyView } from '../src/lib/failedReportAutopsy';

// Execute the real component's event handlers and asynchronous effects. Preserve hook identity,
// callback dependencies, effect cleanup and refs so concurrency tests cannot pass on fake remounts.
const hooks = vi.hoisted(() => ({ slots: [] as any[], index: 0, effects: [] as Array<() => void>, writes: 0 }));
vi.mock('react', async original => {
  const same = (a: unknown[] | undefined, b: unknown[] | undefined) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  return {
    ...await original<typeof import('react')>(),
    useState(initial: unknown) {
      const index = hooks.index++;
      const slot = hooks.slots[index] ??= { kind: 'state', value: typeof initial === 'function' ? initial() : initial };
      slot.set ??= (value: unknown) => { hooks.writes++; slot.value = typeof value === 'function' ? value(slot.value) : value; };
      return [slot.value, slot.set];
    },
    useRef(initial: unknown) {
      const index = hooks.index++;
      return hooks.slots[index] ??= { kind: 'ref', current: initial };
    },
    useCallback(callback: unknown, deps: unknown[]) {
      const index = hooks.index++;
      if (!same(hooks.slots[index]?.deps, deps)) hooks.slots[index] = { kind: 'callback', value: callback, deps };
      return hooks.slots[index].value;
    },
    useEffect(effect: () => (() => void) | void, deps: unknown[]) {
      const index = hooks.index++;
      const previous = hooks.slots[index];
      if (same(previous?.deps, deps)) return;
      const slot = { kind: 'effect', deps, cleanup: undefined as (() => void) | void };
      hooks.slots[index] = slot;
      hooks.effects.push(() => { previous?.cleanup?.(); slot.cleanup = effect(); });
    },
  };
});
import { FailedReportAutopsyEditor } from '../src/components/admin/FailedReportAutopsyEditor';

const digestA = 'a'.repeat(64), digestB = 'b'.repeat(64);
const originalId = '11111111-1111-4111-8111-111111111111';
const nextId = '22222222-2222-4222-8222-222222222222';
const otherId = '33333333-3333-4333-8333-333333333333';
const request = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>();
const randomUUID = vi.fn(() => nextId);
type Props = Parameters<typeof FailedReportAutopsyEditor>[0];
let props: Props;
type ElementProps = { children?: ReactNode; type?: string; disabled?: boolean; className?: string; minLength?: number;
  onClick?: () => void; onSubmit?: (e: React.FormEvent) => Promise<void>; onChange?: (e: { target: { value: string } }) => void };
function elements(node: ReactNode, tag: string): React.ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(child => elements(child, tag));
  if (!React.isValidElement<ElementProps>(node)) return [];
  return [...(node.type === tag ? [node] : []), ...elements(node.props.children, tag)];
}
function render() { hooks.index = 0; return FailedReportAutopsyEditor(props); }
function flushEffects() { while (hooks.effects.length) hooks.effects.shift()!(); }
function unmount() { for (const slot of hooks.slots) if (slot.kind === 'effect') slot.cleanup?.(); }
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred() {
  let resolve!: (value: unknown) => void; let reject!: (error: Error) => void;
  const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function initialView(digest = digestA, historyId = '100'): FailedReportAutopsyView {
  const record: FailedReportAutopsyRecord = {
    expectedRevision: 0, reportDigest: digest, mutationId: originalId, status: 'in_progress',
    summary: 'Full evidence review started; root-cause verification remains in progress.',
    ledgerUrl: '', counts: { total: 2, resolved: 0, blocked: 0 }, blockers: '', verification: null,
    reason: 'Begin itemized review', revision: 1, workspaceId: 'app', historyId, updatedAt: 123, actor: 'admin:owner',
  };
  return { reportDigest: digest, revision: 1, state: 'in_progress', record };
}
function replyFor(update: FailedReportAutopsyInput): FailedReportAutopsyView {
  return { reportDigest: update.reportDigest, revision: update.expectedRevision + 1, state: update.status,
    record: { ...update, revision: update.expectedRevision + 1, workspaceId: 'app', historyId: '100', updatedAt: 456, actor: 'admin:owner' } };
}
function posts() { return request.mock.calls.filter(([, init]) => init?.method === 'POST'); }
function posted(index = 0): FailedReportAutopsyInput { return JSON.parse(String(posts()[index][1]!.body)); }
function submit(tree = render()) {
  const event = { preventDefault: vi.fn() } as unknown as React.FormEvent;
  return elements(tree, 'form')[0].props.onSubmit!(event);
}
function html() { return renderToStaticMarkup(render()); }
async function mount(view: FailedReportAutopsyView = initialView()) {
  request.mockResolvedValueOnce(view);
  render(); flushEffects(); await settle();
  const tree = render();
  const reason = elements(tree, 'input').find(input => input.props.minLength === 3);
  reason?.props.onChange!({ target: { value: 'Record verified review progress' } });
  return render();
}
beforeEach(() => {
  hooks.slots = []; hooks.index = 0; hooks.effects = []; hooks.writes = 0;
  request.mockReset(); randomUUID.mockReset().mockReturnValue(nextId);
  props = { workspaceId: 'app', historyId: '100', displayedReportDigest: digestA, request };
  vi.stubGlobal('crypto', { randomUUID });
});
afterEach(() => { unmount(); vi.unstubAllGlobals(); });

describe('autopsy editor is bound to the evidence actually displayed', () => {
  it('blocks both form controls and the save handler if metadata belongs to a newer report', async () => {
    const tree = await mount(initialView(digestB));
    expect(renderToStaticMarkup(tree)).toContain('Open the full report again');
    expect(elements(tree, 'fieldset')[0].props.disabled).toBe(true);
    expect(elements(tree, 'button').find(button => button.props.type === 'submit')!.props.disabled).toBe(true);
    await submit(tree);
    expect(posts()).toHaveLength(0);
    expect(randomUUID).not.toHaveBeenCalled();
  });

  it('reloading metadata cannot silently replace the digest of the displayed report', async () => {
    const tree = await mount();
    request.mockResolvedValueOnce(initialView(digestB));
    elements(tree, 'button')[0].props.onClick!();
    await settle();
    const reloaded = render();
    expect(props.displayedReportDigest).toBe(digestA);
    expect(elements(reloaded, 'fieldset')[0].props.disabled).toBe(true);
    await submit(reloaded);
    expect(posts()).toHaveLength(0);
    expect(html()).toContain('Open the full report again');
  });
});

describe('autopsy save keeps a single mutation identity until its outcome is known', () => {
  it('locks duplicate submits synchronously before the first request resolves', async () => {
    const tree = await mount(); const pending = deferred();
    request.mockReturnValueOnce(pending.promise);
    const first = submit(tree);
    await submit(tree);
    expect(posts()).toHaveLength(1);
    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(posted()).toMatchObject({ expectedRevision: 1, reportDigest: digestA, mutationId: nextId });
    expect(elements(render(), 'button').find(button => button.props.type === 'submit')!.props.disabled).toBe(true);
    pending.resolve(replyFor(posted())); await first;
    expect(html()).toContain('Autopsy metadata saved.');
  });

  it('after an unknown outcome, freezes the draft and retries the identical request and mutation id', async () => {
    const tree = await mount();
    request.mockRejectedValueOnce(new Error('Connection lost before acknowledgement'));
    await submit(tree);
    const originalBody = posts()[0][1]!.body;
    const uncertain = render();
    expect(renderToStaticMarkup(uncertain)).toContain('Do not assume it succeeded');
    expect(renderToStaticMarkup(uncertain)).toContain('Retry same save');
    expect(elements(uncertain, 'fieldset')[0].props.disabled).toBe(true);
    expect(renderToStaticMarkup(uncertain)).not.toContain('Autopsy metadata saved.');
    request.mockResolvedValueOnce(replyFor(posted()));
    await submit(uncertain);
    expect(posts()).toHaveLength(2);
    expect(posts()[1][1]!.body).toBe(originalBody);
    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(html()).toContain('Autopsy metadata saved.');
  });

  it('an idempotent retry returning a changed report does not announce a current saved review', async () => {
    const tree = await mount();
    request.mockRejectedValueOnce(new Error('Response lost'));
    await submit(tree);
    const acknowledged = replyFor(posted());
    request.mockResolvedValueOnce({ ...acknowledged, reportDigest: digestB, state: 'stale' });
    await submit(render());
    expect(html()).toContain('Current status: stale');
    expect(html()).toContain('Open the full report again');
    expect(html()).not.toContain('Autopsy metadata saved.');
    expect(elements(render(), 'fieldset')[0].props.disabled).toBe(true);
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it('an idempotent retry returning a later reviewer revision shows current truth rather than claiming its own save', async () => {
    const tree = await mount();
    request.mockRejectedValueOnce(new Error('Response lost'));
    await submit(tree);
    const newer = initialView();
    newer.revision = 3;
    newer.record = { ...newer.record!, expectedRevision: 2, revision: 3, mutationId: otherId, actor: 'oauth:other',
      summary: 'Another reviewer recorded newer evidence after the original save.' };
    request.mockResolvedValueOnce(newer);
    await submit(render());
    expect(html()).toContain('Current status: in progress · revision 3');
    expect(html()).toContain('Another reviewer recorded newer evidence');
    expect(html()).not.toContain('Autopsy metadata saved.');
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });
});

describe('obsolete editor operations cannot overwrite a newer selection', () => {
  it.each(['resolve', 'reject'] as const)('unmount ignores a late %s from the initial read', async outcome => {
    const pending = deferred(); request.mockReturnValueOnce(pending.promise);
    render(); flushEffects(); unmount();
    const writesBefore = hooks.writes;
    if (outcome === 'resolve') pending.resolve(initialView()); else pending.reject(new Error('Old read failed'));
    await settle();
    expect(hooks.writes).toBe(writesBefore);
  });

  it.each(['resolve', 'reject'] as const)('a changed selection ignores the older read %s', async outcome => {
    const pending = deferred(); request.mockReturnValueOnce(pending.promise);
    render(); flushEffects();
    props = { ...props, historyId: '200', displayedReportDigest: digestB };
    request.mockResolvedValueOnce(initialView(digestB, '200'));
    render(); flushEffects(); await settle();
    const before = html(), writesBefore = hooks.writes;
    if (outcome === 'resolve') pending.resolve(initialView()); else pending.reject(new Error('Old read failed'));
    await settle();
    expect(html()).toBe(before);
    expect(hooks.writes).toBe(writesBefore);
    expect(request.mock.calls[1][0]).toContain('/app/200/autopsy');
  });

  it.each(['resolve', 'reject'] as const)('a changed selection ignores an older save %s and its pending/busy state', async outcome => {
    const tree = await mount(); const pending = deferred(); request.mockReturnValueOnce(pending.promise);
    const saving = submit(tree); const originalUpdate = posted();
    props = { ...props, historyId: '200', displayedReportDigest: digestB };
    request.mockResolvedValueOnce(initialView(digestB, '200'));
    render(); flushEffects(); await settle();
    const before = html(), writesBefore = hooks.writes;
    if (outcome === 'resolve') pending.resolve(replyFor(originalUpdate)); else pending.reject(new Error('Old save failed'));
    await saving;
    expect(html()).toBe(before);
    expect(hooks.writes).toBe(writesBefore);
    expect(html()).not.toContain('Retry same save');
    expect(html()).not.toContain('Autopsy metadata saved.');
    expect(elements(render(), 'fieldset')[0].props.disabled).toBe(false);
  });
});
