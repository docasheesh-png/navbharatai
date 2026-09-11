import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { APP_KNOWLEDGE_BASE } from '../src/server/AppContext/AppKnowledgeBase';
import { listProfessionals, getProfessional } from '../src/server/professionals/registry';

/**
 * Polish campaign — Professional AIs (75), bulk rock-solid verification.
 *
 * The Professionals are a config-driven system with THREE sources of truth that must stay consistent:
 *   1. the registry (`listProfessionals()`)      — the real backend list the chat engine serves,
 *   2. the ProfessionalsView cards               — what the user actually sees + taps,
 *   3. the AppKnowledgeBase entries              — what every NavBharatAI AI uses to route "where is X?".
 * This suite locks all three together so a professional can never be shipped to the backend without a
 * discoverable card + a correct KB entry (or vice-versa). The shared chat engine's honesty was hardened
 * separately (the Doctor AI / SDA fix). ids here are the registry ids, reused verbatim by the KB.
 */
const view = readFileSync(join(__dirname, '../src/components/professionals/ProfessionalsView.tsx'), 'utf8');
const kbIds = new Set(APP_KNOWLEDGE_BASE.map((f) => f.id));
const registry = listProfessionals();

describe('Registry ↔ ProfessionalsView ↔ KnowledgeBase are consistent', () => {
  it('the registry serves a real, non-empty professional roster', () => {
    expect(registry.length).toBeGreaterThanOrEqual(60);
    for (const p of registry) {
      expect(p.id, 'every registry professional has an id').toBeTruthy();
      expect(getProfessional(p.id)!.name, `${p.id} resolves to a config`).toBeTruthy();
    }
  });

  it('every registry professional is an ACTIVE card in ProfessionalsView', () => {
    const missing = registry.filter((p) => !view.includes(`id: '${p.id}'`));
    expect(missing.map((p) => p.id), 'registry professionals missing a ProfessionalsView card').toEqual([]);
  });

  it('every registry professional has a KnowledgeBase entry so AIs can route to it', () => {
    const missing = registry.filter((p) => !kbIds.has(p.id));
    expect(missing.map((p) => p.id), 'registry professionals missing a KB entry').toEqual([]);
  });

  it('every professional KB entry routes through the REAL front door', () => {
    // The door MOVED on 2026-09-11 (admin: "professional wale option ko navbharatai free ke andar hi
    // shift kar diya gaya hai, to sidebar menu me se bhi isko hata do"), so this assertion moved with
    // it — from "Professionals" to the Free chat's Mode button. The INTENT is unchanged and just as
    // strict: every professional's KB path must name a door a user can actually open, because these
    // strings are what every AI in the app reads when someone asks "where is X?".
    const wrongPath = registry
      .map((p) => APP_KNOWLEDGE_BASE.find((f) => f.id === p.id)!)
      .filter((e) => e && !/Mode \(bottom bar\)/.test(e.path));
    expect(wrongPath.map((e) => e.id), 'professional KB entries whose path omits the Mode button').toEqual([]);
  });

  it('🔒 and no professional KB entry still points at the removed sidebar row', () => {
    const stale = registry
      .map((p) => APP_KNOWLEDGE_BASE.find((f) => f.id === p.id)!)
      .filter((e) => e && /Sidebar → Professionals/.test(`${e.path} ${e.howToUse}`));
    expect(stale.map((e) => e.id), 'KB entries still naming the removed sidebar row').toEqual([]);
  });
});

describe('Doctor AI (SDA) — the special professional surface — stays reachable', () => {
  it('has a KB entry (doctor_ai) and its own Professionals card (sda_chat surface)', () => {
    const doc = APP_KNOWLEDGE_BASE.find((f) => f.id === 'doctor_ai');
    expect(doc).toBeTruthy();
    expect(doc!.path).toMatch(/Doctor AI/);
    expect(doc!.aiSurface).toBe('sda_chat');
    expect(view).toContain("id: 'sda_chat'"); // the Doctor AI card in ProfessionalsView
  });
});
