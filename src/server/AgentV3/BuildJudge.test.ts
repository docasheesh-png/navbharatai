import { describe, it, expect } from 'vitest';
import { buildJudgePrompt, parseJudgeVerdict, judgeBuild, judgeRepairPrompt } from './BuildJudge';

describe('buildJudgePrompt', () => {
  it('includes the request + the files, and demands JSON-only', () => {
    const { system, user } = buildJudgePrompt('build a login', [{ path: 'src/App.tsx', content: 'export default () => <div/>' }]);
    expect(system).toMatch(/STRICT/);
    expect(system).toMatch(/JSON/);
    expect(user).toContain('build a login');
    expect(user).toContain('src/App.tsx');
  });
  it('skips node_modules/dist and bounds the file count', () => {
    const files = Array.from({ length: 40 }, (_, i) => ({ path: `src/f${i}.ts`, content: 'x' }));
    files.push({ path: 'node_modules/react/index.js', content: 'IGNORE_ME' });
    const { user } = buildJudgePrompt('x', files);
    expect(user).not.toContain('IGNORE_ME');
    expect((user.match(/--- src\/f/g) || []).length).toBeLessThanOrEqual(24);
  });
});

describe('parseJudgeVerdict', () => {
  it('parses a clean pass', () => {
    expect(parseJudgeVerdict('{"verdict":"pass","findings":[],"score":95}')).toEqual({ pass: true, findings: [], score: 95 });
  });
  it('parses a fail with findings (extracts JSON from surrounding prose)', () => {
    const v = parseJudgeVerdict('Here is my review:\n{"verdict":"fail","findings":["login is cosmetic","password in localStorage"],"score":30}\nThanks');
    expect(v.pass).toBe(false);
    expect(v.findings).toEqual(['login is cosmetic', 'password in localStorage']);
    expect(v.score).toBe(30);
  });
  it('a FAIL with no findings is unactionable → treated as PASS (never escalate blind)', () => {
    expect(parseJudgeVerdict('{"verdict":"fail","findings":[]}').pass).toBe(true);
  });
  it('unparseable / empty / null reply → PASS (best-effort, never block a build)', () => {
    expect(parseJudgeVerdict('the model rambled with no json').pass).toBe(true);
    expect(parseJudgeVerdict('').pass).toBe(true);
    expect(parseJudgeVerdict(null).pass).toBe(true);
  });
  it('clamps the score to 0–100 and caps findings at 10', () => {
    const v = parseJudgeVerdict(`{"verdict":"fail","score":999,"findings":[${Array.from({ length: 20 }, (_, i) => `"f${i}"`).join(',')}]}`);
    expect(v.score).toBe(100);
    expect(v.findings.length).toBe(10);
  });
});

describe('judgeBuild — DI-testable, best-effort', () => {
  const sonnet = 'claude-sonnet-4-6';
  it('returns the parsed verdict from the injected Sonnet turn', async () => {
    const runTurn = async () => ({ text: '{"verdict":"fail","findings":["missing real auth"],"score":40}' });
    const v = await judgeBuild('add login', [{ path: 'a.tsx', content: 'x' }], runTurn, sonnet);
    expect(v.pass).toBe(false);
    expect(v.findings).toEqual(['missing real auth']);
  });
  it('no files → PASS without calling the model', async () => {
    let called = false;
    const runTurn = async () => { called = true; return { text: '{"verdict":"fail","findings":["x"]}' }; };
    const v = await judgeBuild('x', [], runTurn, sonnet);
    expect(v.pass).toBe(true);
    expect(called).toBe(false);
  });
  it('a model error → PASS (never blocks the build)', async () => {
    const runTurn = async () => { throw new Error('overloaded'); };
    const v = await judgeBuild('x', [{ path: 'a', content: 'b' }], runTurn, sonnet);
    expect(v.pass).toBe(true);
  });
  it('forces the SONNET model on the judge call', async () => {
    let usedModel = '';
    const runTurn = async (args: { model: string }) => { usedModel = args.model; return { text: '{"verdict":"pass","findings":[],"score":100}' }; };
    await judgeBuild('x', [{ path: 'a', content: 'b' }], runTurn, sonnet);
    expect(usedModel).toBe(sonnet);
  });
});

describe('judgeRepairPrompt — fix, not rebuild', () => {
  it('lists the findings and instructs EDITING existing files, not a rebuild', () => {
    const p = judgeRepairPrompt('build a calculator', ['ButtonType enum not exported', 'Operator logic wrong']);
    expect(p).toContain('1. ButtonType enum not exported');
    expect(p).toContain('2. Operator logic wrong');
    expect(p).toMatch(/EDITING the existing files/);
    expect(p).toMatch(/do NOT rebuild/i);
    expect(p).toContain('build a calculator');
  });
});
