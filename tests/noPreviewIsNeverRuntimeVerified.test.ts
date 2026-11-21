// failedbr #1563 (2026-11-20): no preview ever came up (PREVIEW_NEVER_CAME_UP), yet the report said "Runtime verified —
// the app ran in the browser" because the console capture returned nothing without saying it could not look.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runtimeCanBeVerified } from '../src/server/AgentV3/AutoFix';

describe('no preview is never "runtime verified" (failedbr #1563)', () => {
  it('needs a published preview or a proved render', () => {
    expect(runtimeCanBeVerified(null, false)).toBe(false);
    expect(runtimeCanBeVerified('', false)).toBe(false);
    expect(runtimeCanBeVerified('https://5173-x.e2b.app', false)).toBe(true);
    expect(runtimeCanBeVerified(null, true)).toBe(true);
  });
  it('the route asks before recording RUNTIME_VERIFIED', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toMatch(/else if \(!runtimeCanBeVerified\(lastPreviewUrl, renderProvenNow\(\)\)\) \{[\s\S]{0,300}runtimeUncheckedRecord[\s\S]{0,80}\} else \{\s*buildDiag\.record\(runtimeVerifiedRecord\(\)\);/);
  });
});
