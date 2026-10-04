// Autopsy 73648e12 + 2f723acb (2026-10-01) — "Build a mock test app for UPSC drug inspector exam 2026 based on
// previous papers, make it interactive", Weak tier. The user stopped the first build at 108 s, then pressed
// Continue and asked for an APK; the second build ran 11.5 minutes and billed ₹184.41.
//
//   1. "exam" made it an education platform: roles, courses, attendance and fees were added as "almost always
//      needed", and the scorer called it complex (58, the score of a hospital ERP).
//   2. "Continue…" on the two files of the stopped build was sized as "hi" (5) — the original request had been
//      set aside because two files of the user's existed, while the entry was still our starter.
//   3. The end-of-turn style check skipped every `nb-` class, handed back 2 classes, and 17 invented `nb-`
//      names reached a 95-second repair pass. The user was told "the app looks complete" over them.
//   4. "<h3>Latest mock test result</h3>" was reported to the user as a made-up result ("a random song").
//   5. The sign-in page had five buttons (three one-tap demo roles), so it was not read as a sign-in page:
//      nothing signed in, and the page check counted /login only while five routes redirected to it.
//   6. A package the stopped build had just installed was reported as unused.
//   7. An ambiguous edit was followed by a full re-read of the stylesheet.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import http from 'http';
import type { AddressInfo } from 'net';
import { analyzeRequirementGaps, buildRequirementGuidance, missingDomainFeatures, namesASingleLearnerTool } from '../src/server/lib/RequirementGapAnalyzer';
import { analyzeRequest } from '../src/server/AgentV3/RequestAnalyser';
import { planningRequest } from '../src/server/AgentV3/planningRequest';
import { scanAuthenticity, simulatedResultIssues, simulatedResultNotice } from '../src/server/AgentV3/AuthenticityAnalysis';
import { leftToTheKit, kitClasses } from '../src/server/AgentV3/kitRestore';
import { undefinedClassWriteNote } from '../src/server/AgentV3/CssConsistency';
import { doneStyleNote } from '../src/server/AgentV3/stylePolishResume';
import { ToolDispatcher, applyEdit, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { isSignInWall } from '../src/server/AgentV3/FeaturePresence';
import { classifyPage } from '../src/server/AgentV3/PageRouteCheck';
import { signInModule, parseSignInOutput, SIGN_IN_RESULT_MARKER } from '../src/server/AgentV3/signInExplore';
import { unusedDependencyLine } from '../src/server/AgentV3/unusedDepPrune';

const PROMPT = 'Build a mock test app for UPSC drug inspector exam 2026 based on previous papers, make it interactive';
const CONTINUE = 'Continue from where you left off and finish/fix the build so the app works end-to-end. Provide me with a downloadable APK, for testing';
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('1 · one learner\'s practice tool is not an education platform', () => {
  it('the report\'s prompt keeps its domain name and loses the institution features', () => {
    const g = analyzeRequirementGaps(PROMPT);
    expect(g.domain).toBe('education');
    expect(g.likelyMissing).toEqual([]);
    expect(g.clarifyingQuestions).toEqual([]);
    expect(buildRequirementGuidance(g)).not.toMatch(/REQUIREMENT AWARENESS/);
    expect(missingDomainFeatures(PROMPT, '').labels).toEqual([]);
  });

  it('it is sized as the quiz family, not as a hospital ERP', () => {
    const a = analyzeRequest({ prompt: PROMPT, buildIntent: 'new_build' } as Parameters<typeof analyzeRequest>[0]);
    expect(a.taskType).toBe('simple_app');
    expect(a.complexityScore).toBeLessThan(40);
  });

  it('a request that names an institution keeps the full list and the complex sizing', () => {
    const p = 'Build a mock test platform for my coaching institute with student logins and fees';
    expect(namesASingleLearnerTool(p)).toBe(false);
    expect(analyzeRequirementGaps(p).likelyMissing.length).toBeGreaterThan(0);
    expect(analyzeRequest({ prompt: p, buildIntent: 'new_build' } as Parameters<typeof analyzeRequest>[0]).taskType).toBe('complex_app');
    expect(analyzeRequest({ prompt: 'school management system', buildIntent: 'new_build' } as Parameters<typeof analyzeRequest>[0]).taskType).toBe('complex_app');
  });

  it('the practice tools are recognised; an exam with nothing named is not one', () => {
    for (const p of ['make a test series app for SSC CGL', 'flashcards app for NEET biology', 'UPSC previous year papers app', 'question bank app for class 10 maths']) {
      expect(namesASingleLearnerTool(p), p).toBe(true);
    }
    expect(namesASingleLearnerTool('Build an exam app')).toBe(false);
  });
});

describe('2 · "Continue" on a started-but-unbuilt app is sized from the request it continues', () => {
  const recentTurns = [{ text: PROMPT, lane: 'build' as const }];

  it('the earlier request is read while the entry is still our starter', () => {
    const r = planningRequest({ prompt: CONTINUE, recentTurns, userAppExists: true, appStillUnbuilt: true });
    expect(r.sources).toContain('earlier-requests');
    expect(r.text).toContain('mock test app for UPSC');
    expect(r.text).toContain('started but never finished');
  });

  it('a finished app is unchanged: "Continue" is sized alone', () => {
    const r = planningRequest({ prompt: CONTINUE, recentTurns, userAppExists: true });
    expect(r.sources).toEqual([]);
    expect(r.text).toBe(CONTINUE);
  });

  it('the route reads the entry file and passes the reading in', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toMatch(/const appStillUnbuilt = await[\s\S]{0,900}isUntouchedStarterEntry\(got\[p\]\)/);
    expect(route).toContain('planningRequest({ prompt, attachmentText: planningAttachmentText, picturesSetAside, recentTurns, conversationReply, userAppExists, appStillUnbuilt })');
  });
});

