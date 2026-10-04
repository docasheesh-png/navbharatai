// AUTOPSY e725e002 (2026-09-29) — the message was `mkdir src`; the app was an e-commerce site.
//
// Two defects, one shape: something that decides about the app READ LESS than what the app is made of.
//   1. Every sizer and planner (complexity score, ETA, request analysis, app-scope, project-mode
//      detection, the fast lane's file plan) read the user's four-word message, while the builder read
//      that message PLUS the attached file / earlier requests that gave it meaning. Score 5, ETA 2–4
//      min, a 267-second fast lane planning a generic app — for a 35-file shop that took 17.6 min.
//   2. The design repair was told the kit is "ALREADY in the project" and used `.nb-empty*`; the
//      architect had rewritten `src/index.css` without the kit, so four empty states shipped unstyled
//      under a DESIGN_HEALED line.
// Fixed with ONE planning request every sizer reads (planningRequest.ts) and a deterministic,
// model-free restore of the kit's own rules (kitRestore.ts), wired in both lanes.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  planningRequest, planningContextEnabled, planningContextNote,
  PLANNING_ATTACHMENT_MAX, PLANNING_EARLIER_REQUESTS,
} from '../src/server/AgentV3/planningRequest';
import {
  kitRestorePatch, kitRestoreTarget, kitClasses, parseCssBlocks, kitRestoreNote, KIT_RESTORE_MARKER,
} from '../src/server/AgentV3/kitRestore';
import { findUndefinedClasses } from '../src/server/AgentV3/CssConsistency';
import { complexityFromPrompt } from '../src/server/lib/BuildTimeEstimator';

