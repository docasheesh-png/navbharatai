// AUTOPSY 303e8a6f (2026-10-12), item E — "Issue queue: 1 opened" on a build the user stopped at 36 s. ISS-001
// was a SECURITY finding against our OWN template: src/lib/imageAi.ts sets `link.rel = 'noopener noreferrer'` on
// the line before `link.target = '_blank'`, and the `unsafe-target-blank` guard read one line (or one tag) and
// never the element. The false finding then lived in the user's project memory for ever: shown to them after the
// next build, handed to every edit, costing readiness points, and impossible to clear because the scanner
// re-flags correct code. (The two lines were split by the PR that made the image keys required — #3528 — which
// is how a line-reading guard turned correct code into a finding.)
//
// The CLASS: the platform's own security analyzer misjudges code the platform itself ships, and nothing ran that
// analyzer over our own templates and recipes. This census does — every file of every golden scaffold and every
// file every recipe emits — so a new false finding on our own code, or a real one, fails CI.
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { scanSecurity, elementRelGuard } from '../src/server/AgentV3/SecurityAnalysis';
import { GOLDEN_SCAFFOLDS, goldenScaffoldFiles } from '../src/server/AgentV3/goldenScaffolds/registry';
import { WorkspaceMemory } from '../src/server/AgentV3/WorkspaceMemory';
import { foldSettle } from '../src/server/AgentV3/changeEngine/changeSession';
import { emptyMemory } from '../src/server/AgentV3/changeEngine/changeLog';
import { classifyNewApp } from '../src/server/AgentV3/changeEngine/changeClassifier';
import { foldBuildFindings, retireOpenIssues } from '../src/server/AgentV3/changeEngine/issueQueue';
import { buildConsentBannerScript } from '../src/server/lib/ConsentBannerGenerator';

const serious = (file: string, content: string) => scanSecurity(file, content).filter((f) => f.severity !== 'low');

/** Every file every recipe emits, for every option shape a recipe commonly takes. */
async function recipeOutputs(): Promise<Array<[string, string, string]>> {
  const dir = join(__dirname, '../src/server/lib');
  const out: Array<[string, string, string]> = [];
  for (const f of readdirSync(dir).filter((n) => /Generator\.ts$/.test(n))) {
    const mod: Record<string, unknown> = await import(join(dir, f));
    for (const [name, fn] of Object.entries(mod)) {
      if (!/^generate[A-Z]/.test(name) || typeof fn !== 'function') continue;
      for (const arg of [undefined, {}, { server: false, react: true }, { server: true, react: true }]) {
        let res: unknown;
        try { res = (fn as (a: unknown) => unknown)(arg); } catch { continue; }
        const files = res && typeof res === 'object' ? (res as { files?: unknown }).files : null;
        if (!files || typeof files !== 'object') continue;
        for (const [p, c] of Object.entries(files as Record<string, unknown>)) if (typeof c === 'string') out.push([`${f}:${name}`, p, c]);
      }
    }
  }
  return out;
}

describe('1 · 🔒 the census: our own code passes our own security scan', () => {
  it('every file of every golden scaffold', () => {
    const hits = GOLDEN_SCAFFOLDS.flatMap((g) => Object.entries(goldenScaffoldFiles(g)).flatMap(([p, c]) => serious(p, c).map((f) => `${g.id} ${p}:${f.line} ${f.rule}`)));
    expect(hits).toEqual([]);
  });

  it('every file every recipe emits', async () => {
    const outputs = await recipeOutputs();
    expect(outputs.length).toBeGreaterThan(200); // the census is reading recipes, not nothing
    const hits = outputs.flatMap(([who, p, c]) => serious(p, c).map((f) => `${who} ${p}:${f.line} ${f.rule}`));
    expect([...new Set(hits)]).toEqual([]);
  });

  it('the scanner is live — the shapes it must still catch', () => {
    expect(serious('src/a.ts', "const a = document.createElement('a');\na.target = '_blank';").map((f) => f.rule)).toEqual(['unsafe-target-blank']);
    expect(serious('src/a.tsx', '<a href="x" target="_blank">x</a>').map((f) => f.rule)).toEqual(['unsafe-target-blank']);
    expect(serious('src/a.ts', "b.rel = 'noopener';\na.target = '_blank';").map((f) => f.rule)).toEqual(['unsafe-target-blank']);
    expect(serious('src/a.ts', "window.open(url, '_blank')").map((f) => f.rule)).toEqual(['window-open-no-opener']);
    expect(serious('src/a.ts', 'el.innerHTML = userText;').map((f) => f.rule)).toEqual(['unsafe-html-sink']);
  });
});

