import { afterEach, describe, expect, it, vi } from 'vitest';
import { readInitialLaneDecline } from '../src/server/AgentV3/initialLaneDecline';
import { runSimpleBuild, parseFileManifest, type SimpleBuildDeps } from '../src/server/AgentV3/SimpleBuilder';
import { runOneShot, parseFileBlocks, type OneShotDeps } from '../src/server/AgentV3/OneShotBuilder';

// Synthetic responses only. These tests classify an answer, never the user's request or policy.
const NO = 'I cannot build or provide this app. I can help with an authorized alternative instead.';
const BLOCK = '<<<FILE src/App.tsx>>>\nexport default function App(){return <h1>Todo list</h1>}\n<<<ENDFILE>>>';
const PLAN = 'src/App.tsx :: root component\nsrc/helpers.ts :: shared helper';
const candidate = (text: string) => readInitialLaneDecline(text, parseFileManifest(text).length + parseFileBlocks(text).length);
const simpleDeps = (text: string, extra: Partial<SimpleBuildDeps> = {}): SimpleBuildDeps => ({
  prompt: 'Build a todo app', framework: 'vite-react', scaffoldPaths: ['src/App.tsx', 'index.html'],
  generate: async () => text, writeFiles: async () => {}, shareContract: false, depOrder: false, ...extra,
});
const oneDeps = (text: string, extra: Partial<OneShotDeps> = {}): OneShotDeps => ({
  prompt: 'Build a todo app', framework: 'vite-react', scaffoldPaths: ['src/App.tsx', 'index.html'],
  generate: async () => text, writeFiles: async () => {}, ...extra,
});
afterEach(() => { vi.useRealTimers(); });

describe('initial text-only answers require direct, unqualified opening semantics', () => {
  it.each([
    NO, 'Main yeh app nahi bana sakta.', 'मैं यह ऐप नहीं बना सकता।',
    'My refusal stands. I can help with something else.', 'I cannot generate an MP4 here.',
    "I can't build this app.", "I'm not able to help with that request.",
  ])('recognizes an explicit artifact-free opening: %s', (text) => {
    expect(candidate(text)).toEqual({ kind: 'initial-lane-decline', modelAnswer: text });
  });
  it('accepted artifact evidence takes precedence over prose classification', () => {
    expect(readInitialLaneDecline(NO, 1)).toBeUndefined();
  });
  it('retains the exact original answer, including leading/trailing whitespace', () => {
    const text = ' \n' + NO + '\n\n';
    expect(candidate(text)?.modelAnswer).toBe(text);
  });
  it.each([
    'I cannot render an MP4 here.', // No widening of the existing semantic predicate.
    '', 'Here is the plan, but formatting is malformed.', 'src/App.tsx : malformed separator',
    'The requested button label is "I cannot build this app".',
    '```ts\nconst message = "I cannot build this app";\n```',
    'I can build the page with a label that says "I cannot build this app".',
    'Main button par "I cannot build this app" likh raha hoon.',
    'Main button par I cannot build this app likh raha hoon.',
    'I cannot wait to build this app.', 'I cannot help but build this app.',
    'Main yeh nahi keh raha ki main app nahi bana sakta.',
    'Main title par My refusal stands likh raha hoon.',
    'Main button bana raha hoon. I cannot build this app.',
    'I cannot build this app if the API is unavailable. The API is available, so I will proceed.',
    'I cannot build this app unless I read the existing API. I will read it now.',
    'I cannot build this app without planning it first.\nsrc/App.tsx : root component',
    'I cannot build this app until the import is done. The import finished, so I will proceed.',
    'Main agar app nahi bana sakta to aapse clarification poochunga.',
    'Main yeh app nahi bana sakta jab API unavailable ho. API available hai.',
    'मैं यह ऐप नहीं बना सकता यदि API उपलब्ध न हो। API उपलब्ध है।',
    NO + '\n<FILE src/App.tsx>\nexport default function App(){return null}',
    NO + '\n<<FILE src/App.tsx>>\nexport default function App(){return null}',
    NO + '\n<<<FILE src/App.tsx>>\nexport default function App(){return null}',
    NO + '\nsrc/App.tsx : root component',
    NO + '\n{"files":[{"path":"src/App.tsx","content":"..."}]}',
    NO + '\n[{"path":"src/App.tsx","purpose":"root component"}]',
    NO + '\n' + BLOCK, NO + '\n' + PLAN, BLOCK, PLAN,
    'Main fake login nahi banaunga; ab asli authentication bana raha hoon.',
    'Sorry, I cannot build this app.', // Deliberately no arbitrary preamble support.
  ])('preserves ordinary, quoted, conditional and artifact-bearing recovery: %s', (text) => {
    expect(candidate(text)).toBeUndefined();
  });
});

