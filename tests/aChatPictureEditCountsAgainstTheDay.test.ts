// Q-683 (admin 2026-10-06, the recommendation accepted with "ok banao") — a picture edited inside the chat
// takes a slot of the same 5 free pictures a day as the Image Generator, and is never charged: the chat never
// shows a price. After the free 5, the chat says where more pictures are made instead of charging.
//
// Before: the chat's edit path used the old tool gate. It counted the picture only AFTER delivery, so two
// edits at once could both be "free", and it never refused past the daily 5 — the allowance had a side door.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { reserveImage, type ImageHoldDeps } from '../src/server/lib/imageHold';
import { chatEditFreeUsedMessage } from '../src/server/lib/imageTier';
import { IMAGE_STUDIO_MODE_NAME } from '../src/server/lib/freeChatModeGuide';

function counterDeps(start: number) {
  let count = start;
  const calls = { hold: 0, decrement: 0 };
  const deps: ImageHoldDeps = {
    increment: async () => ++count,
    decrement: async () => { calls.decrement++; count = Math.max(0, count - 1); },
    hold: async () => { calls.hold++; return { ok: true, ownerId: 'u1', tokensDebited: 0, tokenBalance: 0 } as never; },
    release: async () => ({ ok: true, released: false }),
    settle: async () => undefined,
    now: () => Date.UTC(2026, 9, 6, 12),
    newId: () => 'h1',
  };
  return { deps, calls, count: () => count };
}

describe('the chat takes the same daily slot, never a price', () => {
  it('the fifth picture of the day is free; the sixth is refused and its slot handed back — nothing is held', async () => {
    const at4 = counterDeps(4);
    const fifth = await reserveImage({ uid: 'u1', freeListed: false, priceShown: false }, at4.deps);
    expect(fifth.ok).toBe(true);
    if (fifth.ok) expect(fifth.hold.feeInr).toBe(0);

    const sixth = await reserveImage({ uid: 'u1', freeListed: false, priceShown: false }, at4.deps);
    expect(sixth.ok).toBe(false);
    if (!sixth.ok) expect(sixth.reason).toBe('price_not_shown');
    expect(at4.calls.hold).toBe(0);       // the chat never takes money
    expect(at4.calls.decrement).toBe(1);  // the refused slot is not counted
    expect(at4.count()).toBe(5);
  });

  it('a picture that is not delivered gives its free slot back', async () => {
    const at0 = counterDeps(0);
    const r = await reserveImage({ uid: 'u1', freeListed: false, priceShown: false }, at0.deps);
    expect(r.ok).toBe(true);
    if (r.ok) await r.hold.release('engine failed');
    expect(at0.count()).toBe(0);
  });
});

describe('the refusal says where more pictures are made, in the user\'s own words', () => {
  it('names the Image Generator, the price and tomorrow — never "busy", never "update"', () => {
    for (const said of ['make the sky blue', 'is photo ka background blue kar do', 'इस फोटो को नीला करो']) {
      const m = chatEditFreeUsedMessage(said, 5);
      expect(m, said).toContain(IMAGE_STUDIO_MODE_NAME);
      expect(m, said).toContain('₹1');
      expect(m, said).toMatch(/5/);
      expect(m, said).not.toMatch(/busy|update/i);
    }
    expect(chatEditFreeUsedMessage('इस फोटो को नीला करो', 5)).toMatch(/[ऀ-ॿ]/);
    expect(chatEditFreeUsedMessage('is photo ka background blue kar do', 5)).toMatch(/Aaj ki 5 free pictures/);
  });
});

describe('wiring: the chat edit path reserves before the engine and releases on every miss', () => {
  const src = readFileSync('src/server/routes/chat.ts', 'utf8');
  const start = src.indexOf("const { checkEditable, runImageEdit } = await import('../lib/imageEditRun');");
  const block = src.slice(start, src.indexOf('if (visionAttachments.length > 0)', start));

  it('reserves with priceShown: false before runImageEdit, and refuses with the chat sentence', () => {
    expect(block).toMatch(/reserveImage\(\{[\s\S]*priceShown: false/);
    expect(block.indexOf('reserveImage(')).toBeLessThan(block.indexOf('runImageEdit(dataUrl'));
    expect(block).toContain('chatEditFreeUsedMessage(message, reservation.freePerDay)');
  });

  it('settles only a delivered picture and releases from a finally', () => {
    expect(block).toMatch(/finally \{\s*if \(!delivered\) await hold\.release\(/);
    expect(block).toMatch(/delivered = true;\s*await hold\.settle\(\);/);
  });

  it('never debits a wallet itself', () => {
    expect(block).not.toMatch(/debitWallet|chargeToolAction|holdWalletRolledUp/);
  });
});
