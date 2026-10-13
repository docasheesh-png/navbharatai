// AUTOPSY 303e8a6f (2026-10-12), item E — "Issue queue: 1 opened" on a build the user stopped at 36 s. ISS-001
// was a SECURITY finding against our OWN template: src/lib/imageAi.ts sets `link.rel = 'noopener noreferrer'` on
// the line before `link.target = '_blank'`, and the `unsafe-target-blank` guard read one line (or one tag) and
// never the element. The false finding then lived in the user's project memory for ever: shown to them after the
// next build, handed to every edit, costing readiness points, and impossible to clear because the scanner
// re-flags correct code. (The two lines were split by the PR that made the image keys required — #3528 — which
// is how a line-reading guard turned correct code into a finding.)
//
// The CLASS: the platform's own security analyzer misjudges code the platform itself ships, and nothing ran that
// analyzer over our own templates and recipes. This census does — every file of every template the platform seeds
// (framework starters AND chip templates) and every file every `generate_*` tool writes through the REAL dispatcher,
// across every enum and boolean option and both workspace shapes — so a new false finding on our own code, or a
// real one, fails CI. A tool the census cannot call fails it too: partial coverage never passes silently.
//
// ⚠️ CORRECTED BY THE ADVERSARIAL REVIEW (2026-10-12): the first element guard read ±600 characters, which hid an
// unguarded link beside a guarded one of the same name — it now reads the element's own lifetime; the rule is LOW
// (modern browsers already treat target=_blank as noopener — the module's own record said so); the census found
// two more siblings the first version never looked at (the vanilla starter's innerHTML, the Fixer recipe sending
// its key over plain HTTP); the consent banner rewrite is proven byte-identical to the reviewed markup; a new app
// RETIRES the old app's issues (history kept) instead of deleting them.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanSecurity } from '../src/server/AgentV3/SecurityAnalysis';
import { platformSeedTemplates } from '../src/server/AgentV3/starterFragment';
import { GOLDEN_SCAFFOLDS, goldenScaffoldFiles } from '../src/server/AgentV3/goldenScaffolds/registry';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';
import { ToolDispatcher } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { WorkspaceMemory } from '../src/server/AgentV3/WorkspaceMemory';
import { foldSettle } from '../src/server/AgentV3/changeEngine/changeSession';
import { emptyMemory } from '../src/server/AgentV3/changeEngine/changeLog';
import { classifyNewApp } from '../src/server/AgentV3/changeEngine/changeClassifier';
import { foldBuildFindings, retireOpenIssues, parseIssueQueue, isOpenIssue } from '../src/server/AgentV3/changeEngine/issueQueue';
import { publicAppMemory } from '../src/server/AgentV3/changeEngine/publicView';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { buildConsentBannerScript, CONSENT_CORE_SOURCE, type ConsentBannerOptions } from '../src/server/lib/ConsentBannerGenerator';
import { FakeActuator } from './helpers/dispatcherHarness';
import { miniBrowser, MiniElement } from './helpers/miniDom';

const rules = (file: string, content: string) => scanSecurity(file, content).map((f) => `${f.rule}:${f.severity}`);
const targetBlank = (content: string) => scanSecurity('src/a.ts', content).filter((f) => f.rule === 'unsafe-target-blank').map((f) => f.line);

