import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  greenFreezeEnabled, latchGreen, clearGreenLatch, isGreenLatched,
  runInPass, currentPass, writeRefused, assertWriteAllowed, GreenFreezeError,
  setGreenFreezeObserver, ALLOWED_PASSES,
} from './greenFreeze';

/**
 * THE RULE, PROVEN FROM OUR OWN CODE (audit 2026-08-12): after the app is verified working, twelve
 * write-capable passes run and only one checked whether the app already works. Green Freeze makes the
 * default DENY: a write that would overwrite a file present at green is refused unless an allowlisted
 * pass (the user's own request) makes it. Refusing a write can only ever keep the working app as it was
 * — it can never break it — so every test here is really the one absolute rule, enforced by construction.
 */

const WS = 'ws-test';
beforeEach(() => clearGreenLatch(WS));
afterEach(() => clearGreenLatch(WS));

describe('before green there is no freeze — the build writes freely', () => {
  it('an un-latched workspace refuses nothing', () => {
    expect(isGreenLatched(WS)).toBe(false);
    expect(writeRefused(WS, 'src/App.tsx')).toBe(false);
  });
});

describe('once green, an EDIT to an existing file is refused by default', () => {
  beforeEach(() => latchGreen(WS, ['src/App.tsx', 'src/main.tsx', 'index.html']));

  it('overwriting a file that existed at green is refused', () => {
    expect(writeRefused(WS, 'src/App.tsx')).toBe(true);
  });

  it('path spelling variance does not matter — ./src/App.tsx and src/App.tsx are the same file', () => {
    expect(writeRefused(WS, './src/App.tsx')).toBe(true);
    expect(writeRefused(WS, '/src/App.tsx')).toBe(true);
  });

  it('a genuinely NEW file is allowed — it cannot break the app the browser rendered', () => {
    // This is what lets the e2e/test/doc scaffolds still write, while the unused-import sweep (which
    // edits existing files) is refused.
    expect(writeRefused(WS, 'e2e/smoke.spec.ts')).toBe(false);
    expect(writeRefused(WS, 'src/NewThing.tsx')).toBe(false);
  });

  it('node_modules / build artefacts were never part of the snapshot, so they are never frozen', () => {
    latchGreen(WS, ['src/App.tsx', 'node_modules/react/index.js', 'dist/bundle.js']);
    expect(writeRefused(WS, 'node_modules/react/index.js')).toBe(false);
    expect(writeRefused(WS, 'dist/bundle.js')).toBe(false);
  });
});

describe('the allowlist — the user\'s own requests still write to a green app', () => {
  beforeEach(() => latchGreen(WS, ['src/App.tsx']));

  it('runtime-error auto-fix may still edit — the app renders but throws, the user wants it working', async () => {
    await runInPass('runtime-error-autofix', async () => {
      expect(currentPass()).toBe('runtime-error-autofix');
      expect(writeRefused(WS, 'src/App.tsx')).toBe(false);
    });
  });

  it('feature-presence heal may still edit — a requested feature is missing', async () => {
    await runInPass('feature-presence-heal', async () => {
      expect(writeRefused(WS, 'src/App.tsx')).toBe(false);
    });
  });

  it('the green-guard restore may write — it is the safety mechanism itself', async () => {
    await runInPass('green-guard-restore', async () => {
      expect(writeRefused(WS, 'src/App.tsx')).toBe(false);
    });
  });

  it('a pass NOT on the allowlist is still refused — this is the whole point', async () => {
    await runInPass('unused-import-sweep', async () => {
      expect(writeRefused(WS, 'src/App.tsx')).toBe(true);
    });
  });

  it('an unwrapped write (no pass at all) is refused — deny by default catches a future pass automatically', () => {
    expect(currentPass()).toBeNull();
    expect(writeRefused(WS, 'src/App.tsx')).toBe(true);
  });

  it('the allowlist is exactly the three user-request / safety passes', () => {
    expect([...ALLOWED_PASSES].sort()).toEqual(['feature-presence-heal', 'green-guard-restore', 'runtime-error-autofix']);
  });
});

