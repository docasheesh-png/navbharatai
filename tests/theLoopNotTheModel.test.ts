import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  runAiRepairLoop, parseAiRepairReply, buildAiRepairPrompt, isMeaningfulChange, aiRepairMaxRounds,
  isAppSourcePath, AI_REPAIR_MAX_ASK,
  type AiRepairModel, type AiRepairLlm, type VerifyFix,
} from '../src/server/lib/mobileBuildAiRepair';
import { makeRepairVerifier, sandboxCanJudge, type RealBuildActuator } from '../src/server/lib/mobileShipRealBuild';

/**
 * "LOOP THEEK KARO, MODEL NAHI" (admin 2026-09-22: make NavBharatAI's GitHub APK/AAB building
 * Claude-Code level).
 *
 * The AI repair was a ONE-SHOT blind patch: one prompt over the files the log happened to name, one
 * reply, committed without being run, and a five-minute GitHub run — one of the user's three — to learn
 * whether it worked. Claude Code's loop differs in three ways that have nothing to do with which model
 * runs: it OPENS the file it needs, it RUNS THE BUILD before it pushes, and it ITERATES on the error the
 * build printed. These cases lock those three, and the guards that were not loosened to get them.
 */
const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const RUNG: AiRepairModel = { provider: 'GLM', model: 'glm-x', baseURL: 'http://x', apiKey: 'k', kind: 'openai' };
const ORIGINAL = {
  'src/App.tsx': 'import { useTodos } from "./hooks/useTodos";\nexport const App = () => <div>{useTodos().count}</div>;',
  'package.json': '{"name":"app","scripts":{"build":"vite build"}}',
};
const TREE = ['src/App.tsx', 'src/hooks/useTodos.ts', 'src/types.ts', 'package.json', 'index.html'];
const ctx = (over: Partial<Parameters<typeof runAiRepairLoop>[2]> = {}) => ({
  log: 'error during build:\nsrc/App.tsx: Property "count" does not exist',
  files: { ...ORIGINAL },
  ruleSummary: 'Your app itself did not compile.',
  tree: TREE,
  ...over,
});
const fix = (files: Record<string, string>, explanation = 'Corrected the counter.') =>
  JSON.stringify({ fixable: true, explanation, files });
const ask = (paths: string[]) => JSON.stringify({ needFiles: paths });
/** An llm that answers from a script, one reply per round, and records every prompt it was shown. */
function scripted(replies: string[]): AiRepairLlm & { prompts: string[] } {
  const prompts: string[] = [];
  const llm = (async (_m: AiRepairModel, _s: string, prompt: string) => {
    prompts.push(prompt);
    const r = replies.shift();
    if (r === undefined) throw new Error('script exhausted');
    return r;
  }) as AiRepairLlm & { prompts: string[] };
  llm.prompts = prompts;
  return llm;
}
const fetchFiles = async (paths: string[]) => Object.fromEntries(
  paths.filter((p) => TREE.includes(p)).map((p) => [p, `// content of ${p}`]),
);

afterEach(() => { delete process.env.MOBILE_AUTOFIX_AI_ROUNDS; });