// ── The recipe census, through the real dispatcher ─────────────────────────────────────────────────────────────
const ENTITY_FIELDS = [{ name: 'title', type: 'string' }, { name: 'price', type: 'float' }];
/** An input for every REQUIRED field that has no enum. A required field missing here fails the census. */
const REQUIRED_INPUTS: Record<string, Record<string, unknown>> = {
  generate_openapi: { routes: [{ method: 'GET', path: '/api/items', summary: 'List items' }] },
  generate_api_docs: { routes: [{ method: 'POST', path: '/api/items', description: 'Create an item', auth: true }] },
  generate_tests: { path: 'src/lib/price.test.ts', module_path: './price', functions: [{ name: 'total', params: ['items'] }] },
  generate_seed_data: { entities: [{ name: 'Item', fields: ENTITY_FIELDS }] },
  generate_migration: { entities: [{ name: 'Item', fields: ENTITY_FIELDS }] },
  generate_mcp_server: { tables: ['orders'] },
  generate_crud: { name: 'Item', fields: ENTITY_FIELDS },
  generate_admin: { name: 'Item', fields: ENTITY_FIELDS },
  generate_rbac: { roles: ['admin', 'editor', 'viewer'] },
  generate_dashboard: { models: ['Item'] },
  generate_backup: { models: ['Item'] },
  generate_i18n: { languages: ['en', 'hi', 'ta'] },
  generate_env_validation: { keys: ['DATABASE_URL'] },
  generate_release_notes: { features: ['Browse items'] },
};
/** Files a tool reads before it writes (generate_types turns a schema into types). */
const PRESENT: Record<string, Record<string, string>> = {
  generate_types: { 'prisma/schema.prisma': 'model Item {\n  id    Int    @id\n  title String\n}\n' },
};
/** The two shapes a workspace has: a static app, and an app with a server of its own. */
const SHAPES: Record<string, Record<string, string>> = {
  static: { 'package.json': JSON.stringify({ name: 'app', dependencies: { react: '^18.3.1' } }) },
  server: { 'package.json': JSON.stringify({ name: 'app', dependencies: { react: '^18.3.1', express: '^4.19.2' } }), 'server/index.ts': "import express from 'express';\nconst app = express();\napp.listen(3000);\n" },
};
const MAX_COMBOS = 64;

type Prop = { type?: string; enum?: unknown[]; items?: { enum?: unknown[] } };
function inputCombos(name: string, schema: { properties?: Record<string, Prop>; required?: string[] }): Array<Record<string, unknown>> {
  const props = schema.properties ?? {};
  const missing = (schema.required ?? []).filter((k) => !Array.isArray(props[k]?.enum) && !(k in (REQUIRED_INPUTS[name] ?? {})));
  if (missing.length) throw new Error(`census cannot call ${name}: no input for required ${missing.join(', ')}`);
  let combos: Array<Record<string, unknown>> = [{ ...REQUIRED_INPUTS[name] }];
  for (const [k, p] of Object.entries(props)) {
    const values = Array.isArray(p.enum) ? p.enum
      : p.type === 'boolean' ? [true, false]
        : p.type === 'array' && Array.isArray(p.items?.enum) ? [p.items!.enum]
          : null;
    if (values) combos = combos.flatMap((c) => values.map((v) => ({ ...c, [k]: v })));
  }
  if (combos.length > MAX_COMBOS) throw new Error(`census for ${name} would need ${combos.length} combinations — raise MAX_COMBOS deliberately`);
  return combos;
}

async function toolCensus(): Promise<{ hits: string[]; silent: string[]; calls: number; tools: number }> {
  const tools = defaultToolCatalog().filter((t) => /^generate_/.test(t.name));
  const hits = new Set<string>();
  const silent: string[] = [];
  let calls = 0;
  for (const t of tools) {
    let wrote = 0;
    for (const input of inputCombos(t.name, t.input_schema as never)) {
      for (const [shape, files] of Object.entries(SHAPES)) {
        const act = new FakeActuator();
        const seeded = { ...files, ...(PRESENT[t.name] ?? {}) };
        for (const [p, c] of Object.entries(seeded)) act.files.set(p, c);
        const stream = new AgentEventStream();
        await new ToolDispatcher(act, `ws-census-${t.name}`, new WorkspaceState(stream), stream).dispatch({ id: 'c', name: t.name, input }, 'architect');
        calls++;
        for (const [p, c] of act.files) {
          if (seeded[p] === c) continue;
          wrote++;
          for (const f of scanSecurity(p, c)) hits.add(`${t.name} [${shape}] ${p}:${f.line} ${f.rule}:${f.severity}`);
        }
      }
    }
    if (!wrote) silent.push(t.name);
  }
  return { hits: [...hits], silent, calls, tools: tools.length };
}

