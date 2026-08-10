/**
 * Audit finding #1 — one way to read a boolean env flag.
 *
 * The bug this locks out was silent by construction: `AGENTV3_PAID_PUBLIC=on` under a
 * `=== 'true'` reader left BILLING OFF with nothing in any log, and `AGENTV3_CIRCUIT_BREAKER=OFF`
 * under a `=== 'off'` reader disabled NOTHING while the operator believed it had. So these tests
 * cover both the parser and — more importantly — the invariant that no call site may go back to
 * hand-rolling its own dialect.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { parseEnvFlag, envFlag, envKillSwitch } from '../src/server/lib/envFlag';

const KEY = 'NBAI_TEST_FLAG_' + Math.floor(Math.random() * 1e6);
afterEach(() => { delete process.env[KEY]; });

describe('parseEnvFlag', () => {
  it('accepts every spelling of YES the admin actually uses', () => {
    for (const v of ['on', 'ON', 'On', 'true', 'TRUE', 'True', '1', 'yes', 'y', 'enable', 'enabled']) {
      expect(parseEnvFlag(v), v).toBe(true);
    }
  });

  it('accepts every spelling of NO — a kill switch must fire for all of them', () => {
    for (const v of ['off', 'OFF', 'Off', 'false', 'FALSE', '0', 'no', 'n', 'disable', 'disabled']) {
      expect(parseEnvFlag(v), v).toBe(false);
    }
  });

  it('ignores surrounding whitespace — a Cloud Run value can carry a stray space', () => {
    expect(parseEnvFlag(' on ')).toBe(true);
    expect(parseEnvFlag('\toff\n')).toBe(false);
  });

  it('returns null — NOT false — for unset, empty, or unrecognised', () => {
    // "the admin did not say" and "the admin said no" are different facts. Collapsing a typo to
    // `false` would silently disable a default-ON kill switch.
    expect(parseEnvFlag(undefined)).toBe(null);
    expect(parseEnvFlag(null)).toBe(null);
    expect(parseEnvFlag('')).toBe(null);
    expect(parseEnvFlag('   ')).toBe(null);
    expect(parseEnvFlag('ture')).toBe(null);
    expect(parseEnvFlag('maybe')).toBe(null);
  });
});

describe('envFlag', () => {
  it('is off by default for an opt-in feature', () => {
    expect(envFlag(KEY)).toBe(false);
  });

  it('is on by default for a default-ON feature, and its kill switch still works', () => {
    expect(envFlag(KEY, true)).toBe(true);
    process.env[KEY] = 'off';
    expect(envFlag(KEY, true)).toBe(false);
    process.env[KEY] = 'FALSE';
    expect(envFlag(KEY, true)).toBe(false);
  });

  it('keeps the documented default when the value is a typo, rather than guessing', () => {
    process.env[KEY] = 'offf';
    expect(envFlag(KEY, true)).toBe(true);
    expect(envFlag(KEY, false)).toBe(false);
  });

  it('reads process.env at CALL time, not at import time', () => {
    expect(envFlag(KEY)).toBe(false);
    process.env[KEY] = 'on';
    expect(envFlag(KEY)).toBe(true);
  });

  it('turns ON for the admin\'s actual habit — `on`, the value CLAUDE.md records seven times', () => {
    process.env[KEY] = 'on';
    expect(envFlag(KEY)).toBe(true);
  });
});

describe('envKillSwitch', () => {
  it('is engaged only by an explicit NO', () => {
    expect(envKillSwitch(KEY)).toBe(false);       // unset ⇒ feature stays on
    process.env[KEY] = 'on';
    expect(envKillSwitch(KEY)).toBe(false);
    process.env[KEY] = 'off';
    expect(envKillSwitch(KEY)).toBe(true);
    process.env[KEY] = '0';
    expect(envKillSwitch(KEY)).toBe(true);
  });
});

describe('the old dialects cannot come back', () => {
  // The class fix is only real if a new call site cannot re-introduce it. This walks the actual
  // server source rather than trusting review.
  const files = execSync(
    "find src/server -name '*.ts' | grep -v '\\.test\\.' | grep -v goldenScaffolds | grep -v 'generator/templates'",
    { encoding: 'utf8' },
  ).trim().split('\n').filter(Boolean);

  /**
   * The source of one file, with every TEMPLATE LITERAL blanked out. Generators such as
   * `MaintenanceModeGenerator` hold the code they write INTO A USER'S APP inside backticks; that
   * text is the user's program, not ours, and it neither can nor should call our helper. Scanning it
   * for our conventions would be scanning the wrong codebase.
   */
  const codeOutsideTemplates = (src: string): string =>
    src.replace(/`(?:\\[\s\S]|[^`\\])*`/g, (m) => '`' + ' '.repeat(Math.max(0, m.length - 2)) + '`');

  const readSource = (f: string): string | null => {
    // Several *Generator.test.ts files emit a scratch `._<name>_emitted_<pid>.ts` INTO src/server/lib
    // and delete it again, so a tree walk running beside them can list a file that is already gone.
    // This test must fail on a real dialect, never on another test's timing.
    if (/\/\._/.test(f)) return null;
    try { return readFileSync(f, 'utf8'); } catch { return null; }
  };

  const scan = (re: RegExp): string[] => {
    const out: string[] = [];
    for (const f of files) {
      if (f.endsWith('src/server/lib/envFlag.ts')) continue; // the one place allowed to know the spellings
      const raw = readSource(f);
      if (raw === null) continue;
      codeOutsideTemplates(raw).split('\n').forEach((l, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(l)) return; // comments describe the old bug on purpose
        if (re.test(l)) out.push(`${f}:${i + 1}: ${l.trim()}`);
      });
    }
    return out;
  };

  it('no boolean env var is compared against a bare string literal', () => {
    // `process.env.X === 'true' | 'on' | '1' | 'off' | 'false'` — every dialect the audit found.
    expect(scan(/process\.env\.[A-Z0-9_]+\s*===\s*'(true|on|1|false)'/)).toEqual([]);
  });

  it('nobody rebuilds the truthy list by hand', () => {
    expect(scan(/===\s*'on'\s*\|\|\s*\w+\s*===\s*'true'/)).toEqual([]);
    expect(scan(/===\s*'1'\s*\|\|\s*\w+\s*===\s*'true'/)).toEqual([]);
    expect(scan(/\/\^\(on\|true\|1\)\$\/i/)).toEqual([]);
    expect(scan(/\/\^\(off\|false\|0\)\$\/i/)).toEqual([]);
  });

  it('the flags that gate MONEY go through the shared parser', () => {
    // AGENTV3_PAID_PUBLIC / AGENTV3_CREDIT_GATE decide whether a build is charged at all, and
    // AGENTV3_REALCOST_BILLING decides which billing model runs. A dialect bug here is revenue.
    const featureFlag = readFileSync('src/server/AgentV3/featureFlag.ts', 'utf8');
    expect(featureFlag).toContain("envFlag('AGENTV3_PAID_PUBLIC')");
    expect(featureFlag).toContain("envFlag('AGENTV3_CREDIT_GATE')");
    expect(featureFlag).toContain("envFlag('AGENTV3_ENABLED')");
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain("envFlag('AGENTV3_REALCOST_BILLING', true)");
  });

  it('never leaks the helper into code we EMIT into a user\'s app', () => {
    // A real regression caught during this sweep: `MaintenanceModeGenerator` holds the middleware it
    // writes into the USER'S project inside a template literal. Rewriting a line in there to call our
    // server helper produced an app that cannot resolve the import. Generated source must stay
    // self-contained, so `envFlag(` inside a template literal is a bug by construction.
    const offenders: string[] = [];
    for (const f of files) {
      // envFlag.ts documents its own API in JSDoc, and inline `code spans` in a comment look exactly
      // like template literals to a regex. The definition is not emitted anywhere, so skip it.
      if (f.endsWith('src/server/lib/envFlag.ts')) continue;
      const raw = readSource(f);
      if (raw === null) continue;
      for (const m of raw.matchAll(/`(?:\\[\s\S]|[^`\\])*`/g)) {
        if (/env(?:Flag|KillSwitch)\(/.test(m[0])) {
          offenders.push(`${f}:${raw.slice(0, m.index).split('\n').length}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('leaves the ENUM-valued settings alone — collapsing them would destroy real meaning', () => {
    // AGENTV3_CHEAP_FLOOR is off|glm|kimi|on|both and the power tiers use 'off' as a TIER NAME.
    // These must NOT have been swept; the sweep's correctness includes what it did not touch.
    expect(readFileSync('src/server/AgentV3/powerLevel.ts', 'utf8')).toContain("input === 'off'");
    expect(readFileSync('src/server/routes/agentv3.ts', 'utf8')).toContain("floor === 'off'");
  });
});