describe('3 · an invented nb- class is handed back like any other', () => {
  it('only a class the kit defines is left to the kit', () => {
    const kitOne = [...kitClasses()].find((c) => c.startsWith('nb-'))!;
    expect(leftToTheKit(kitOne)).toBe(true);
    expect(leftToTheKit('nb-demo-roles')).toBe(false);
    expect(leftToTheKit('nb-option-key')).toBe(false);
    expect(leftToTheKit('card')).toBe(false);
  });

  class Fake implements ActuatorPort {
    files = new Map<string, string>();
    async readFile(_w: string, p: string): Promise<string> { const f = this.files.get(p); if (f === undefined) throw new Error('ENOENT'); return f; }
    async writeFile(_w: string, p: string, c: string): Promise<void> { this.files.set(p, c); }
    async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
    async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
    async getPortUrl(_w: string, port: number): Promise<string> { return `https://x-${port}`; }
  }
  const dispatcher = (a: Fake) => { const s = new AgentEventStream(); return new ToolDispatcher(a, 'ws', new WorkspaceState(s), s); };

  it('the end-of-turn check names the report\'s invented classes, and still leaves the kit\'s own to the kit', async () => {
    const kitOne = [...kitClasses()].find((c) => c.startsWith('nb-'))!;
    const a = new Fake();
    a.files.set('src/index.css', '.card { padding: 8px; }');
    a.files.set('src/components/AuthScreen.tsx', `export default () => <div className="card ${kitOne}"><div className="nb-demo-roles"><span className="badge-soft">x</span></div></div>;`);
    const r = await dispatcher(a).undefinedClassesNow();
    expect(r.missing).toContain('nb-demo-roles');
    expect(r.missing).toContain('badge-soft');
    expect(r.missing).not.toContain(kitOne);
  });

  it('a stylesheet write lists invented nb- classes of the screens, but not those a screen in the same write uses', () => {
    const project = { 'src/components/Tests.tsx': 'export default () => <div className="nb-option-key quiz-row" />;' };
    const sheetOnly = undefinedClassWriteNote({ 'src/index.css': '.card{}' }, project, { kitDefines: leftToTheKit });
    expect(sheetOnly).toContain('.nb-option-key');
    expect(sheetOnly).toContain('.quiz-row');
    const withScreen = undefinedClassWriteNote({ 'src/index.css': '.card{}', 'src/components/Tests.tsx': project['src/components/Tests.tsx'] }, {}, { kitDefines: leftToTheKit });
    expect(withScreen).not.toContain('.nb-option-key');
    // Without the predicate the old behaviour is kept exactly.
    expect(undefinedClassWriteNote({ 'src/index.css': '.card{}' }, project)).not.toContain('.nb-option-key');
  });

  it('"the app looks complete" is not said over unstyled screens; the done steer names them instead', () => {
    expect(doneStyleNote(['nb-demo-roles', '.badge-soft'], 'src/index.css')).toMatch(/Before you finish: 2 class name\(s\)[\s\S]*\.nb-demo-roles[\s\S]*EMPTY old_string/);
    expect(doneStyleNote([], 'src/index.css')).toBe('');
    const runner = read('src/server/AgentV3/AgentRunner.ts');
    expect(runner).toMatch(/styleNote = doneStyleNote\(style\.missing, style\.sheet\)[\s\S]{0,200}if \(styleNote\) doneText = [\s\S]{0,80}else events\.emit\([\s\S]{0,120}The app looks complete/);
  });
});

describe('4 · a mock test is an exam, not a made-up result', () => {
  it('the report\'s own line, and its identifier forms, are not flagged', () => {
    for (const line of ['<h3>Latest mock test result</h3>', 'const mockTestResults = loadAttempts();', 'Your simulated exam results', 'mock interview answers']) {
      expect(scanAuthenticity('src/components/Dashboard.tsx', line).map((i) => i.kind), line).not.toContain('simulated-result');
    }
  });

  it('a made-up result is still caught', () => {
    for (const line of ['// Simulate AI Overview generation', 'const song = MOCK_DB[Math.floor(Math.random() * MOCK_DB.length)];', 'mockResults = []', '// Simulate API call to fetch test results']) {
      expect(scanAuthenticity('src/a.tsx', line).map((i) => i.kind), line).toContain('simulated-result');
    }
  });

  it('the user is never given an example that is not in their app', () => {
    const n = simulatedResultNotice(simulatedResultIssues({ 'src/a.tsx': 'const r = MOCK_DB[0]; // mock search results' }));
    expect(n).toMatch(/demo results, not real ones/);
    expect(n).not.toMatch(/song/);
  });
});

describe('5 · a sign-in page with demo buttons is a sign-in page', () => {
  const PAGE = '<div id=root><h1>UPSC Drug Inspector</h1><form><label>Email<input type=email></label><label>Password<input type="password"></label><button type=submit>Log in</button></form><button>Create new account</button><div class="nb-demo-roles"><button>Demo Student</button><button>Demo Teacher</button><button>Demo Admin</button></div></div>';

  it('the report\'s page is a wall; an app screen with a password box is not', () => {
    expect(isSignInWall(PAGE.toLowerCase())).toBe(true);
    const settings = '<input type=password><button>Save</button><button>Delete</button><button>Export</button><button>Import</button><button>Share</button>';
    expect(isSignInWall(settings.toLowerCase())).toBe(false);
  });

  it('a redirect records where it went, and the route signs in when routes redirect to a sign-in page', () => {
    const r = classifyPage({ route: '/courses', status: 200, text: 500, errors: [], finalPath: '/login' });
    expect(r.verdict).toBe('redirected');
    expect(r.redirectedTo).toBe('/login');
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toMatch(/r\.verdict === 'redirected' && typeof r\.redirectedTo === 'string' && isSignInRoute\(r\.redirectedTo\)[\s\S]{0,200}signInBehindTheDoor\(lastPreviewUrl\)/);
  });

  it('the sign-in module carries no backslash its TS template would swallow', () => {
    const mod = signInModule({ base: 'http://x/', marker: SIGN_IN_RESULT_MARKER, state: '/tmp/s.json', maxScreens: 6, budgetMs: 45_000, candidates: [] });
    // eslint-disable-next-line no-control-regex
    expect(mod).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);
    expect(mod).toContain('one-tap demo button on the sign-in page');
  });
});