describe('1 · 🔒 the census: our own code passes our own security scan — every severity', () => {
  it('every file of every template the platform seeds (framework starters and chip templates)', () => {
    const seeds = platformSeedTemplates();
    expect(seeds.length).toBeGreaterThanOrEqual(GOLDEN_SCAFFOLDS.length + 10);
    const hits = seeds.flatMap((tpl, i) => Object.entries(tpl).flatMap(([p, c]) => scanSecurity(p, c).map((f) => `seed#${i} ${p}:${f.line} ${f.rule}:${f.severity}`)));
    expect(hits).toEqual([]);
  });

  it('every file every generate_* tool writes, for every option, in both workspace shapes — and every tool is callable', async () => {
    const { hits, silent, calls, tools } = await toolCensus();
    expect(tools).toBeGreaterThan(150); // the census is reading the catalog, not nothing
    expect(calls).toBeGreaterThan(400);
    expect(silent).toEqual([]);         // a tool the census could not make write would be a silent pass
    expect(hits).toEqual([]);
  }, 120_000);

  it('every file of every game recipe', () => {
    const hits = [...recipeFilePool()].flatMap(([p, { content }]) => scanSecurity(p, content).map((f) => `${p}:${f.line} ${f.rule}:${f.severity}`));
    expect(hits).toEqual([]);
  });

  it('the scanner is live — the shapes it must still catch', () => {
    expect(rules('src/a.ts', "const a = document.createElement('a');\na.target = '_blank';")).toEqual(['unsafe-target-blank:low']);
    expect(rules('src/a.tsx', '<a href="x" target="_blank">x</a>')).toEqual(['unsafe-target-blank:low']);
    expect(rules('src/a.ts', "window.open(url, '_blank')")).toEqual(['window-open-no-opener:medium']);
    expect(rules('src/a.ts', 'el.innerHTML = userText;')).toEqual(['unsafe-html-sink:medium']);
    expect(rules('src/a.ts', "fetch('http://api.example.com/rates?key=' + KEY)")).toEqual(['insecure-http:low']);
  });

  it('an XML schemaLocation is a namespace, not an endpoint; a real http URL still is', () => {
    expect(rules('pom.xml', '<project xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">')).toEqual([]);
    expect(rules('pom.xml', '<url>"http://repo.example.com/maven"</url>')).toEqual(['insecure-http:low']);
  });
});

describe('2 · a link guarded on its own element is safe, however it is written', () => {
  it.each([
    ['the report\'s template', "const link = document.createElement('a');\nlink.rel = 'noopener noreferrer';\nlink.target = '_blank';"],
    ['rel after target', "const a = document.createElement('a');\na.target = '_blank';\na.rel = 'noopener';"],
    ['setAttribute', "const a = document.createElement('a');\na.setAttribute('rel', 'noopener');\na.setAttribute('target', '_blank');"],
    ['relList', "a.relList.add('noopener');\na.target = '_blank';"],
    ['target inside a nested block', "const a = document.createElement('a');\na.rel = 'noopener';\nif (x) {\n  a.target = '_blank';\n}"],
    ['a function parameter', "function open(link: HTMLAnchorElement) {\n  link.rel = 'noopener';\n  if (y) { link.target = '_blank'; }\n}"],
    ['a generic before the element — never a pseudo-tag', "async function f(): Promise<void> {\n  const link = document.createElement('a');\n  link.rel = 'noopener';\n  link.target = '_blank';\n}"],
    ['noreferrer alone (it implies noopener)', '<a href="x" target="_blank" rel="noreferrer">x</a>'],
    ['window.open with noreferrer', "window.open(u, '_blank', 'noreferrer')"],
  ])('%s', (_n, code) => expect(scanSecurity('src/a.tsx', code)).toEqual([]));

  // The adversarial review's counterexamples: each guard must belong to THIS element.
  it('🔒 the same name in the adjacent function is a different element — the unguarded one is still reported', () => {
    const two = [
      'function openSafe(u: string) {', "  const link = document.createElement('a');", "  link.rel = 'noopener noreferrer';",
      "  link.target = '_blank';", '  link.href = u; link.click();', '}',
      'function openUnsafe(u: string) {', "  const link = document.createElement('a');", "  link.target = '_blank';",
      '  link.href = u; link.click();', '}',
    ].join('\n');
    expect(targetBlank(two)).toEqual([9]);
  });

  it.each([
    ['rel set on a different element', "b.rel = 'noopener';\na.target = '_blank';", [2]],
    ['rel set on a shadowing element inside another function', "const a = document.createElement('a');\nfunction f() { const a = document.createElement('a'); a.rel = 'noopener'; }\na.target = '_blank';", [3]],
    ['a parameter of another function', "function f(link) {\n  link.rel = 'noopener';\n}\nfunction g(link) {\n  link.target = '_blank';\n}", [5]],
    ['setAttribute with no rel at all', "const a = document.createElement('a');\na.setAttribute('target', '_blank');", [2]],
  ])('%s is reported', (_n, code, lines) => expect(targetBlank(code as string)).toEqual(lines));

  it('the rule is advice (low); window.open, which really can reach this tab, stays medium', () => {
    expect(scanSecurity('src/a.tsx', '<a href="x" target="_blank">x</a>')[0]).toMatchObject({ severity: 'low' });
    expect(scanSecurity('src/a.ts', "window.open(u, '_blank')")[0]).toMatchObject({ severity: 'medium' });
  });
});

