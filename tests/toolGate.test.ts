import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The Other AI tools call the platform's own AI on NavBharatAI's account. Until now nothing metered
// them, so these tests are the contract for the money side: the flag must be a perfect no-op when off,
// a Pass must genuinely unlock, images must stay capped even for a Pass holder (that is the one promise
// ₹99 cannot carry), and a blocked action must never burn an allowance.

const state = {
  passActive: false,
  usedToday: 0,
  incremented: [] as Array<{ uid: string; bucket: string }>,
};

vi.mock('../src/server/professionals/ProfessionalPassStore', () => ({
  professionalPassStore: {
    getStatus: async () => ({ active: state.passActive, expiresAt: null, plan: null }),
  },
}));

vi.mock('../src/server/tools/ToolUsageStore', () => ({
  toolUsageStore: {
    getTodayCount: async () => state.usedToday,
    increment: async (uid: string, bucket: string) => { state.incremented.push({ uid, bucket }); return 1; },
  },
  usageDocId: (uid: string, bucket: string) => `${uid}__${bucket}`,
}));

const { gateToolAction, burnToolAction, aiToolFreeDailyLimit, imageFreeDailyLimit, imagePassDailyLimit } =
  await import('../src/server/tools/toolGate');

const UID = 'user123';
const EMAIL = 'someone@example.com';

const savedEnv = { ...process.env };
beforeEach(() => {
  state.passActive = false;
  state.usedToday = 0;
  state.incremented = [];
  process.env.PROFESSIONAL_PAID_ENABLED = 'true';
  delete process.env.AI_TOOL_FREE_DAILY_LIMIT;
  delete process.env.AI_IMAGE_FREE_DAILY_LIMIT;
  delete process.env.AI_IMAGE_PASS_DAILY_LIMIT;
  delete process.env.AGENTV3_FREE_LIST;
});
afterEach(() => { process.env = { ...savedEnv }; });

describe('the flag off is a perfect no-op', () => {
  it('allows everything and meters nothing', async () => {
    delete process.env.PROFESSIONAL_PAID_ENABLED;
    const r = await gateToolAction(UID, EMAIL, 'ai_tool');
    expect(r.allow).toBe(true);
    if (r.allow) {
      expect(r.countsAgainstFree).toBe(false);
      expect(r.tier).toBe('paid'); // today's behaviour: the full chain, unmetered
    }
  });

  it('allows an anonymous caller too, exactly like today', async () => {
    process.env.PROFESSIONAL_PAID_ENABLED = 'false';
    const r = await gateToolAction(null, null, 'image');
    expect(r.allow).toBe(true);
  });
});

describe('free users get a daily allowance', () => {
  it('allows an action inside the allowance, on the free chain, and marks it to be burned', async () => {
    state.usedToday = 2;
    const r = await gateToolAction(UID, EMAIL, 'ai_tool');
    expect(r.allow).toBe(true);
    if (r.allow) {
      expect(r.countsAgainstFree).toBe(true);
      expect(r.tier).toBe('free');
      expect(r.remainingFree).toBe(aiToolFreeDailyLimit() - 3);
    }
  });

  it('blocks with 402 once the allowance is used, and offers the Pass', async () => {
    state.usedToday = aiToolFreeDailyLimit();
    const r = await gateToolAction(UID, EMAIL, 'ai_tool');
    expect(r.allow).toBe(false);
    if (!r.allow) {
      expect(r.status).toBe(402);
      expect(r.body.code).toBe('tool_paywall');
      expect(r.body.passPriceInr).toBe(99);
      expect(String(r.body.error)).toMatch(/Professional Pass/);
      // The message must name what the user just tried, not "quota exceeded".
      expect(String(r.body.error)).toMatch(/AI tool actions/);
    }
  });

  it('a blocked action never counts against the allowance', async () => {
    state.usedToday = 99;
    const r = await gateToolAction(UID, EMAIL, 'ai_tool');
    expect(r.allow).toBe(false);
    // countsAgainstFree only exists on an allow; nothing may be burned from a block.
    expect(state.incremented).toHaveLength(0);
  });

  it('asks an anonymous caller to sign in rather than silently metering them', async () => {
    const r = await gateToolAction(null, null, 'ai_tool');
    expect(r.allow).toBe(false);
    if (!r.allow) {
      expect(r.status).toBe(401);
      expect(r.body.code).toBe('login_required');
    }
  });
});

