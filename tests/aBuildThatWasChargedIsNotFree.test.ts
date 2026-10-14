/**
 * A BUILD THAT WAS CHARGED SAYS SO, AND NO RETIRED PROGRAMME IS NAMED AS CURRENT — autopsy 9c612cdb (Q-995).
 *
 * The real record, one object in the admin report:
 *     userTier "free (… cheap engines)" · billedUsd 1.064709 · billedInr 103.24 · walletTokensDebited 10323
 *     powerLevel weak · noClaude true
 * The label came from a ROUTING flag (`freeTierBuildActive`, set for every Weak build), so it called a ₹103.24
 * build free without a word about the charge, and gave as the reason a sign-up grant the admin retired on
 * 2026-09-17. Two copies of the label (the wall-clock finalizer and the settle) chose it, and had drifted.
 *
 * Locked here, as a CLASS:
 *   1. the label is computed by ONE function from the money facts as well as the routing, at every
 *      `setBilling` site — a site that builds its own label fails the wiring guard;
 *   2. the Weak label keeps the routing meaning the admin accepted (still classified 'free' in the inbox,
 *      routes/admin.ts 2026-09-14) but always states the charge beside it, with a `charged` boolean for money;
 *   3. labels stored before this change still classify exactly as they did;
 *   4. a census: no string, template or regex literal anywhere in src/server says "welcome bonus" outside the
 *      named readers of HISTORY — so a retired programme cannot be printed as current again by any new code.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import ts from 'typescript';
import { buildBillingLabel, CHEAP_TIER_LABEL } from '../src/server/AgentV3/buildBillingLabel';
import { classifyReportTier } from '../src/server/AgentV3/AdminBuildReportStore';
import { BuildDiagnostics, renderDiagnosticsText } from '../src/server/AgentV3/BuildDiagnostics';
import { codeOnly } from './helpers/sourceSlice';

const root = join(__dirname, '..');

/** Report 9c612cdb's own billing facts. */
const REPORT_9C612CDB = { powerLevel: 'weak', billedUsd: 1.064709, billedInr: 103.24, walletTokensDebited: 10323, noClaude: true };
/** The label that report actually carried — a STORED string the inbox must still read. */
const LEGACY_LABEL = 'free (welcome bonus — cheap engines)';

describe('the label for report 9c612cdb\'s build', () => {
  // The build was debited (walletTokensDebited 10323), so billing applied; a Weak build is cheap-engines-only.
  const label = buildBillingLabel({
    freeListed: false,
    cheapEnginesOnly: true,
    billingActive: true,
    billedUsd: REPORT_9C612CDB.billedUsd,
    billedInr: REPORT_9C612CDB.billedInr,
  });

  it('🔒 names the charge, and never the retired grant', () => {
    expect(label.userTier).toBe('weak (free tier — cheap engines) · charged ₹103.24');
    expect(label.userTier).not.toMatch(/welcome bonus/i);
    expect(label.charged).toBe(true);
  });

  it('keeps the routing meaning the admin accepted: the inbox still files it under the free tier', () => {
    expect(classifyReportTier(label.userTier)).toBe('free');
  });

  it('…and the report the admin reads says both facts on one line', () => {
    const d = new BuildDiagnostics({ now: () => 1 });
    d.setBilling({ ...label, billedUsd: REPORT_9C612CDB.billedUsd, billedInr: REPORT_9C612CDB.billedInr, walletTokensDebited: REPORT_9C612CDB.walletTokensDebited, powerLevel: 'weak', noClaude: true });
    const r = d.report();
    expect(r.billing?.charged).toBe(true);
    const text = renderDiagnosticsText(r);
    expect(text).toContain('User tier: weak (free tier — cheap engines) · charged ₹103.24 [power: weak, no-Claude]');
    expect(text).not.toMatch(/welcome bonus/i);
  });
});

// Q-1036: `billedButNotDebited` is pinned on EVERY branch, not only where it can be true. A flag that
// only one test looks at is a flag that quietly becomes true somewhere nobody checked.
describe('every branch of the one rule', () => {
  it('a ₹0 Weak build says "not charged"', () => {
    const l = buildBillingLabel({ freeListed: false, cheapEnginesOnly: true, billingActive: true, billedUsd: 0, billedInr: 0 });
    expect(l).toEqual({ userTier: `${CHEAP_TIER_LABEL} · not charged`, charged: false, billedButNotDebited: false });
    expect(classifyReportTier(l.userTier)).toBe('free');
  });

  it('a Weak build with billing OFF is not charged, whatever the bill was priced at (nothing was debited)', () => {
    const l = buildBillingLabel({ freeListed: false, cheapEnginesOnly: true, billingActive: false, billedUsd: 0.5, billedInr: 48.5 });
    expect(l).toEqual({ userTier: `${CHEAP_TIER_LABEL} · not charged`, charged: false, billedButNotDebited: false });
  });

  it('free-list, paid and billing-off keep their stored wording, so the inbox classification does not move', () => {
    const freeListed = buildBillingLabel({ freeListed: true, cheapEnginesOnly: true, billingActive: false, billedUsd: 1, billedInr: 97 });
    expect(freeListed).toEqual({ userTier: 'free-list (admin/tester)', charged: false, billedButNotDebited: false });
    expect(classifyReportTier(freeListed.userTier)).toBe('admin');

    const paid = buildBillingLabel({ freeListed: false, cheapEnginesOnly: false, billingActive: true, billedUsd: 2.5, billedInr: 242.43 });
    expect(paid).toEqual({ userTier: 'paid', charged: true, billedButNotDebited: false });
    expect(classifyReportTier(paid.userTier)).toBe('paid');
    expect(buildBillingLabel({ freeListed: false, cheapEnginesOnly: false, billingActive: true, billedUsd: 0, billedInr: 0 }))
      .toEqual({ userTier: 'paid', charged: false, billedButNotDebited: false });

    const off = buildBillingLabel({ freeListed: false, cheapEnginesOnly: false, billingActive: false, billedUsd: 3, billedInr: 291 });
    expect(off).toEqual({ userTier: 'billing-off (no charge)', charged: false, billedButNotDebited: false });
    expect(classifyReportTier(off.userTier)).toBe('free');
  });

  it('a stored report written before this change still classifies exactly as it did', () => {
    expect(classifyReportTier(LEGACY_LABEL)).toBe('free');
  });
});

