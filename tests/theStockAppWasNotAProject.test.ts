/**
 * AUTOPSY 8e124182 (2026-09-30) — a stock-inventory app, Weak tier, 30.5 minutes, ₹639.85.
 *
 * The app rendered and worked. Everything around it went wrong in a chain, and each link is locked here
 * against the report's own evidence (the verbatim prompt is `fixtures/autopsy8e124182.prompt.txt`):
 *   1. a prompt-generator template's `# Steps` and prose counted as 16 features → Software Project Mode;
 *   2. module 1 (types only) was judged "nothing built yet", so the model built the whole app inside it
 *      and the plan still said 1 of 14 modules done;
 *   3. our own starter test crashed in Node on `localStorage`, colour codes hid which file failed, and
 *      the repair rewrote the user's source to satisfy OUR test — its reply became the build's answer;
 *   4. refused by the green freeze twice, the model wrote the file with `cat >` and nothing noticed;
 *   5. "List / items" was called missing from behind the sign-in page;
 *   6. "Add New Stock Item Menu" made it a restaurant;
 *   7. "using PHP MVC architecture" was built in React without a word to the user.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { countEnumeratedFeatures, STRUCTURED_MIN } from '../src/server/AgentV3/enumeratedFeatures';
import { megaProjectSignals, starterEntryExpectedFor, moduleOwnsAppEntry, type ProjectPlan, type ProjectModule } from '../src/server/AgentV3/ProjectPlan';
import { parseTestOutcome, stripAnsi, testOutcomeRepairPrompt } from '../src/server/AgentV3/testRunner';
import { planAutoTests, STARTER_TEST_MARKER, isPlatformStarterTest, failuresAreOurStarterTests, withBrowserStorageShim } from '../src/server/AgentV3/TestGenerationAgent';
import { adoptHealResult } from '../src/server/AgentV3/healResult';
import { shellWriteTargets } from '../src/server/AgentV3/shellWriteTargets';
import { checkFeaturePresence, isSignInWall } from '../src/server/AgentV3/FeaturePresence';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';
import { unsupportedStackRequested, unsupportedStackUserNote, unsupportedStackBuilderNote } from '../src/server/AgentV3/unsupportedStack';
import { latchGreen, clearGreenLatch, writeRefused, GreenFreezeError } from '../src/server/AgentV3/greenFreeze';

const PROMPT = readFileSync(join(__dirname, 'fixtures/autopsy8e124182.prompt.txt'), 'utf8');
const ROUTE = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
const DISPATCHER = readFileSync(join(__dirname, '../src/server/AgentV3/ToolDispatcher.ts'), 'utf8');

describe('1 · a prompt about how to answer is not a list of what to build', () => {
  it('the report prompt no longer turns Software Project Mode on', () => {
    const sig = megaProjectSignals(PROMPT);
    expect(sig.features).toBeLessThan(14);
    expect(sig.fires).toBe(false);
  });

  it('lines under # Steps / # Output Format are instructions, not parts', () => {
    const steps = ['Build an app with:', '- login', '- dashboard', '', '# Steps', ...Array.from({ length: 20 }, (_, i) => `${i + 1}. Explain part ${i} strategy`)].join('\n');
    expect(countEnumeratedFeatures(steps)).toBe(2);
  });

  it('prose between the bullets of a structured spec adds no inline run', () => {
    const bullets = Array.from({ length: STRUCTURED_MIN }, (_, i) => `- module ${i}`).join('\n');
    const text = `You are tasked with designing, developing, testing, and shipping it.\n${bullets}\nFor each, include design notes, security notes, test notes, and docs.`;
    expect(countEnumeratedFeatures(text)).toBe(STRUCTURED_MIN);
  });

  it('a genuine big spec still fires, and a one-line comma list still counts', () => {
    const big = Array.from({ length: 15 }, (_, i) => `- feature number ${i}`).join('\n');
    expect(megaProjectSignals(big).fires).toBe(true);
    expect(countEnumeratedFeatures('school ERP with students, teachers, attendance, fees, exams, timetable, library, transport')).toBeGreaterThanOrEqual(8);
  });
});

describe('2 · a module that does not own the entry leaves it as the starter on purpose', () => {
  const mod = (id: string, files: string[], status: ProjectModule['status'] = 'pending'): ProjectModule =>
    ({ id, name: id, description: id, dependsOn: [], files, contracts: '', status });
  const plan = (modules: ProjectModule[]): ProjectPlan => ({ modules } as unknown as ProjectPlan);

  it('types-only module 1, with App.tsx owned by a later module → the starter entry is expected', () => {
    const types = mod('foundation-types', ['src/types/index.ts'], 'in_progress');
    const root = mod('app-root', ['src/App.tsx', 'src/main.tsx']);
    expect(moduleOwnsAppEntry(root)).toBe(true);
    expect(starterEntryExpectedFor(plan([types, root]), types)).toBe(true);
  });

  it('the module that owns the entry — and a plan where nobody does — keep the gate', () => {
    const types = mod('foundation-types', ['src/types/index.ts']);
    const root = mod('app-root', ['./src/App.tsx']);
    expect(starterEntryExpectedFor(plan([types, root]), root)).toBe(false);
    expect(starterEntryExpectedFor(plan([types, mod('ui', ['src/pages/A.tsx'])]), types)).toBe(false);
  });

  it('ONE flag after the merge with #3399 (autopsy 6a5fb04b fixed this in parallel): the route sets it from shellModuleFor, and the dispatcher stands the starter blocker down', () => {
    expect(ROUTE).toMatch(/const shell = shellModuleFor\(pPlan, projectModuleRef\);\s*if \(shell\) \{\s*moduleAwaitsShell = shell\.name;\s*dispatcher\.setStarterExpected\(true\);/);
    expect(ROUTE).not.toContain('setStarterEntryExpected');
    expect(DISPATCHER).not.toContain('setStarterEntryExpected');
    const body = DISPATCHER.slice(DISPATCHER.indexOf('private async _blockIfStillTheStarterApp'));
    expect(body.slice(0, 400)).toMatch(/if \(this\._starterExpected\) return report;/);
  });

  it('the two helpers are one answer, not two', () => {
    const types = mod('foundation-types', ['src/types/index.ts'], 'in_progress');
    const root = mod('app-root', ['src/main.tsx']); // owns an entry only the wider list names
    expect(moduleOwnsAppEntry(root)).toBe(true);
    expect(starterEntryExpectedFor(plan([types, root]), types)).toBe(true);
  });
});

describe('3 · our own starter test, the colour codes, and the repair that answered for the build', () => {
  const COLOURED = ' \u001b[31m❯\u001b[39m src/lib/auth.test.ts \u001b[2m(\u001b[22m\u001b[2m0 test\u001b[22m\u001b[2m)\u001b[22m\n'
    + '\u001b[41m\u001b[1m FAIL \u001b[22m\u001b[49m src/lib/auth.test.ts\u001b[2m [ src/lib/auth.test.ts ]\u001b[22m\n'
    + '\u001b[31m\u001b[1mReferenceError\u001b[22m: localStorage is not defined\u001b[39m\n'
    + '\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[31m1 failed\u001b[39m\u001b[22m\u001b[2m | \u001b[22m\u001b[1m\u001b[32m3 passed\u001b[39m\u001b[22m\u001b[90m (4)\u001b[39m\n'
    + '\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m34 passed\u001b[39m\u001b[22m\u001b[2m | \u001b[22m\u001b[90m25 todo\u001b[39m\u001b[90m (59)\u001b[39m\n';

  it('coloured vitest output yields counts and the failing FILE, not just "exit=1"', () => {
    const o = parseTestOutcome({ framework: 'vitest', command: "npx vitest run --exclude 'e2e/**'", reason: '' } as never, 1, COLOURED, '');
    expect(o.ok).toBe(false);
    expect(o.failingTests).toEqual(['src/lib/auth.test.ts']);
    expect(o.passed).toBe(34);
    expect(o.failed).toBe(1);
    expect(o.summary).not.toMatch(/exit=1/);
    expect(stripAnsi('\u001b[32mok\u001b[39m')).toBe('ok');
    // …and the repair is told to run exactly what we ran (the e2e exclude included).
    expect(testOutcomeRepairPrompt(o)).toContain("npx vitest run --exclude 'e2e/**'");
  });

  const seed = "const PREFIX = 'x_';\nexport function bootstrapData() { if (!localStorage.getItem(PREFIX)) localStorage.setItem(PREFIX, '1'); }\n";
  const auth = "import { bootstrapData } from './seed';\nbootstrapData();\nexport function login(e: string) { return e.length > 0; }\n";

  it('a starter test carries our marker, and a stand-in storage when the app uses browser storage', () => {
    const plan = planAutoTests([{ path: 'src/lib/auth.ts', content: auth }, { path: 'src/lib/seed.ts', content: seed }], { limit: 2 });
    expect(plan.length).toBe(2);
    for (const p of plan) {
      expect(p.content.startsWith(STARTER_TEST_MARKER)).toBe(true);
      expect(isPlatformStarterTest(p.content)).toBe(true);
      expect(p.content).toMatch(/import \{ describe, it, expect, vi \} from 'vitest';/);
      expect(p.content).toMatch(/vi\.hoisted\(\(\) => \{/);
    }
  });

  it('no stand-in where nothing touches browser storage', () => {
    const plan = planAutoTests([{ path: 'src/lib/math.ts', content: 'export function add(a: number, b: number) { return a + b; }\n' }]);
    expect(plan[0].content).not.toMatch(/vi\.hoisted/);
    expect(withBrowserStorageShim('no vitest import here')).toBe('no vitest import here');
  });

  it('only OUR failing tests stand the repair down; one of theirs, or a bare name, never does', () => {
    const ours = `${STARTER_TEST_MARKER}\nimport { describe } from 'vitest';`;
    expect(failuresAreOurStarterTests(['src/lib/auth.test.ts'], { 'src/lib/auth.test.ts': ours }, new Set())).toBe(true);
    expect(failuresAreOurStarterTests(['src/lib/auth.test.ts'], {}, new Set(['src/lib/auth.test.ts']))).toBe(true);
    expect(failuresAreOurStarterTests(['src/lib/auth.test.ts', 'src/x.test.ts'], { 'src/lib/auth.test.ts': ours, 'src/x.test.ts': 'mine' }, new Set())).toBe(false);
    expect(failuresAreOurStarterTests(['adds two numbers'], {}, new Set())).toBe(false);
    expect(failuresAreOurStarterTests([], {}, new Set())).toBe(false);
  });

  it('the vaccine asks "ours or theirs?" BEFORE it spends a repair on the user\'s source', () => {
    const ask = ROUTE.indexOf('failuresAreOurStarterTests(outcome.failingTests');
    const repair = ROUTE.indexOf("The app's own tests are failing (");
    expect(ask).toBeGreaterThan(0);
    expect(ask).toBeLessThan(repair);
  });

  it('a repair on a successful build keeps the build\'s answer', () => {
    const build = { ok: true, summary: 'Your stock app is ready.', steps: 40 };
    const healed = { ok: true, summary: 'The source bug that was crashing the test suite is fixed.', steps: 9 };
    expect(adoptHealResult(build, healed)).toEqual({ ok: true, summary: 'Your stock app is ready.', steps: 9 });
    expect(adoptHealResult({ ...build, ok: false }, healed).summary).toBe(healed.summary);
    // No repair in the route may overwrite the build's result wholesale any more.
    expect(ROUTE).not.toMatch(/\bresult = healed\b/);
    expect(ROUTE).not.toMatch(/result = healResult as typeof result/);
  });
});

describe('4 · the shell is not a way around the green freeze', () => {
  it('reads the write targets a shell expresses plainly — and not heredoc content', () => {
    expect(shellWriteTargets("cat > src/lib/seed.ts << 'EOF'\nconst a = b > c;\necho x > nothing.ts\nEOF")).toEqual(['src/lib/seed.ts']);
    expect(shellWriteTargets("echo 'a > b' > src/a.ts")).toEqual(['src/a.ts']);
    expect(shellWriteTargets("sed -i 's/a/b/' src/App.tsx")).toEqual(['src/App.tsx']);
    expect(shellWriteTargets('printf x | tee -a src/x.css')).toEqual(['src/x.css']);
    expect(shellWriteTargets('cp dist/index.html /home/user/workspace/public/index.html')).toEqual(['public/index.html']);
    expect(shellWriteTargets('rm src/lib/export.ts.bak')).toEqual(['src/lib/export.ts.bak']);
  });

  it('never invents a target: pipes, fd duplication, /tmp, /dev/null, dev commands', () => {
    for (const c of ['npx vitest run 2>&1 | head -200', 'ls -la src 2>/dev/null || true', 'npm run build > /tmp/out.txt 2>&1', 'mkdir -p src/types', 'npm run dev -- --host 0.0.0.0 --port 5173']) {
      expect(shellWriteTargets(c)).toEqual([]);
    }
  });

  it('the report\'s own bypass is refused on a latched app, with words that say not to look for another way', () => {
    const ws = 'autopsy-8e124182-freeze';
    latchGreen(ws, ['src/lib/seed.ts']);
    try {
      for (const t of shellWriteTargets("cat > src/lib/seed.ts << 'EOF'\nx\nEOF")) expect(writeRefused(ws, t)).toBe(true);
      expect(new GreenFreezeError('src/lib/seed.ts', null).message).toMatch(/shell is refused too/);
    } finally { clearGreenLatch(ws); }
    const bash = DISPATCHER.slice(DISPATCHER.indexOf("case 'bash': {"));
    expect(bash.slice(0, 6000)).toMatch(/if \(isGreenLatched\(this\.workspaceId\)\) \{\s*for \(const target of shellWriteTargets\(command\)\) assertWriteAllowed\(this\.workspaceId, target\);/);
  });
});

describe('5 · a sign-in screen hides the app, it does not lack it', () => {
  const LOGIN = '<div id="root"><div class="login"><h1>Stock Inventory</h1><form>'
    + '<label for="email">Email</label><input id="email" type="email" value="admin@example.com">'
    + '<label for="password">Password</label><input id="password" type="password">'
    + '<button type="button" aria-label="Show password">👁</button><button type="submit">Sign in</button>'
    + '</form></div></div>';

  it('is recognised as a sign-in wall; an app screen with a table is not', () => {
    expect(isSignInWall(LOGIN.toLowerCase())).toBe(true);
    expect(isSignInWall('<input type="password"><table><tr><td>x</td></tr></table>')).toBe(false);
    expect(isSignInWall('<input type="email"><button>Go</button>')).toBe(false);
  });

  it('only the sign-in feature is judged from behind it — nothing is called missing', () => {
    const r = checkFeaturePresence(PROMPT, LOGIN);
    expect(r.missing).toEqual([]);
    expect(r.probes.every((p) => p.feature === 'auth')).toBe(true);
  });
});

describe('6 · an app\'s "Items Menu" is navigation, not food', () => {
  it('the report prompt is an inventory app — not a restaurant, not a shop', () => {
    const g = analyzeRequirementGaps(PROMPT);
    expect(g.domain).toBe('inventory');
    expect(g.likelyMissing.join(' ')).not.toMatch(/kitchen|KOT|cart|checkout/i);
  });

  it('a real restaurant and a real shop keep their domains', () => {
    expect(analyzeRequirementGaps('Build a restaurant app with a digital menu, KOT and table billing').domain).toBe('restaurant');
    expect(analyzeRequirementGaps('a cafe app showing the menu items with prices').domain).toBe('restaurant');
    expect(analyzeRequirementGaps('an online store with cart, checkout, product catalog and inventory').domain).toBe('ecommerce');
  });
});

describe('7 · a stack we do not build is said out loud', () => {
  it('the report prompt asked for PHP; a migration, a question or an unrelated "rails" did not', () => {
    expect(unsupportedStackRequested(PROMPT)).toBe('PHP');
    expect(unsupportedStackRequested('a Laravel app for billing')).toBe('PHP');
    expect(unsupportedStackRequested('build an e-commerce site using Ruby on Rails')).toBe('Ruby on Rails');
    expect(unsupportedStackRequested('Convert my PHP website to React')).toBeNull();
    expect(unsupportedStackRequested('what is php?')).toBeNull();
    expect(unsupportedStackRequested('guard rails for the balcony')).toBeNull();
    expect(unsupportedStackRequested('build a todo app')).toBeNull();
  });

  it('the builder is told never to claim it, and the user is told what it really is', () => {
    expect(unsupportedStackBuilderNote('PHP', 'vite-react')).toMatch(/never claim the app is PHP/);
    expect(unsupportedStackUserNote('PHP', 'vite-react')).toMatch(/You asked for \*\*PHP\*\*.*React \+ TypeScript/s);
    expect(unsupportedStackUserNote(null, 'vite-react')).toBe('');
    expect(ROUTE).toMatch(/unsupportedStackRequested\(prompt\)/);
    expect(ROUTE).toMatch(/unsupportedStackUserNote\(unsupportedStackAsked, framework\)/);
  });
});

describe('8 · the test-suite repair on a working app is verified or undone', () => {
  it('runs in its own pass, on a snapshot, kept only if the suite passes AND the app renders', () => {
    const at = ROUTE.indexOf("runInPass('vaccine-repair'");
    expect(at).toBeGreaterThan(0);
    const around = ROUTE.slice(at - 1500, at + 1800);
    expect(around).toMatch(/if \(isGreenLatched\(workspaceId\)\) \{/);
    expect(around).toMatch(/snapshot: async \(\) => snap,/);
    expect(around).toMatch(/reverify: strictReverify\(/);
    expect(around).toMatch(/parseTestOutcome\(plan, again\.exitCode, again\.stdout, again\.stderr\)\.ok/);
    expect(around).toMatch(/analyzePreviewHtml\(shot\.html/);
    expect(around).toMatch(/revert: revertToGreenSnapshot,/);
    // …and an undone repair still reports the failing suite.
    expect(around).toMatch(/gateEvidence\.tests = 'failed';/);
  });
});

import { reconcilePlanWithWrites } from '../src/server/AgentV3/ProjectPlan';
import { analyzeRequirementCoverage } from '../src/server/AgentV3/RequirementCoverage';
import { vulnScanSummary } from '../src/server/lib/VulnScanner';
import { unfixableInstallNote, packagesInstalledBy } from '../src/server/lib/unfixablePackages';
import { parallelHelperScopeNote } from '../src/server/AgentV3/parallelHelperScope';
import { scanSecurity } from '../src/server/AgentV3/SecurityAnalysis';
import { signInCandidates } from '../src/server/AgentV3/signInExplore';

describe('9 · the rest of the ledger', () => {
  it('a module turn that built other modules\' files marks those modules done, and nothing else', () => {
    const m = (id: string, files: string[], status: 'pending' | 'done' | 'in_progress' = 'pending') => ({ id, name: id, description: '', dependsOn: [], files, contracts: '', status });
    const plan = { modules: [m('types', ['src/types/index.ts'], 'done'), m('lib', ['src/lib/stock.ts', 'src/lib/auth.ts']), m('ui', ['src/pages/A.tsx', 'src/pages/B.tsx']), m('empty', [])] } as never;
    const r = reconcilePlanWithWrites(plan, ['src/lib/stock.ts', './src/lib/auth.ts', 'src/pages/A.tsx']);
    expect(r.alsoDone).toEqual(['lib']);
    const statuses = Object.fromEntries((r.plan as { modules: { id: string; status: string }[] }).modules.map((x) => [x.id, x.status]));
    expect(statuses).toEqual({ types: 'done', lib: 'done', ui: 'pending', empty: 'pending' });
    expect(ROUTE).toMatch(/reconcilePlanWithWrites\(settled, writtenFiles\.keys\(\)\)/);
  });

  it('"alert notifications (low stock warnings)" is met by the alerts the app renders', () => {
    const graph = { files: ['src/pages/Dashboard.tsx'], components: ['Dashboard'], routes: ['/dashboard'] } as never;
    const dash = [{ path: 'src/pages/Dashboard.tsx', content: "const lowStockItems = items.filter((i) => i.quantity <= i.lowStockThreshold);\nreturn <div role=\"alert\">{lowStockItems.length} items low on stock</div>;" }];
    expect(analyzeRequirementCoverage(PROMPT, graph, dash).confirmedMissing).not.toContain('notifications');
    // …but "push notifications" is not met by a form-error alert.
    const formOnly = [{ path: 'src/pages/Dashboard.tsx', content: 'return <p role="alert">Required</p>;' }];
    expect(analyzeRequirementCoverage('build a chat app with push notifications', graph, formOnly).confirmedMissing).toContain('notifications');
  });

  it('a package with no fixed release on npm is named with its replacement — at install and in the report', () => {
    expect(packagesInstalledBy('npm install react-router-dom recharts xlsx lucide-react && npm i -D @types/xlsx')).toEqual(['react-router-dom', 'recharts', 'xlsx', 'lucide-react', '@types/xlsx']);
    expect(unfixableInstallNote('npm install react-router-dom xlsx')).toMatch(/xlsx.*exceljs/);
    expect(unfixableInstallNote('npm install exceljs')).toBe('');
    const sum = vulnScanSummary({ ok: true, scanned: 13, findings: [{ package: 'xlsx', version: '0.18.5', ids: ['GHSA-4r6h-8v6p-xvw6'] }] });
    expect(sum).toMatch(/exceljs/);
    expect(sum).toMatch(/where one exists/);
  });

  it('two engineers in parallel are told their lane — a browser-only backend is told there is no server', () => {
    expect(parallelHelperScopeNote('backend', 'vite-react')).toMatch(/no server/);
    expect(parallelHelperScopeNote('frontend', 'vite-react')).toMatch(/list that folder and import what already exists/);
    expect(parallelHelperScopeNote('reviewer', 'vite-react')).toBe('');
    expect(readFileSync(join(__dirname, '../src/server/AgentV3/SubAgent.ts'), 'utf8')).toMatch(/parallelHelperScopeNote\(role, deps\.framework\)/);
  });

  it('a sign-in form that starts with a password typed in is a security finding — an empty one is not', () => {
    const hit = scanSecurity('src/pages/Login.tsx', "const [password, setPassword] = useState('password');");
    expect(hit.map((f) => f.rule)).toContain('prefilled-password');
    expect(scanSecurity('src/pages/Login.tsx', "const [password, setPassword] = useState('');").map((f) => f.rule)).not.toContain('prefilled-password');
  });

  it('the report\'s own demo map — emails keyed to a password constant — is a sign-in candidate', () => {
    const got = signInCandidates({ 'src/lib/seed.ts': "const commonPassword = 'demo1234';\nexport const passwordMap: Record<string, string> = {\n  'admin@stock.test': commonPassword,\n};" });
    expect(got[0]).toMatchObject({ identifier: 'admin@stock.test', password: 'demo1234', source: 'demo account in the source' });
  });
});
