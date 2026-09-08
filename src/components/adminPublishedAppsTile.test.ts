import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dash = readFileSync(resolve(__dirname, 'AdminDashboard.tsx'), 'utf8');
const tile = (() => {
  const at = dash.indexOf("statCard(\n                  'Published Apps'");
  return dash.slice(at, at + 1400);
})();

describe('Published Apps tile — the ceiling, readable at a glance', () => {
  it('exists on the Overview page', () => {
    // The full Publish Capacity card has carried this number since 2026-08-21, but under four rows of
    // tiles — and the admin did not know it was there. A ceiling that stops publishing for EVERY user
    // at once has to sit among the other counts.
    expect(tile).toContain("'Published Apps'");
  });

  it('🔒 shows "—" for an unreadable list, NEVER a count of zero', () => {
    // Reporting a failed read as "no apps published" is the exact dishonesty the endpoint itself
    // refuses ("the ceiling is UNKNOWN, not clear"). The tile must hold the same line.
    expect(tile).toContain("channelsError || !channels ? '—'");
    expect(tile).toContain('not a count of zero');
  });

  it('🔒 reads the SAME verdict the capacity card reads, so the two cannot disagree', () => {
    // Two independently-derived numbers on one screen is how an admin stops trusting either.
    expect(tile).toContain('channels.verdict.used');
    expect(tile).toContain('channels.verdict.cap');
    expect(tile).not.toMatch(/channels\.channels\.length/);
  });

  it('carries the same colour thresholds as the card below it', () => {
    expect(tile).toContain("channels.verdict.level === 'critical' ? 'bg-red-500'");
    expect(tile).toContain("channels.verdict.level === 'warn' ? 'bg-amber-500'");
  });
});

/**
 * NOTE ON SCOPE — why this file does NOT import channelCeilingVerdict.
 *
 * It did, and that broke CI in a way local checks missed. This file lives under src/components, so
 * importing a SERVER module pulled the whole server dependency graph (firebase-admin, axios) into the
 * FRONTEND tsconfig's program, where those node types are not configured — 60 type errors in files
 * nobody had touched.
 *
 * The behaviour of the verdict is already covered by src/server/AgentV3/channelInventory.test.ts,
 * which runs under the server config where those types resolve. This file's job is the TILE, and it
 * does that by reading the rendered source — no import needed.
 *
 * ⚠️ THE RULE IS NOT "frontend must never import server code" — it does, in eight places, and those
 * are fine: reportTriage, appId, terminalQuota, AppKnowledgeBase and the rest are PURE. The line is
 * whether the module's transitive graph reaches a node-only dependency. `channelInventory` does, via
 * Deployment.ts → axios + firebase-admin. A blanket ban would break the eight legitimate ones.
 *
 * No guard was added for this, deliberately: `tsc --noEmit` IS the guard and it caught it exactly as
 * designed. What failed was the process — the typecheck was run BEFORE this file was written and not
 * after. Both typechecks belong at the END of a change, not in the middle.
 */