describe('the async zone propagates through awaits', () => {
  beforeEach(() => latchGreen(WS, ['src/App.tsx']));

  it('a nested await still sees the pass', async () => {
    await runInPass('runtime-error-autofix', async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 1));
      expect(writeRefused(WS, 'src/App.tsx')).toBe(false);
    });
  });

  it('the pass does not leak outside its scope', async () => {
    await runInPass('runtime-error-autofix', async () => { /* … */ });
    expect(currentPass()).toBeNull();
    expect(writeRefused(WS, 'src/App.tsx')).toBe(true);
  });
});

describe('the enforcement an actuator calls', () => {
  beforeEach(() => latchGreen(WS, ['src/App.tsx']));
  afterEach(() => setGreenFreezeObserver(() => {})); // reset

  it('throws GreenFreezeError on a refused write, and nothing on an allowed one', () => {
    expect(() => assertWriteAllowed(WS, 'src/App.tsx')).toThrow(GreenFreezeError);
    expect(() => assertWriteAllowed(WS, 'src/New.tsx')).not.toThrow();
  });

  it('notifies the observer before throwing, with the path and pass', () => {
    let seen: { path: string; pass: string | null } | null = null;
    setGreenFreezeObserver((info) => { seen = { path: info.path, pass: info.pass }; });
    expect(() => assertWriteAllowed(WS, 'src/App.tsx')).toThrow();
    expect(seen).toEqual({ path: 'src/App.tsx', pass: null });
  });

  it('an allowlisted pass sails through the enforcement', async () => {
    await runInPass('feature-presence-heal', async () => {
      expect(() => assertWriteAllowed(WS, 'src/App.tsx')).not.toThrow();
    });
  });
});

describe('the kill switch and cleanup', () => {
  it('off restores today\'s behaviour — nothing is ever refused', () => {
    latchGreen(WS, ['src/App.tsx']);
    const off = { AGENTV3_GREEN_FREEZE: 'off' } as NodeJS.ProcessEnv;
    expect(writeRefused(WS, 'src/App.tsx', off)).toBe(false);
    expect(greenFreezeEnabled(off)).toBe(false);
    expect(greenFreezeEnabled({} as NodeJS.ProcessEnv)).toBe(true); // default ON
  });

  it('clearing the latch un-freezes — so the next build for the same workspace writes freely', () => {
    latchGreen(WS, ['src/App.tsx']);
    expect(writeRefused(WS, 'src/App.tsx')).toBe(true);
    clearGreenLatch(WS);
    expect(writeRefused(WS, 'src/App.tsx')).toBe(false);
  });

  it('junk input never throws', () => {
    expect(() => latchGreen('', ['x'])).not.toThrow();
    expect(() => writeRefused('', 'x')).not.toThrow();
    expect(writeRefused('nope', 'x')).toBe(false);
  });
});

describe('the actuator enforces it at the one write choke point', () => {
  const actuator = readFileSync(
    join(__dirname, 'sandbox/EngineerAI/actuators/E2BActuator.ts'), 'utf8',
  );

  it('writeFile calls assertWriteAllowed before touching disk', () => {
    const at = actuator.indexOf('async writeFile(');
    const body = actuator.slice(at, at + 900);
    expect(body).toContain('assertWriteAllowed(workspaceId, rel)');
    // Before the actual write.
    expect(body.indexOf('assertWriteAllowed')).toBeLessThan(body.indexOf('files.write'));
  });
});

describe('it is wired into the build', () => {
  const routes = readFileSync(join(__dirname, '../routes/agentv3.ts'), 'utf8');

  it('the workspace is latched at the verified-render points', () => {
    expect(routes).toContain('latchGreen(workspaceId,');
    // Both green points latch (render rescue + preview verify).
    expect((routes.match(/latchGreen\(workspaceId,/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('the three allowlisted passes are wrapped so their writes are permitted', () => {
    expect(routes).toContain("runInPass('runtime-error-autofix'");
    expect(routes).toContain("runInPass('feature-presence-heal'");
    expect(routes).toContain("runInPass('green-guard-restore'");
  });

  it('refused writes are recorded honestly and offered, not silently dropped', () => {
    expect(routes).toContain('GREEN_FREEZE_DEFERRED');
    expect(routes).toContain('was NOT applied');
  });

  it('the latch is cleared in the finally AND the deadline finalizer — it must never leak', () => {
    expect((routes.match(/clearGreenLatch\(workspaceId\)/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});
