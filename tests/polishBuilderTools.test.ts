import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { APP_KNOWLEDGE_BASE } from '../src/server/AppContext/AppKnowledgeBase';

/**
 * Polish campaign — Builder Tools (Other AI) cluster, rock-solid verification.
 *
 * The Other AI grid renders grouped tiles from `homeToolGroups.ts` (group titles ARE shown), so every KB
 * path must name the real group + tile. Root causes fixed here:
 *   • voice_to_app pointed at a non-existent "Settings → AI Tools → Voice to App" — the real control is the
 *     🎙️ mic inside the NavBharatAI Pro v5.0 composer (AgentV3Panel).
 *   • ai_debugger / ai_image_gen / bot_builder omitted their "AI Tools" group (unlike ai_code_review).
 * The rest are verified against the real tile labels so they can't silently drift.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const groups = read('src/components/home/homeToolGroups.ts');
const panel = read('src/components/agentv3/AgentV3Panel.tsx');
const insights = read('src/components/panels/ProjectInsightsPanel.tsx');
const kb = (id: string) => APP_KNOWLEDGE_BASE.find((f) => f.id === id);

describe('Voice to App — real control is the Pro v5.0 mic', () => {
  it('the KB no longer points at the non-existent "Settings → AI Tools → Voice to App"', () => {
    const e = kb('voice_to_app')!;
    expect(e.path).not.toMatch(/Settings → AI Tools/);
    expect(e.path).toMatch(/NavBharatAI Pro v5\.0/);
    expect(e.path).toMatch(/mic/i);
  });
  it('the inline dictation mic really exists in the Pro composer', () => {
    expect(panel).toContain('Voice to App — speak to type');
    expect(panel).toContain('toggleVoice');
  });
});

describe('AI Tools tiles are reachable via Other AI', () => {
  // NOTE: the KB paths intentionally read "Home → Other AI → <tile>" (the builder tools moved from
  // Settings to the Home "Other AI" card on 2026-07-23; the group header is visual only). Locked so a
  // future edit can't quietly re-point them back at the retired "Settings → AI Tools" doorway.
  it.each([
    ['ai_debugger', 'Home → Other AI → AI Debugger'],
    ['ai_image_gen', 'Home → Other AI → AI Image Gen'],
    ['bot_builder', 'Home → Other AI → Bot Builder'],
  ])('%s path is the real Other AI doorway (not Settings)', (id, path) => {
    expect(kb(id)!.path).toBe(path);
    expect(kb(id)!.path).not.toMatch(/Settings/);
  });
  it('those tiles really live in the AI Tools group in code', () => {
    expect(groups).toContain("title: 'AI Tools'");
    for (const label of ["label: 'Bot Builder'", "label: 'AI Image Gen'", "label: 'AI Debugger'", "label: 'Code Review'"]) {
      expect(groups).toContain(label);
    }
  });
});

describe('Developer Tools + Design & Build tiles match real labels', () => {
  it('API Tester / Versioning / Minifier are in Developer Tools', () => {
    expect(groups).toContain("title: 'Developer Tools'");
    for (const label of ["label: 'API Tester'", "label: 'Versioning'", "label: 'Minifier'"]) {
      expect(groups).toContain(label);
    }
    expect(kb('api-tester')!.path).toMatch(/Developer Tools → API Tester/);
    expect(kb('code_versioning')!.path).toMatch(/Developer Tools → Versioning/);
  });
  it('Figma Import is in Design & Build', () => {
    expect(groups).toContain("title: 'Design & Build'");
    expect(groups).toContain("label: 'Figma Import'");
    expect(kb('figma_importer')!.path).toMatch(/Design & Build → Figma Import/);
  });
});

describe('Code Review + Code Review Comments reach real destinations', () => {
  it('AI Code Review path names the AI Tools group', () => {
    expect(kb('ai-code-review-tool')!.path).toMatch(/AI Tools → Code Review/);
  });
  it('Code Review Comments really live in the Insights panel', () => {
    expect(insights).toContain('/review'); // durable per-workspace review comments API
    expect(insights).toContain('Code Review');
  });
});