describe('1 · it can OPEN the file it needs', () => {
  it('a needFiles reply is fetched, added to what the model may see AND change, and the loop continues', async () => {
    const llm = scripted([
      ask(['src/hooks/useTodos.ts']),
      fix({ 'src/hooks/useTodos.ts': 'export const useTodos = () => ({ count: 0 });' }),
    ]);
    const r = await runAiRepairLoop(llm, [RUNG], ctx(), { fetchFiles, verify: async () => ({ ran: true, ok: true }) });
    expect(r.outcome).toBe('fixed');
    expect(r.asked).toEqual(['src/hooks/useTodos.ts']);
    expect(r.rounds).toBe(2);
    // Round two really showed the fetched file, so the fix could be made IN it.
    expect(llm.prompts[1]).toContain('--- src/hooks/useTodos.ts ---');
    expect(Object.keys(r.fix!.files)).toEqual(['src/hooks/useTodos.ts']);
  });

  it('🔒 the menu is the allowlist: a path the model invents is rejected, even as a read', () => {
    expect(parseAiRepairReply(ask(['src/secret/notInTree.ts']), Object.keys(ORIGINAL), ORIGINAL, TREE)).toBeNull();
    // And with no menu at all the shape is out of contract — the one-shot path is unchanged.
    expect(parseAiRepairReply(ask(['src/types.ts']), Object.keys(ORIGINAL), ORIGINAL)).toBeNull();
  });

  it('a request for a file it already holds, or a forbidden one, is dropped — never a round spent on nothing', () => {
    expect(parseAiRepairReply(ask(['src/App.tsx']), Object.keys(ORIGINAL), ORIGINAL, TREE)).toBeNull();
    const menu = [...TREE, 'android/app/my.keystore', '.env'];
    expect(parseAiRepairReply(ask(['android/app/my.keystore', '.env']), Object.keys(ORIGINAL), ORIGINAL, menu)).toBeNull();
    const many = Array.from({ length: 10 }, (_, i) => `src/f${i}.ts`);
    const r = parseAiRepairReply(ask(many), Object.keys(ORIGINAL), ORIGINAL, many);
    expect(r && 'needFiles' in r ? r.needFiles.length : 0).toBe(AI_REPAIR_MAX_ASK);
  });

  it('the prompt lists only files the model does NOT already have, and says how to ask', () => {
    const p = buildAiRepairPrompt(ctx());
    expect(p).toContain('OTHER FILES IN THE APP');
    expect(p).toContain('src/hooks/useTodos.ts');
    // Already offered, so not on the menu — the section lists the others only.
    const menu = p.split('OTHER FILES IN THE APP')[1];
    expect(menu).not.toContain('src/App.tsx\n');
  });
});

describe('2 · it RUNS THE BUILD before it pushes', () => {
  it('🔴 a change the build REJECTS is never the result — on any round', async () => {
    const llm = scripted([
      fix({ 'src/App.tsx': 'export const App = () => <div>1</div>;' }),
      fix({ 'src/App.tsx': 'export const App = () => <div>2</div>;' }),
    ]);
    const verify: VerifyFix = async () => ({ ran: true, ok: false, log: 'still broken', summary: 'It did not compile.' });
    const r = await runAiRepairLoop(llm, [RUNG], ctx(), { fetchFiles, verify }, 2);
    expect(r.outcome).toBe('gave-up');
    expect(r.fix).toBeUndefined();
    expect(r.rejected).toBe(2);
    expect(r.rounds).toBe(2);
    expect(r.reason).toContain('none of them made it compile');
  });

  it('a change the build ACCEPTS is the result, marked verified, as a diff against the repository', async () => {
    const llm = scripted([fix({ 'src/App.tsx': 'export const App = () => <div>ok</div>;', 'package.json': ORIGINAL['package.json'] })]);
    const seen: Record<string, string>[] = [];
    const r = await runAiRepairLoop(llm, [RUNG], ctx(), { fetchFiles, verify: async (c) => { seen.push(c); return { ran: true, ok: true }; } });
    expect(r.outcome).toBe('fixed');
    expect(r.verified).toBe(true);
    // package.json came back identical, so it is not in the diff and the verifier never saw it.
    expect(Object.keys(r.fix!.files)).toEqual(['src/App.tsx']);
    expect(Object.keys(seen[0])).toEqual(['src/App.tsx']);
  });

  it('with NO verifier the fix is returned as before — and LABELLED unverified, never as verified', async () => {
    const llm = scripted([fix({ 'src/App.tsx': 'export const App = () => null;' })]);
    const r = await runAiRepairLoop(llm, [RUNG], ctx(), { fetchFiles });
    expect(r.outcome).toBe('unverified-fix');
    expect(r.verified).toBe(false);
    expect(r.fix).toBeDefined();
  });

  it('🔒 once a build has REJECTED a change, a later round that could not be checked is NOT committed blind', async () => {
    // "Could not check this one" is not evidence it went right, and we already hold evidence this
    // repair goes wrong. Committing it would spend the user's next five-minute run on a coin flip.
    const llm = scripted([
      fix({ 'src/App.tsx': 'export const App = () => <div>1</div>;' }),
      fix({ 'src/App.tsx': 'export const App = () => <div>2</div>;' }),
    ]);
    let calls = 0;
    const verify: VerifyFix = async () => (++calls === 1
      ? { ran: true, ok: false, log: 'nope', summary: 'no' }
      : { ran: false, reason: 'timed-out' });
    const r = await runAiRepairLoop(llm, [RUNG], ctx(), { fetchFiles, verify });
    expect(r.outcome).toBe('gave-up');
    expect(r.fix).toBeUndefined();
  });
});