describe('3 · 🔒 the consent banner is built from DOM nodes, and the visitor sees exactly the reviewed banner', () => {
  const FIXTURE = JSON.parse(readFileSync(join(__dirname, 'fixtures/consentBannerMarkup.json'), 'utf8')).scenarios as Record<string, string>;
  const core = new Function(`${CONSENT_CORE_SOURCE}; return NavConsentCore;`)() as { STORAGE_KEY: string; serialize(g: string[], v: string, at: string): string };
  const SCENARIOS: Array<{ name: string; opts: ConsentBannerOptions; attrs?: Record<string, string>; saved?: { granted: string[]; version: string }; open?: boolean }> = [
    { name: 'default, first visit', opts: {} },
    { name: 'english, every purpose, grievance contact, hostile app name', opts: { appName: 'Sharma <Stores> & "Co"', language: 'en', grievanceEmail: 'privacy@sharma.in', purposes: ['analytics', 'marketing', 'personalization'], policyUrl: '/privacy' } },
    { name: 'hindi, reopened after choosing marketing', opts: { language: 'hi', policyVersion: '2026-10-01' }, saved: { granted: ['marketing'], version: '2026-10-01' }, open: true },
    { name: 'hostile runtime attributes on the script tag', opts: {}, attrs: { 'data-purposes': 'analytics <img src=x onerror=alert(1)>', 'data-policy': '/p?a="1"&b=<2>', 'data-grievance': 'a"b@x.in' } },
  ];
  const show = (sc: (typeof SCENARIOS)[number]) => {
    const storage = sc.saved ? { [core.STORAGE_KEY]: core.serialize(sc.saved.granted, sc.saved.version, '2026-10-01T00:00:00.000Z') } : {};
    const b = miniBrowser({ scriptAttrs: sc.attrs, storage });
    b.run(buildConsentBannerScript(sc.opts));
    if (sc.open) (b.window.NavConsent as { open: () => void }).open();
    return b.body.querySelector('div.nbc-wrap')!;
  };

  it.each(SCENARIOS.map((s) => [s.name, s] as const))('%s — byte-identical to the markup the old innerHTML wrote', (name, sc) => {
    expect(FIXTURE[name]).toBeTruthy();
    expect(show(sc).innerHTML).toBe(FIXTURE[name]);
  });

  it('the compliance shape, read from the DOM: Reject beside Accept, Necessary always on, nothing pre-ticked, a saved choice reflected', () => {
    const fresh = show(SCENARIOS[0]!);
    expect(fresh.querySelectorAll('button[data-act]').map((b) => b.getAttribute('data-act'))).toEqual(['reject-all', 'manage', 'accept-all']);
    const necessary = fresh.querySelector('input[id="nbc-necessary"]')!;
    expect([necessary.hasAttribute('checked'), necessary.hasAttribute('disabled')]).toEqual([true, true]);
    expect(fresh.querySelectorAll('input[data-purpose]').filter((i) => i.hasAttribute('checked'))).toEqual([]);
    const reopened = show(SCENARIOS[2]!);
    expect(reopened.querySelectorAll('input[data-purpose]').filter((i) => i.hasAttribute('checked')).map((i) => i.getAttribute('data-purpose'))).toEqual(['marketing']);
  });

  it('a hostile value becomes text, never an element', () => {
    const wrap = show(SCENARIOS[3]!);
    const tags = (n: MiniElement): string[] => [n.tagName, ...n.children.flatMap((c) => (c instanceof MiniElement ? tags(c) : []))];
    expect(tags(wrap).filter((t) => !['div', 'h2', 'p', 'input', 'label', 'span', 'button', 'a'].includes(t))).toEqual([]);
    expect(wrap.innerHTML).toContain('&lt;img');
  });

  it('no HTML string anywhere in the emitted script', () => {
    expect(buildConsentBannerScript({ purposes: ['analytics'] })).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    expect(scanSecurity('public/consent-banner.js', buildConsentBannerScript({ purposes: ['analytics'] }))).toEqual([]);
  });
});

