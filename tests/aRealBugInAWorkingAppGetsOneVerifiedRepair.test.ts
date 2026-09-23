import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { selectAutoFixableWarnings, selectGreenRepairable, isFunctionalFinding } from '../src/server/AgentV3/ReviewerAgent';
import {
  greenFunctionalRepairEnabled, greenRepairPlan, greenRepairOutcome, greenRepairUserLine,
  GREEN_REPAIR_MAX_MS, GREEN_REPAIR_MIN_MS, GREEN_REPAIR_VERIFY_RESERVE_MS, GREEN_REPAIR_SETTLE_SLACK_MS,
} from '../src/server/AgentV3/greenReviewPolicy';
import { latchGreen, clearGreenLatch, runInPass, writeRefused, isSecretFilePath } from '../src/server/AgentV3/greenFreeze';
import { reconcileCapturedWrites } from '../src/server/AgentV3/GreenGuard';

/**
 * Autopsy ac41a924 (2026-09-23), admin: "han to fix karo". A Hindi news site rendered, and the reviewer
 * found two real bugs — every article rendered as one paragraph, and footer links into "page not
 * found". Both shipped: the classifier did not recognise either as functional, and on a green app the
 * reviewer could only suggest. A working app's functional findings now get ONE verified repair.
 */

const PARAGRAPH = 'ArticleDetail splits article.content with split("\\\\n"), but articles.ts uses template literals with real newlines, so the literal backslash-n sequence is not present and the content will render as one long paragraph. Use split("\\n") to correctly separate paragraphs.';
const DEAD_LINKS = 'Footer links to /about, /contact, and /privacy, but no routes or pages exist for them; clicking them will show the NotFound page. Either add the pages or remove the links to avoid dead-end navigation.';

describe('the classifier recognises a bug described as what the user sees', () => {
  it('both real findings from the report are functional', () => {
    const picked = selectAutoFixableWarnings([
      { severity: 'warning', message: PARAGRAPH },
      { severity: 'warning', message: DEAD_LINKS },
    ]);
    expect(picked).toHaveLength(2);
  });

  it('polish is still not a repair', () => {
    expect(isFunctionalFinding('Consider adding an aria-label to the search input')).toBe(false);
    expect(isFunctionalFinding('Variable naming could be clearer in utils.ts')).toBe(false);
    expect(isFunctionalFinding('')).toBe(false);
  });

  it('a critical is repaired on a green app only when it names broken behaviour', () => {
    const picked = selectGreenRepairable([
      { severity: 'critical', message: 'API keys should be moved to a secrets vault' },
      { severity: 'critical', message: 'The Add button does not work — handleAdd is never called' },
      { severity: 'warning', message: DEAD_LINKS },
      { severity: 'suggestion', message: 'The empty state is missing an illustration' },
    ]);
    expect(picked.map((i) => i.severity)).toEqual(['critical', 'warning']);
    expect(picked[0].message).toMatch(/Add button/);
  });
});

describe('the pass may write the app, never the user\'s keys', () => {
  const ws = 'ws-green-repair-test';
  afterEach(() => clearGreenLatch(ws));

  it('on a green app the repair pass may edit source but not a .env file', async () => {
    latchGreen(ws, ['src/App.tsx', '.env']);
    await runInPass('reviewer-functional-repair', async () => {
      expect(writeRefused(ws, 'src/components/Footer.tsx', {})).toBe(false);
      expect(writeRefused(ws, '.env', {})).toBe(true);
      expect(writeRefused(ws, 'server/.env.local', {})).toBe(true);
    });
    // Other allowed passes are unchanged by the secret deny.
    await runInPass('feature-presence-heal', async () => {
      expect(writeRefused(ws, 'src/App.tsx', {})).toBe(false);
    });
  });

  it('what counts as a secret file', () => {
    expect(isSecretFilePath('.env')).toBe(true);
    expect(isSecretFilePath('.env.production')).toBe(true);
    expect(isSecretFilePath('apps\\api\\.env')).toBe(true);
    expect(isSecretFilePath('src/env.ts')).toBe(false);
    expect(isSecretFilePath('.env.example')).toBe(true); // conservative: a template is still refused
    expect(isSecretFilePath('.envrc')).toBe(false);
    expect(isSecretFilePath('docs/environment.md')).toBe(false);
  });
});

