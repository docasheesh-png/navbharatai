import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sectionUntil } from './helpers/sourceSlice';

// The pure rollup is tested next to itself. What THIS pins is that it is actually FED and actually
// READABLE — a counter nobody writes to, or writes to but nobody can read, is the "looks done, does
// nothing" state the second absolute rule forbids.

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('every assistant turn reaches the rollup', () => {
  const src = read('src/server/lib/professionalRouting.ts');

  it('records beside recordAiSpend — the one place every professional and Other-AI tool passes', () => {
    // Recording at each call site instead would be one forgotten line away from an undercount, and an
    // undercount here reads as "the free model is still carrying everything" — the exact false comfort
    // this measurement exists to prevent.
    const answer = sectionUntil(src, 'const answer =', '// Tier-1 leader');
    expect(answer).toContain('recordAiSpend(spend)');
    expect(answer).toContain('assistantSpendStore.record(');
  });

  it('prices the turn with the same function the wallet charges from', () => {
    // A second pricing path would drift from the one the user is billed by, and then the admin's
    // "what does this cost us" number would answer a different question than the bill does.
    expect(src).toContain("import { chatTurnCost, type ChatTurnUsage } from './chatSpend'");
    expect(sectionUntil(src, 'const answer =', '// Tier-1 leader')).toContain('chatTurnCost(spend, usdInrRate())');
  });

  it('never awaits the write into the answer', () => {
    // A telemetry round-trip must not be able to slow down — or fail — a user's reply.
    const answer = sectionUntil(src, 'const answer =', '// Tier-1 leader');
    expect(answer).toContain('void assistantSpendStore.record(');
    expect(answer).not.toContain('await assistantSpendStore.record(');
  });
});

describe('the numbers are readable, and only by an admin', () => {
  const src = read('src/server/routes/admin.ts');

  it('exposes the summary', () => {
    expect(src).toContain("'/api/admin/assistant-spend'");
    expect(src).toContain('assistantSpendStore.summary(');
  });

  it('is behind the admin token — the payload names real providers and models', () => {
    // White-Label Law §3: vendor identity is admin-only forensics and must never reach a user surface.
    const route = src.slice(src.indexOf("'/api/admin/assistant-spend'"));
    expect(route.slice(0, 200)).toContain('verifyAdminToken');
  });
});

describe('the store cannot hurt a user', () => {
  const src = read('src/server/lib/AssistantSpendStore.ts');

  it('folds under a transaction, so concurrent turns are not silently dropped', () => {
    // A plain read-modify-write would undercount exactly when traffic is high — i.e. when the free/paid
    // split matters most.
    expect(src).toContain('runTransaction');
  });

  it('swallows its own failures rather than surfacing them', () => {
    expect(sectionUntil(src, 'async record(', 'async summary(')).toContain('catch');
  });

  it('a failed READ reports "unknown", never a reassuring healthy-and-empty', () => {
    const summary = sectionUntil(src, 'async summary(');
    expect(summary).toContain('assistantSpendVerdict(null)');
  });
});
