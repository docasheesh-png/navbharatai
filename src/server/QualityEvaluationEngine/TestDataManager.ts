// P-TQA.9 — Test Data Manager / Fixture System (dependency-free, deterministic).
//
// Generated tests used hardcoded strings ("test value") — fragile and unrealistic. This provides
// reusable fixtures + a SEEDED random-but-deterministic data generator (no @faker-js/faker dependency,
// per the codebase's dependency-free policy). Same seed → same data every run, so tests stay
// reproducible while still exercising varied, realistic inputs. Pure (no fs / no node APIs) so it is
// safe to import from both server tests and the client AITestingSuite.

/** FNV-style string → 32-bit seed. Pure, deterministic. */
function hashSeed(s: string): number {
  let h = 2166136261 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

/** mulberry32 PRNG — small, fast, deterministic (no Math.random / Date). Pure. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Aarav', 'Diya', 'Vivaan', 'Ananya', 'Ishaan', 'Saanvi', 'Kabir', 'Myra', 'Reyansh', 'Aadhya'];
const LAST = ['Sharma', 'Patel', 'Reddy', 'Iyer', 'Khan', 'Mehta', 'Nair', 'Bose', 'Gupta', 'Rao'];
const WORDS = ['build', 'deploy', 'render', 'state', 'route', 'token', 'cache', 'query', 'preview', 'agent', 'panel', 'sync'];
const FRAMEWORKS = ['vite-react', 'next', 'vue', 'svelte'];
const JOB_STATUS = ['queued', 'building', 'preview_ready', 'failed'];

/** A seeded, deterministic test-data generator. Same `seed` → identical output across runs. */
export class TestDataManager {
  private rnd: () => number;
  constructor(seed: string = 'navbharat') {
    this.rnd = mulberry32(hashSeed(seed));
  }

  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    if (max < min) [min, max] = [max, min];
    return min + Math.floor(this.rnd() * (max - min + 1));
  }

  /** Pick one element deterministically. */
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.rnd() * arr.length) % arr.length];
  }

  bool(): boolean {
    return this.rnd() < 0.5;
  }

  /** A short deterministic id like `id_a1b2c3`. */
  id(prefix = 'id'): string {
    const n = Math.floor(this.rnd() * 0xffffff).toString(16).padStart(6, '0');
    return `${prefix}_${n}`;
  }

  name(): string {
    return `${this.pick(FIRST)} ${this.pick(LAST)}`;
  }

  email(): string {
    return `${this.pick(FIRST).toLowerCase()}.${this.pick(LAST).toLowerCase()}${this.int(1, 99)}@example.com`;
  }

  sentence(words = 6): string {
    const out: string[] = [];
    for (let i = 0; i < Math.max(1, words); i++) out.push(this.pick(WORDS));
    const s = out.join(' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ── Entity factories (match the tests/fixtures/*.json shapes) ──────────────
  user() {
    return { id: this.id('user'), name: this.name(), email: this.email(), plan: this.pick(['free', 'pro']), createdAt: this.int(1_600_000_000_000, 1_900_000_000_000) };
  }
  workspace() {
    return { id: this.id('ws'), name: `${this.pick(WORDS)}-app`, framework: this.pick(FRAMEWORKS), fileCount: this.int(3, 120) };
  }
  buildJob() {
    return { id: this.id('job'), status: this.pick(JOB_STATUS), durationMs: this.int(500, 180_000), ok: this.bool() };
  }
  chatMessage() {
    return { id: this.id('msg'), role: this.pick(['user', 'assistant']), text: this.sentence(this.int(4, 12)), ts: this.int(1_600_000_000_000, 1_900_000_000_000) };
  }

  /** N deterministic records from any factory. */
  list<T>(factory: () => T, n: number): T[] {
    const out: T[] = [];
    for (let i = 0; i < Math.max(0, n); i++) out.push(factory());
    return out;
  }
}

/** Convenience: a one-shot sample input string for a generated UI test, seeded by a label. Pure. */
export function sampleInputValue(label: string): string {
  return new TestDataManager(label).sentence(3);
}
