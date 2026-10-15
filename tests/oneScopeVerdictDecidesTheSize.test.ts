// ONE SCOPE VERDICT DECIDES HOW BIG A BUILD IS (admin 2026-10-11, Q-138: "keep APP_SCOPE as the one scope
// analyser; Project Mode reads its answer").
//
// Autopsy eed79815: Software Project Mode decomposed a car game (40 bullets, its own ≥14 rule) while APP_SCOPE
// called the same prompt a single-purpose app. THE CLASS: a size decision taken twice, by two rule sets, with no
// rule for which wins. Now the route sizes once (`scopeVerdict`), and Project Mode only asks whether a request
// that verdict calls LARGE is shaped like a project spec.
//
// Measured while building it (every string in the test suite, 66,309 of them, at both complexity answers): the
// first draft would have built two REAL large specs in one pass — Blue Berry (144 parts) and the 6461025c ads
// platform (429 parts) — because APP_SCOPE's small-word veto read "resume" and "Budget". And the scale reader
// counted "404 page" as 404 pages. Both are locked below with the real prompts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { scopeVerdict, analyzeAppScope } from '../src/server/lib/appScopeAnalyzer';
import { megaProjectSignals, statedScale, projectModeDiagnosis } from '../src/server/AgentV3/ProjectPlan';

const BLUE_BERRY = readFileSync('tests/fixtures/blueBerryPrompt.txt', 'utf8');
const ADS_PLATFORM = readFileSync('tests/fixtures/autopsy6461025c.prompt.txt', 'utf8');
const SMALL_APP_LONG_LIST = `A todo app with:\n${['dark mode', 'labels', 'search', 'due dates', 'reminders', 'priorities', 'subtasks', 'tags',
  'calendar view', 'sharing', 'export', 'import', 'notes', 'attachments', 'recurring tasks', 'drag and drop',
  'offline sync', 'voice input', 'progress charts'].map((f) => `- ${f}`).join('\n')}`;

describe('🔒 project mode reads the one verdict', () => {
  it('a long list on an app that IS small is one build — the two answers can no longer disagree', () => {
    expect(megaProjectSignals(SMALL_APP_LONG_LIST).fires).toBe(true); // project mode's shape alone would split it
    const v = scopeVerdict(SMALL_APP_LONG_LIST, { complex: false });
    expect(v.large).toBe(false);
    expect(v.projectMode).toBe(false);
  });

  it('🔒 the real large specs stay large and keep project mode — a stray small word does not shrink them', () => {
    for (const [name, prompt] of [['Blue Berry', BLUE_BERRY], ['6461025c', ADS_PLATFORM]] as const) {
      const v = scopeVerdict(prompt, { complex: false });
      expect(v.scope.smallHint, name).toBe(true); // "resume" / "Budget" — the word that used to decide
      expect(v.large, name).toBe(true);
      expect(v.projectMode, name).toBe(true);
    }
  });

  it('a big-software system with named parts is large in APP_SCOPE too, as it was in project mode', () => {
    const s = analyzeAppScope('Hospital CRM: login system, patient CRUD, appointment scheduling, search/filter, analytics dashboard, multi-language support, and dark mode.');
    expect(s.decision).toBe('analyze');
    expect(s.signals.join(' ')).toMatch(/big-software system with \d+ named parts/);
  });

  it('a famous name that stood down is not large for project mode either', () => {
    const v = scopeVerdict('ek quiz app banao, instagram, jisme mere sawal ho', { complex: false });
    expect(v.scope.decision).toBe('analyze');
    expect(v.dispute).not.toBeNull();
    expect(v.large).toBe(false);
    expect(v.projectMode).toBe(false);
  });

  it('a verdict is never thrown — a failure reads as an ordinary direct build', () => {
    const v = scopeVerdict(undefined as unknown as string, { complex: false });
    expect(v.large).toBe(false);
    expect(v.projectMode).toBe(false);
  });

  it('the report says why project mode stood down, in its own words', () => {
    const d = projectModeDiagnosis({ flagRaw: 'on', isNewBuild: true, prompt: SMALL_APP_LONG_LIST, scope: { large: false, signals: ['single-purpose app — buildable in one shot'] } });
    expect(d.skipReason).toBe('scope-says-one-app');
    expect(d.detail).toContain('single-purpose app');
    expect(projectModeDiagnosis({ flagRaw: 'on', isNewBuild: true, prompt: BLUE_BERRY, scope: { large: true, signals: [] } }).skipReason).toBeNull();
  });
});

describe('🔒 an error page is not a page count', () => {
  it('a status code before the singular word names a page', () => {
    expect(statedScale('a portfolio site with a custom 404 page')).toBe(0);
    expect(statedScale('add a 500 error page and a 404 not found page')).toBe(0);
    expect(megaProjectSignals('a portfolio site with a custom 404 page').fires).toBe(false);
  });
  it('a real count still counts — plural, or any other number', () => {
    expect(statedScale('a documentation website with 120 pages')).toBe(120);
    expect(statedScale('a custom 404 page, and 150 screens of content')).toBe(150);
    expect(statedScale('an app with 500 screens')).toBe(500);
    expect(statedScale('a 100 page website')).toBe(100);
  });
  it('a link is not the request', () => {
    expect(statedScale('like https://example.com/docs/250-pages-guide')).toBe(0);
  });
});

describe('🔒 the route sizes once', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('one verdict, from planning.sizing, read by the report, the roadmap and project mode', () => {
    expect(route.match(/scopeVerdict\(/g) ?? []).toHaveLength(1);
    expect(route).toContain('const appScope = scopeVerdict(planning.sizing, { complex: buildIsComplex });');
    expect(route).toContain('const scope = appScope.scope;');
    expect(route).toContain('const { scope, dispute } = appScope;');
    expect(route).toContain('megaProject: appScope.projectMode,');
    // UPDATED 2026-10-14 (autopsy e3135b7b, Q-1080): the gate gained `&& !templateIsTheFinishedApp(seededScaffold)`
    // — a seeded simple-tier template IS the finished app, so there is nothing to decompose. Pinned as a
    // PROPERTY of the condition rather than its exact text, because the literal form is what broke here: a
    // guard that pins punctuation fails on every correct change and teaches nothing (the class named in
    // `nobodyPlansAnAppAlreadyWritten.test.ts`).
    const planGate = route.slice(route.indexOf('if (!pPlan &&'), route.indexOf(') {', route.indexOf('if (!pPlan &&')) + 3);
    expect(planGate).toContain('appScope.projectMode'); // ← project mode reads THE one verdict, not a second derivation
    expect(planGate).not.toMatch(/megaProjectSignals\(|analyzeAppScope\(/);
    expect(route).toContain('scope: { large: appScope.large, signals: appScope.scope.signals },');
  });

  it('🔒 no second sizer is called in the route', () => {
    for (const sizer of ['analyzeAppScope(', 'scopeDispute(', 'detectMegaProject(', 'megaProjectSignals(']) {
      expect(route.includes(sizer), sizer).toBe(false);
    }
  });
});
