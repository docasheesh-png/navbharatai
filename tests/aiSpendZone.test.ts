import { describe, it, expect } from 'vitest';
import {
  runInAiSpendZone, collectAiSpend, recordAiSpend, currentAiSpend, inAiSpendZone,
} from '../src/server/lib/aiSpendZone';
import { decideAiChargeForTurns } from '../src/server/lib/aiTurnCharge';
import type { ChatTurnUsage } from '../src/server/lib/chatSpend';

// Charging needs the cost, and the cost is known deep inside the shared routing layer while the user
// and their wallet are known up in the route. Threading it back out meant changing the return type of
// every function in between — across six call sites with six different shapes, one of which (the App
// Debugger) fans out over BATCHES and makes a dozen model calls for a single action. The seventh tool
// added later would silently bill nothing. Same fragility noClaudeZone was built to remove, so this
// uses the same mechanism.

const turn = (n: number): ChatTurnUsage =>
  ({ provider: 'GLM', model: 'glm-4.7', inputTokens: n, outputTokens: n });

describe('collecting what a request spent', () => {
  it('gathers every model call made anywhere inside it', async () => {
    const { result, spend } = await runInAiSpendZone(async () => {
      recordAiSpend(turn(1));
      await Promise.resolve();
      recordAiSpend(turn(2));
      return 'done';
    });
    expect(result).toBe('done');
    expect(spend.map((s) => s.inputTokens)).toEqual([1, 2]);
  });

  it('follows the calls down through nested async work — the batched-tool case', async () => {
    // The App Debugger calls the model once per batch of files, several levels deep. All of it must
    // land on one bill, not just whichever call the route happened to hold a reference to.
    const analyseBatch = async (i: number) => { await Promise.resolve(); recordAiSpend(turn(i)); };
    const { spend } = await runInAiSpendZone(async () => {
      await Promise.all([1, 2, 3, 4].map(analyseBatch));
    });
    expect(spend).toHaveLength(4);
  });

  it('keeps concurrent requests apart — one user is never billed for another', async () => {
    const request = async (id: number) => {
      const { spend } = await runInAiSpendZone(async () => {
        recordAiSpend(turn(id));
        await new Promise((r) => setTimeout(r, id === 1 ? 20 : 1)); // interleave them
        recordAiSpend(turn(id));
      });
      return spend;
    };
    const [a, b] = await Promise.all([request(1), request(2)]);
    expect(a.every((s) => s.inputTokens === 1)).toBe(true);
    expect(b.every((s) => s.inputTokens === 2)).toBe(true);
  });

  it('reads the running total from inside, which is how a route charges beside its existing burn', () => {
    return runInAiSpendZone(async () => {
      expect(currentAiSpend()).toEqual([]);
      recordAiSpend(turn(5));
      expect(currentAiSpend()).toHaveLength(1);
    });
  });
});

describe('outside a zone, nothing breaks', () => {
  it('recording is a no-op — an internal call nobody is billing must not fail', () => {
    expect(() => recordAiSpend(turn(1))).not.toThrow();
    expect(currentAiSpend()).toEqual([]);
  });

  it('a null or absent usage is ignored', async () => {
    const { spend } = await runInAiSpendZone(async () => {
      recordAiSpend(null);
      recordAiSpend(undefined);
    });
    expect(spend).toEqual([]);
  });
});

describe('a request that fails part-way', () => {
  it('still reports what it spent — the money really was spent', async () => {
    const r = await collectAiSpend(async () => {
      recordAiSpend(turn(1));
      recordAiSpend(turn(2));
      throw new Error('batch 3 failed');
    });
    expect(r.ok).toBe(false);
    expect(r.spend).toHaveLength(2); // pretending otherwise would under-report our own cost
  });

  it('lets the error out of runInAiSpendZone so a route still fails honestly', async () => {
    await expect(runInAiSpendZone(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });
});

describe('the express wrapper', () => {
  it('opens a zone around the handler so the route can read its own spend', async () => {
    let seen = -1;
    const handler = inAiSpendZone(async (_req: unknown, _res: unknown) => {
      recordAiSpend(turn(7));
      seen = currentAiSpend().length;
    });
    await handler({}, {});
    expect(seen).toBe(1);
  });

  it('gives each request its own store', async () => {
    const counts: number[] = [];
    const handler = inAiSpendZone(async () => {
      recordAiSpend(turn(1));
      counts.push(currentAiSpend().length);
    });
    await handler({}, {});
    await handler({}, {});
    expect(counts).toEqual([1, 1]); // never [1, 2] — no leak between requests
  });
});

describe('one bill for a multi-call action', () => {
  const ON = { AI_WALLET_SPEND: 'on' } as NodeJS.ProcessEnv;

  it('sums the calls BEFORE deciding, so ten fractional calls are one honest charge', () => {
    // Deciding per call would let ten sub-token calls each round to nothing. Summing first also means
    // the tiered markup applies to the request's real total, exactly as a build's does.
    const many = Array.from({ length: 10 }, () => turn(50_000));
    const one = decideAiChargeForTurns({ userId: 'u1' }, many, 85, ON);
    expect(one.charge).toBe(true);
    expect(one.cost.inputTokens).toBe(500_000);
  });

  it('an action whose calls were all unmeasured is not charged', () => {
    const d = decideAiChargeForTurns({ userId: 'u1' }, [{ provider: 'GROK' }, null], 85, ON);
    expect(d.reason).toBe('unmeasured');
    expect(d.billedInr).toBe(0);
  });

  it('a Pass holder is never charged, however many calls the action made', () => {
    const many = Array.from({ length: 10 }, () => turn(500_000));
    expect(decideAiChargeForTurns({ userId: 'u1', hasActivePass: true }, many, 85, ON).reason).toBe('pass');
  });
});
