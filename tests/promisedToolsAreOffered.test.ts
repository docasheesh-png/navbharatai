// THE PROMPT NAMED TOOLS THE MODEL WAS NEVER GIVEN (2026-09-29, found while building payment verification).
//
// The architect prompt says "payments → generate_payment", "your own DB → generate_db_config", and "ask the
// user for a key with request_secrets". None of them was in any role's tool list, and `catalogForTools`
// silently drops what a role does not list — so the model was told to call tools it could not call. The key
// popup built on 2026-08-08 had never once been reachable. This test holds the prompt and the lists together.
//
// 🔒 A RATCHET. NOT_YET_OFFERED is the debt measured today, and it may only SHRINK: a name leaves it when its
// tool is offered (the stale-entry check fails until it is removed), and a new name the prompt promises
// without offering fails CI immediately. It is not a list of things that are fine.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { roleConfig } from '../src/server/AgentV3/AgentRegistry';
import { RECIPE_TOOLS } from '../src/server/AgentV3/ToolCatalog';
import { projectHasServer, noServerPaymentGuidance } from '../src/server/lib/PaymentGenerator';

// The debt that stood here — 56 named tools no role was offered — is paid (2026-09-30): 54 are recipes
// reached through `run_recipe`, and `write_files_batch` / `find_ui_element` are offered directly. The
// list is gone rather than empty, so a new unoffered promise fails the first test below with no escape.

const catalog = readFileSync('src/server/AgentV3/ToolCatalog.ts', 'utf8');
// 🔴 A TOOL NAME MAY CARRY A DIGIT (autopsy f496c75b, 2026-09-30). Both patterns used to be letters and
// underscores only, so `generate_game_3d` matched as `generate_game` — not a catalog name — and the
// census never saw the prompt's step 2 for every 3D game. It was on no list, and a real build re-ran
// generate_game_runtime six times looking for the renderer it never got.
const catalogNames = new Set([...catalog.matchAll(/name:\s*'([a-z0-9_]+)'/g)].map((m) => m[1]));
// Every file that writes text the ARCHITECT reads as instructions — not only the system prompt. The
// object contract (heroObjectSpec.ts) is injected into the build prompt and names `object_spec`.
const PROMPT_SOURCES = ['src/server/AgentV3/systemPrompt.ts', 'src/server/lib/heroObjectSpec.ts'];
const prompt = PROMPT_SOURCES.map((f) => readFileSync(f, 'utf8')).join('\n');
const promised = new Set([...prompt.matchAll(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g)].map((m) => m[1]).filter((n) => catalogNames.has(n)));
const architectTools = roleConfig('architect').tools as string[];
/** What the architect can actually reach: its own tools, plus every recipe when it holds run_recipe. */
const architect = new Set<string>([...architectTools, ...(architectTools.includes('run_recipe') ? RECIPE_TOOLS : [])]);

describe('every tool the architect prompt names is one it can call', () => {
  it('the census reads a name with a digit in it', () => {
    expect(promised.has('generate_game_3d')).toBe(true);
    expect(promised.has('object_spec')).toBe(true);
  });
  it('no NEW promise without the tool', () => {
    const missing = [...promised].filter((n) => !architect.has(n));
    expect(missing).toEqual([]);
  });
  it('the payment, webhook, database and key-popup tools are offered', () => {
    for (const t of ['generate_payment', 'generate_webhook', 'generate_idempotency', 'generate_db_config', 'request_secrets']) {
      expect(architect.has(t), t).toBe(true);
    }
  });
  it('the key popup is the architect\'s alone — a sub-agent never opens a popup in front of the user', () => {
    for (const role of ['frontend', 'backend', 'fullstack', 'database'] as const) {
      expect(roleConfig(role).tools as string[]).not.toContain('request_secrets');
    }
  });
});

describe('generate_payment never pretends on an app with no server', () => {
  const vite = JSON.stringify({ dependencies: { react: '^18' }, devDependencies: { vite: '^8' } });
  it('a Vite/React app with no server folder has no server', () => {
    expect(projectHasServer(vite, ['src/App.tsx', 'src/utils/razorpay.ts', 'index.html'])).toBe(false);
  });
  it('an Express dependency, or a server folder, is a server', () => {
    expect(projectHasServer(JSON.stringify({ dependencies: { express: '^4' } }), [])).toBe(true);
    expect(projectHasServer(vite, ['server/index.ts'])).toBe(true);
    expect(projectHasServer('{ broken', ['api/pay.js'])).toBe(true);
  });
  it('the guidance forbids "paid" from the browser and writes nothing', () => {
    const g = noServerPaymentGuidance('razorpay');
    expect(g).toMatch(/no files were written/);
    expect(g).toMatch(/payment pending/);
    expect(g).toMatch(/NOT proof/);
    expect(g).not.toMatch(/will set up/);
  });
  it('the handler asks before it writes', () => {
    const src = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
    const at = src.indexOf("case 'generate_payment': {");
    const body = src.slice(at, at + 2500);
    expect(body.indexOf('projectHasServer(pkgText, paths)')).toBeGreaterThan(0);
    expect(body.indexOf('projectHasServer(pkgText, paths)')).toBeLessThan(body.indexOf('generatePaymentIntegration(pProvider)'));
  });
  it('the prompt states the rule once, beside the payment recipe', () => {
    expect(prompt).toMatch(/A payment is PAID only when a SERVER verified the gateway signature/);
  });
});