describe('the Professional Pass unlocks the tools', () => {
  it('a pass holder is unlimited on the AI tools, however much they have used', async () => {
    state.passActive = true;
    state.usedToday = 10_000;
    const r = await gateToolAction(UID, EMAIL, 'ai_tool');
    expect(r.allow).toBe(true);
    if (r.allow) {
      expect(r.countsAgainstFree).toBe(false);
      expect(r.tier).toBe('paid');
    }
  });

  it('but images stay capped WITH a pass — ₹99 cannot carry unlimited image generation', async () => {
    state.passActive = true;
    state.usedToday = imagePassDailyLimit();
    const r = await gateToolAction(UID, EMAIL, 'image');
    expect(r.allow).toBe(false);
    if (!r.allow) {
      expect(r.status).toBe(402);
      expect(r.body.dailyLimit).toBe(imagePassDailyLimit());
      // A paying customer must not be told to buy the thing they already have.
      expect(r.body.passPriceInr).toBeUndefined();
      expect(String(r.body.error)).toMatch(/resets tomorrow/i);
    }
  });

  it('a pass holder still gets their higher image allowance', async () => {
    state.passActive = true;
    state.usedToday = imageFreeDailyLimit(); // past the FREE cap, inside the pass cap
    const r = await gateToolAction(UID, EMAIL, 'image');
    expect(r.allow).toBe(true);
  });
});

describe('images are capped tighter than everything else', () => {
  it('because they are the one action with a real per-image charge', () => {
    expect(imageFreeDailyLimit()).toBeLessThan(aiToolFreeDailyLimit());
  });

  it('blocks a free user at the image cap while AI tools are still available', async () => {
    state.usedToday = imageFreeDailyLimit();
    expect((await gateToolAction(UID, EMAIL, 'image')).allow).toBe(false);
    // Separate counters: the same count has not exhausted the ai_tool bucket.
    expect((await gateToolAction(UID, EMAIL, 'ai_tool')).allow).toBe(true);
  });
});

describe('the admin can retune every limit from Cloud Run without a deploy', () => {
  it('follows the env values', async () => {
    process.env.AI_TOOL_FREE_DAILY_LIMIT = '2';
    process.env.AI_IMAGE_FREE_DAILY_LIMIT = '1';
    process.env.AI_IMAGE_PASS_DAILY_LIMIT = '50';
    expect(aiToolFreeDailyLimit()).toBe(2);
    expect(imageFreeDailyLimit()).toBe(1);
    expect(imagePassDailyLimit()).toBe(50);
    state.usedToday = 2;
    expect((await gateToolAction(UID, EMAIL, 'ai_tool')).allow).toBe(false);
  });

  it('a limit of 0 turns the free allowance off entirely', async () => {
    process.env.AI_IMAGE_FREE_DAILY_LIMIT = '0';
    state.usedToday = 0;
    const r = await gateToolAction(UID, EMAIL, 'image');
    expect(r.allow).toBe(false);
  });

  it('ignores rubbish and keeps the safe default', () => {
    process.env.AI_TOOL_FREE_DAILY_LIMIT = 'lots';
    expect(aiToolFreeDailyLimit()).toBe(5);
  });
});

describe('burnToolAction', () => {
  it('records against the bucket that was used', () => {
    burnToolAction(UID, 'image');
    expect(state.incremented).toEqual([{ uid: UID, bucket: 'image' }]);
  });

  it('does nothing for an anonymous caller', () => {
    burnToolAction(null, 'ai_tool');
    expect(state.incremented).toHaveLength(0);
  });
});
