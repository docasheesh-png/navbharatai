/**
 * Owner 2026-11-17: "surplus ko bhi default on karo". The Pro Weak Surplus builder is ON unless
 * `AGENTV3_SURPLUS_BUILDER` is explicitly off, and it serves a build only when a usable key is set.
 *
 * The class this locks: a flag read in several files with its own dialect. Before this change eight
 * call sites each wrote `parseEnvFlag(env.AGENTV3_SURPLUS_BUILDER) === true`; flipping the default in one
 * of them would have left the others refusing. The census below fails when a new reader appears.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { surplusBuilderSwitchOn } from '../src/server/lib/alwaysOnSuppliers';
import { surplusBuilderEnabled } from '../src/server/AI/SurplusRegistry/buildSession';
import { surplusBuilderLive } from '../src/server/AI/SurplusRegistry/liveAdmission';

const KEY = 'synthetic-surplus-test-key';

describe('Surplus builder is default ON', () => {
  it('the switch is ON when unset, empty or unrecognised, and OFF only on an explicit off value', () => {
    for (const raw of [undefined, '', ' ', 'on', 'true', '1', 'yes', 'whatever']) {
      expect(surplusBuilderSwitchOn({ AGENTV3_SURPLUS_BUILDER: raw })).toBe(true);
    }
    for (const raw of ['off', 'OFF', 'false', '0', 'no']) {
      expect(surplusBuilderSwitchOn({ AGENTV3_SURPLUS_BUILDER: raw })).toBe(false);
    }
  });

  it('with a usable key and no flag at all, the builder is enabled', () => {
    expect(surplusBuilderEnabled({ SURPLUS_API_KEY: KEY } as NodeJS.ProcessEnv)).toBe(true);
    expect(surplusBuilderLive({ SURPLUS_API_KEY: KEY } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('the explicit off value is the kill switch even with a key', () => {
    expect(surplusBuilderEnabled({ SURPLUS_API_KEY: KEY, AGENTV3_SURPLUS_BUILDER: 'off' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('without a usable key there is nothing to call, so a keyless server behaves as it did when the default was OFF', () => {
    expect(surplusBuilderEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(surplusBuilderEnabled({ AGENTV3_SURPLUS_BUILDER: 'on' } as NodeJS.ProcessEnv)).toBe(false);
    for (const bad of ['', 'inf_admin_control_plane_key', 'replace_with_your_surplus_api_key', 'line\nbreak']) {
      expect(surplusBuilderEnabled({ SURPLUS_API_KEY: bad } as NodeJS.ProcessEnv)).toBe(false);
    }
  });
});

describe('🔒 one reader of AGENTV3_SURPLUS_BUILDER', () => {
  const files = (p: string): string[] => statSync(p).isFile() ? [p] : readdirSync(p).flatMap(n => files(join(p, n)));
  const sources = [...files('src'), 'server.ts'].filter(f => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
  const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('the scan sees the real reader (a scan that finds nothing proves nothing)', () => {
    expect(stripComments(readFileSync('src/server/lib/alwaysOnSuppliers.ts', 'utf8'))).toMatch(/env\.AGENTV3_SURPLUS_BUILDER/);
  });

  it('no other source file reads the flag from env', () => {
    const readers = sources.filter(f => f !== 'src/server/lib/alwaysOnSuppliers.ts'
      && /(?:env|process\.env)(?:\.|\[['"])AGENTV3_SURPLUS_BUILDER/.test(stripComments(readFileSync(f, 'utf8'))));
    expect(readers, 'read the switch through surplusBuilderSwitchOn / surplusBuilderEnabled').toEqual([]);
  });
});