describe('2 · a link guarded on its own element is safe, however it is written', () => {
  it.each([
    ['the report\'s template', "const link = document.createElement('a');\nlink.rel = 'noopener noreferrer';\nlink.target = '_blank';"],
    ['setAttribute', "a.setAttribute('rel', 'noopener');\na.target = '_blank';"],
    ['relList', "a.relList.add('noopener');\na.target = '_blank';"],
    ['noreferrer alone (it implies noopener)', '<a href="x" target="_blank" rel="noreferrer">x</a>'],
    ['window.open with noreferrer', "window.open(u, '_blank', 'noreferrer')"],
  ])('%s', (_n, code) => expect(serious('src/a.tsx', code)).toEqual([]));

  it('the element guard reads the same element only', () => {
    expect(elementRelGuard("x.rel = 'noopener';\nx.target = '_blank';", "x.target = '_blank';", 19)).toContain('noopener');
    expect(elementRelGuard("y.rel = 'noopener';\nx.target = '_blank';", "x.target = '_blank';", 19)).toBe('');
    expect(elementRelGuard('anything', 'const t = 1;', 0)).toBeNull();
  });

  it('the consent banner builds DOM nodes — no HTML string, so no sink to report', () => {
    expect(serious('public/consent-banner.js', buildConsentBannerScript({ purposes: ['analytics'] }))).toEqual([]);
  });
});

describe('3 · the report\'s chain: a stopped starter build opens no phantom issue', () => {
  it('index the ai-image template, settle a stopped build → nothing opened', () => {
    const wm = new WorkspaceMemory('ws-303e8a6f');
    const g = GOLDEN_SCAFFOLDS.find((x) => x.id === 'ai-image')!;
    for (const [p, c] of Object.entries(goldenScaffoldFiles(g))) wm.indexFile(p, c);
    const session = { workspaceId: 'ws-303e8a6f', isEdit: false, requested: [], probes: new Map(), assignedIssueIds: [], summary: 'AI image', classification: classifyNewApp('x') } as never;
    const out = foldSettle(emptyMemory(), session, { ok: false, stopped: true, gate: 'red', files: [], issues: [], security: wm.appSecurityFindings(), securityScanned: wm.graph().files }, 1);
    expect(out.mem.queue.issues).toEqual([]);
    expect(out.result.reportLines.join('\n')).not.toMatch(/Issue queue/);
  });

  it('a new app retires the previous app\'s open issues; an edit keeps them', () => {
    const q = foldBuildFindings({ issues: [], nextIss: 1 }, { findings: [{ code: 'SECURITY:x', severity: 'error', message: 'old app finding', file: 'src/old.ts' }], changeId: 'C1', now: 1, checksRan: true }).queue;
    expect(retireOpenIssues(q).queue.issues).toEqual([]);
    expect(retireOpenIssues(q).retired.map((i) => i.message)).toEqual(['old app finding']);
  });

  it('a detected issue promoted to triaged is counted (it is the moment the user starts seeing it)', () => {
    const w = [{ code: 'A11Y_X', severity: 'warning' as const, message: 'a field has no label' }];
    const first = foldBuildFindings({ issues: [], nextIss: 1 }, { findings: w, changeId: 'C1', now: 1, checksRan: true });
    expect(first.triaged).toEqual([]);
    const second = foldBuildFindings(first.queue, { findings: w, changeId: 'C2', now: 2, checksRan: true });
    expect(second.triaged.map((i) => i.status)).toEqual(['triaged']);
  });
});

describe('4 · the NAME of an environment variable is not a credential', () => {
  it('a table of which secret a feature reads is not a hardcoded secret', async () => {
    const { isEnvVarNameValue } = await import('../src/server/AgentV3/SecurityAnalysis');
    for (const name of ['NAVBHARATAI_API_KEY', 'OPENAI_API_KEY', 'STRIPE_SECRET_KEY', 'GITHUB_TOKEN', 'TWILIO_ACCOUNT_SID', 'X_CLIENT_ID', 'DATABASE_URL']) {
      expect(isEnvVarNameValue(name), name).toBe(true);
    }
    expect(serious('src/lib/keys.ts', "export const K = [{ secret: 'NAVBHARATAI_API_KEY' }, { secret: 'OPENAI_API_KEY' }];")).toEqual([]);
  });

  it('🔒 a real-looking or a human password value is still reported', async () => {
    const { isEnvVarNameValue } = await import('../src/server/AgentV3/SecurityAnalysis');
    for (const v of ['ADMIN_PASSWORD', 'sk_live_51HxAbCdEfGh', 'Hunter2Hunter2', 'abcd1234EFGH', 'MY_SECRET_2024']) expect(isEnvVarNameValue(v), v).toBe(false);
    expect(serious('src/a.ts', "const apiKey = 'a8f3k2l9q0w1e2r3';").map((f) => f.rule)).toEqual(['hardcoded-secret']);
  });
});
