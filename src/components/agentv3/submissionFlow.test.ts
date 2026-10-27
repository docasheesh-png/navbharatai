import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { SubmissionScope } from './submissionScope';
import { shouldOfferFeatureCard } from './featureConfirm';

// Execute the actual panel send closure, not a second implementation. Browser/rendering dependencies
// are injected so delayed I/O, double-clicks and stale callbacks can be tested without a paid build.
const panel = readFileSync(new URL('./AgentV3Panel.tsx', import.meta.url), 'utf8');
const sendSource = panel.slice(panel.indexOf('  const send = async ('), panel.indexOf('  // ── INLINE VOICE DICTATION'));
const compiled = ts.transpileModule(`${sendSource}\nreturn send;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function harness(overrides: Record<string, unknown> = {}) {
  const observed: Record<string, any> = { userMsgs: [], agentHistory: [], checkpointHistory: [], submissionPhase: null, fwConflict: null, featureConfirm: null, versionUndoOpen: false };
  const setter = (key: string) => (value: any) => { observed[key] = typeof value === 'function' ? value(observed[key]) : value; };
  const deps: Record<string, any> = {
    prompt: 'Build a notes app', files: [], running: false, isBusy: () => false, listening: false, importUrl: '',
    sessionSwitchRef: { current: false }, queueClaimInFlightRef: { current: null }, queueContinuationAbortRef: { current: null }, weakForceContinueRef: { current: false },
    localSubmissionMessagesRef: { current: new Set<number>() }, submissionRef: { current: new SubmissionScope() }, sessionIdRef: { current: 'original' },
    state: { narration: [], checkpoints: [], activity: [], activityLog: [] }, userMsgs: [], agentHistory: [],
    autoContinueRef: {}, planContinuesRef: {}, lastPlanRemainingRef: {}, noProgressRef: {}, lastFilesWrittenRef: {},
    setQueueContinuationWaiting: vi.fn(), stopVoice: vi.fn(), setQuickRepliesUsedTs: vi.fn(), setInterruptedResume: vi.fn(),
    checkAttachmentSizes: () => ({ ok: true }), fileToAttachment: vi.fn(async () => ({ name: 'attachment' })),
    setUserMsgs: setter('userMsgs'), setAgentHistory: setter('agentHistory'), setCheckpointHistory: setter('checkpointHistory'),
    setSubmissionPhase: setter('submissionPhase'), setFwConflict: setter('fwConflict'), setFeatureConfirm: setter('featureConfirm'),
    // Free variables the extracted send() now closes over (Pro undo picker). Default: never intercept.
    setVersionUndoOpen: setter('versionUndoOpen'), wantsVersionUndo: () => false,
    setPrompt: vi.fn(), setFiles: vi.fn(), setImportUrl: vi.fn(), onBeforeBuild: undefined,
    nextUserMessageTs: (now: number) => now + 1, withoutStaleLiveStatus: (items: any[]) => items,
    userId: 'user', email: undefined, onlyOpus: false, powerLevel: 'medium', planFirst: false, thinking: true,
    framework: 'vite-react', frameworkExplicit: false, appSignaturePref: () => false, chatMode: 'build',
    shouldOfferFeatureCard, featureConfirmDisabled: () => false,
    resolveFrameworkSelection: () => ({ status: 'ok', framework: 'vite-react' }),
    authJsonHeaders: async () => ({}), fetch: vi.fn(async () => ({ ok: true, json: async () => ({ show: false }) })),
    start: vi.fn(async () => undefined), ...overrides,
  };
  const send = new Function(...Object.keys(deps), compiled)(...Object.values(deps)) as (override?: { text: string; importUrl: string }) => Promise<void>;
  const cancel = () => { deps.submissionRef.current.cancel(); observed.submissionPhase = null; observed.fwConflict = null; observed.featureConfirm = null; observed.versionUndoOpen = false; };
  return { send, deps, observed, cancel };
}
const plan = { show: true, domain: 'notes', named: ['Notes'], suggested: ['Search'] };

describe('real Pro send preflight', () => {
  it('inserts user text before delayed attachment conversion and blocks a same-render duplicate', async () => {
    const conversion = deferred<object>();
    const h = harness({ files: [{ name: 'photo.png' }], fileToAttachment: () => conversion.promise });
    const pending = h.send();
    expect(h.observed.userMsgs).toHaveLength(1);
    expect(h.observed.submissionPhase).toBe('attachments');
    await h.send();
    expect(h.observed.userMsgs).toHaveLength(1);
    expect(h.deps.start).not.toHaveBeenCalled();
    conversion.resolve({ name: 'photo.png' });
    await pending;
    expect(h.deps.start).toHaveBeenCalledTimes(1);
    expect(h.deps.start.mock.calls[0][1]).toMatchObject({ sessionId: 'original', userMessageTs: h.observed.userMsgs[0].ts });
    expect(h.observed.submissionPhase).toBeNull();
  });
  it('reports conversion failure, unlocks retry, and does not archive the old live narration', async () => {
    const h = harness({ files: [{ name: 'bad.png' }], fileToAttachment: async () => { throw new Error('read failed'); }, state: { narration: [{ text: 'prior', ts: 1 }], checkpoints: [] } });
    await h.send();
    expect(h.observed.userMsgs.at(-1).text).toContain('could not be started');
    expect(h.observed.agentHistory).toEqual([]);
    expect(h.deps.localSubmissionMessagesRef.current.has(h.observed.userMsgs[0].ts)).toBe(true);
    expect(h.deps.submissionRef.current.busy).toBe(false);
    expect(h.deps.start).not.toHaveBeenCalled();
  });
  it.each(['cancel', 'switch'])('does not launch after delayed save and %s', async (action) => {
    const saving = deferred<void>();
    const h = harness({ onBeforeBuild: () => saving.promise });
    const pending = h.send();
    expect(h.observed.submissionPhase).toBe('saving');
    if (action === 'switch') h.deps.sessionIdRef.current = 'other';
    else h.cancel();
    saving.resolve();
    await pending;
    expect(h.deps.start).not.toHaveBeenCalled();
    expect(h.deps.fetch).not.toHaveBeenCalled();
  });
  it('cancels delayed feature detection even when the request ignores AbortSignal', async () => {
    const response = deferred<object>();
    const h = harness({ fetch: vi.fn(() => response.promise) });
    const pending = h.send();
    expect(h.observed.submissionPhase).toBe('features');
    h.cancel();
    response.resolve({ ok: true, json: async () => plan });
    await pending;
    expect(h.observed.featureConfirm).toBeNull();
    expect(h.deps.start).not.toHaveBeenCalled();
  });
  it('feature confirmation waits without work, starts once and archives only at launch', async () => {
    const h = harness({ fetch: vi.fn(async () => ({ ok: true, json: async () => plan })) });
    await h.send();
    const launch = h.observed.featureConfirm.launch;
    expect(h.observed.submissionPhase).toBe('confirmation');
    expect(h.deps.start).not.toHaveBeenCalled();
    await h.send();
    expect(h.observed.userMsgs).toHaveLength(1);
    await Promise.all([launch({ include: ['Notes'], exclude: [] }), launch()]);
    expect(h.deps.start).toHaveBeenCalledTimes(1);
    expect(h.observed.submissionPhase).toBeNull();
  });
  it('framework selection and feature callbacks cannot launch after cancel or be used twice', async () => {
    const h = harness({ resolveFrameworkSelection: () => ({ status: 'conflict', picked: 'vite-react', detected: 'nextjs' }) });
    await h.send();
    expect(h.observed.submissionPhase).toBe('framework');
    const launch = h.observed.fwConflict.launch;
    await Promise.all([launch('nextjs'), launch('vite-react')]);
    expect(h.deps.fetch).toHaveBeenCalledTimes(1);
    expect(h.deps.start).toHaveBeenCalledTimes(1);
    const second = harness({ fetch: vi.fn(async () => ({ ok: true, json: async () => plan })) });
    await second.send();
    const stale = second.observed.featureConfirm.launch;
    second.cancel();
    await stale();
    expect(second.deps.start).not.toHaveBeenCalled();
  });
  it('invalid feature responses fall through safely rather than crashing the card', async () => {
    const h = harness({ fetch: vi.fn(async () => ({ ok: true, json: async () => ({ show: true, named: null }) })) });
    await h.send();
    expect(h.observed.featureConfirm).toBeNull();
    expect(h.deps.start).toHaveBeenCalledTimes(1);
  });
  it('preserves programmatic drafts and keeps oversized attachments in the composer', async () => {
    const h = harness();
    await h.send({ text: 'Import repo', importUrl: 'https://example.test/repo' });
    expect(h.deps.setPrompt).not.toHaveBeenCalled();
    expect(h.deps.setFiles).not.toHaveBeenCalled();
    const rejected = harness({ files: [{ name: 'huge.zip' }], checkAttachmentSizes: () => ({ ok: false, reason: 'Too large' }) });
    await rejected.send();
    expect(rejected.deps.setPrompt).not.toHaveBeenCalled();
    expect(rejected.deps.start).not.toHaveBeenCalled();
    expect(rejected.deps.submissionRef.current.busy).toBe(false);
  });
  it('archives a previous reply exactly once, only after the delayed preparation completes', async () => {
    const saving = deferred<void>();
    const prior = { text: 'Your previous app is ready', ts: 10 };
    const h = harness({ onBeforeBuild: () => saving.promise, state: { narration: [prior], checkpoints: [{ sha: 'old' }] } });
    const pending = h.send();
    expect(h.observed.agentHistory).toEqual([]);
    expect(h.observed.checkpointHistory).toEqual([]);
    await h.send();
    saving.resolve();
    await pending;
    expect(h.observed.agentHistory).toHaveLength(1);
    expect(h.observed.agentHistory[0].text).toBe(prior.text);
    expect(h.observed.checkpointHistory).toEqual([{ sha: 'old' }]);
    expect(h.deps.start).toHaveBeenCalledTimes(1);
  });
  it.each(['handleUnsend', 'handleEdit'])('%s removes an unlaunched prompt without purging the prior server turn', async (name) => {
    const conversion = deferred<object>();
    const h = harness({ files: [{ name: 'image.png' }], fileToAttachment: () => conversion.promise });
    const pending = h.send();
    const message = h.observed.userMsgs[0];
    // Same scope as the actual panel handlers, with a previous workspace already present.
    const deps = {
      unsending: false, localSubmissionMessagesRef: h.deps.localSubmissionMessagesRef,
      cancelSubmission: h.cancel, invalidateQueuedContinuation: vi.fn(), setUnsending: vi.fn(),
      state: { workspaceId: 'prior-workspace' }, unsend: vi.fn(async () => true), stop: vi.fn(),
      setUserMsgs: h.deps.setUserMsgs, setAgentHistory: h.deps.setAgentHistory,
      setPrompt: h.deps.setPrompt, setTimeout: vi.fn(), composerRef: { current: null },
    };
    const begin = panel.indexOf(`  const ${name} = async`);
    const source = panel.slice(begin, panel.indexOf('\n  };', begin) + 5);
    const js = ts.transpileModule(`${source}\nreturn ${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const handler = new Function(...Object.keys(deps), js)(...Object.values(deps));
    await handler(message.ts, message.text);
    expect(deps.unsend).not.toHaveBeenCalled();
    expect(deps.stop).not.toHaveBeenCalled();
    expect(h.observed.userMsgs).toEqual([]);
    conversion.resolve({ name: 'image.png' });
    await pending;
    expect(h.deps.start).not.toHaveBeenCalled();
    if (name === 'handleEdit') expect(h.deps.setPrompt).toHaveBeenLastCalledWith(message.text);
  });
  it('hands off to the hook before stream EOF, without stale cleanup unlocking a newer request', async () => {
    const stream = deferred<void>();
    let busy = false;
    const h = harness({ isBusy: () => busy, start: vi.fn(() => { busy = true; return stream.promise; }) });
    const pending = h.send({ text: 'First turn', importUrl: '' });
    expect(h.deps.start).toHaveBeenCalledTimes(1);
    await h.send({ text: 'Duplicate before render', importUrl: '' });
    expect(h.observed.userMsgs).toHaveLength(1);
    // Even if React batches running=true/false, preflight is already released.
    expect(h.deps.submissionRef.current.busy).toBe(false);
    expect(h.observed.submissionPhase).toBeNull();
    busy = false;
    const next = h.deps.submissionRef.current.begin('original');
    expect(next).not.toBeNull();
    stream.resolve();
    await pending;
    await Promise.resolve();
    await Promise.resolve();
    expect(h.deps.submissionRef.current.current(next, 'original')).toBe(true);
    h.cancel();
  });
  it('wires lifecycle cancellation and accessible non-running feedback in the panel', () => {
    expect(panel).toContain('useEffect(() => () => submissionRef.current.cancel(), [])');
    expect(panel).toMatch(/const reset = useCallback\(\(\) => \{\s*cancelSubmission\(\);\s*localSubmissionMessagesRef.current.clear\(\);\s*resetBuild\(\)/);
    expect(panel).toMatch(/const stop = useCallback\(\(\) => \{\s*cancelSubmission\(\)/);
    expect(panel).toContain('if (sessionIdRef.current) cancelSubmission();');
    expect(panel).toContain('role="status" aria-live="polite" aria-atomic="true"');
    expect(panel).toContain('submissionIsWorking(submissionPhase) &&');
    expect(panel).toContain('running || isBusy()');
    expect(panel).toContain('onCancel={cancelSubmission}');
    expect(panel.match(/const localOnly = localSubmissionMessagesRef.current.has\(ts\)/g)).toHaveLength(2);
    expect(panel.match(/if \(!localOnly\) \{\s*if \(state.workspaceId\) purged = await unsend\(\)/g)).toHaveLength(2);
    expect(panel).toContain('running || submissionRef.current.busy || queueClaimInFlightRef.current');
  });
});

  it('opens the version undo picker for undo intent and does not start a build', async () => {
    const h = harness({
      prompt: 'pehle wala',
      wantsVersionUndo: (text: string) => /pehle wala|undo|wapas/i.test(text),
    });
    await h.send();
    expect(h.observed.versionUndoOpen).toBe(true);
    expect(h.deps.start).not.toHaveBeenCalled();
    expect(h.observed.submissionPhase).toBeNull();
  });