describe('🔒 WIRING — every setBilling site takes its label from the one rule', () => {
  const route = codeOnly(readFileSync(join(root, 'src/server/routes/agentv3.ts'), 'utf8'));
  const sites = route.split('.setBilling({').slice(1);

  it('there are the two settle paths (the wall-clock finalizer and the settle)', () => {
    expect(sites.length).toBe(2);
  });

  it('each one opens with ...buildBillingLabel({ … }) and builds no label of its own', () => {
    for (const site of sites) {
      const call = site.slice(0, site.indexOf('});'));
      expect(call.trimStart().startsWith('...buildBillingLabel({'), call.slice(0, 200)).toBe(true);
      expect(call).not.toMatch(/userTier\s*:/);
      expect(call).toContain('cheapEnginesOnly: freeTierBuildActive');
      expect(call).toMatch(/billingActive(\s*,|:)/);
    }
  });

  it('no literal label survives anywhere in the route', () => {
    expect(/['"]free \(/.test(route), 'a hand-built cheap-tier label is back in the route').toBe(false);
    expect(/\?\s*'paid'/.test(route), 'a hand-built "paid" ternary is back in the route').toBe(false);
  });
});

/**
 * THE CENSUS. Every string, template and regex literal in src/server (test files excluded: they may hold a
 * stored report's old wording as a fixture, which is history by definition) is read with the TypeScript
 * parser, so neither a comment nor a `/*` inside a string can hide one.
 *
 * Allowed only where the literal READS HISTORY or SAYS THE GRANT IS GONE, each with its reason:
 *  - lib/accountMerge.ts — recognises the retired grant's ledger entries on wallets created before 2026-09-17,
 *    so a merge counts it once.
 *  - AppContext/AppKnowledgeBase.ts — tells users there is NO welcome bonus any more, and lists the words a
 *    user types when asking about it; every occurrence there must be one of those two shapes.
 * (`lib/payments.ts` is the other history reader; its code names the grant only as `WELCOME_BONUS_TOKENS`
 * and `welcomeBonusTokens`, which are identifiers, not text a person reads, so it needs no entry.)
 */
describe('🔒 CENSUS — no literal in src/server presents the retired welcome bonus as current', () => {
  const RETIRED = /welcome[ -]bonus/i;
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  const sources = walk(join(root, 'src/server'))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !/(^|\/)__tests__\//.test(f));

  const literalsMatching = (file: string): string[] => {
    const text = readFileSync(file, 'utf8');
    if (!RETIRED.test(text)) return [];
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const out: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node) || ts.isRegularExpressionLiteral(node)) {
        const t = node.getText(sf);
        if (RETIRED.test(t)) out.push(t);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
  };

  const found = new Map<string, string[]>();
  for (const f of sources) {
    const hits = literalsMatching(f);
    if (hits.length) found.set(relative(join(root, 'src/server'), f).replace(/\\/g, '/'), hits);
  }

  /**
   * Every occurrence inside one literal must say the grant is gone ("there is no automatic welcome bonus"),
   * speak of it in the past ("received a welcome bonus in the past"), or be the bare keyword a user types.
   */
  const onlySaysItIsGone = (literal: string): boolean => {
    const bareKeyword = /^['"]welcome bonus['"]$/i.test(literal.trim());
    if (bareKeyword) return true;
    const re = /welcome[ -]bonus/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(literal))) {
      const before = literal.slice(Math.max(0, m.index - 40), m.index);
      const after = literal.slice(m.index + m[0].length, m.index + m[0].length + 20);
      if (!/\bno (automatic )?$/i.test(before) && !/^ in the past\b/i.test(after)) return false;
    }
    return true;
  };

  const HISTORY_READERS: Record<string, (literal: string) => boolean> = {
    'lib/accountMerge.ts': (l) => /^\/welcome bonus\/i$/.test(l.trim()),
    'AppContext/AppKnowledgeBase.ts': onlySaysItIsGone,
  };

  it('the census reads real code (it finds the known history reader)', () => {
    expect(sources.length).toBeGreaterThan(500);
    expect(found.has('lib/accountMerge.ts')).toBe(true);
  });

  it('nothing outside the named history readers', () => {
    const offenders = [...found.keys()].filter((f) => !(f in HISTORY_READERS));
    expect(offenders, `A literal names the welcome bonus outside a history reader: ${offenders.map((f) => `${f}: ${found.get(f)!.join(' | ').slice(0, 160)}`).join('; ')}`).toEqual([]);
  });

  it('and inside them, only in the shape that reads history or says it is gone', () => {
    for (const [file, ok] of Object.entries(HISTORY_READERS)) {
      for (const literal of found.get(file) ?? []) {
        expect(ok(literal), `${file}: ${literal.slice(0, 200)}`).toBe(true);
      }
    }
  });
});
