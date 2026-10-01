// A PASTED ONE-FILE APP STAYS ONE FILE (admin 2026-10-01, after autopsy a106df77).
//
// The user pasted their own bill maker — one HTML file, version 40 — and got back a Vite + React project.
// These tests lock the rule that replaced that: the format that was pasted is the format that comes back,
// the user's own page is the starting file, its storage names are kept, and React is used only when the
// user's words ask for it. The report's prompt is used verbatim (tests/fixtures/autopsyA106df77.prompt.txt).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  pastedFormatDecision, pastedHtmlDocument, pastedStorageKeys, pastedOneFileRule, pastedKeepsFormatEnabled,
  STATIC_SCAFFOLD_EXTRAS, PASTED_ONE_FILE_CODE,
} from '../src/server/AgentV3/pastedAppFormat';
import { buildFindingSuggestions } from '../src/server/AgentV3/buildFindingSuggestions';
import { isAppFinding } from '../src/server/AgentV3/BuildDiagnostics';

const PROMPT = readFileSync(resolve(__dirname, 'fixtures/autopsyA106df77.prompt.txt'), 'utf8');
const route = readFileSync(resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
const FRESH = { newBuild: true, frameworkPicked: false };
const ON = {} as NodeJS.ProcessEnv;

const page = (body: string) => ['<!doctype html>', '<html lang="en">', '<head>', '<title>Shop</title>', '</head>', '<body>', body, '<script>', 'const x = 1;', '</script>', '</body>', '</html>'].join('\n');

describe('the decision', () => {
  it('🔴 the a106df77 paste, on a new build, stays one file', () => {
    expect(pastedFormatDecision(PROMPT, FRESH, ON)).toEqual({ keep: true });
  });

  it('the existing app\'s stack wins on an edit, and the user\'s own framework pick wins', () => {
    expect(pastedFormatDecision(PROMPT, { newBuild: false, frameworkPicked: false }, ON)).toEqual({ keep: false, reason: 'not-a-new-build' });
    expect(pastedFormatDecision(PROMPT, { newBuild: true, frameworkPicked: true }, ON)).toEqual({ keep: false, reason: 'framework-picked' });
  });

  it('React when the user\'s WORDS ask for it — a framework by name, or something one file cannot carry', () => {
    expect(pastedFormatDecision(`Make this a Vue app\n${PROMPT}`, FRESH, ON)).toEqual({ keep: false, reason: 'words-name-a-framework' });
    // React is the default rather than a detector rule, so naming it is read as asking for a project.
    expect(pastedFormatDecision(`Make this a React app\n${PROMPT}`, FRESH, ON)).toEqual({ keep: false, reason: 'words-need-a-project' });
    expect(pastedFormatDecision(`${PROMPT}\nAdd login and a database so my staff can use it`, FRESH, ON)).toEqual({ keep: false, reason: 'words-need-a-project' });
    expect(pastedFormatDecision(`Convert this into a full app\n${PROMPT}`, FRESH, ON)).toEqual({ keep: false, reason: 'words-need-a-project' });
  });

  it('words that ask for no project keep the one file', () => {
    expect(pastedFormatDecision(`Fix the print button and make it look better\n${PROMPT}`, FRESH, ON)).toEqual({ keep: true });
  });

  it('the paste\'s OWN "Login" button is not a request for accounts — only the words around it are read', () => {
    expect(pastedFormatDecision(page('<button>Login</button><p>Database of customers</p>'), FRESH, ON)).toEqual({ keep: true });
  });

  it('a request in words, or a pasted snippet that is not a whole page, is not this case', () => {
    expect(pastedFormatDecision('build a bill maker app', FRESH, ON)).toEqual({ keep: false, reason: 'not-a-pasted-page' });
    const component = ['add this to my app:', 'export function Card() {', '  const [n, setN] = useState(0);', '  return (', '    <div className="card">', '      <button onClick={() => setN(n + 1)}>{n}</button>', '    </div>', '  );', '}', 'export default Card;'].join('\n');
    expect(pastedFormatDecision(component, FRESH, ON)).toEqual({ keep: false, reason: 'not-a-pasted-page' });
  });

  it('the kill switch restores the React rebuild', () => {
    expect(pastedKeepsFormatEnabled({ AGENTV3_PASTED_KEEPS_FORMAT: 'off' } as NodeJS.ProcessEnv)).toBe(false);
    expect(pastedFormatDecision(PROMPT, FRESH, { AGENTV3_PASTED_KEEPS_FORMAT: 'off' } as NodeJS.ProcessEnv)).toEqual({ keep: false, reason: 'off' });
  });
});

describe('the starting file is the user\'s own page', () => {
  it('the document runs from <!doctype to its last line of code — the code pasted after </html> included', () => {
    const doc = pastedHtmlDocument(PROMPT);
    expect(doc.startsWith('<!doctype html>')).toBe(true);
    expect(doc).toContain('</html>');
    expect(doc).toContain('A1 Decor');
    expect(doc.trimEnd().endsWith('}')).toBe(true); // a106df77's stray script after </html> is kept for the builder to repair
  });

  it('words before and after the paste are not written into the file', () => {
    const doc = pastedHtmlDocument(`Here is my app, please fix it:\n${page('<h1>Shop</h1>')}\nThanks, make the totals right`);
    expect(doc.startsWith('<!doctype html>')).toBe(true);
    expect(doc).not.toContain('please fix it');
    expect(doc).not.toContain('Thanks');
  });

  it('the page\'s storage names are read, so saved data is still found', () => {
    expect(pastedStorageKeys(pastedHtmlDocument(PROMPT))).toContain('a1Bills');
    expect(pastedStorageKeys('localStorage.setItem("bills", x); localStorage["theme"]; indexedDB.open(\'shop-db\'); localStorage.getItem(key)'))
      .toEqual(['bills', 'theme', 'shop-db']);
  });

  it('the rule keeps the file one file, its own look, and names the storage keys', () => {
    const rule = pastedOneFileRule(['a1Bills']);
    expect(rule).toMatch(/index\.html already holds the app exactly as the user pasted it/);
    expect(rule).toMatch(/ONE self-contained HTML file/);
    expect(rule).toMatch(/Do not link style\.css/);
    expect(rule).toContain('"a1Bills"');
    expect(pastedOneFileRule([])).not.toMatch(/storage names/);
    expect(STATIC_SCAFFOLD_EXTRAS).toEqual(['script.js', 'style.css']);
  });
});

describe('the one-tap upgrade', () => {
  it('a kept one-file app offers "Upgrade to a full app project", which keeps the saved data', () => {
    const [s] = buildFindingSuggestions([{ code: PASTED_ONE_FILE_CODE, severity: 'info' }]);
    expect(s.title).toBe('Upgrade to a full app project');
    expect(s.prompt).toMatch(/same storage names/);
  });

  it('it is a decision, never a finding against the app', () => {
    expect(isAppFinding({ phase: 'build', code: PASTED_ONE_FILE_CODE })).toBe(false);
  });
});

describe('the route wiring (source guards)', () => {
  it('a kept page builds on `static`, and the client is told', () => {
    expect(route).toMatch(/const pastedFormat = pastedFormatDecision\(prompt, \{\s*newBuild: intent === 'new_build' && !userAppExists && !hasImportIntent,\s*frameworkPicked: frameworkExplicit,/);
    expect(route).toMatch(/if \(pastedFormat\.keep && framework !== 'static'\) \{\s*framework = 'static';\s*emitFrameworkCorrection\('static', 'detected'\);/);
  });

  it('a turn re-read as an edit gives the framework back', () => {
    expect(route.match(/framework = frameworkBeforePastedFormat;/g)?.length).toBe(2);
  });

  it('the user\'s page is written over the UNTOUCHED starter only, and the unused starter files go', () => {
    expect(route).toMatch(/const untouched = current == null \|\| withoutPreviewBridge\('index\.html', current\)\.trim\(\) === starter\.trim\(\);/);
    expect(route).toMatch(/if \(doc && untouched\) \{\s*await actuator\.writeFile\(workspaceId, 'index\.html', doc\);/);
    expect(route).toMatch(/await removeWorkspaceFiles\(workspaceId, \[\.\.\.STATIC_SCAFFOLD_EXTRAS\]\)/);
  });

  it('the one-file rule reaches both lanes, ahead of the kit rule', () => {
    expect(route).toMatch(/const singleHtmlFileRule = pastedOneFile\s*\|\| \(framework === 'static' && wantsSingleHtmlFile\(prompt\) \? SINGLE_HTML_FILE_RULE : ''\);/);
  });

  it('a seeded page is improved in place: no fast-lane regeneration, no milestones, no module plan', () => {
    expect(route).toContain('const fastLaneWouldRun = !goldenPreseeded && pastedSeed.size === 0 && oneShotEnabled()');
    expect(route).toContain("if (envFlag('AGENTV3_MEGA_ROADMAP', true) && intent === 'new_build' && !isEditMode && !pastedFormat.keep) {");
    expect(route).toContain("if (!pPlan && intent === 'new_build' && !isEditMode && !pastedFormat.keep && detectMegaProject(planning.text)) {");
  });

  it('the user\'s own page is never billed as our delivered work unless the build changed it', () => {
    expect(route).toContain('for (const [pp, pc] of pastedSeed) preseededGolden.set(pp, pc);');
  });
});