describe('initial lanes preserve answers without claiming an app was built', () => {
  it('ends Simple before root injection, minimums, shared contract, writes or readiness', async () => {
    const generate = vi.fn(async () => ' \n' + NO + '\n');
    const writeFiles = vi.fn(async () => {}), verify = vi.fn(async () => ({ ok: true, ran: true, errors: '' }));
    const startPreview = vi.fn(async () => {}), repair = vi.fn(async () => []), onPlanned = vi.fn(), onFilesReady = vi.fn();
    const result = await runSimpleBuild(simpleDeps(NO, {
      generate, writeFiles, verify, startPreview, repair, onPlanned, onFilesReady,
      starterEntryPath: 'src/App.tsx', minFiles: 1, shareContract: true,
    }));
    expect(result).toMatchObject({ ok: false, filesWritten: 0, plannedFiles: 0, plannedPaths: [],
      summary: ' \n' + NO + '\n', reason: 'initial_lane_declined',
      initialDecline: { kind: 'initial-lane-decline', modelAnswer: ' \n' + NO + '\n' },
      phases: { verifyRuns: 0, repairRuns: 0, generateMs: 0, contractMs: 0 },
    });
    expect(result.outcome).toBeUndefined();
    expect(result.typecheckRan).toBeUndefined();
    expect(generate).toHaveBeenCalledTimes(1);
    for (const effect of [writeFiles, verify, startPreview, repair, onPlanned, onFilesReady]) expect(effect).not.toHaveBeenCalled();
  });
  it('ends OneShot without a write or preview, even with minimums relaxed', async () => {
    const generate = vi.fn(async () => NO), writeFiles = vi.fn(async () => {}), startPreview = vi.fn(async () => {});
    const result = await runOneShot(oneDeps(NO, { generate, writeFiles, startPreview, minFiles: 0 }));
    expect(result).toEqual({ ok: false, filesWritten: 0, summary: NO, reason: 'initial_lane_declined',
      initialDecline: { kind: 'initial-lane-decline', modelAnswer: NO } });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(writeFiles).not.toHaveBeenCalled();
    expect(startPreview).not.toHaveBeenCalled();
  });
  it.each(['', 'Unformatted plan follows.', NO + '\n{"files":[{"path":"src/App.tsx"}]}', NO + '\nsrc/App.tsx : root component'])(
    'keeps malformed/empty output recoverable in both lanes: %s', async (text) => {
      const simple = await runSimpleBuild(simpleDeps(text));
      const one = await runOneShot(oneDeps(text));
      expect(simple.initialDecline).toBeUndefined();
      expect(one.initialDecline).toBeUndefined();
      expect(simple.reason).toBe('manifest_too_small');
      expect(one.reason).toBe('no_files_parsed');
    },
  );
  it.each([BLOCK, NO + '\n' + BLOCK])('writes a valid OneShot artifact even beside decline-shaped prose: %s', async (text) => {
    const writeFiles = vi.fn(async () => {}), startPreview = vi.fn(async () => {});
    const result = await runOneShot(oneDeps(text, { writeFiles, startPreview }));
    expect(result).toMatchObject({ ok: true, filesWritten: 1 });
    expect(result.initialDecline).toBeUndefined();
    expect(writeFiles).toHaveBeenCalledTimes(1);
    expect(startPreview).toHaveBeenCalledTimes(1);
  });
  it.each([PLAN, NO + '\n' + PLAN])('generates a valid Simple manifest even beside decline-shaped prose: %s', async (text) => {
    const written: string[] = [];
    const result = await runSimpleBuild(simpleDeps(text, {
      generate: async (_system, user) => {
        if (user.includes('Plan the file list')) return text;
        const path = user.match(/write THIS file in full:\s*\n\s*([^\n]+)/)?.[1]?.trim();
        return `<<<FILE ${path}>>>\nexport default function App(){return null}\n<<<ENDFILE>>>`;
      },
      writeFiles: async (files) => { written.push(...files.map(file => file.path)); },
    }));
    expect(result).toMatchObject({ ok: true, filesWritten: 2 });
    expect(result.initialDecline).toBeUndefined();
    expect(new Set(written)).toEqual(new Set(['src/App.tsx', 'src/helpers.ts']));
  });
  it('does not extend terminal classification into shared-contract or per-file answers', async () => {
    for (const refuseFiles of [false, true]) {
      const result = await runSimpleBuild(simpleDeps(PLAN, {
        shareContract: true,
        generate: async (_system, user) => {
          if (user.includes('Plan the file list')) return PLAN;
          const path = user.match(/write THIS file in full:\s*\n\s*([^\n]+)/)?.[1]?.trim();
          if (!path || refuseFiles) return NO;
          return `<<<FILE ${path}>>>\nexport default function App(){return null}\n<<<ENDFILE>>>`;
        },
      }));
      expect(result.initialDecline).toBeUndefined();
      expect(result.ok).toBe(!refuseFiles);
      if (refuseFiles) expect(result.reason).toBe('too_few_files_generated');
    }
  });
  it('accepted raw artifacts win before scaffold filtering in both lanes', async () => {
    const simple = await runSimpleBuild(simpleDeps(NO + '\nsrc/ErrorBoundary.tsx :: provided error boundary', {
      scaffoldPaths: ['src/ErrorBoundary.tsx'],
    }));
    const one = await runOneShot(oneDeps(NO + '\n<<<FILE tsconfig.json>>>\n{}\n<<<ENDFILE>>>', {
      scaffoldPaths: ['tsconfig.json'],
    }));
    expect(simple.initialDecline).toBeUndefined();
    expect(one.initialDecline).toBeUndefined();
    expect(simple.reason).toBe('manifest_too_small');
    expect(one.reason).toBe('no_files_parsed');
  });
  it('accepted raw artifacts win before minimums, including file format in the manifest lane', async () => {
    for (const text of [NO + '\nsrc/App.tsx :: root component', NO + '\n' + BLOCK]) {
      const result = await runSimpleBuild(simpleDeps(text, { minFiles: 3 }));
      expect(result.initialDecline).toBeUndefined();
      expect(result.reason).toBe('manifest_too_small');
    }
    const one = await runOneShot(oneDeps(NO + '\n' + BLOCK, { minFiles: 2 }));
    expect(one.initialDecline).toBeUndefined();
    expect(one.reason).toBe('no_files_parsed');
  });
  it('workspace refusal of an artifact remains a write failure, not a model decline', async () => {
    const result = await runOneShot(oneDeps(BLOCK, {
      writeFiles: async () => [{ path: 'src/App.tsx', ok: false, error: 'synthetic refused write' }],
    }));
    expect(result.reason).toBe('files_not_written');
    expect(result.initialDecline).toBeUndefined();
  });
  it('a provider error with decline-shaped text is still an error, not trusted answer metadata', async () => {
    const generate = async () => { throw new Error(NO); };
    for (const result of [await runSimpleBuild(simpleDeps('', { generate })), await runOneShot(oneDeps('', { generate }))]) {
      expect(result.initialDecline).toBeUndefined();
      expect(result.reason).toBe(NO);
    }
  });
  it('Stop arriving with the Simple answer wins over terminal decline', async () => {
    const abort = new AbortController();
    const result = await runSimpleBuild(simpleDeps(NO, {
      signal: abort.signal, generate: async () => { abort.abort(); return NO; },
    }));
    expect(result.stopped).toBe(true);
    expect(result.initialDecline).toBeUndefined();
  });
  it.each(['simple', 'one-shot'] as const)('a %s timeout stays a timeout when a late decline arrives', async (lane) => {
    vi.useFakeTimers();
    let resolve!: (text: string) => void;
    const pending = new Promise<string>(done => { resolve = done; });
    const writeFiles = vi.fn(async () => {});
    const resultPromise = lane === 'simple'
      ? runSimpleBuild(simpleDeps('', { generate: () => pending, writeFiles, overallTimeoutMs: 10, planTimeoutMs: 10 }))
      : runOneShot(oneDeps('', { generate: () => pending, writeFiles, overallTimeoutMs: 10 }));
    await vi.advanceTimersByTimeAsync(11);
    const result = await resultPromise;
    expect(result.reason).toContain('timed out');
    expect(result.initialDecline).toBeUndefined();
    resolve(NO);
    await vi.advanceTimersByTimeAsync(0);
    expect(writeFiles).not.toHaveBeenCalled();
    expect(result.initialDecline).toBeUndefined();
  });
});
