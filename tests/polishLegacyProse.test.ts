import { describe, it, expect } from 'vitest';
import { APP_KNOWLEDGE_BASE } from '../src/server/AppContext/AppKnowledgeBase';

/**
 * Polish campaign — "second lap": legacy v2.0 capability PROSE refreshed to v5.0 reality.
 *
 * Navigation was already correct after the first pass; this locks the descriptions so they no longer
 * assert v2.0-era internals that are simply untrue now (a right-docked canvas, a "16k Opus budget", a
 * Firestore "pro_memories" collection, a Pro-Chat-then-Engineer-AI handoff) — and, in passing, removes a
 * few provider-name leaks from user-facing entries (White-Label Law).
 */
const kb = (id: string) => APP_KNOWLEDGE_BASE.find((f) => f.id === id)!;
const text = (id: string) => `${kb(id).description ?? ''} ${kb(id).howToUse ?? ''}`;

describe('Refreshed descriptions no longer describe retired v2.0 internals', () => {
  it('unified-workspace: header tabs, not a right-docked panel', () => {
    expect(text('unified-workspace')).not.toMatch(/docks to the RIGHT|docks on the right/i);
    expect(text('unified-workspace')).toMatch(/Pro v5\.0/);
  });
  it('unified-memory: durable v5.0 memory, not "Firestore pro_memories" / Engineer AI handoff', () => {
    const t = text('unified-memory');
    expect(t).not.toMatch(/pro_memories|ProEngineRunner/);
    expect(t).not.toMatch(/Engineer AI/);
    expect(t).toMatch(/Pro v5\.0/);
  });
  it('pro_chat_session_memory: no raw Firestore internal', () => {
    expect(text('pro_chat_session_memory')).not.toMatch(/Firestore/);
  });
});

describe('Provider names removed from these user-facing entries (White-Label Law)', () => {
  it('extended-thinking + design-to-code no longer name Claude / Opus', () => {
    expect(text('pro_chat_extended_thinking')).not.toMatch(/Claude|Opus/);
    expect(text('pro_chat_design_to_code')).not.toMatch(/Claude|Opus/);
  });
});

describe('App Navigation Overview lists the REAL header tabs/menu', () => {
  it('describes the real nav (Pro v5.0 / Professionals), not the retired Pro Chat / Reports / Engineer AI tabs', () => {
    const d = kb('app_navigation').description!;
    expect(d).toMatch(/Pro v5\.0/);
    expect(d).toMatch(/Professionals/);
    expect(d).not.toMatch(/Pro Chat/);
    expect(d).not.toMatch(/Reports \(Free Chat\)/);
    expect(d).not.toMatch(/Engineer AI/);
  });
});
