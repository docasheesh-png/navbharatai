// 🖱️ A FREE CURSOR NEVER TURNS THE CAMERA (admin 2026-11-27, choice "A"; the PUBG-like game build #2565/#2566 screenshots:
// moving the cursor toward a button swung the whole frame). Two causes, both fixed here:
//   1. the kit turned the camera on EVERY mouse move, captured or not ("refused: the mouse still looks, just not captured");
//   2. NavBharatAI's preview frames had no `allow-pointer-lock`, so the browser refused every capture there.
// Now the mouse turns the camera only while the game holds the pointer (after a click; Esc frees it), or while a button is
// held (a drag, where a browser still refuses the lock). Runs the REAL generated kit input.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { UNTRUSTED_PREVIEW_SANDBOX, LIVE_PREVIEW_SANDBOX } from '../src/lib/previewSandbox';

const DIR = join(__dirname, `.tmp-free-cursor-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let I: any;
const doc: any = { pointerLockElement: null };
beforeAll(async () => {
  (globalThis as any).document = doc;
  (globalThis as any).window = { addEventListener: () => {}, removeEventListener: () => {} };
  for (const [p, c] of Object.entries(generateGameRuntime().files)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c as string); }
  I = await import(join(DIR, 'src/game/core/input.ts'));
}, 60_000);
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); delete (globalThis as any).document; delete (globalThis as any).window; });

/** A target that records listeners, so a real mousemove can be sent to the kit's Input. */
const target = () => { const l: Record<string, Array<(e: any) => void>> = {}; return { l, addEventListener: (t: string, f: any) => { (l[t] ||= []).push(f); }, removeEventListener: () => {}, send: (t: string, e: any) => (l[t] || []).forEach((f) => f(e)) }; };

describe('🖱️ the kit: the mouse turns the camera only when the game has it', () => {
  it('a free cursor moving over the game turns nothing', () => {
    doc.pointerLockElement = null;
    const t = target(); const input = new I.Input(t as any);
    t.send('mousemove', { movementX: 120, movementY: 40, buttons: 0 });
    expect([input.lookX, input.lookY]).toEqual([0, 0]);
  });
  it('captured (pointer lock after a click): the mouse turns camera and aim', () => {
    doc.pointerLockElement = {};
    const t = target(); const input = new I.Input(t as any);
    t.send('mousemove', { movementX: 120, movementY: 40, buttons: 0 });
    expect([input.lookX, input.lookY]).toEqual([120, 40]);
    doc.pointerLockElement = null;
  });
  it('not captured but dragged with a button held: it still looks (a browser that refuses the lock)', () => {
    doc.pointerLockElement = null;
    const t = target(); const input = new I.Input(t as any);
    t.send('mousemove', { movementX: 30, movementY: 0, buttons: 1 });
    t.send('mousemove', { movementX: 20, movementY: 0, buttons: 2 });
    expect(input.lookX).toBe(50);
  });
});

describe('🔓 every frame a game plays in lets it capture the mouse', () => {
  it('the shared sandbox lists carry allow-pointer-lock (and the untrusted one still never gets our origin)', () => {
    expect(UNTRUSTED_PREVIEW_SANDBOX.split(' ')).toContain('allow-pointer-lock');
    expect(UNTRUSTED_PREVIEW_SANDBOX).not.toContain('allow-same-origin');
    expect(LIVE_PREVIEW_SANDBOX.split(' ')).toContain('allow-pointer-lock');
  });
  it('census: no preview/player iframe keeps its own sandbox string without the token', () => {
    for (const f of ['src/components/agentv3/PreviewSurface.tsx', 'src/components/admin/AppPreviewSheet.tsx', 'src/components/SharePortal.tsx', 'src/components/ide/WebAppPlayer.tsx']) {
      const src = readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');   // a comment is not a frame
      for (const m of src.matchAll(/(?:sandbox=|SANDBOX = )["'`]([^"'`]+)["'`]/g)) expect(m[1], `${f}: ${m[1]}`).toContain('allow-pointer-lock');
    }
  });
});
