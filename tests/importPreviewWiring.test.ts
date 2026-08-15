/**
 * THE SPLIT-BRAIN PREVIEW — one missing wire, three lies (Mitrify report a876b7bb, 2026-08-15).
 *
 * The import path's background preview boot published `{type:'preview'}` through `emitLive`, which
 * wrote STRAIGHT to the raw HTTP stream — bypassing the AgentEventStream that `lastPreviewUrl`
 * subscribes to. The user's Preview tab showed the app; the build's own state said no preview exists.
 * From that one gap, in one real report:
 *
 *   1. the summary said "The live preview didn't start automatically — click Diagnose"
 *      while the preview was up and VERIFIED on port 3000;
 *   2. RELEASE_GATE swore "no live preview was ever available" — false, in the very feature whose
 *      job is honesty;
 *   3. every post-build runtime check gated on `lastPreviewUrl` silently skipped — including the
 *      deterministic dev-server-restart net, which is exactly what would have caught the dev server
 *      that died minutes later and left the user on E2B's "Closed Port Error" page.
 *
 * These are WIRING tests (same discipline as cachePrefixWiring.test.ts): the fix is one line in a
 * 12k-line route, nothing fails if a refactor drops it — the state just quietly goes blind again. So
 * the wire itself is pinned against the source.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');

describe('🔒 the import preview reaches the build’s own state', () => {
  it('emitLive routes through events.emit — never straight to the raw stream', () => {
    const line = route.match(/const emitLive = [^\n]+/)?.[0] ?? '';
    expect(line, 'emitLive must exist in the import block').not.toBe('');
    expect(line).toContain('events.emit');
    // The old shape — `emit(e)` directly — is what created the split brain.
    expect(line).not.toMatch(/=> \{ if \(!rb\.ended\) emit\(/);
  });

  it('lastPreviewUrl still subscribes to the events stream it now feeds', () => {
    // The other end of the wire — if this subscription moves off `events`, the fix above is void.
    expect(route).toMatch(/let lastPreviewUrl = ''/);
    expect(route).toMatch(/events\.subscribe\(\(e\) => \{ if \(\(e as \{ type\?: string \}\)\.type === 'preview'\)/);
  });
});

describe('🔒 the phase that lied for five minutes', () => {
  it("'checking the live preview' is exited on the normal path and the throw path", () => {
    // The phase was entered and never exited, so heartbeats said "checking the live preview, 293s"
    // while the build ran model calls. Count the exits AFTER the enterPhase.
    const enterAt = route.indexOf("enterPhase?.('checking the live preview')");
    expect(enterAt).toBeGreaterThan(-1);
    // Within the remainder of the import IIFE (bounded window), at least two exitPhase calls —
    // one after the if/else verdict, one on the catch path.
    const window = route.slice(enterAt, enterAt + 12_000);
    const exits = window.match(/opts\.diag\?\.exitPhase\?\.\(\)/g) ?? [];
    expect(exits.length).toBeGreaterThanOrEqual(2);
  });
});
