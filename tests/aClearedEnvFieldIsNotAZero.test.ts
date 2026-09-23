/**
 * A CLEARED CLOUD RUN FIELD IS NOT A DELIBERATE ZERO.
 *
 * `Number('')` is **0**, not `NaN`. Twelve readers across nine files were shaped
 * `Number(process.env.X)` followed by an `n >= 0` range test, so a key that EXISTS and is BLANK
 * became a deliberate zero — and a blank value is exactly what the console displays as configured.
 *
 * An UNSET key was always safe (`Number(undefined)` is `NaN`), which is why this never showed up:
 * every test in this repo deleted the key rather than emptying it.
 *
 * What a zero meant at each site is in `envNumber.ts`. The rule these cases pin is one sentence:
 * **an explicit `0` is honoured, a blank value takes the default.** Three existing suites already
 * assert the first half in words — `walletCredit.test.ts` calls switching the bonus off "a valid
 * choice" — so this file must not disturb it, and the `explicit 0` cases below are here to prove it
 * still holds after the change.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { codeOnly } from './helpers/sourceSlice';
import { parseEnvNumber } from '../src/server/lib/envNumber';
import { welcomeBonusTokens, TOKENS_PER_RUPEE } from '../src/server/lib/payments';
import { weeklyTopUpTokens } from '../src/server/lib/weeklyTopUp';
import { aiToolFreeDailyLimit, imageFreeDailyLimit, imagePassDailyLimit } from '../src/server/tools/toolGate';
import { professionalFreeDailyLimit } from '../src/server/professionals/professionalPaid';
import { maxDeployMb } from '../src/server/lib/HostingQuota';
import { storeFeePct } from '../src/server/lib/storeBilling';
import { sandboxSpikeMinUsd } from '../src/server/lib/monitorAlerts';
import { memoryMinScore } from '../src/server/memory/semanticMemory';

const KEYS = [
  'WELCOME_BONUS_TOKENS', 'WEEKLY_TOPUP_TOKENS', 'AI_TOOL_FREE_DAILY_LIMIT',
  'AI_IMAGE_FREE_DAILY_LIMIT', 'AI_IMAGE_PASS_DAILY_LIMIT', 'PROFESSIONAL_FREE_DAILY_LIMIT',
  'AGENTV3_DEPLOY_MAX_MB', 'STORE_FEE_PCT', 'MONITOR_SANDBOX_SPIKE_MIN_USD',
  'SEMANTIC_MEMORY_MIN_SCORE',
];
afterEach(() => { for (const k of KEYS) delete process.env[k]; });

/** Every fixed reader, with the default it must fall back to. */
const READERS: Array<{ key: string; read: () => number; dflt: number; zeroMeans: string }> = [
  { key: 'WELCOME_BONUS_TOKENS', read: welcomeBonusTokens, dflt: 250 * TOKENS_PER_RUPEE, zeroMeans: 'no welcome gift for any new account' },
  { key: 'WEEKLY_TOPUP_TOKENS', read: weeklyTopUpTokens, dflt: 200 * TOKENS_PER_RUPEE, zeroMeans: 'the weekly gift ladder is off' },
  { key: 'AI_TOOL_FREE_DAILY_LIMIT', read: aiToolFreeDailyLimit, dflt: 5, zeroMeans: 'no free tool actions' },
  { key: 'AI_IMAGE_FREE_DAILY_LIMIT', read: imageFreeDailyLimit, dflt: 3, zeroMeans: 'no free images' },
  { key: 'AI_IMAGE_PASS_DAILY_LIMIT', read: imagePassDailyLimit, dflt: 25, zeroMeans: 'no images on an unlimited tier' },
  { key: 'PROFESSIONAL_FREE_DAILY_LIMIT', read: professionalFreeDailyLimit, dflt: 10, zeroMeans: 'no free professional messages' },
  { key: 'AGENTV3_DEPLOY_MAX_MB', read: maxDeployMb, dflt: 50, zeroMeans: 'the per-deploy size ceiling is disabled' },
  { key: 'STORE_FEE_PCT', read: storeFeePct, dflt: 15, zeroMeans: 'the store takes no commission' },
  { key: 'MONITOR_SANDBOX_SPIKE_MIN_USD', read: sandboxSpikeMinUsd, dflt: 1, zeroMeans: 'every trivial spend is alert-worthy' },
  { key: 'SEMANTIC_MEMORY_MIN_SCORE', read: memoryMinScore, dflt: 0.72, zeroMeans: 'no relevance floor at all' },
];