describe('6 · a package a stopped build just installed is "not used yet", never "unused"', () => {
  it('unfinished + added this build ⇒ information; otherwise the old warning', () => {
    const stopped = unusedDependencyLine('react-router-dom', { unfinished: true, addedThisBuild: true });
    expect(stopped.severity).toBe('info');
    expect(stopped.message).toMatch(/not used yet/);
    expect(unusedDependencyLine('react-router-dom', { unfinished: false, addedThisBuild: true }).severity).toBe('warning');
    expect(unusedDependencyLine('lodash', { unfinished: true, addedThisBuild: false }).severity).toBe('warning');
  });
});

describe('7 · an ambiguous edit shows where each match is', () => {
  it('lists the lines so the retry needs no re-read', () => {
    let msg = '';
    try { applyEdit('a {\n  color: red;\n}\nb {\n  color: red;\n}\n', '  color: red;', 'x', 'src/index.css'); } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/not unique in src\/index\.css \(2 matches\)/);
    expect(msg).toMatch(/Match at line 2:[\s\S]*Match at line 5:/);
    expect(msg).toContain('Add a neighbouring line');
  });
});

// ── A REAL BROWSER, where one exists ────────────────────────────────────────────────────────────────
const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const haveBrowser = existsSync(PW) && existsSync(BROWSERS);