describe('the budget comes from the build\'s clock, and the cap is re-armed to a finite bound', () => {
  it('no wall clock ⇒ the maximum repair, and a cap that covers repair + check + settle', () => {
    expect(greenRepairPlan(Number.POSITIVE_INFINITY)).toEqual({
      repairMs: GREEN_REPAIR_MAX_MS,
      capMs: GREEN_REPAIR_MAX_MS + GREEN_REPAIR_VERIFY_RESERVE_MS + GREEN_REPAIR_SETTLE_SLACK_MS,
    });
  });

  it('too little time ⇒ do not start', () => {
    const tooShort = GREEN_REPAIR_MIN_MS + GREEN_REPAIR_VERIFY_RESERVE_MS + GREEN_REPAIR_SETTLE_SLACK_MS - 1;
    expect(greenRepairPlan(tooShort)).toEqual({ repairMs: 0, capMs: 0 });
    expect(greenRepairPlan(-5_000)).toEqual({ repairMs: 0, capMs: 0 });
    expect(greenRepairPlan(Number.NaN)).toEqual({ repairMs: 0, capMs: 0 });
  });

  it('a middling amount of time is used, never exceeded', () => {
    const p = greenRepairPlan(150_000);
    expect(p.repairMs).toBe(150_000 - GREEN_REPAIR_VERIFY_RESERVE_MS - GREEN_REPAIR_SETTLE_SLACK_MS);
    expect(p.capMs).toBe(150_000);
  });

  it('the kill switch restores suggest-only', () => {
    expect(greenFunctionalRepairEnabled({ AGENTV3_GREEN_FUNCTIONAL_REPAIR: 'off' } as NodeJS.ProcessEnv)).toBe(false);
    expect(greenFunctionalRepairEnabled({} as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe('the report and the user are told the truth', () => {
  it('four outcomes, and an undo is the net working', () => {
    const base = { count: 2, budgetMs: 90_000 };
    expect(greenRepairOutcome({ ...base, kept: true, reverted: false, timedOut: false, finished: true }).code).toBe('REVIEW_FUNCTIONAL_REPAIRED');
    const timed = greenRepairOutcome({ ...base, kept: false, reverted: true, timedOut: true, finished: false });
    expect(timed.code).toBe('REVIEW_FUNCTIONAL_REPAIR_UNDONE');
    expect(timed.message).toMatch(/90 s budget/);
    expect(timed.severity).toBe('info');
    expect(greenRepairOutcome({ ...base, kept: false, reverted: true, timedOut: false, finished: true }).message).toMatch(/could not be shown to still render/);
    const stuck = greenRepairOutcome({ ...base, kept: false, reverted: false, timedOut: false, finished: true });
    expect(stuck.severity).toBe('warning');
    expect(stuck.autoResolved).toBe(false);
  });

  it('the user line names no engine', () => {
    const line = greenRepairUserLine(2);
    expect(line).toMatch(/2 real problems/);
    expect(line).not.toMatch(/claude|glm|kimi|gemini|grok|sonnet|opus|reviewer agent/i);
    expect(greenRepairUserLine(0)).toBe('');
  });
});

describe('a reverted change does not come back through the durable save', () => {
  it('the captured map takes exactly what the restore changed', () => {
    const captured = new Map<string, string>([
      ['src/Footer.tsx', 'BROKEN'],
      ['src/NewPage.tsx', 'CREATED BY THE REPAIR'],
      ['src/App.tsx', 'written earlier, untouched by the restore'],
    ]);
    reconcileCapturedWrites(captured, {
      write: { 'src/Footer.tsx': 'GREEN', 'src/Other.tsx': 'GREEN OTHER' },
      remove: ['src/NewPage.tsx'],
      unchanged: 1,
    });
    expect(captured.get('src/Footer.tsx')).toBe('GREEN');
    expect(captured.has('src/NewPage.tsx')).toBe(false);
    expect(captured.get('src/App.tsx')).toBe('written earlier, untouched by the restore');
    expect(captured.has('src/Other.tsx')).toBe(false); // not captured before ⇒ the scan already has it
  });
});

describe('the route wires it the only safe way', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');

  it('ONE revert for every verifyAfterFix site, and it reconciles the captured writes', () => {
    expect(route.match(/'vaf-remove'/g)?.length).toBe(1);
    expect(route.match(/revert: revertToGreenSnapshot,/g)?.length).toBe(3);
    const def = route.slice(route.indexOf('const revertToGreenSnapshot'), route.indexOf('const revertToGreenSnapshot') + 1200);
    expect(def).toContain('reconcileCapturedWrites(writtenFiles, plan)');
    // An empty snapshot is a failed read; restoring from it would delete the whole workspace.
    expect(def.indexOf("refusing to restore from an empty snapshot")).toBeGreaterThan(0);
    expect(def.indexOf("refusing to restore from an empty snapshot")).toBeLessThan(def.indexOf('restorePlan(snap, cur)'));
  });

  it('the green repair never runs without a snapshot it took itself', () => {
    const at = route.indexOf("runInPass('reviewer-functional-repair'");
    const before = route.slice(at - 3000, at);
    expect(before).toContain('const greenSnap = (await collectWorkspaceFiles(actuator, workspaceId)).files;');
    expect(before).toContain('snapshot: async () => greenSnap,');
  });

  it('the repair runs in its own pass, inside the net, and an unfinished repair is undone', () => {
    const at = route.indexOf("runInPass('reviewer-functional-repair'");
    expect(at).toBeGreaterThan(0);
    const block = route.slice(route.lastIndexOf('verifyAfterFix<', at), at + 3000);
    expect(block).toContain('if (!repairOk) return false');
    expect(block).toContain('return v.rendered && !v.inconclusive && !v.serverDown');
    expect(block).toContain('repairAbort.abort()');
  });

  it('the advisory cap is re-armed only with the plan\'s finite bound', () => {
    expect(route).toContain('armAdvisoryCap(plan.capMs)');
    expect(route.match(/armAdvisoryCap\(/g)?.length).toBe(2); // the default call + the repair (the definition is `= (`)
  });
});