describe('3 · it ITERATES on the real error, with its own change in view', () => {
  it('the next round is shown what the build said AND the candidate it was said about', async () => {
    const llm = scripted([
      fix({ 'src/App.tsx': 'export const App = () => <div>{count}</div>;' }),
      fix({ 'src/App.tsx': 'export const App = () => <div>0</div>;' }),
    ]);
    let n = 0;
    const verify: VerifyFix = async () => (++n === 1
      ? { ran: true, ok: false, log: 'src/App.tsx: Cannot find name "count"', summary: 'It did not compile.' }
      : { ran: true, ok: true });
    const r = await runAiRepairLoop(llm, [RUNG], ctx(), { fetchFiles, verify });
    expect(r.outcome).toBe('fixed');
    expect(r.rounds).toBe(2);
    expect(r.rejected).toBe(1);
    expect(llm.prompts[1]).toContain('ROUND 1: YOUR PREVIOUS CHANGE DID NOT FIX THE BUILD');
    expect(llm.prompts[1]).toContain('Cannot find name "count"');
    // The files section carries the CANDIDATE, so the model corrects its own change rather than starting over.
    expect(llm.prompts[1]).toContain('<div>{count}</div>');
  });

  it('what happened on EARLIER GitHub runs is shown ahead of the log, so a repeat is corrected, not repeated', async () => {
    const llm = scripted([fix({ 'src/App.tsx': 'export const App = () => null;' })]);
    await runAiRepairLoop(llm, [RUNG], ctx({ history: 'On the previous attempt YOUR change to src/App.tsx was committed and the build failed the SAME way.' }), { fetchFiles });
    expect(llm.prompts[0]).toContain('=== WHAT HAPPENED ON EARLIER ATTEMPTS ===');
    expect(llm.prompts[0].indexOf('EARLIER ATTEMPTS')).toBeLessThan(llm.prompts[0].indexOf('=== FAILING STEP LOG ==='));
  });

  it('a round that only undoes an earlier change commits nothing for it', async () => {
    const llm = scripted([
      fix({ 'src/App.tsx': 'export const App = () => <div>1</div>;' }),
      fix({ 'src/App.tsx': ORIGINAL['src/App.tsx'] }),
    ]);
    const verify: VerifyFix = async () => ({ ran: true, ok: false, log: 'x', summary: 'no' });
    const r = await runAiRepairLoop(llm, [RUNG], ctx(), { fetchFiles, verify }, 2);
    // Round 2 put the file back to the repository's content: net nothing, so no verify, no commit.
    expect(r.rejected).toBe(1);
    expect(r.fix).toBeUndefined();
  });
});

