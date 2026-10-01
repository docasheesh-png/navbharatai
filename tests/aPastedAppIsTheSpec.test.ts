// Autopsy a106df77 (2026-10-01): a user pasted their own HTML bill maker into the build box, nothing else.
// Every reader that treats the prompt as a sentence read markup. These tests use the report's prompt
// verbatim (tests/fixtures/autopsyA106df77.prompt.txt) and lock the CLASS, not the instance.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { isPastedSource, isPastedHtmlDocument, readablePrompt, pastedAppFacts, pastedVisibleText, isCodeLine } from '../src/server/lib/pastedSource';
import { withoutMachineText } from '../src/server/lib/machineText';
import { resolveAppDisplayName, nameFromPrompt, descriptionFromPrompt } from '../src/server/AgentV3/appDisplayName';
import { quotedAppName, offTopicSummaryNotice } from '../src/server/AgentV3/offTopicSummary';
import { deriveTitle } from '../src/server/AgentV3/ConversationStore';
import { checkFeaturePresence } from '../src/server/AgentV3/FeaturePresence';
import { analyzeRequest } from '../src/server/AgentV3/RequestAnalyser';
import { pastedAppBrief } from '../src/server/AgentV3/pastedAppBrief';
import { summaryAdditions } from '../src/server/AgentV3/summaryAdditions';
import { sanitizeResponseEmoji } from '../src/server/lib/responseEmoji';
import { declaredRoutes } from '../src/server/AgentV3/routerPaths';
import { extractPageRoutes } from '../src/server/AgentV3/PageRouteCheck';
import { routeFromRouter } from '../src/server/AgentV3/journeyDerivation';
import { detectTypesMajorMismatch } from '../src/server/AgentV3/DependencyAnalysis';
import { analyzeDependencyConstraints } from '../src/server/AI/reasoning/ConstraintSolver';

const PASTED = readFileSync(resolve(__dirname, 'fixtures/autopsyA106df77.prompt.txt'), 'utf8');
const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

const ORDINARY = [
  'Build a notes app with search and dark mode',
  'ek billing app banao jisme GST ho',
  'make the <button> on the home page bigger',
  'Create a "Shiv Medical Store" app with inventory, billing, and reports',
  'Fix this: TypeError: Cannot read properties of undefined (reading map)\n    at App (src/App.tsx:12:5)',
  'Note: the app should work offline.\nIt needs a login page, a dashboard and a settings page.',
];

describe('1 · a pasted file is recognised, and an ordinary prompt never is', () => {
  it('the report prompt is pasted source — an HTML document', () => {
    expect(isPastedSource(PASTED)).toBe(true);
    expect(isPastedHtmlDocument(PASTED)).toBe(true);
  });

  it('precision: ordinary prompts are untouched, byte for byte', () => {
    for (const p of ORDINARY) {
      expect(isPastedSource(p), p).toBe(false);
      expect(readablePrompt(p)).toBe(p);
      expect(withoutMachineText(p).trim().length).toBeGreaterThan(0);
    }
  });

  it('a pasted code block (no markup) is pasted source; a one-tag sentence is not', () => {
    const code = ['please fix this', ...Array.from({ length: 10 }, (_, i) => `const v${i} = compute(${i});`)].join('\n');
    expect(isPastedSource(code)).toBe(true);
    expect(isPastedHtmlDocument(code)).toBe(false);
    expect(readablePrompt(code)).toBe('please fix this');
    expect(isCodeLine('margin:0;')).toBe(true);
    expect(isCodeLine('box-sizing:border-box')).toBe(true);
    expect(isCodeLine('Fix this:')).toBe(false);
  });

  it('the words written around a paste are kept, the paste is not', () => {
    const p = `Is app ko theek karo aur Items tab add karo\n${PASTED}\nthanks`;
    expect(readablePrompt(p)).toBe('Is app ko theek karo aur Items tab add karo\nthanks');
  });
});

