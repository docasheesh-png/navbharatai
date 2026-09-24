/**
 * A big app's version is kept WHOLE (admin 2026-09-24, after the compression audit: "jo hamari
 * navbharatai ko world class banaye woh build karo").
 *
 * The Time Machine kept the first ~900 KB of an app and silently dropped the rest — measured in
 * JavaScript characters, so a Hindi-heavy app could exceed Firestore's 1 MiB and lose the version
 * entirely. Source is text and packs 4–6×, so the same document now holds the whole app, and whatever
 * still does not fit is COUNTED rather than hidden.
 */
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  packJson, unpackJson, fitFilesPacked, utf8Bytes, MAX_PACKED_BYTES, PACKED_ENCODING,
} from '../src/server/lib/compactStore';
import { planVersionFiles, readVersionFiles } from '../src/server/project/BuildHistoryStore';
import { saveRestorePoint, _resetRestorePointMemory } from '../src/server/AgentV3/restorePoint';

/** Realistic source: repetitive, like real components — not a single repeated character. */
function component(i: number): string {
  return `import React, { useState } from 'react';\n\nexport function Screen${i}() {\n` +
    Array.from({ length: 120 }, (_, j) =>
      `  const [value${j}, setValue${j}] = useState<string>('item-${i}-${j}');\n`).join('') +
    `  return <div className="p-4 rounded-xl">{value0}</div>;\n}\n`;
}
function app(files: number): Record<string, string> {
  return Object.fromEntries(Array.from({ length: files }, (_, i) => [`src/screens/Screen${i}.tsx`, component(i)]));
}

describe('compactStore — the shared helper', () => {
  it('round-trips JSON, Hindi included', () => {
    const v = { 'a.ts': 'const x = 1;', 'hi.ts': 'नमस्ते दुनिया — दवा की दुकान' };
    const p = packJson(v);
    expect(p.enc).toBe(PACKED_ENCODING);
    expect(unpackJson(p.enc, p.data)).toEqual(v);
  });

  it('accepts the byte shapes the Firestore SDKs hand back', () => {
    const p = packJson({ a: 1 });
    expect(unpackJson(p.enc, new Uint8Array(p.data))).toEqual({ a: 1 });
    expect(unpackJson(p.enc, { toUint8Array: () => new Uint8Array(p.data) })).toEqual({ a: 1 });
  });

  it('refuses an unknown tag or a non-bytes payload instead of guessing', () => {
    const p = packJson({ a: 1 });
    expect(() => unpackJson('zs9', p.data)).toThrow();
    expect(() => unpackJson(p.enc, 'not bytes')).toThrow();
  });

  it('measures size in UTF-8 bytes, not characters', () => {
    expect(utf8Bytes('नमस्ते')).toBeGreaterThan('नमस्ते'.length);
  });

  it('keeps the whole map when it fits compressed', () => {
    const files = app(200);
    const fit = fitFilesPacked(files);
    expect(fit.omitted).toEqual([]);
    expect(Object.keys(fit.files)).toHaveLength(200);
    expect(fit.packed.data.length).toBeLessThanOrEqual(MAX_PACKED_BYTES);
  });

  it('when even compressed it does not fit: the longest prefix that does, and every left-out path named', () => {
    // Random bytes do not compress — the one input that forces a partial fit.
    const files = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`blob${i}.txt`, randomBytes(150_000).toString('base64')]));
    const fit = fitFilesPacked(files, 600_000);
    expect(fit.packed.data.length).toBeLessThanOrEqual(600_000);
    expect(fit.omitted.length).toBeGreaterThan(0);
    expect(Object.keys(fit.files).length + fit.omitted.length).toBe(10);
    expect(Object.keys(fit.files)).toEqual(Object.keys(files).slice(0, Object.keys(fit.files).length));
    expect(unpackJson(fit.packed.enc, fit.packed.data)).toEqual(fit.files);
  });
});

