import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkFeaturePresence } from '../src/server/AgentV3/FeaturePresence';
import { clickExplorerScript } from '../src/server/AgentV3/clickExplorer';
import { calculatorAppTsx } from '../src/server/AgentV3/goldenScaffolds/appsA';
import {
  greenRepairPrompt, readRepairVerdicts, greenRepairOutcome,
} from '../src/server/AgentV3/greenReviewPolicy';

/**
 * Autopsy 972acde5 (2026-09-30) — a calculator on the Weak tier, built from our own tested template.
 * It worked. The report still said its requested delete key had "no visible control", that pressing
 * "7" changed nothing, and — to the user — that a final review had found and fixed a real problem the
 * repair itself had traced and found not to exist.
 */

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const PROMPT = 'Build a calculator app with the standard operations (+ − × ÷ %), a clear and a delete key, decimal support, keyboard input, and a running history of recent calculations. Big, tappable buttons; light/dark mode.';

// What the preview capture of the pre-fix template looked like: glyph keys, no names.
const pad = (del: string) => `<div id="root"><div class="container"><h1>Calculator</h1><button aria-label="Switch to dark mode">Auto</button>
<div class="card"><div>0</div><div><button>C</button>${del}<button>%</button><button>/</button><button>7</button><button>8</button></div></div></div></div>`;

describe('a keypad delete key is a delete key', () => {
  it('the calculator report: a DEL key satisfies "a delete key"', () => {
    const r = checkFeaturePresence(PROMPT, pad('<button>DEL</button>'));
    expect(r.missing).not.toContain('Delete / remove');
  });

  it('icon-only delete, edit and done buttons are seen at last', () => {
    for (const icon of ['✕', '×', '🗑️', '⌫']) {
      const r = checkFeaturePresence('a todo list where I can delete tasks, with dark mode', pad(`<button>${icon}</button>`));
      expect(r.missing, icon).not.toContain('Delete / remove');
    }
    const edit = checkFeaturePresence('notes I can edit, with dark mode', pad('<button>✏️</button>'));
    expect(edit.missing).not.toContain('Edit / update');
  });

  it('a delete control that is really absent is still reported', () => {
    const r = checkFeaturePresence('a todo list where I can delete tasks, with dark mode', pad(''));
    expect(r.missing).toContain('Delete / remove');
  });

  it('the template names its glyph keys for a screen reader', () => {
    for (const name of ['Clear', 'Backspace', 'Percent', 'Divide', 'Multiply', 'Minus', 'Plus', 'Equals', 'Decimal point']) {
      expect(calculatorAppTsx).toContain(`'${name}')}`);
    }
    expect(calculatorAppTsx).toContain('aria-label={name}');
  });
});

describe('the explorer sees a change that keeps the same length', () => {
  // Evaluate the runner's own `measure()` against a fake page — the function, not a copy of it.
  const script = clickExplorerScript('http://localhost:5173', { blockWrites: false });
  const body = /function measure\(\) \{[\s\S]*?\n\}\n/.exec(script)?.[0] ?? '';
  const measureOn = (html: string, text: string) => {
    const root = { innerText: text, querySelector: () => null };
    const document = { querySelector: () => root, body: { innerHTML: html, innerText: text } };
    return new Function('document', `${body}; return measure();`)(document) as { sig: string };
  };

  it('is the function the script really ships', () => {
    expect(body).toContain('function measure()');
    expect(body).not.toMatch(/innerHTML\.length/);
  });

  it('"0" becoming "7" is a change', () => {
    expect(measureOn('<div>0</div>', '0').sig).not.toBe(measureOn('<div>7</div>', '7').sig);
  });

  it('an identical page is not', () => {
    expect(measureOn('<div>0</div>', '0').sig).toBe(measureOn('<div>0</div>', '0').sig);
  });
});

describe('a review finding on a working app is proven before the app is edited', () => {
  const findings = ['Chained operations overwrite the accumulator', 'Keyboard / conflicts with quick-find'];

  it('the prompt does not tell the model the findings are real', () => {
    const p = greenRepairPrompt('build a calculator', findings);
    expect(p).not.toMatch(/real problems that must be fixed/);
    expect(p).toMatch(/sometimes wrong/);
    expect(p).toMatch(/Change NOTHING for a/);
    expect(p).toContain('CONFIRMED <number>');
    expect(p).toContain('NOT A BUG <number>');
  });

  it('reads the verdicts the pass wrote, and nothing it did not', () => {
    const v = readRepairVerdicts('Traced both.\n\nNOT A BUG 1: 2 + 3 + 4 = gives 9\n- **CONFIRMED 2**: pressing / opened quick-find', 2);
    expect(v).toEqual({ read: true, confirmed: [1], refuted: [0] });
    expect(readRepairVerdicts('I fixed it.', 2).read).toBe(false);
    expect(readRepairVerdicts('CONFIRMED 7: out of range', 2).read).toBe(false);
    // Named both ways ⇒ kept as confirmed: the safe side keeps a real fix.
    expect(readRepairVerdicts('NOT A BUG 1: x\nCONFIRMED 1: y', 1)).toEqual({ read: true, confirmed: [0], refuted: [] });
  });

  it('an undone edit for a refuted finding says so, and claims nothing', () => {
    const o = greenRepairOutcome({ kept: false, reverted: true, timedOut: false, finished: true, count: 1, budgetMs: 150_000, changed: 1, refuted: true });
    expect(o.code).toBe('REVIEW_FUNCTIONAL_REFUTED');
    expect(o.message).toMatch(/nothing was claimed as fixed/);
  });

  it('the route asks, reads, undoes and does not re-offer (source guard)', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toContain("runInPass('reviewer-functional-repair', () => repairRunner.run(greenRepairPrompt(prompt, greenRepairable)))");
    expect(route).not.toContain("repairRunner.run(judgeRepairPrompt(prompt, greenRepairable))");
    expect(route).toContain('if (repairOk) repairVerdicts = readRepairVerdicts(outcome.summary, greenRepairable.length);');
    expect(route).toContain('if (repairRefutedAll()) return false;');
    expect(route).toContain('!greenRepaired.includes(t) && !greenRefuted.includes(t)');
  });
});

describe('the template lands in one round trip, not twelve', () => {
  it('writes the seed concurrently (source guard)', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toContain('await Promise.all(Object.entries(goldenFiles).map(([gp, gc]) => actuator.writeFile(workspaceId, gp, gc)));');
  });
});
