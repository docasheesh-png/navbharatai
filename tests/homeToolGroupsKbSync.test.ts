/**
 * THE MENU AND WHAT EVERY AI SAYS ABOUT THE MENU MUST AGREE.
 *
 * `AppKnowledgeBase.ts` is what every AI in NavBharatAI reads to answer "where is X?" — it carries
 * literal paths like `Home → Other AI → Developer Tools → Versioning`. When the admin regrouped the
 * Other-AI tools on 2026-08-14, thirty-seven of those strings became directions to a group the tool
 * had just left.
 *
 * That failure is worse than a stale document. A user asks the assistant where the APK Builder is,
 * the assistant answers confidently, the user goes there and it is not — and the app looks broken
 * while the AI looks like it is guessing. Nothing in the build catches it, because both files are
 * perfectly valid on their own.
 *
 * So this test is the join between them: for every tool in the menu, any KB path naming that tool
 * must name the group it is ACTUALLY in. It is the "AppKnowledgeBase sync rule" from CLAUDE.md, made
 * mechanical for this one screen instead of trusted to whoever edits next.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { HOME_TOOL_GROUPS } from '../src/components/home/homeToolGroups';

/**
 * ⚠️ The KB is NOT the only place these paths are written. The regroup also found them in the v5
 * SYSTEM PROMPT and in a runtime-error hint — files nobody would think to check, whose sentences are
 * read out to users just as confidently. Scanning all of them together is the only version of this
 * guard that actually holds.
 */
const SOURCES = [
  'src/server/AppContext/AppKnowledgeBase.ts',
  'src/server/AgentV3/systemPrompt.ts',
  'src/server/AgentV3/RuntimeErrorClassify.ts',
];
const kb = SOURCES.map((f) => readFileSync(join(__dirname, '..', f), 'utf8')).join('\n');

/** Every group title the menu currently has. */
const groupTitles = HOME_TOOL_GROUPS.map((g) => g.title);

/** label → the group it really lives in. */
const groupOf = new Map<string, string>();
for (const g of HOME_TOOL_GROUPS) for (const item of g.items) groupOf.set(item.label, g.title);

/** Every `Other AI → <group> → <tool>` path the knowledge base states. */
function kbPaths(): Array<{ group: string; tool: string }> {
  const out: Array<{ group: string; tool: string }> = [];
  for (const m of kb.matchAll(/Other AI → ([A-Za-z][A-Za-z &/]*?) → ([A-Za-z][A-Za-z /&-]*?)(?=[.,'"`\n)]|\s{2}|$)/g)) {
    out.push({ group: m[1].trim(), tool: m[2].trim() });
  }
  return out;
}

describe('🔒 everything that states a path points at the REAL group', () => {
  it('every KB path for a known tool names the group that tool is actually in', () => {
    const wrong = kbPaths()
      // Only paths whose middle segment is a real MENU GROUP. `Other AI → Insights & Webhooks →
      // Code Review` is a card INSIDE that tool, not a menu path, and it happens to share a name
      // with the Code Review tool — checking it would flag a correct sentence.
      .filter((p) => groupTitles.includes(p.group))
      .filter((p) => groupOf.has(p.tool))
      .filter((p) => groupOf.get(p.tool) !== p.group)
      .map((p) => `"Other AI → ${p.group} → ${p.tool}" — but ${p.tool} is in ${groupOf.get(p.tool)}`);
    expect([...new Set(wrong)], `AppKnowledgeBase would send users to the wrong place:\n${wrong.join('\n')}`).toEqual([]);
  });

  it('🔒 no KB path names a group that no longer exists', () => {
    // "Design & Build" was folded into Developer Tools. A leftover path to it is a dead direction.
    const known = new Set([...groupTitles, 'Analytics', 'Insights & Webhooks']); // the last two are in-tool sections, not groups
    const ghosts = kbPaths()
      .map((p) => p.group)
      .filter((g) => !known.has(g));
    expect([...new Set(ghosts)], `these groups are named in the KB but do not exist in the menu`).toEqual([]);
  });

  it('the parser is actually finding paths — otherwise both checks pass vacuously', () => {
    const paths = kbPaths();
    expect(paths.length).toBeGreaterThan(20);
    expect(paths.filter((p) => groupOf.has(p.tool)).length).toBeGreaterThan(10);
  });
});

describe('every tool is described somewhere', () => {
  it('🔒 each menu tool is named in the knowledge base, so an AI can answer "where is it?"', () => {
    // A tool absent from the KB is invisible to every AI in the product — the exact failure the
    // AppKnowledgeBase sync rule exists to prevent.
    const missing = [...groupOf.keys()].filter((label) => !kb.includes(label));
    expect(missing, `not described in AppKnowledgeBase: ${missing.join(', ')}`).toEqual([]);
  });
});