describe('the Time Machine store — planVersionFiles', () => {
  it('a small app is stored exactly as before (plain), so a rollback of this code still reads it', () => {
    const plan = planVersionFiles(app(10));
    expect(plan.mode).toBe('plain');
    expect(plan.omitted).toEqual([]);
    expect(plan.files).toEqual(app(10));
  });

  it('THE BUG: a ~3 MB app used to keep a fragment — now it is kept whole, compressed', () => {
    const big = app(300);
    const raw = Object.entries(big).reduce((n, [p, c]) => n + utf8Bytes(p) + utf8Bytes(c), 0);
    expect(raw).toBeGreaterThan(2_000_000);
    const plan = planVersionFiles(big);
    expect(plan.mode).toBe('packed');
    expect(plan.omitted).toEqual([]);
    if (plan.mode !== 'packed') throw new Error('unreachable');
    expect(plan.packed.data.length).toBeLessThanOrEqual(MAX_PACKED_BYTES);
    expect(readVersionFiles({ filesEnc: plan.packed.enc, filesPacked: plan.packed.data } as never)).toEqual(big);
  });

  it('a Hindi-heavy app is measured in bytes: 400K characters is ~1.2 MB and is NOT stored plain', () => {
    const plan = planVersionFiles({ 'content.ts': 'दवा'.repeat(133_000) });
    expect(plan.mode).toBe('packed');
  });

  it('AGENTV3_COMPACT_STORAGE=off: never compresses, and names what did not fit', () => {
    const plan = planVersionFiles(app(300), { AGENTV3_COMPACT_STORAGE: 'off' } as NodeJS.ProcessEnv);
    expect(plan.mode).toBe('plain');
    expect(plan.omitted.length).toBeGreaterThan(0);
  });

  it('reads a legacy plain version, and treats an unreadable payload as NO files — never as an empty app', () => {
    expect(readVersionFiles({ files: { 'a.ts': 'x' } } as never)).toEqual({ 'a.ts': 'x' });
    expect(readVersionFiles({ filesEnc: PACKED_ENCODING, filesPacked: Buffer.from('garbage') } as never)).toBeNull();
    expect(readVersionFiles({} as never)).toBeNull();
  });
});

describe('restore points hand the store the WHOLE app', () => {
  it('a 3 MB app reaches the store complete, with its true file count', async () => {
    _resetRestorePointMemory();
    const big = app(300);
    let got: { fileCount: number; files: Record<string, string> } | null = null;
    const r = await saveRestorePoint({
      ok: true, workspaceId: 'agentv3-u-s', uid: 'u', buildKey: 'big',
      io: { loadFiles: async () => big, save: async (_k, v) => { got = v; return true; } },
    });
    expect(r.save).toBe(true);
    expect(got!.fileCount).toBe(300);
    expect(Object.keys(got!.files)).toHaveLength(300);
  });
});

describe('a big build step is saved in the transcript, not replaced by "too large to save"', async () => {
  const { turnDocFor, turnMessagesOf, TURN_PLAIN_MAX_BYTES } = await import('../src/server/AgentV3/FirestoreConversationStore');
  const step = (n: number) => ({ role: 'user', content: [{ type: 'tool_result', content: 'npm run build output line\n'.repeat(n) }] });

  it('an ordinary turn is stored exactly as before', () => {
    const msgs = [step(10)];
    expect(turnDocFor(3, msgs, 99)).toEqual({ seq: 3, messages: msgs, ts: 99 });
  });

  it('a ~1.3 MB turn is packed well under the document limit and reads back exactly', () => {
    const msgs = [step(50_000)];
    expect(Buffer.byteLength(JSON.stringify(msgs))).toBeGreaterThan(TURN_PLAIN_MAX_BYTES);
    const doc = turnDocFor(4, msgs, 99) as { messagesPacked: Buffer; messages?: unknown };
    expect(doc.messages).toBeUndefined();
    expect(doc.messagesPacked.length).toBeLessThan(900_000);
    expect(turnMessagesOf(doc as never)).toEqual(msgs);
  });

  it('an unreadable packed turn becomes one honest marker, never a silent gap', () => {
    const out = turnMessagesOf({ messagesEnc: 'br1', messagesPacked: Buffer.from('junk') });
    expect(out).toHaveLength(1);
    expect(JSON.stringify(out)).toMatch(/could not be read/);
  });

  it('off: never packs', () => {
    const msgs = [step(50_000)];
    expect(turnDocFor(4, msgs, 1, { AGENTV3_COMPACT_STORAGE: 'off' } as NodeJS.ProcessEnv)).toHaveProperty('messages');
  });
});