describe('2 · the pasted page names itself', () => {
  it('facts come from the markup outside <script>, an unclosed <style> included', () => {
    const f = pastedAppFacts(PASTED);
    expect(f.title).toBe('A1 Decor India - Bill Maker • Pro v40');
    expect(f.heading).toBe('A1 Decor India');
    expect(f.controls).toEqual(['Home', 'Bill', 'Items', 'Settings', 'Add Item', 'Save Bill', 'Print', 'Save Settings']);
    expect(f.fields).toContain('Customer Name');
    expect(f.colours.map((c) => c.value)).toEqual(expect.arrayContaining(['#173f73', '#d9aa28']));
    // A button written inside a JavaScript template is code, not a label we can vouch for.
    expect(f.controls).not.toContain('Delete');
    const visible = pastedVisibleText(PASTED);
    expect(visible).not.toMatch(/display:flex|tabs\{|function|localStorage/);
    expect(visible).toContain('Item List');
  });

  it('🔴 the report: the published name was `<!doctype html> <html lang="en"> <head>`', () => {
    const d = resolveAppDisplayName({ indexHtml: '<title>App</title>', prompt: PASTED });
    expect(d.name).toBe('A1 Decor India - Bill Maker • Pro v40');
    expect(`${d.name} ${d.shortName} ${d.description}`).not.toMatch(/[<>]|doctype/i);
    expect(nameFromPrompt(PASTED)).not.toMatch(/doctype/i);
    expect(descriptionFromPrompt(PASTED, 'X')).not.toMatch(/[<>]/);
  });

  it('the History title and the repo name are not the markup either', () => {
    expect(deriveTitle(PASTED)).toBe('A1 Decor India - Bill Maker • Pro v40');
    expect(deriveTitle(`fix my bill app\n${PASTED}`)).toBe('fix my bill app');
    expect(deriveTitle('Build a todo app')).toBe('Build a todo app');
  });
});

describe('3 · a quoted attribute is not the app the user asked for', () => {
  it('🔴 the report: "You asked for “width=device-width,initial-scale=1”" was shown to the user', () => {
    expect(quotedAppName(PASTED)).toBeNull();
    expect(offTopicSummaryNotice(PASTED, 'Your A1 Decor India billing app is ready.')).toBeNull();
    expect(quotedAppName('make an app called "width=device-width, initial-scale=1"')).toBeNull();
  });

  it('a name the user really quoted still works', () => {
    expect(quotedAppName('Build a "Hospital Emergency Management" app')).toBe('Hospital Emergency Management');
    expect(offTopicSummaryNotice('Build a "Hospital Emergency Management" app', 'Your Dino Run game is ready')).not.toBeNull();
  });
});

describe('4 · the request readers read words, the size readers keep the paste', () => {
  it('the feature probe is not asked for features named in the code', () => {
    const r = checkFeaturePresence(PASTED, '<html><body><div id="root"><button>Add Item</button><input aria-label="Item"></div></body></html>');
    const probed = r.probes.map((p) => p.feature);
    expect(probed).not.toContain('delete'); // `removeItem` / a template "Delete" in the script
    expect(probed).not.toContain('filter'); // `.tabs` in the CSS
  });

  it('routing is unchanged: a pasted app is still sized from its code', () => {
    const a = analyzeRequest({ prompt: PASTED });
    expect(a.taskType).toBe('complex_app');
    expect(a.complexityScore).toBe(73);
    // …but the ranked features are words, never CSS or JS fragments.
    for (const f of [...(a.features?.core ?? []), ...(a.features?.important ?? []), ...(a.features?.nice ?? [])]) {
      expect(f).not.toMatch(/[{};]|function|getElementById/);
    }
  });

  it('every request reader goes through the one choke point (source guard)', () => {
    expect(src('src/server/lib/machineText.ts')).toMatch(/requestWords\(text0\)/);
    expect(src('src/server/AgentV3/RequestAnalyser.ts')).toMatch(/keepPasted: true/);
    expect(src('src/server/lib/BuildTimeEstimator.ts')).toMatch(/keepPasted: true/);
  });
});

describe('5 · the builder is handed the pasted app as a checklist', () => {
  it('the brief names the name, every control, every field and the colours', () => {
    const b = pastedAppBrief(PASTED);
    expect(b).toContain('THE USER PASTED THEIR OWN APP — "A1 Decor India - Bill Maker • Pro v40"');
    expect(b).toContain('Home, Bill, Items, Settings, Add Item, Save Bill, Print, Save Settings');
    expect(b).toContain('--gold #d9aa28');
    expect(b).toMatch(/never remove/);
  });

  it('no brief for an ordinary prompt or a pasted component', () => {
    for (const p of ORDINARY) expect(pastedAppBrief(p)).toBe('');
    const component = Array.from({ length: 12 }, (_, i) => `const x${i} = useState(${i});`).join('\n');
    expect(pastedAppBrief(component)).toBe('');
  });

  it('both lanes read it (source guard)', () => {
    const route = src('src/server/routes/agentv3.ts');
    expect(route).toMatch(/pastedBrief = pastedAppBriefEnabled\(\) \? pastedAppBrief\(prompt\) : ''/);
    expect(route).toContain('buildPrompt = `${pastedBrief}');
    expect(route).toContain('planning.text + singleHtmlFileSuffix + pastedBriefSuffix');
  });
});

describe('6 · the platform’s additions survive a reply that celebrated', () => {
  it('🔴 the report: "ready. 🎉" in the summary never matched "ready." on screen', () => {
    const reply = 'Your A1 Decor India billing app is ready. 🎉\n\n**What is built:**\n- Dashboard\n- Settings with GSTIN and UPI ID';
    const narrated = sanitizeResponseEmoji(reply, 'working');
    expect(narrated).not.toContain('🎉');
    const summary = `${reply}\n\n**What this app needs from you:** set your UPI ID in Settings.`;
    const a = summaryAdditions(summary, [narrated]);
    expect(a.matched).toBe(true);
    expect(a.text).toContain('What this app needs from you');
    expect(a.text).not.toContain('What is built');
  });
});

describe('7 · a nested <Route> serves its parent’s path joined to its own', () => {
  const APP = `import { Routes, Route } from 'react-router-dom';
import { Shell } from './components/Shell';
import { Dashboard } from './pages/Dashboard';
import { NewBill } from './pages/NewBill';
import { Bills } from './pages/Bills';
import { Settings } from './pages/Settings';
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Shell />}>
        <Route index element={<Dashboard />} />
        <Route path="new" element={<NewBill />} />
        <Route path="bills" element={<Bills />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      {/* <Route path="old" element={<Old />} /> */}
      <Route path="*" element={<Dashboard />} />
    </Routes>
  );
}`;

  it('declaredRoutes joins parents, keeps index routes, skips comments', () => {
    expect(declaredRoutes(APP).map((r) => r.path)).toEqual(['/', '/', '/new', '/bills', '/settings', '/*']);
    expect(declaredRoutes('<Route path="/admin" element={<A/>}><Route element={<L/>}><Route path="users" element={<U/>} /></Route></Route>').map((r) => r.path))
      .toEqual(['/admin', '/admin/users']);
    expect(declaredRoutes('<Route path={base} element={<A/>}><Route path="x" element={<X/>} /></Route>')).toEqual([]);
  });

  it('🔴 the report: the page check found "no separate page routes"', () => {
    expect(extractPageRoutes({ 'src/App.tsx': APP, 'package.json': '{"dependencies":{"vite":"8"}}' })).toEqual(['/bills', '/new', '/settings']);
  });

  it('🔴 the report: the New Bill journey ran on `/`, where the form is not', () => {
    const files = { 'src/App.tsx': APP, 'src/pages/NewBill.tsx': 'export function NewBill(){return <form/>}', 'src/pages/Dashboard.tsx': 'export function Dashboard(){return null}' };
    expect(routeFromRouter('src/pages/NewBill.tsx', files)).toBe('/new');
    expect(routeFromRouter('src/pages/Dashboard.tsx', files)).toBe('/');
  });
});

describe('9 · a package that ships its own types needs no @types copy', () => {
  const pkg = JSON.stringify({ dependencies: { 'react-router-dom': '^6.30.0', '@types/react-router-dom': '^5.3.3' } });

  it('🔴 the report: "@types/react-router-dom is v5 but react-router-dom is v6" — the advice is now "remove it"', () => {
    const issues = detectTypesMajorMismatch(pkg);
    expect(issues).toHaveLength(1);
    expect(issues[0].suggestion).toBe('Remove it: npm uninstall @types/react-router-dom.');
    expect(issues[0].suggestion).not.toMatch(/\^6/);
    const solved = analyzeDependencyConstraints({ 'package.json': pkg });
    const t = solved.conflicts.find((c) => c.kind === 'types-mismatch');
    expect(t?.detail).toContain('ships its own type definitions');
  });

  it('a package that does need @types keeps the old advice', () => {
    const issues = detectTypesMajorMismatch(JSON.stringify({ dependencies: { react: '^18.3.1', '@types/react': '^17.0.0' } }));
    expect(issues[0].suggestion).toMatch(/\^18/);
  });
});
