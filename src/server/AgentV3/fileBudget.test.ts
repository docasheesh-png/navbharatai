import { describe, it, expect } from 'vitest';
import { fileBudgetForPrompt, fileBudgetInstruction, overBudgetNote } from './fileBudget';
import { manifestUserPrompt, manifestSystemPrompt } from './SimpleBuilder';

const TODO = 'Build a to-do list app: add, edit, complete and delete tasks, organise them by category, filter by all/active/done, and save everything in the browser so it persists on reload.';
const SAAS = 'Build a multi-tenant SaaS admin dashboard with team accounts, role-based access (owner/admin/member), an analytics overview with charts, a settings page, and subscription billing. Clean, modern UI with a sidebar.';

describe('fileBudgetForPrompt — a NUMBER instead of the adjective "minimal"', () => {
  it('a simple app gets a small ceiling; a named complex app gets a bigger one', () => {
    const todo = fileBudgetForPrompt(TODO);
    const saas = fileBudgetForPrompt(SAAS);
    expect(todo.maxFiles).toBeLessThan(saas.maxFiles);
    expect(todo.maxFiles).toBeGreaterThanOrEqual(10); // never starves a real app
  });

  it('THE REAL FAILURE: the SaaS build planned 50 files — the budget is well under that', () => {
    const saas = fileBudgetForPrompt(SAAS);
    expect(saas.maxFiles).toBeLessThan(50);
    expect(overBudgetNote(50, saas)).toContain('50 files planned');
  });

  it('the golden to-do scaffold (11 hand-written files) fits comfortably inside its budget', () => {
    expect(fileBudgetForPrompt(TODO).maxFiles).toBeGreaterThanOrEqual(11);
  });

  it('is CLAMPED at both ends and never returns junk', () => {
    for (const p of ['', '   ', 'x', 'a '.repeat(5000)]) {
      const b = fileBudgetForPrompt(p);
      expect(b.maxFiles).toBeGreaterThanOrEqual(10);
      expect(b.maxFiles).toBeLessThanOrEqual(32);
      expect(['simple', 'standard', 'large']).toContain(b.label);
    }
  });

  it('is DETERMINISTIC — the same prompt always gets the same budget', () => {
    expect(fileBudgetForPrompt(SAAS)).toEqual(fileBudgetForPrompt(SAAS));
  });
});

describe('fileBudgetInstruction — states the ceiling AND the anti-pattern that causes bloat', () => {
  it('gives the concrete number and calls it a ceiling, not a target', () => {
    const b = fileBudgetForPrompt(SAAS);
    const text = fileBudgetInstruction(b);
    expect(text).toContain(`AT MOST ${b.maxFiles} source files`);
    expect(text).toContain('hard ceiling, not a target');
  });

  it('forbids the real bloat source: a file per tiny helper/type/constant', () => {
    const text = fileBudgetInstruction(fileBudgetForPrompt(TODO));
    expect(text).toMatch(/separate file for a single small helper/i);
    expect(text).toMatch(/no speculative abstraction layers/i);
  });
});

describe('overBudgetNote — honest telemetry, never a silent trim', () => {
  it('is null inside the budget and explains the overrun outside it', () => {
    const b = fileBudgetForPrompt(TODO);
    expect(overBudgetNote(b.maxFiles, b)).toBeNull();
    expect(overBudgetNote(b.maxFiles - 3, b)).toBeNull();
    const note = overBudgetNote(b.maxFiles + 9, b) ?? '';
    expect(note).toContain(`${b.maxFiles}-file ceiling`);
    expect(note).toContain('nothing was trimmed'); // the plan still builds IN FULL
  });

  it('tolerates junk counts', () => {
    const b = fileBudgetForPrompt(TODO);
    expect(overBudgetNote(NaN, b)).toBeNull();
    expect(overBudgetNote(-1, b)).toBeNull();
  });
});

describe('manifest prompt wiring — EVERY plan path inherits the budget (no unbudgeted second path)', () => {
  it('manifestUserPrompt embeds the per-app ceiling derived from its own prompt argument', () => {
    const saasPrompt = manifestUserPrompt(SAAS, []);
    const todoPrompt = manifestUserPrompt(TODO, ['src/App.tsx']);
    expect(saasPrompt).toContain(`AT MOST ${fileBudgetForPrompt(SAAS).maxFiles} source files`);
    expect(todoPrompt).toContain(`AT MOST ${fileBudgetForPrompt(TODO).maxFiles} source files`);
    // Different apps really do get different ceilings through the prompt, not one flat rule.
    expect(saasPrompt).not.toBe(todoPrompt);
  });

  it('manifestUserPrompt still carries the app prompt and the scaffold list', () => {
    const p = manifestUserPrompt(TODO, ['src/App.tsx', 'index.html']);
    expect(p).toContain(TODO);
    expect(p).toContain('src/App.tsx');
    expect(p).toContain('one "path :: purpose" per line');
  });

  it('the system prompt carries the app-agnostic consolidation rule', () => {
    const sys = manifestSystemPrompt('vite-react');
    expect(sys).toMatch(/Never a separate file for a single tiny helper/i);
    expect(sys).toMatch(/Fewer, cohesive files beat many thin ones/i);
  });
});
