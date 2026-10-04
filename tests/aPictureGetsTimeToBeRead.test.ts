// Q-091 (autopsy 0311186f; admin 2026-10-04: "aap kro, jo jo kar sakte").
//
// The build route read an attached picture inside an 8-second race. On 0311186f the vision call was abandoned at
// exactly 8.0 s and the build went ahead without the picture the user had sent. 8 s was chosen to bound a hang,
// never measured. A turn that carries a picture now waits up to 20 s; a turn without one keeps 8 s.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { visionReadCapMs, VISION_READ_CAP_MS, NO_PICTURE_READ_CAP_MS } from '../src/server/lib/attachmentReadOutcome';

const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');

describe('Q-091 · a picture the user sent gets time to be read', () => {
  it('🔴 a turn with a picture waits 20 s, not the 8 s that abandoned 0311186f', () => {
    expect(visionReadCapMs(1)).toBe(20_000);
    expect(visionReadCapMs(3)).toBe(VISION_READ_CAP_MS);
    expect(VISION_READ_CAP_MS).toBeGreaterThan(8_000);
  });
  it('a turn with no picture keeps the old 8 s bound', () => {
    expect(visionReadCapMs(0)).toBe(8_000);
    expect(NO_PICTURE_READ_CAP_MS).toBe(8_000);
  });
  it('🔒 it is still a hard bound, never "wait for ever"', () => {
    expect(Number.isFinite(VISION_READ_CAP_MS)).toBe(true);
    expect(VISION_READ_CAP_MS).toBeLessThanOrEqual(30_000);
  });
  it('🔴 the route races the read with the per-turn bound, not a fixed 8 s', () => {
    const at = route.indexOf("'describeVisionAttachments')");
    expect(at).toBeGreaterThan(0);
    const call = route.slice(route.lastIndexOf('raceTimeout(describeVisionAttachments', at), at);
    expect(call).toContain('visionReadCapMs(images.length)');
    expect(call).not.toMatch(/,\s*8_000,\s*$/);
  });
});
