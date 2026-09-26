/**
 * AUTOPSY — the SignBridge build (2026-09-26). A free user pasted a 20-section spec for an Indian Sign
 * Language translator. The app rendered and was billed, and nearly every judgement the platform made
 * about it was wrong in a way that cost time, money, or the truth:
 *
 *  1. It was ORDERED to build a map and a chat app. "Map recognized labels to the sign dictionary" (a
 *     verb) and "clear status messages" were read as feature requests and handed to the builder as
 *     "not suggestions … build every one of these" — so it shipped a Leaflet map of invented "nearby
 *     ISL schools" in an app whose user wrote "do not fake".
 *  2. It was told this was a JOBS app — off the method name `resume()` — and to include employer roles,
 *     interview scheduling and an admin dashboard.
 *  3. Project Mode's planner opened on the complex build chain's always-reasoning rungs, both spent
 *     their whole output budget thinking, and 315s (22% of the build) produced no plan — then the
 *     report blamed claude-sonnet-4-6, an engine a weak build may never run.
 *  4. "All 6 page routes rendered" — six addresses (/ChatPage …) the app does not serve, read off a
 *     Next.js convention in a Vite app; its catch-all sent each one home, and home rendered.
 *  5. "0 user journey(s) passed" was coded JOURNEY_PASSED.
 *  6. "Added 2 missing dependencies" — twice, for a write Green Freeze refused; and the refused content
 *     leaked into the saved app anyway.
 *  7. "Build health check detected issues — preparing recovery…" on a green app; no recovery exists.
 *  8. A Settings page's own list of options was sent to a paid repair for having "no empty state".
 *  9. The report ate a section heading as a "leaked credential".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractPageRoutes, pagesFolderIsRouteTable, classifyPage, parsePageCheck, summarizePageCheck, pageCheckScript } from '../src/server/AgentV3/PageRouteCheck';
import { summarizeJourneys, routeForFile, type JourneyResult } from '../src/server/AgentV3/journeyDerivation';
import { requestedFeatureLabels, analyzeRequirementCoverage } from '../src/server/AgentV3/RequirementCoverage';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';
import { rendersDataList } from '../src/server/AgentV3/DesignCoverage';
import { plannerCallLabel, fastLaneProviderLabel } from '../src/server/routes/agentv3';
import { redactSecrets } from '../src/server/AgentV3/SecretRedactor';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const PROMPT = src('tests/fixtures/promptSignbridge.txt');

// ── 1 · a verb is not a feature, and the contract is an order ────────────────────────────────────

describe('1 · what the builder is ORDERED to build is only what the user named', () => {
  it('🔴 the real SignBridge prompt asks for settings and search — not a map, not a chat app', () => {
    expect(requestedFeatureLabels(PROMPT)).toEqual(['settings', 'search']);
  });
  it('the verb "map … to …", "chat bubbles" and "clear/status/error messages" ask for nothing', () => {
    expect(requestedFeatureLabels('Map recognized labels to the sign dictionary.')).toEqual([]);
    expect(requestedFeatureLabels('Display messages as chat bubbles.')).toEqual([]);
    expect(requestedFeatureLabels('Use clear messages such as "Camera denied". Show clear status messages and error messages.')).toEqual([]);
  });
  it('🔒 the noun still asks — a map to look at, a chat to talk in', () => {
    for (const p of ['show nearby stores on a map', 'an app with a map view', 'integrate Google Maps', 'show my location']) {
      expect(requestedFeatureLabels(p)).toContain('map / location');
    }
    for (const p of ['build a chat app', 'users can send messages to each other', 'a messaging app like whatsapp', 'an inbox for direct messages']) {
      expect(requestedFeatureLabels(p)).toContain('chat / messaging');
    }
  });
  it('the end-of-build audit asks the SAME question, so the two lists cannot drift', () => {
    const graph = { files: ['src/pages/MapPage.tsx', 'src/pages/ChatPage.tsx', 'src/pages/SettingsPage.tsx'], components: [], routes: [] } as never;
    expect(analyzeRequirementCoverage(PROMPT, graph).requested).toEqual(['settings', 'search']);
    const rc = strip(src('src/server/AgentV3/RequirementCoverage.ts'));
    expect(rc).toContain('return FEATURES.filter((f) => featureAskedFor(req, f)).map((f) => f.label);');
    expect(rc).toContain('if (!featureAskedFor(req, feat)) continue;');
  });
});

// ── 2 · a method name is not a domain ────────────────────────────────────────────────────────────

describe('2 · the domain guess no longer invents a jobs / social / shop app', () => {
  it('🔴 the real prompt is "general" — no domain features are pushed at the builder', () => {
    expect(analyzeRequirementGaps(PROMPT).domain).toBe('general');
  });
  it('each trigger, alone', () => {
    expect(analyzeRequirementGaps('TextToSpeechManager functions: speak(text, language) stop() pause() resume()').domain).not.toBe('jobs');
    expect(analyzeRequirementGaps('Store translation history locally. Use localStorage or IndexedDB.').domain).not.toBe('ecommerce');
    expect(analyzeRequirementGaps('Use clear status messages. Display messages as chat bubbles.').domain).not.toBe('social');
  });
  it('🔒 real domains keep their classification', () => {
    expect(analyzeRequirementGaps('a job board where employers post jobs and candidates apply with a resume').domain).toBe('jobs');
    expect(analyzeRequirementGaps('a resume builder for freshers').domain).toBe('jobs');
    expect(analyzeRequirementGaps('an online store with a cart and checkout').domain).toBe('ecommerce');
    expect(analyzeRequirementGaps('a social app where friends post photos, follow each other and chat').domain).toBe('social');
    expect(analyzeRequirementGaps('list every product(s) in the shop').domain).toBe('ecommerce'); // the plural shorthand is prose
  });
});

// ── 3 · a planner climbs the plan ladder, and a failure names nobody who did not run ─────────────

describe('3 · planners use the plan ladder; a planner that got no answer blames no engine', () => {
  it('🔴 no provider answered ⇒ "no provider answered", never the planned Sonnet id', () => {
    expect(plannerCallLabel('', fastLaneProviderLabel, 'claude-sonnet-4-6')).toEqual({ provider: 'none', model: 'no provider answered' });
    expect(plannerCallLabel(undefined, fastLaneProviderLabel, 'claude-sonnet-4-6').model).not.toMatch(/claude/);
    expect(plannerCallLabel('GLM', fastLaneProviderLabel, 'claude-sonnet-4-6').provider).toBe('glm');
    expect(plannerCallLabel('CLAUDE', fastLaneProviderLabel, 'claude-sonnet-4-6').model).toBe('claude-sonnet-4-6');
  });
  it('🔒 buildTurnRunner has a plan option, and all three planners use it', () => {
    const route = strip(src('src/server/routes/agentv3.ts'));
    expect(route).toContain('if (opts.plan) rungs = planLadder(level);');
    expect(route).toContain('const makePlanTextRunner = (onUsed?: (used: string) => void): TurnRunner => buildTurnRunner({');
    for (const v of ['rmProvider', 'bpProvider', 'ppProvider']) {
      expect(route).toContain(`makePlanTextRunner((used) => { ${v} = used; })`);
      expect(route).not.toContain(`let ${v} = 'CLAUDE';`);
    }
    expect(route.split('plannerCallLabel(').length - 1).toBeGreaterThanOrEqual(3); // definition + two failure sites
  });
});

// ── 4 · a page route is a URL the app serves, and a redirect is not a render ─────────────────────

describe('4 · page routes come from the app, and a redirect proves nothing', () => {
  const viteApp = {
    'package.json': '{"dependencies":{"react":"^18","react-router-dom":"^6"}}',
    'vite.config.ts': 'export default {}',
    'src/App.tsx': ['/', '/chat', '/chat/:id', '/history', '/library', '/map', '/settings', '/translate']
      .map((p) => `<Route path="${p}" element={<X/>}/>`).join(''),
    'src/pages/ChatPage.tsx': 'x', 'src/pages/ConversationPage.tsx': 'x', 'src/pages/HistoryPage.tsx': 'x',
    'src/pages/LibraryPage.tsx': 'x', 'src/pages/MapPage.tsx': 'x', 'src/pages/SettingsPage.tsx': 'x',
  };
  it('🔴 a Vite app\'s src/pages folder is not a route table — the real routes are checked', () => {
    expect(pagesFolderIsRouteTable(viteApp)).toBe(false);
    expect(extractPageRoutes(viteApp)).toEqual(['/chat', '/history', '/library', '/map', '/settings', '/translate']);
  });
  it('🔒 a Next app still reads pages/ as routes; a bare file map keeps the old reading', () => {
    const next = { 'package.json': '{"dependencies":{"next":"14"}}', 'pages/about.tsx': 'x' };
    expect(extractPageRoutes(next)).toEqual(['/about']);
    expect(extractPageRoutes({ 'pages/about.tsx': 'x' })).toEqual(['/about']);
  });
  it('a route the browser was sent AWAY from is "redirected" — neither pass nor fail', () => {
    const r = classifyPage({ route: '/ChatPage', status: 200, text: 900, errors: [], finalPath: '/' });
    expect(r.verdict).toBe('redirected');
    expect(classifyPage({ route: '/chat', status: 200, text: 900, errors: [], finalPath: '/chat/' }).verdict).toBe('ok');
  });
  it('🔴 every route redirected ⇒ the check did NOT run in any sense that counts', () => {
    const lines = ['/ChatPage', '/MapPage'].map((route) => `NBAI_PAGE:${JSON.stringify({ route, status: 200, text: 500, errors: [], finalPath: '/' })}`).join('\n');
    const results = parsePageCheck(lines);
    expect(results.map((r) => r.verdict)).toEqual(['redirected', 'redirected']);
    const s = summarizePageCheck(results);
    expect(s.ran).toBe(false);
    expect(s.summary).not.toMatch(/All \d+ page routes? opened/);
  });
  it('a redirected route is set aside, and the rest are judged', () => {
    const results = parsePageCheck([
      `NBAI_PAGE:${JSON.stringify({ route: '/chat', status: 200, text: 500, errors: [], finalPath: '/chat' })}`,
      `NBAI_PAGE:${JSON.stringify({ route: '/admin', status: 200, text: 500, errors: [], finalPath: '/login' })}`,
    ].join('\n'));
    const s = summarizePageCheck(results);
    expect(s).toMatchObject({ ok: true, ran: true });
    expect(s.summary).toMatch(/All 1 page route opened/);
    expect(s.summary).toMatch(/1 route redirected elsewhere and was not counted/);
  });
  it('🔒 the browser records where it ended up, and the gate reads `ran`', () => {
    expect(pageCheckScript('https://x', ['/a'])).toContain('out.finalPath = new URL(page.url()).pathname;');
    expect(strip(src('src/server/routes/agentv3.ts'))).toContain("if (pageSummary.ran) gateEvidence.pages = pageSummary.ok ? 'passed' : 'failed';");
  });
});

// ── 5 · zero passed is not a pass ────────────────────────────────────────────────────────────────

describe('5 · journeys: all unreachable is not JOURNEY_PASSED, and ChatPage serves /chat', () => {
  const unreachable: JourneyResult = { id: 'j1', kind: 'create-persists' as never, route: '/ChatPage', verdict: 'unreachable', step: 'fill', note: 'none of the form fields were present on the running page', errors: [] };
  it('🔴 one unreachable and none passed ⇒ ran: false', () => {
    const v = summarizeJourneys([unreachable]);
    expect(v.ran).toBe(false);
    expect(v.summary).not.toMatch(/^0 user journey\(s\) passed/);
  });
  it('🔒 one passed and one unreachable is still a pass', () => {
    const v = summarizeJourneys([{ ...unreachable, id: 'j2', verdict: 'passed' as never }, unreachable]);
    expect(v).toMatchObject({ ok: true, ran: true });
  });
  it('the file suffix names the file, not the URL', () => {
    expect(routeForFile('src/pages/ChatPage.tsx', ['/chat', '/history'])).toBe('/chat');
    expect(routeForFile('src/pages/HistoryScreen.tsx', ['/chat', '/history'])).toBe('/history');
    expect(routeForFile('src/pages/Home.tsx', ['/chat'])).toBe('/');
  });
});

// ── 6 · a heal that did not land is not recorded, saved or announced ─────────────────────────────

describe('6 · a refused heal write is never recorded, saved or announced', () => {
  const td = strip(src('src/server/AgentV3/ToolDispatcher.ts'));
  it('🔴 no heal site swallows its write and then records it anyway', () => {
    expect(td).not.toMatch(/try \{ await this\.actuator\.writeFile\(this\.workspaceId, [\w.']+, \w+\); \} catch \{ \}\s*\n\s*try \{ this\.onFileWrite/);
    expect(td.split('await this.landHealWrite(').length - 1).toBeGreaterThanOrEqual(5);
  });
  it('the missing-dependency sentence is inside the landed branch', () => {
    expect(td).toMatch(/if \(await this\.landHealWrite\('package\.json', newPkg, pkgJson\)\) \{\s*this\.narrate\('fix\.missingDeps'/);
  });
  it('landHealWrite returns false on a refused write BEFORE recording anything', () => {
    const body = td.slice(td.indexOf('private async landHealWrite('), td.indexOf('private narrate<'));
    const refused = body.indexOf('return false;');
    expect(refused).toBeGreaterThan(-1);
    expect(refused).toBeLessThan(body.indexOf('this.onFileWrite?.('));
  });
});

// ── 7 · no promise of a recovery that does not exist ─────────────────────────────────────────────

describe('7 · the checkpoint no longer promises a recovery', () => {
  it('🔴 the user-facing "preparing recovery" line is gone; the signal is admin-only', () => {
    const route = strip(src('src/server/routes/agentv3.ts'));
    expect(route).not.toContain('preparing recovery');
    expect(route).toContain("code: 'CHECKPOINT_SIGNAL'");
    expect(strip(src('src/server/AgentV3/BuildDiagnostics.ts'))).toMatch(/'CHECKPOINT_SIGNAL',/);
  });
});

// ── 8 · a literal list is never empty ────────────────────────────────────────────────────────────

describe('8 · a list written into the page cannot be empty, so it needs no empty state', () => {
  it('🔴 camelCase literal arrays and objects are static', () => {
    expect(rendersDataList(`const languages = [{c:'en'},{c:'hi'}];\nreturn <ul>{languages.map((l) => <li key={l.c}>{l.c}</li>)}</ul>`)).toBe(false);
    expect(rendersDataList(`const speeds: number[] = [0.75, 1, 1.25];\nreturn <div>{speeds.map((s) => <b>{s}</b>)}</div>`)).toBe(false);
    expect(rendersDataList(`const labels = { en: 'English' };\nreturn <div>{Object.entries(labels).map(([k, v]) => <b>{v}</b>)}</div>`)).toBe(false);
  });
  it('🔒 state, props and a filtered list are still data', () => {
    expect(rendersDataList(`const [items] = useState([]);\nreturn <ul>{items.map((i) => <li>{i}</li>)}</ul>`)).toBe(true);
    expect(rendersDataList(`function L({ items }) { return <ul>{items.map((i) => <li>{i}</li>)}</ul>; }`)).toBe(true);
    expect(rendersDataList(`const all = [1];\nconst shown = all.filter((x) => x > q);\nreturn <ul>{shown.map((i) => <li>{i}</li>)}</ul>`)).toBe(true);
  });
});

// ── 9 · a divider is not a credential ────────────────────────────────────────────────────────────

describe('9 · the report no longer eats a section heading as a secret', () => {
  it('🔴 "credentials." then a line of "=" survives intact', () => {
    const t = 'Do not expose private credentials.\n==================================================\n17. DEMO MODE';
    expect(redactSecrets(t)).toBe(t);
  });
  it('🔒 real assignments are still masked', () => {
    expect(redactSecrets('API_KEY=abcdef123456')).toBe('API_KEY=[REDACTED:secret]');
    expect(redactSecrets('password: hunter22')).toBe('password: [REDACTED:secret]');
    expect(redactSecrets('DB_PASSWORD="s3cr3tvalue"')).toBe('DB_PASSWORD="[REDACTED:secret]"');
  });
});
