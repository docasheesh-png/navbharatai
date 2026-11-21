// EVERY PLANNER KNOWS WHAT THE PLATFORM'S BUILDER HAS (admin 2026-11-21: "Planner ko pura navbharatai pro me jo jo hai sab
// batao — app / game builder kya kya kar sakte hai, sab batao").
//
// 🧬 THE CLASS (failedbr #2481): a planner that decides an app's steps, and what is "beyond a normal build", without knowing
// what is already ready — it called a big game map infrastructure and planned a cube on a plane. The digest is built from the
// tool catalog itself, so this census fails the day a recipe exists that a planner is not told about, or a scope-deciding
// planner call is added that does not carry the digest.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { platformCapabilityDigest, plannerCapabilityNames } from '../src/server/AgentV3/plannerCapabilities';
import { RECIPE_TOOLS, defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';

const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
const digest = platformCapabilityDigest();

describe('📋 the capability digest is the catalog, not a second list', () => {
  it('names every recipe the builder can run (census: a new recipe reaches the planner by itself)', () => {
    const isHousekeeping = (n: string) => /readme|docs|guide|env_example|gitignore|app_defaults|openapi/.test(n);
    for (const name of RECIPE_TOOLS) if (!isHousekeeping(name)) expect(digest, name).toContain(`- ${name}: `);
    const generators = defaultToolCatalog().map((t) => t.name).filter((n) => n.startsWith('generate_'));
    const told = new Set(plannerCapabilityNames());
    const housekeeping = generators.filter((n) => !told.has(n));
    // Only docs / ignore-file / defaults housekeeping is left out, and nothing an app's plan would be made of.
    expect(housekeeping.every(isHousekeeping)).toBe(true);
    expect(told.size).toBeGreaterThan(150);
  });

  it('covers apps AND games: business backends, payments, sign-in, and the game kit with its big maps', () => {
    for (const n of ['generate_auth', 'generate_payment', 'generate_booking', 'generate_hospital_erp', 'generate_restaurant_pos', 'generate_upi',
      'generate_mobile_export', 'generate_game_3d', 'generate_game_2d', 'generate_athree_map', 'generate_world_2d', 'generate_board_games']) {
      expect(digest, n).toContain(`- ${n}: `);
    }
    expect(digest).toMatch(/generate_athree_map: .*big seeded world/);
  });

  it('every line says something (no empty description), and tells the planner how to use the list', () => {
    const lines = digest.split('\n').filter((l) => l.startsWith('- generate_') || l.startsWith('- add_') || l.startsWith('- author_'));
    for (const l of lines) expect(l.split(': ').slice(1).join(': ').length, l).toBeGreaterThan(15);
    expect(digest).toMatch(/Never call it impossible, "beyond a normal build" or infrastructure/);
    expect(digest).toMatch(/user-facing text \(titles, goals, messages\) never shows these names/);
  });

  it('never hands the planner an AI vendor or product name to repeat (White-Label Law)', () => {
    expect(digest).not.toMatch(/\b(?:Claude|Anthropic|OpenAI|ChatGPT|GPT-?\d|Gemini|Grok|Cursor|Copilot|Kimi|GLM|Qwen)\b/i);
  });

  it('stays small enough to ride on a planner call', () => {
    expect(digest.length).toBeLessThan(26_000);
  });
});

describe('🧭 every scope-deciding planner is told', () => {
  it('the mega-app roadmap, plan mode, the project planner and its replan all carry the digest', () => {
    expect(route).toContain('${gamePlannerCapability(prompt, framework)}\\n${platformCapabilityDigest()}`');
    expect(route).toContain('system: `${planSystemPrompt()}\\n\\n${platformCapabilityDigest()}`');
    expect(route).toContain('ppGenerate(`${projectPlanSystemPrompt(framework)}\\n\\n${platformCapabilityDigest()}`');
    expect(route).toContain('ppGenerate(`${replanSystemPrompt(framework)}\\n\\n${platformCapabilityDigest()}`');
  });

  it('🧬 census: no planner system prompt is used in the route without the digest beside it', () => {
    for (const fn of ['megaRoadmapSystemPrompt()', 'planSystemPrompt()', 'projectPlanSystemPrompt(framework)', 'replanSystemPrompt(framework)']) {
      const uses = route.split(fn).length - 1;
      expect(uses, fn).toBeGreaterThan(0);
      // Every CALL that uses it carries the digest on the same line (the diagnostics record of a call is not a call).
      for (const line of route.split('\n').filter((l) => l.includes(fn) && !l.trimStart().startsWith('import ') && !l.trimStart().startsWith('//') && !l.includes('recordLlmCall('))) {
        expect(line.includes('platformCapabilityDigest()'), `${fn} → ${line.trim().slice(0, 120)}`).toBe(true);
      }
    }
  });
});