describe('4 · the report\'s chain: a stopped starter build opens no phantom issue', () => {
  it('index the ai-image template, settle a stopped build → nothing opened', () => {
    const wm = new WorkspaceMemory('ws-303e8a6f');
    const g = GOLDEN_SCAFFOLDS.find((x) => x.id === 'ai-image')!;
    for (const [p, c] of Object.entries(goldenScaffoldFiles(g))) wm.indexFile(p, c);
    const session = { workspaceId: 'ws-303e8a6f', isEdit: false, requested: [], probes: new Map(), assignedIssueIds: [], summary: 'AI image', classification: classifyNewApp('x') } as never;
    const out = foldSettle(emptyMemory(), session, { ok: false, stopped: true, gate: 'red', files: [], issues: [], security: wm.appSecurityFindings(), securityScanned: wm.graph().files }, 1);
    expect(out.mem.queue.issues).toEqual([]);
    expect(out.result.reportLines.join('\n')).not.toMatch(/Issue queue/);
  });

  const oldApp = () => foldBuildFindings({ issues: [], nextIss: 1 }, { findings: [{ code: 'SECURITY:x', severity: 'error', message: 'old app finding', file: 'src/old.ts' }], changeId: 'C1', now: 1, checksRan: true }).queue;

  it('🔒 a new app RETIRES the previous app\'s open issues — kept for history, never shown, never handed to a build', () => {
    const { queue, retired } = retireOpenIssues(oldApp());
    expect(retired.map((i) => [i.message, i.status])).toEqual([['old app finding', 'retired']]);
    expect(queue.issues.map((i) => i.status)).toEqual(['retired']); // history kept, not deleted
    expect(queue.issues.filter(isOpenIssue)).toEqual([]);
    expect(parseIssueQueue(JSON.parse(JSON.stringify(queue))).issues.map((i) => i.status)).toEqual(['retired']);
    const mem = { ...emptyMemory(), queue };
    expect(publicAppMemory(mem).openIssues).toEqual([]);
  });

  it('an issue the new app still has comes straight back as triaged — never hidden for a build as a fresh detection', () => {
    const { queue } = retireOpenIssues(oldApp());
    const again = foldBuildFindings(queue, { findings: [{ code: 'SECURITY:x', severity: 'warning', message: 'old app finding', file: 'src/old.ts' }], changeId: 'C2', now: 2, checksRan: true });
    expect(again.queue.issues.map((i) => [i.id, i.status])).toEqual([['ISS-001', 'triaged']]);
    expect(again.triaged.map((i) => i.id)).toEqual(['ISS-001']);
  });

  it('a detected issue promoted to triaged is counted (it is the moment the user starts seeing it)', () => {
    const w = [{ code: 'A11Y_X', severity: 'warning' as const, message: 'a field has no label' }];
    const first = foldBuildFindings({ issues: [], nextIss: 1 }, { findings: w, changeId: 'C1', now: 1, checksRan: true });
    expect(first.triaged).toEqual([]);
    const second = foldBuildFindings(first.queue, { findings: w, changeId: 'C2', now: 2, checksRan: true });
    expect(second.triaged.map((i) => i.status)).toEqual(['triaged']);
  });
});

describe('5 · the NAME of an environment variable is not a credential', () => {
  it('a table of which secret a feature reads is not a hardcoded secret', async () => {
    const { isEnvVarNameValue } = await import('../src/server/AgentV3/SecurityAnalysis');
    for (const name of ['NAVBHARATAI_API_KEY', 'OPENAI_API_KEY', 'STRIPE_SECRET_KEY', 'GITHUB_TOKEN', 'TWILIO_ACCOUNT_SID', 'X_CLIENT_ID', 'DATABASE_URL']) {
      expect(isEnvVarNameValue(name), name).toBe(true);
    }
    expect(scanSecurity('src/lib/keys.ts', "export const K = [{ secret: 'NAVBHARATAI_API_KEY' }, { secret: 'OPENAI_API_KEY' }];")).toEqual([]);
  });

  it('🔒 a real-looking or a human password value is still reported', async () => {
    const { isEnvVarNameValue } = await import('../src/server/AgentV3/SecurityAnalysis');
    for (const v of ['ADMIN_PASSWORD', 'sk_live_51HxAbCdEfGh', 'Hunter2Hunter2', 'abcd1234EFGH', 'MY_SECRET_2024']) expect(isEnvVarNameValue(v), v).toBe(false);
    expect(rules('src/a.ts', "const apiKey = 'a8f3k2l9q0w1e2r3';")).toEqual(['hardcoded-secret:high']);
  });
});