describe('the bounds, and the guards that were NOT loosened', () => {
  it('rounds are bounded; a malformed setting takes the default, never "no limit"', async () => {
    expect(aiRepairMaxRounds({} as NodeJS.ProcessEnv)).toBe(4);
    expect(aiRepairMaxRounds({ MOBILE_AUTOFIX_AI_ROUNDS: 'lots' } as NodeJS.ProcessEnv)).toBe(4);
    expect(aiRepairMaxRounds({ MOBILE_AUTOFIX_AI_ROUNDS: '99' } as NodeJS.ProcessEnv)).toBe(8);
    expect(aiRepairMaxRounds({ MOBILE_AUTOFIX_AI_ROUNDS: '2' } as NodeJS.ProcessEnv)).toBe(2);
    const llm = scripted(Array.from({ length: 20 }, (_, i) => fix({ 'src/App.tsx': `export const App = () => <div>${i}</div>;` })));
    const r = await runAiRepairLoop(llm, [RUNG], ctx(), { fetchFiles, verify: async () => ({ ran: true, ok: false, log: 'x', summary: 'no' }) }, 3);
    expect(r.rounds).toBe(3);
  });

  it('🔴 a comment-only rewrite is not a change — it used to be reported as `fixed: true`', () => {
    expect(isMeaningfulChange('src/a.ts', 'const a = 1;', '// note\nconst a = 1;')).toBe(false);
    expect(isMeaningfulChange('src/a.ts', 'const a = 1;', 'const a = 1;   /* same */')).toBe(false);
    expect(isMeaningfulChange('.github/workflows/x.yml', 'run: npm ci', '# note\nrun: npm ci')).toBe(false);
    expect(isMeaningfulChange('index.html', '<div/>', '<!-- x --><div/>')).toBe(false);
    expect(isMeaningfulChange('src/a.ts', 'const a = 1;', 'const a = 2;')).toBe(true);
    // A URL inside a string is not a comment.
    expect(isMeaningfulChange('src/a.ts', 'const u = "http://x";', 'const u = "http://y";')).toBe(true);
    const r = parseAiRepairReply(fix({ 'src/App.tsx': `// touched\n${ORIGINAL['src/App.tsx']}` }), Object.keys(ORIGINAL), ORIGINAL);
    expect(r).toBeNull();
  });

  it('an honest fixable:false from the model ends the loop as a miss, spending nothing more', async () => {
    const llm = scripted([JSON.stringify({ fixable: false, explanation: 'The signing key is missing.' })]);
    const r = await runAiRepairLoop(llm, [RUNG], ctx(), { fetchFiles, verify: async () => ({ ran: true, ok: true }) });
    expect(r.outcome).toBe('miss');
    expect(r.rounds).toBe(1);
    expect(r.reason).toContain('signing key');
  });

  it('no chain ⇒ miss, and every user-facing sentence is vendor-free (White-Label Law)', async () => {
    const r = await runAiRepairLoop(scripted([]), [], ctx(), { fetchFiles });
    expect(r.outcome).toBe('miss');
    const src = codeOnly(read('src/server/lib/mobileBuildAiRepair.ts'));
    for (const line of src.split('\n').filter((l) => /reason:|none\(/.test(l))) {
      for (const vendor of ['GLM', 'Kimi', 'Claude', 'Sonnet', 'Opus', 'Gemini', 'Grok', 'OpenAI']) {
        expect(line).not.toContain(vendor);
      }
    }
  });

  it('the app-source rule: packaging files are never "the app", and secrets never are either', () => {
    expect(isAppSourcePath('src/App.tsx')).toBe(true);
    expect(isAppSourcePath('package.json')).toBe(false);
    expect(isAppSourcePath('capacitor.config.ts')).toBe(false);
    expect(isAppSourcePath('.github/workflows/android-apk.yml')).toBe(false);
    expect(isAppSourcePath('src/../.env')).toBe(false);
  });
});

// ───────────────────────── the verifier ─────────────────────────

function fakeSandbox(files: Record<string, string>, over: Partial<RealBuildActuator> & { result?: { success: boolean; logs: string }; delayMs?: number } = {}) {
  const disk = { ...files };
  const log: string[] = [];
  let builds = 0;
  const a: RealBuildActuator & { disk: Record<string, string>; log: string[]; builds: () => number } = {
    readFile: async (_w, p) => { if (!(p in disk)) throw new Error(`no such file: ${p}`); return disk[p]; },
    writeFile: async (_w, p, c) => { disk[p] = c; log.push(`write ${p}`); },
    listFiles: async () => Object.keys(disk),
    build: async () => {
      builds += 1;
      if (over.delayMs) await new Promise((r) => setTimeout(r, over.delayMs));
      return over.result ?? { success: true, logs: 'ok' };
    },
    ...over,
    disk, log, builds: () => builds,
  };
  return a;
}
const WEB = { stage: 'webbuild' as const, code: 'APP_CODE_BUILD_FAILED' };

describe('which failures the sandbox may judge', () => {
  it('the app\'s own build stages, yes; Gradle, Xcode and Capacitor, no — a pass there would answer a different question', () => {
    expect(sandboxCanJudge({ stage: 'webbuild', code: 'APP_CODE_BUILD_FAILED' })).toBe(true);
    expect(sandboxCanJudge({ stage: 'install', code: 'NPM_PEER_CONFLICT' })).toBe(true);
    expect(sandboxCanJudge({ stage: 'android', code: 'STALE_WORKFLOW' })).toBe(false);
    expect(sandboxCanJudge({ stage: 'ios', code: 'UNKNOWN' })).toBe(false);
    expect(sandboxCanJudge({ stage: 'capacitor', code: 'WEB_DIR_MISSING' })).toBe(false);
    expect(sandboxCanJudge({ stage: null, code: 'APP_CODE_BUILD_FAILED' })).toBe(true);
    expect(sandboxCanJudge({ stage: null, code: 'GRADLEW_NOT_EXECUTABLE' })).toBe(false);
  });

  it('no workspace, or an unjudgeable stage, yields NO verifier — the loop then labels its fix unverified', () => {
    expect(makeRepairVerifier(fakeSandbox({}), '', WEB, isAppSourcePath)).toBeUndefined();
    expect(makeRepairVerifier(fakeSandbox({}), 'ws', { stage: 'android', code: 'UNKNOWN' }, isAppSourcePath)).toBeUndefined();
    expect(makeRepairVerifier(null, 'ws', WEB, isAppSourcePath)).toBeUndefined();
  });
});

describe('the sandbox is the user\'s workspace, borrowed', () => {
  it('🔴 no machine holds the app ⇒ "could not tell", and the build is never run', async () => {
    const a = fakeSandbox({});
    const v = makeRepairVerifier(a, 'ws', WEB, isAppSourcePath)!;
    expect(await v({ 'src/App.tsx': 'x' })).toEqual({ ran: false, reason: 'no-sandbox' });
    expect(a.builds()).toBe(0);
  });

  it('a failed build puts every file back exactly as it was', async () => {
    const a = fakeSandbox({ ...ORIGINAL }, { result: { success: false, logs: 'error during build:\nnope' } });
    const v = makeRepairVerifier(a, 'ws', WEB, isAppSourcePath)!;
    const r = await v({ 'src/App.tsx': 'changed', 'package.json': '{"changed":true}' });
    expect(r.ran && !r.ok && r.log).toContain('nope');
    expect(a.disk['src/App.tsx']).toBe(ORIGINAL['src/App.tsx']);
    expect(a.disk['package.json']).toBe(ORIGINAL['package.json']);
    expect(a.builds()).toBe(1);
  });

  it('a passing build keeps the app\'s own healed source and puts the repository-only files back', async () => {
    const a = fakeSandbox({ ...ORIGINAL });
    const v = makeRepairVerifier(a, 'ws', WEB, isAppSourcePath)!;
    expect(await v({ 'src/App.tsx': 'healed', 'package.json': '{"assembled":true}' })).toEqual({ ran: true, ok: true });
    expect(a.disk['src/App.tsx']).toBe('healed');
    expect(a.disk['package.json']).toBe(ORIGINAL['package.json']);
  });

  it('a timeout restores and is "could not tell", never a failure verdict', async () => {
    const a = fakeSandbox({ ...ORIGINAL }, { delayMs: 50 });
    const v = makeRepairVerifier(a, 'ws', { ...WEB, budgetMs: 10 }, isAppSourcePath)!;
    expect(await v({ 'src/App.tsx': 'changed' })).toEqual({ ran: false, reason: 'timed-out' });
    expect(a.disk['src/App.tsx']).toBe(ORIGINAL['src/App.tsx']);
  });

  it('a repository file the sandbox does not have is not planted there; with nothing to test there is no verdict', async () => {
    const a = fakeSandbox({ ...ORIGINAL });
    const v = makeRepairVerifier(a, 'ws', WEB, isAppSourcePath)!;
    expect(await v({ '.github/workflows/android-apk.yml': 'x', 'capacitor.config.ts': 'y' })).toEqual({ ran: false, reason: 'nothing-to-test' });
    expect('.github/workflows/android-apk.yml' in a.disk).toBe(false);
    expect(a.builds()).toBe(0);
  });
});

// ───────────────────────── the wiring ─────────────────────────

describe('the route and the panel', () => {
  const route = codeOnly(read('src/server/routes/mobileShip.ts'));
  const panel = codeOnly(read('src/components/ide/StoreBuildPanel.tsx'));

  it('🔴 a repair starts ONE GitHub run, not two — the server commits, the client dispatches', () => {
    expect(route).not.toContain('commitAndRerun');
    expect(route).toContain('const commitFix = async (files: Record<string, string>, message: string): Promise<void> => {');
    // The one dispatch in this file is the trigger route's. The autofix route must not carry a second.
    expect(route.match(/\/actions\/workflows\/\$\{workflow\}\/dispatches/g)?.length).toBe(1);
  });

  it('🔒 a class no repair can fix ends before a model is spent, from the ONE family list', () => {
    expect(route).toContain("if (cureFamily(diag.code) === 'user-credentials') {");
    expect(route.indexOf("cureFamily(diag.code) === 'user-credentials'")).toBeLessThan(route.indexOf('const tryAiRepair = async'));
  });

  it('the workspace comes from the VERIFIED identity plus the session — never from the body alone', () => {
    expect(route).toContain("workspaceId = sessionWorkspaceId(identity.uid, typeof sessionId === 'string' ? sessionId : '');");
    expect(route).toContain("makeRepairVerifier(buildActuator(), workspaceId ?? '', { stage, code: diag.code }, isAppSourcePath, toWorkspace)");
  });

  it('a VERIFIED fix heals the workspace too; an unverified one never touches it; a rejected one commits nothing', () => {
    expect(route).toContain('if (loop.verified && workspaceId) {');
    // A repository path is mapped to its WORKSPACE path first (a static repo keeps its source under
    // `www/`; a prebuilt one keeps its build there), and only app source that has a home is healed.
    expect(route).toContain('const local = toWorkspace(repoPath);');
    expect(route).toContain('if (local && isAppSourcePath(local)) source[local] = content;');
    expect(route).toContain("if (loop.outcome === 'gave-up') {");
    expect(route).toContain('verified: loop.verified,');
  });

  it('the panel sends the session, and its last sentence says whether anything was really repaired', () => {
    expect(panel).toContain('runId: finished.id, powerLevel, sessionId }');
    expect(panel).toContain('fixesApplied > 0');
    expect(panel).toContain('could not find a repair it could verify');
    expect(panel).not.toContain("'NavBharatAI fixed what it could and tried again, but the build still did not finish.'");
  });
});
