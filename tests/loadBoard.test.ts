import { describe, it, expect } from 'vitest';
import { gradeLoad, displayOf, worstLevel, loadBoard, type LoadReadings } from '../src/server/lib/loadBoard';

/**
 * THE LOAD BOARD (ROADMAP §12). Admin: "admin panel ke home page par to load dikhna chahiye… sabhi
 * load likhne hai."
 *
 * §12's audit found eight ceilings and gave each one a trigger. A trigger nobody can see is not a
 * trigger, it is a hope — this is the screen that turns each into a number.
 *
 * The rule these tests spend most of their weight on is not a threshold. It is that **an unreadable
 * number is UNKNOWN, never zero** — the mistake this codebase has already paid for three times: a
 * channel inventory that read a Firestore hiccup as "no channels in use", a preview check that printed
 * "Live!" over a dead site, and a metric gap that would have billed as "used nothing".
 */
describe('🔒 gradeLoad — unknown is its own answer, and never ok', () => {
  it('a missing reading is unknown, not zero and not healthy', () => {
    for (const v of [null, undefined, NaN, 'x' as unknown as number]) {
      expect(gradeLoad({ value: v as number | null, cap: 10 })).toBe('unknown');
    }
  });

  it('a real value with NO ceiling is ok — a number with no cap must not be graded as if it had one', () => {
    // Otherwise a healthy platform gets a red light for being popular.
    expect(gradeLoad({ value: 999_999, cap: null })).toBe('ok');
    expect(gradeLoad({ value: 5 })).toBe('ok');
    expect(gradeLoad({ value: 5, cap: 0 })).toBe('ok');
  });

  it('grades against the ceiling, warning early enough to act', () => {
    expect(gradeLoad({ value: 5, cap: 10 })).toBe('ok');
    expect(gradeLoad({ value: 8, cap: 10 })).toBe('warn');
    expect(gradeLoad({ value: 9, cap: 10 })).toBe('critical');
    expect(gradeLoad({ value: 10, cap: 10 })).toBe('full');
    expect(gradeLoad({ value: 11, cap: 10 })).toBe('full');
  });

  it('a genuine zero is ok — measured nothing is different from unmeasured', () => {
    expect(gradeLoad({ value: 0, cap: 10 })).toBe('ok');
  });
});

describe('displayOf — says "unknown" out loud', () => {
  it('renders value and cap, and never prints a bare 0 for a missing reading', () => {
    expect(displayOf(3, 10, 'instances')).toBe('3 / 10 instances');
    expect(displayOf(4, null, 'active')).toBe('4 active');
    expect(displayOf(null, 10, 'instances')).toBe('unknown instances');
    expect(displayOf(undefined, null, '')).toBe('unknown');
    expect(displayOf(0, 10, 'apps')).toBe('0 / 10 apps');
  });
});

describe('🔒 worstLevel — unknown never masks a real problem, and is never swallowed', () => {
  it('a real problem beside an unknown is the problem', () => {
    expect(worstLevel([{ level: 'unknown' }, { level: 'critical' }])).toBe('critical');
    expect(worstLevel([{ level: 'ok' }, { level: 'full' }, { level: 'unknown' }])).toBe('full');
  });

  it('🔒 "everything fine except the thing I could not read" is NOT fine', () => {
    expect(worstLevel([{ level: 'ok' }, { level: 'ok' }, { level: 'unknown' }])).toBe('unknown');
  });

  it('all healthy is ok; nothing at all is unknown', () => {
    expect(worstLevel([{ level: 'ok' }, { level: 'ok' }])).toBe('ok');
    expect(worstLevel([])).toBe('unknown');
    expect(worstLevel(null)).toBe('unknown');
  });
});

describe('loadBoard — every ceiling §12 found has a tile', () => {
  const full: LoadReadings = {
    instances: 3, instancesCap: 10, requestsInFlight: 12, activeUsers: 40,
    cpuFraction: 0.35, memoryFraction: 0.5, buildsRunning: 2, sandboxesLive: 3,
    storedDocuments: 120_000, collectionsWithoutRetention: 0,
    hostedServices: 12, hostedServicesCap: 1000,
    publishChannels: 8, publishChannelsCap: 50,
    providerErrorRate: 0.01, unrecoveredInr: 0,
  };

  it('the admin\'s four named loads are all there, plus the ones they asked me to find', () => {
    const ids = loadBoard(full).map((t) => t.id);
    for (const id of ['server', 'users', 'storage', 'hosting']) expect(ids, id).toContain(id);
    for (const id of ['cpu', 'memory', 'requests', 'builds', 'sandboxes', 'publish', 'ai', 'money']) {
      expect(ids, id).toContain(id);
    }
  });

  it('the first tile is the ceiling that bites first — §12\'s own ordering', () => {
    expect(loadBoard(full)[0].id).toBe('server');
  });

  it('a healthy platform reads ok across the board', () => {
    expect(worstLevel(loadBoard(full))).toBe('ok');
  });

  it('🔒 NO readings at all ⇒ every measured tile is unknown, and the board is unknown — never ok', () => {
    const tiles = loadBoard({});
    expect(worstLevel(tiles)).toBe('unknown');
    for (const id of ['server', 'cpu', 'memory', 'hosting', 'ai', 'money', 'storage']) {
      expect(tiles.find((t) => t.id === id)!.level, id).toBe('unknown');
    }
    expect(loadBoard(null).length).toBeGreaterThan(0);
  });

  it('🔒 an unknown tile SAYS it is unmeasured rather than showing a bare zero', () => {
    const server = loadBoard({}).find((t) => t.id === 'server')!;
    expect(server.value).toBeNull();
    expect(server.display).toMatch(/unknown/);
    expect(server.note).toMatch(/not zero — it is unmeasured/i);
  });

  it('🔒 hosting nearing the cap names the real fix — Google does not raise it', () => {
    const t = loadBoard({ ...full, hostedServices: 850 }).find((t) => t.id === 'hosting')!;
    expect(t.level).toBe('warn');
    expect(t.note).toMatch(/does NOT raise this cap/);
    expect(t.note).toMatch(/second apps project/);
  });

  it('🔒 storage warns on collections with NO retention, whatever the document count', () => {
    const t = loadBoard({ ...full, collectionsWithoutRetention: 8 }).find((t) => t.id === 'storage')!;
    expect(t.level).toBe('warn');
    expect(t.note).toMatch(/grow forever/);
    expect(t.note).toMatch(/ratchets/);
  });

  it('the server tile points at the scheduled-job fix before raising instances', () => {
    const t = loadBoard({ ...full, instances: 9 }).find((t) => t.id === 'server')!;
    expect(t.level).toBe('critical');
    expect(t.note).toMatch(/scheduled-job leases first/);
  });

  it('user and request tiles are never graded red for being popular', () => {
    const tiles = loadBoard({ ...full, activeUsers: 5_000_000, requestsInFlight: 900 });
    expect(tiles.find((t) => t.id === 'users')!.level).toBe('ok');
    expect(tiles.find((t) => t.id === 'requests')!.level).toBe('ok');
  });

  it('AI refusals grade on their own scale, and unrecovered spend is a warning', () => {
    expect(loadBoard({ ...full, providerErrorRate: 0.3 }).find((t) => t.id === 'ai')!.level).toBe('critical');
    expect(loadBoard({ ...full, providerErrorRate: 0.06 }).find((t) => t.id === 'ai')!.level).toBe('warn');
    const money = loadBoard({ ...full, unrecoveredInr: 240.5 }).find((t) => t.id === 'money')!;
    expect(money.level).toBe('warn');
    expect(money.display).toBe('₹240.50');
  });
});