const ROUTE = readFileSync(path.join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');

describe('planningRequest — the request as the builder reads it', () => {
  const shopSpec = 'Build an e-commerce store: product catalogue with search and categories, cart, checkout with payment, user accounts with saved addresses, order history and an admin dashboard for products and orders.';

  it('the message alone is returned unchanged when nothing else exists', () => {
    const r = planningRequest({ prompt: 'mkdir src', userAppExists: false });
    expect(r).toEqual({ text: 'mkdir src', sizing: 'mkdir src', sources: [], picturesSetAside: 0 });
  });

  it('an attached file is read with the message (the e725e002 case)', () => {
    const r = planningRequest({ prompt: 'mkdir src', attachmentText: shopSpec, userAppExists: false });
    expect(r.text.startsWith('mkdir src')).toBe(true);
    expect(r.text).toContain('product catalogue');
    expect(r.sources).toEqual(['attachment']);
  });

  it('earlier requests are read while no app exists yet — most recent last, the message itself dropped', () => {
    const r = planningRequest({
      prompt: 'mkdir src',
      recentRequests: ['hi', shopSpec, 'mkdir src'],
      userAppExists: false,
    });
    expect(r.sources).toEqual(['earlier-requests']);
    expect(r.text).toContain('product catalogue');
    expect(r.text.match(/mkdir src/g)?.length).toBe(1);
  });

  it('keeps only the most recent earlier requests', () => {
    const reqs = ['one', 'two', 'three', 'four', 'five'];
    const r = planningRequest({ prompt: 'go', recentRequests: reqs, userAppExists: false });
    for (const kept of reqs.slice(-PLANNING_EARLIER_REQUESTS)) expect(r.text).toContain(`- ${kept}`);
    expect(r.text).not.toContain('- one');
  });

  it('once an app exists, earlier requests are NOT read — "make the button blue" is not the whole app again', () => {
    const r = planningRequest({ prompt: 'make the button blue', recentRequests: [shopSpec], userAppExists: true });
    expect(r).toEqual({ text: 'make the button blue', sizing: 'make the button blue', sources: [], picturesSetAside: 0 });
  });

  it('a huge attachment is capped, so a sizing heuristic cannot stall on a 200-page PDF', () => {
    const r = planningRequest({ prompt: 'x', attachmentText: 'a'.repeat(PLANNING_ATTACHMENT_MAX * 5), userAppExists: false });
    expect(r.text.length).toBeLessThan(PLANNING_ATTACHMENT_MAX + 400);
  });

  it('kill switch AGENTV3_PLANNING_CONTEXT=off returns the message alone', () => {
    const env = { AGENTV3_PLANNING_CONTEXT: 'off' } as NodeJS.ProcessEnv;
    expect(planningContextEnabled(env)).toBe(false);
    expect(planningRequest({ prompt: 'mkdir src', attachmentText: shopSpec, userAppExists: false, env }).text).toBe('mkdir src');
  });

  it('the sizer that promised "2–4 minutes" now sees a complex app', () => {
    const alone = complexityFromPrompt('mkdir src');
    const planned = complexityFromPrompt(planningRequest({ prompt: 'mkdir src', attachmentText: shopSpec, userAppExists: false }).text);
    expect(planned.featureCount).toBeGreaterThan(alone.featureCount);
  });

  it('the admin note names what was added', () => {
    const r = planningRequest({ prompt: 'mkdir src', attachmentText: shopSpec, userAppExists: false });
    expect(planningContextNote(r, 9)).toMatch(/attached file/);
  });
});

describe('the route — every sizer reads planning.sizing, every model reads planning.text', () => {
  it('builds the planning request once, from what the builder receives', () => {
    // Since autopsy 19641ab5 the sizers read the part of the attachment that DESCRIBES AN APP (a photo is set aside).
    // Since autopsy 2f723acb an app that was started but never assembled still has its earlier requests read.
    // Since autopsy 5759ad8b a message that points at the conversation ("make this app") also reads its last answer.
    expect(ROUTE).toMatch(/const planning = planningRequest\(\{ prompt, attachmentText: planningAttachmentText, picturesSetAside, recentTurns, conversationReply, userAppExists, appStillUnbuilt \}\)/);
  });
  it.each([
    ['wall-clock complexity', /const buildComplexity = complexityFromPrompt\(planning\.sizing\)/],
    ['ETA complexity', /const etaComplexity = etaByProject[\s\S]{0,120}complexityFromPrompt\(planning\.sizing\)[\s\S]{0,40}: complexityFromPrompt\(planning\.sizing\);/],
    // Whitespace-tolerant since 2026-10-04: the call became multi-line when `fileCount` joined it
    // (autopsy 8b8743a3 / Q-313). The invariant this row guards — the sizer reads `planning.sizing`,
    // never the bare message — is unchanged and still fully enforced; only the line break is allowed.
    ['request analysis', /analyzeRequest\(\{\s*prompt: planning\.sizing/],
    ['complexity routing', /\{ prompt: planning\.sizing, score: analysis\?\.complexityScore/],
    ['project-mode detection', /detectMegaProject\(planning\.sizing\)/],
    ['fast lane', /runSimpleBuild\(\{ prompt: planning\.text/],
  ])('%s', (_name, re) => {
    expect(ROUTE).toMatch(re);
  });
  it('no sizer is left reading the bare message', () => {
    expect(ROUTE).not.toMatch(/complexityFromPrompt\(prompt\)/);
    expect(ROUTE).not.toMatch(/analyzeAppScope\(prompt\)/);
    expect(ROUTE).not.toMatch(/detectMegaProject\(prompt\)/);
  });
});

// A screen the design repair wrote in e725e002, and the stylesheet the architect left behind.
const EMPTY_STATE_PAGE = `export function Orders() {
  return (
    <div className="nb-empty">
      <div className="nb-empty-icon">📦</div>
      <h2 className="nb-empty-title">No orders yet</h2>
      <p className="nb-empty-text">Your orders will appear here.</p>
    </div>
  );
}`;
const ARCHITECT_CSS = `:root { --brand: #e11d48; }
body { margin: 0; font-family: sans-serif; }
.shop-header { display: flex; padding: 16px; }
`;
const MAIN = `import './index.css';\nimport App from './App';`;

describe('kitRestorePatch — the kit\'s own rules, put back by construction', () => {
  const files = { 'src/pages/Orders.tsx': EMPTY_STATE_PAGE, 'src/index.css': ARCHITECT_CSS, 'src/main.tsx': MAIN };

  it('the e725e002 case: four .nb-empty* classes undefined before, all defined after', () => {
    expect(findUndefinedClasses(files)).toEqual(['nb-empty', 'nb-empty-icon', 'nb-empty-text', 'nb-empty-title']);
    const patch = kitRestorePatch(files, {} as NodeJS.ProcessEnv);
    expect(patch).not.toBeNull();
    expect(patch!.path).toBe('src/index.css');
    expect(patch!.restored).toEqual(['nb-empty', 'nb-empty-icon', 'nb-empty-text', 'nb-empty-title']);
    expect(findUndefinedClasses({ ...files, [patch!.path]: patch!.content })).toEqual([]);
  });

  it('the app\'s own stylesheet is kept byte for byte, and appended to', () => {
    const patch = kitRestorePatch(files, {} as NodeJS.ProcessEnv)!;
    expect(patch.content.startsWith(ARCHITECT_CSS.trimEnd())).toBe(true);
    expect(patch.content).toContain(KIT_RESTORE_MARKER);
  });

  it('adds the tokens the restored rules read, light AND dark, and nothing else', () => {
    const patch = kitRestorePatch(files, {} as NodeJS.ProcessEnv)!;
    expect(patch.tokens).toEqual(['--fg', '--muted']);
    expect(patch.content).toMatch(/prefers-color-scheme: dark[\s\S]*--muted/);
    expect(patch.content).not.toMatch(/--accent:/);
  });

  it('never overrides a token the app already sets', () => {
    const own = { ...files, 'src/index.css': `${ARCHITECT_CSS}:root { --muted: #333; }\n` };
    const patch = kitRestorePatch(own, {} as NodeJS.ProcessEnv)!;
    expect(patch.tokens).toEqual(['--fg']);
  });

  it('never restyles a class the app defines itself', () => {
    const own = { ...files, 'src/index.css': `${ARCHITECT_CSS}.nb-empty { color: red; }\n` };
    const patch = kitRestorePatch(own, {} as NodeJS.ProcessEnv)!;
    expect(patch.content).not.toMatch(/\.nb-empty \{ display: flex/);
    expect(patch.restored).not.toContain('nb-empty');
    expect(patch.restored).toContain('nb-empty-title');
  });

  it('brings a media-query rule and a keyframe along with the class that needs them', () => {
    const shell = {
      'src/App.tsx': 'export default () => <div className="nb-shell"><main className="nb-main" /><nav className="nb-sidebar" /></div>;',
      'src/index.css': ARCHITECT_CSS, 'src/main.tsx': MAIN,
    };
    const p = kitRestorePatch(shell, {} as NodeJS.ProcessEnv)!;
    expect(p.content).toMatch(/@media \(max-width: 820px\) \{\n {2}\.nb-shell/);
    const skel = {
      'src/App.tsx': 'export default () => <div><div className="nb-skeleton" /><i className="nb-spinner" /><b className="nb-fade" /></div>;',
      'src/index.css': ARCHITECT_CSS, 'src/main.tsx': MAIN,
    };
    const q = kitRestorePatch(skel, {} as NodeJS.ProcessEnv)!;
    expect(q.content).toMatch(/@keyframes nb-spin/);
    expect(q.content).toMatch(/@keyframes nb-fade-in/);
    expect(q.tokens).toEqual(expect.arrayContaining(['--dur', '--ease']));
  });

  it('says nothing when there is nothing to restore', () => {
    expect(kitRestorePatch({ 'src/App.tsx': '<div className="my-own-thing another-one third-one" />', 'src/index.css': ARCHITECT_CSS }, {} as NodeJS.ProcessEnv)).toBeNull();
    expect(kitRestorePatch({ 'src/App.tsx': EMPTY_STATE_PAGE, 'src/index.css': '@tailwind base;', 'tailwind.config.js': '' }, {} as NodeJS.ProcessEnv)).toBeNull();
    expect(kitRestorePatch({ 'src/App.tsx': EMPTY_STATE_PAGE }, {} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('kill switch AGENTV3_KIT_RESTORE=off', () => {
    expect(kitRestorePatch(files, { AGENTV3_KIT_RESTORE: 'off' } as NodeJS.ProcessEnv)).toBeNull();
  });

  it('writes into a stylesheet the app actually imports', () => {
    expect(kitRestoreTarget({ 'src/styles/app.css': 'x', 'src/other.css': 'y', 'src/main.tsx': "import './styles/app.css';" })).toBe('src/styles/app.css');
    expect(kitRestoreTarget({ 'src/theme.sass': 'x' })).toBeNull();
  });

  it('is idempotent — a second pass over the patched project restores nothing', () => {
    const patch = kitRestorePatch(files, {} as NodeJS.ProcessEnv)!;
    expect(kitRestorePatch({ ...files, [patch.path]: patch.content }, {} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('the kit parses into the classes the repair instruction promises', () => {
    const cls = kitClasses();
    for (const c of ['card', 'btn-primary', 'badge', 'nb-table', 'nb-empty', 'nb-stats', 'nb-shell', 'nb-hero']) expect(cls.has(c)).toBe(true);
    expect(parseCssBlocks('a { b { c } } d { e }').map((b) => b.prelude)).toEqual(['a', 'd']);
  });

  it('the admin note names the classes', () => {
    const patch = kitRestorePatch(files, {} as NodeJS.ProcessEnv)!;
    expect(kitRestoreNote(patch, 'after-repair')).toMatch(/\.nb-empty/);
  });
});

describe('the route — the restore runs in BOTH lanes, before and after the repair', () => {
  it('the architect lane restores before deciding on a model repair', () => {
    const i = ROUTE.indexOf("await restoreKitRules({ ...integrityFiles, ...designFiles }, 'before-repair')");
    const j = ROUTE.indexOf('const cssErr = (() => { try { return cssConsistencyError(projectForCss)');
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
  });
  it('and again after the design repair, which is told to use the kit', () => {
    expect(ROUTE).toMatch(/await restoreKitRules\(\{ \.\.\.integrityFiles, \.\.\.Object\.fromEntries\(writtenFiles\) \}, 'after-repair'\)/);
  });
  it('a design-only repair that leaves classes unstyled is reported, not called healed', () => {
    expect(ROUTE).toMatch(/After the design repair: \$\{undefinedClassesNote\(leftAfterDesign\)\}/);
  });
  it('never writes on a read-only import/survey turn', () => {
    expect(ROUTE).toMatch(/if \(!patch \|\| abort\.signal\.aborted \|\| isImportTurn \|\| !expectsArtifacts\) return;/);
  });
  it('the fast lane restores before its own CSS check', () => {
    const i = ROUTE.indexOf('const patch = kitRestorePatch(project);');
    const j = ROUTE.indexOf('const cssErr = cssConsistencyError(project);');
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
  });
});