describe('parseEnvNumber — the primitive', () => {
  it('reads unset, blank and whitespace-only all as "not stated"', () => {
    expect(parseEnvNumber(undefined)).toBeNull();
    expect(parseEnvNumber(null)).toBeNull();
    expect(parseEnvNumber('')).toBeNull();
    expect(parseEnvNumber('   ')).toBeNull();
    expect(parseEnvNumber('\n')).toBeNull();
    expect(parseEnvNumber('\t ')).toBeNull();
  });

  it('is the whole point: Number() disagrees with it on exactly the blank cases', () => {
    // If this ever stops being true the bug is gone from the language, not from us.
    expect(Number('')).toBe(0);
    expect(Number('   ')).toBe(0);
    expect(Number(undefined)).toBeNaN();
  });

  it('honours an explicit zero, a negative and a fraction as themselves', () => {
    expect(parseEnvNumber('0')).toBe(0);
    expect(parseEnvNumber(' 0 ')).toBe(0);
    expect(parseEnvNumber('-5')).toBe(-5);
    expect(parseEnvNumber('0.72')).toBe(0.72);
    expect(parseEnvNumber('1e3')).toBe(1000);
  });

  it('refuses junk and Infinity — an unbounded value defeats every max it meets', () => {
    expect(parseEnvNumber('lots')).toBeNull();
    expect(parseEnvNumber('20%')).toBeNull();     // deliberately NOT tolerated here; the strippers do that
    expect(parseEnvNumber('Infinity')).toBeNull();
    expect(parseEnvNumber('-Infinity')).toBeNull();
    expect(parseEnvNumber('NaN')).toBeNull();
  });

  it('accepts a number passed directly, so a caller need not stringify first', () => {
    expect(parseEnvNumber(12)).toBe(12);
    expect(parseEnvNumber(0)).toBe(0);
    expect(parseEnvNumber(Number.NaN)).toBeNull();
    expect(parseEnvNumber(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('every fixed reader: blank takes the default, an explicit 0 does not', () => {
  for (const { key, read, dflt, zeroMeans } of READERS) {
    it(`${key}: an EMPTY value is not "${zeroMeans}"`, () => {
      process.env[key] = '';
      expect(read()).toBe(dflt);
    });

    it(`${key}: a WHITESPACE-ONLY value is not "${zeroMeans}" either`, () => {
      process.env[key] = '   ';
      expect(read()).toBe(dflt);
    });

    it(`${key}: an explicit "0" still means "${zeroMeans}"`, () => {
      process.env[key] = '0';
      expect(read()).toBe(0);
    });

    it(`${key}: junk falls back to the default, never to zero`, () => {
      process.env[key] = 'banana';
      expect(read()).toBe(dflt);
    });
  }

  it('a real configured value is untouched by any of this', () => {
    process.env.AI_TOOL_FREE_DAILY_LIMIT = '2';
    expect(aiToolFreeDailyLimit()).toBe(2);
    process.env.STORE_FEE_PCT = '30';
    expect(storeFeePct()).toBe(30);
    process.env.SEMANTIC_MEMORY_MIN_SCORE = '0.5';
    expect(memoryMinScore()).toBe(0.5);
    process.env.AGENTV3_DEPLOY_MAX_MB = '100';
    expect(maxDeployMb()).toBe(100);
  });

  it('each site keeps its OWN range rule — the shared parser did not flatten them', () => {
    // storeFeePct refuses >= 100 (a commission over 100% is nonsense); maxDeployMb has no ceiling.
    process.env.STORE_FEE_PCT = '150';
    expect(storeFeePct()).toBe(15);
    process.env.AGENTV3_DEPLOY_MAX_MB = '4096';
    expect(maxDeployMb()).toBe(4096);
    // memoryMinScore is a 0..1 cosine score, so 2 is out of range.
    process.env.SEMANTIC_MEMORY_MIN_SCORE = '2';
    expect(memoryMinScore()).toBe(0.72);
    // A NEGATIVE is refused everywhere; it was refused before this change too.
    process.env.WELCOME_BONUS_TOKENS = '-1';
    expect(welcomeBonusTokens()).toBe(250 * TOKENS_PER_RUPEE);
  });
});

describe('the bot gate we GENERATE for a user app', () => {
  // Not our own server: this code lives in a template literal and is written into the user's app,
  // which is deliberately dependency-free — so it carries the fix inline rather than the import.
  const src = readFileSync(join(process.cwd(), 'src/server/lib/CaptchaGenerator.ts'), 'utf8');

  it('no longer reads the score floor in the shape a blank value defeats', () => {
    expect(src).not.toContain("Number(process.env.CAPTCHA_MIN_SCORE ?? '0.5')");
  });

  it('treats an empty CAPTCHA_MIN_SCORE as unset, and keeps the 0.5 default', () => {
    expect(src).toContain("rawMin === '' ? NaN : Number(rawMin)");
    expect(src).toContain('Number.isFinite(min) && min >= 0 ? min : 0.5');
  });

  it('stays dependency-free — the generated file imports nothing of ours', () => {
    expect(src).not.toContain("from './envNumber'");
    expect(src).not.toContain('parseEnvNumber');
  });

  it('behaves: a blank floor rejects a bot score, an explicit 0 accepts it', () => {
    // The generated logic, transcribed, so this asserts behaviour and not just wording.
    const decide = (raw: string | undefined, score: number): boolean => {
      const rawMin = (raw || '').trim();
      const min = rawMin === '' ? NaN : Number(rawMin);
      return score >= (Number.isFinite(min) && min >= 0 ? min : 0.5);
    };
    expect(decide('', 0)).toBe(false);        // the defect: this used to be true
    expect(decide('   ', 0)).toBe(false);
    expect(decide(undefined, 0)).toBe(false);
    expect(decide('-1', 0)).toBe(false);      // a negative floor opened it the same way
    expect(decide('0', 0)).toBe(true);        // an explicit 0 is still the admin's own choice
    expect(decide('', 0.9)).toBe(true);       // a good score still passes on the default
    expect(decide('5', 1)).toBe(false);       // out of range still refuses everything — the safe failure
  });
});

describe('the shape cannot come back (prevention)', () => {
  /**
   * The defect is the SHAPE, not the site: a value read with `Number(env.X)` and then accepted at
   * `>= 0` is wrong whatever it is called, because the blank case is decided before any range test
   * runs. So this scans for the shape rather than for a list of files.
   *
   * ⚠️ It is anchored on a regex over whole files, never on a byte window — this repo has paid for
   * fixed-offset source guards seven times, and twice for guards that could not fail at all.
   */
  // The lookbehind is load-bearing: `parseEnvNumber(` and `rawNumber(` both CONTAIN `Number(`,
  // so without it this guard flags its own fix. It did, on the first run.
  //
  // `import.meta.env` is in the alternation because that is how CLIENT code reads env, and a guard
  // that only understood `process.env` would have been blind to half the repo — the exact "I searched
  // `src/` and it was in `server.ts`" mistake this codebase has already paid for.
  const BAD = /(?<![A-Za-z0-9_$])(?:Number|parseFloat)\(\s*(?:process\.|import\.meta\.)?env[.[][^)\n]*\)[\s\S]{0,200}?>=\s*0/g;

  /** Every root that carries live code. `server.ts` sits at the repo ROOT, not under `src/`. */
  const ROOTS = ['src', 'scripts', 'infra', 'server.ts'];

  const walk = (dir: string, out: string[] = []): string[] => {
    if (statSync(dir).isFile()) { out.push(dir); return out; }
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules') continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p, out); continue; }
      if (/\.(tsx?|m?js|cjs)$/.test(p) && !/\.test\.(tsx?|m?js)$/.test(p)) out.push(p);
    }
    return out;
  };

  it('the detector actually detects — it flags a known-bad sample', () => {
    // Without this, a regex that matched nothing would make the sweep below pass vacuously.
    const sample = 'const n = Number(process.env.SOME_LIMIT);\n  return Number.isFinite(n) && n >= 0 ? n : 5;';
    expect(sample.match(BAD)).not.toBeNull();
    const sample2 = 'const n = Number(env.SOME_LIMIT);\nif (Number.isFinite(n) && n >= 0) return n;';
    expect(sample2.match(new RegExp(BAD.source, 'g'))).not.toBeNull();
    // The client shape. `Number('')` is 0 in a browser too.
    const sample3 = 'const n = Number(import.meta.env.VITE_SOME_LIMIT);\n  return n >= 0 ? n : 5;';
    expect(sample3.match(new RegExp(BAD.source, 'g'))).not.toBeNull();
  });

  it('and it clears the safe shape, so it is not just matching everything', () => {
    const good = 'const n = parseEnvNumber(process.env.SOME_LIMIT);\n  return n !== null && n >= 0 ? n : 5;';
    expect(good.match(new RegExp(BAD.source, 'g'))).toBeNull();
    const alsoGood = 'const n = Number(env.SOME_LIMIT);\n  return Number.isFinite(n) && n > 0 ? n : 5;';
    expect(alsoGood.match(new RegExp(BAD.source, 'g'))).toBeNull();
  });

  it('NO file in the repo reads an env number in a shape a blank value turns into zero', () => {
    const offenders: string[] = [];
    const files = ROOTS.flatMap((r) => walk(join(process.cwd(), r)));
    // A scan that found no files would pass vacuously, which is the failure mode this repo keeps
    // paying for — so assert it really walked the tree before trusting an empty offender list.
    expect(files.length).toBeGreaterThan(500);
    for (const file of files) {
      // Comments stripped: the docblock in `envNumber.ts` quotes the bad shape on purpose.
      const hits = codeOnly(readFileSync(file, 'utf8')).match(new RegExp(BAD.source, 'g'));
      if (hits) offenders.push(`${file.replace(process.cwd() + '/', '')} — ${hits.length}`);
    }
    expect(offenders).toEqual([]);
  });
});