/** The report's sign-in page: a form nobody filled, and one-tap demo buttons that fill it. */
function demoSpa(): string {
  return `<!doctype html><html><body><div id="root"></div><script>
const root = document.getElementById('root');
function render() {
  if (localStorage.getItem('session') !== 'ok') {
    root.innerHTML = '<h1>Mock Tests</h1><form id="f"><label for="e">Email</label><input id="e" type="email"><label for="p">Password</label><input id="p" type="password"><button type="submit">Log in</button></form>'
      + '<button id="c">Create new account</button><button class="d" data-e="student@demo.com">Demo Student</button><button class="d" data-e="teacher@demo.com">Demo Teacher</button>';
    document.querySelectorAll('.d').forEach(function (b) { b.onclick = function () { document.getElementById('e').value = b.getAttribute('data-e'); document.getElementById('p').value = 'demo123'; }; });
    document.getElementById('f').onsubmit = function (ev) {
      ev.preventDefault();
      if (document.getElementById('p').value === 'demo123') { localStorage.setItem('session', 'ok'); history.pushState({}, '', '/tests'); render(); }
    };
    return;
  }
  root.innerHTML = '<nav><a href="/tests">Mock Tests</a><a href="/results">Results</a></nav><h1>Mock Tests</h1><p>Paper 1</p>';
}
render();
</script></body></html>`;
}

describe.skipIf(!haveBrowser)('in a real browser', () => {
  let server: http.Server;
  let base = '';
  beforeAll(async () => {
    server = http.createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(demoSpa()); });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  afterAll(async () => { await new Promise<void>((res) => server.close(() => res())); });

  it('signs in with a one-tap demo button that fills the form, and reads the screens behind it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nbai-demo-signin-'));
    const file = join(dir, 'run.mjs');
    const imp = `import playwright from '${PW}';\nconst { chromium } = playwright;`;
    writeFileSync(file, signInModule({ base, marker: SIGN_IN_RESULT_MARKER, state: join(dir, 's.json'), maxScreens: 6, budgetMs: 45_000, candidates: [] }, imp));
    const { execFile } = await import('node:child_process');
    const out = await new Promise<string>((res, rej) => execFile(process.execPath, [file], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 90_000 }, (e, o) => (e ? rej(e) : res(o))));
    const run = parseSignInOutput(out);
    expect(run.signedIn).toBe(true);
    expect(run.note).toBe('one-tap demo button on the sign-in page');
    expect(run.screens.map((s) => s.path)).toEqual(expect.arrayContaining(['/results']));
  }, 120_000);
});
