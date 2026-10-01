// Autopsy 1be16985 (2026-10-01) — "Make biology  learning app", Weak tier, 9.7 minutes against a 6–8
// minute estimate, a working app at the end.
//
//   1. Four words, no features: the scorer recognised nothing, a second opinion was bought, it said
//      "complex", and the build opened on the reasoning rung with the fast lane skipped.
//   2. 63 class names with no style rule survived to the end of the architect's turn; its one attempt to
//      add them missed its anchor and was never retried; a 174 s fresh-context repair pass added them.
//   3. A post-write note told the model to add a React import that the automatic JSX runtime does not need.
//   4. The repair pass's reply — narrated into the user's chat — thanked the user for "the fixes you requested".
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decideComplexity, needsSecondOpinion, statesAScope } from '../src/server/AgentV3/complexityRouting';
import { decideStyleResume, MAX_STYLE_RESUMES } from '../src/server/AgentV3/stylePolishResume';
import { ToolDispatcher, nearestEditRegion, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { reviewEdit } from '../src/server/AgentV3/PostEditReviewer';
import { asPlatformRequest, PLATFORM_REQUEST_PREFIX } from '../src/server/AgentV3/platformRequest';

const PROMPT = 'Make biology  learning app';
const env = {} as NodeJS.ProcessEnv;

describe('1 · a request that states nothing to size is not sized by a guess', () => {
  it('the report\'s prompt states no scope and buys no second opinion', () => {
    expect(statesAScope(PROMPT)).toBe(false);
    expect(needsSecondOpinion(15, PROMPT)).toBe(false);
  });

  it('a model that would have said "complex" is never asked, and the build opens on the cheap rung', async () => {
    let asked = 0;
    const d = await decideComplexity({ prompt: PROMPT, score: 15 }, async () => { asked++; return 'complex'; }, { env });
    expect(asked).toBe(0);
    expect(d.verdict).toBe('simple');
    expect(d.source).toBe('deterministic');
    expect(d.reason).toContain('names no features');
  });

  it('a request that DOES state a scope still buys the opinion', async () => {
    for (const p of ['Make a learning management system', 'make a study app for class 10 with lessons, quizzes and a progress page']) {
      expect(statesAScope(p), p).toBe(true);
      expect(needsSecondOpinion(15, p), p).toBe(true);
      const d = await decideComplexity({ prompt: p, score: 15 }, async () => 'complex', { env });
      expect(d.verdict, p).toBe('complex');
      expect(d.source, p).toBe('model');
    }
  });

  it('a request in a script the scorer cannot read still buys the opinion', () => {
    expect(needsSecondOpinion(5, 'अस्पताल प्रबंधन प्रणाली बनाओ जिसमें डॉक्टर और मरीज हों')).toBe(true);
  });
});

describe('2 · a turn that ends with unstyled screens is handed the class list once', () => {
  const missing = ['app-shell', 'topic-card', 'quiz-option'];

  it('resumes with the list and the append instruction', () => {
    const d = decideStyleResume({ text: 'Your app is ready.', missing, sheet: 'src/index.css', resumesUsed: 0, env });
    expect(d.resume).toBe(true);
    expect(d.message).toContain('.app-shell');
    expect(d.message).toContain('EMPTY old_string');
    expect(d.message).toContain('src/index.css');
  });

  it('stands down when nothing is missing, after one resume, on a refusal, on a question, and when switched off', () => {
    expect(decideStyleResume({ text: 'done', missing: [], resumesUsed: 0, env }).standDown).toBe('nothing-missing');
    expect(decideStyleResume({ text: 'done', missing, resumesUsed: MAX_STYLE_RESUMES, env }).standDown).toBe('limit');
    expect(decideStyleResume({ text: "I can't build that app.", missing, resumesUsed: 0, env }).standDown).toBe('declined');
    expect(decideStyleResume({ text: 'Which colour would you like for the cards?', missing, resumesUsed: 0, env }).standDown).toBe('asked-the-user');
    expect(decideStyleResume({ text: 'done', missing, resumesUsed: 0, env: { AGENTV3_STYLE_RESUME: 'off' } as NodeJS.ProcessEnv }).standDown).toBe('disabled');
  });

  class Fake implements ActuatorPort {
    files = new Map<string, string>();
    unreadable = new Set<string>();
    async readFile(_w: string, p: string): Promise<string> {
      if (this.unreadable.has(p)) throw new Error('EIO');
      const f = this.files.get(p); if (f === undefined) throw new Error('ENOENT'); return f;
    }
    async writeFile(_w: string, p: string, c: string): Promise<void> { this.files.set(p, c); }
    async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
    async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
    async getPortUrl(_w: string, port: number): Promise<string> { return `https://x-${port}`; }
  }
  const dispatcher = (a: Fake) => { const s = new AgentEventStream(); return new ToolDispatcher(a, 'ws', new WorkspaceState(s), s); };

  it('the dispatcher reads the undefined classes from the workspace now', async () => {
    const a = new Fake();
    a.files.set('src/index.css', '.card { padding: 8px; }');
    a.files.set('src/App.tsx', 'export default () => <div className="card app-shell"><p className="topic-card">x</p></div>;');
    const r = await dispatcher(a).undefinedClassesNow();
    expect(r.missing.sort()).toEqual(['app-shell', 'topic-card']);
    expect(r.sheet).toBe('src/index.css');
  });

  it('a stylesheet it could not read means "unknown", never a list', async () => {
    const a = new Fake();
    a.files.set('src/index.css', '.app-shell { display: grid; }');
    a.files.set('src/App.tsx', 'export default () => <div className="app-shell" />;');
    a.unreadable.add('src/index.css');
    expect((await dispatcher(a).undefinedClassesNow()).missing).toEqual([]);
  });

  it('is wired into the end of the architect\'s turn, after a ready verdict', () => {
    const src = readFileSync('src/server/AgentV3/AgentRunner.ts', 'utf8');
    expect(src).toMatch(/readiness\.ready && styleResumes === 0[\s\S]{0,400}undefinedClassesNow\(\)[\s\S]{0,400}decideStyleResume\(/);
  });

  it('an edit that misses its anchor in a long file is shown the END of the file and told how to append', () => {
    const css = Array.from({ length: 400 }, (_, i) => `.rule-${i} { margin: ${i}px; }`).join('\n');
    const out = nearestEditRegion(css, '.a-rule-that-was-never-there { color: red; }\n.another-missing-line { x: y; }');
    expect(out).toContain('.rule-399');
    expect(out).toContain('EMPTY old_string');
  });
});

describe('3 · plain JSX needs no React import under the automatic runtime', () => {
  it('a component with JSX and no React import gets no import note', () => {
    const r = reviewEdit('src/components/TopicView.tsx', "import type { Topic } from '../types';\nexport default function TopicView({ t }: { t: Topic }) {\n  return <div className=\"x\">{t.title}</div>;\n}\n");
    expect(r.issues.some((i) => /react/i.test(i))).toBe(false);
  });
});

describe('4 · a repair the platform asked for is not a request the user made', () => {
  it('the instruction is prefixed once', () => {
    const once = asPlatformRequest('The app is built and compiles. Fix these pages.');
    expect(once.startsWith(PLATFORM_REQUEST_PREFIX)).toBe(true);
    expect(asPlatformRequest(once)).toBe(once);
  });

  it('every repair runner the route builds is marked as a platform request', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    const sites = [...route.matchAll(/\n([ \t]*)client: buildTurnRunner\(healRunnerOpts\(\)\),\n[ \t]*(\S[^\n]*)/g)];
    expect(sites.length).toBeGreaterThan(10);
    for (const m of sites) expect(m[2]).toBe('platformRequest: true,');
  });

  it('AgentRunner puts the prefix on the run\'s first message', () => {
    const src = readFileSync('src/server/AgentV3/AgentRunner.ts', 'utf8');
    expect(src).toContain("content: this.opts.platformRequest ? asPlatformRequest(userPrompt) : userPrompt");
  });
});
