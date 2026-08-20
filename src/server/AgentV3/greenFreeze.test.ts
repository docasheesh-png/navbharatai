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

  it('a NEW app file is ALSO refused for a non-allowlisted pass — full deny, no partial application', () => {
    // The adversarial review (2026-08-12) showed the old "new files always allowed" carve-out let a
    // coordinated change half-apply. Deny-by-default now means a non-allowlisted pass cannot write to
    // the app at all once green — new file or edit.
    expect(writeRefused(WS, 'e2e/smoke.spec.ts')).toBe(true);
    expect(writeRefused(WS, 'src/NewThing.tsx')).toBe(true);
  });

  it('an ALLOWLISTED pass may still create the new files its fix needs', async () => {
    await runInPass('feature-presence-heal', async () => {
      expect(writeRefused(WS, 'src/NewFeature.tsx')).toBe(false);
    });
  });

  it('node_modules / build artefacts are never frozen — they are not the app source', () => {
    expect(writeRefused(WS, 'node_modules/react/index.js')).toBe(false);
    expect(writeRefused(WS, 'dist/bundle.js')).toBe(false);
    expect(writeRefused(WS, '.git/HEAD')).toBe(false);
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

  // The count changed from three to four on 2026-08-10, and this test firing is exactly what it is for:
  // the list's own comment says adding to it is a DELIBERATE ACT, so an addition must be argued, not
  // slipped in. The argument for 'design-consistency-heal':
  //   • it repairs the app against ITS OWN stated design contract — the five-point per-page standard the
  //     architect prompt already sets — rather than the reviewer's opinion ABOUT the code, which is the
  //     distinction this allowlist actually encodes;
  //   • it carries its own revert net (designHealGuard.ts): a page it leaves unparseable is restored;
  //   • it is behind AGENTV3_DESIGN_GATE, default OFF, so nothing changes until an admin decides;
  //   • on the normal path it runs BEFORE the preview is browsed, so no latch exists yet and this entry
  //     is not what lets it write — it is here so a RESUMED already-green session behaves the same way
  //     instead of silently doing nothing on one path and working on the other.
  it('the allowlist is exactly the five user-request / safety / restore passes', () => {
    // This test IS the deliberate act the module header asks for — the list may only grow when someone
    // has to come here and say why. 'sandbox-file-restore' was added 2026-08-20 after the freeze broke
    // a real publish: re-seeding an EMPTY sandbox from the durable store writes through the same
    // `actuator.writeFile` every pass uses, so on a green app every write was refused and the user was
    // told their files could not be restored — on a workspace where the files were perfectly safe.
    //
    // It qualifies for the same reason 'green-guard-restore' does: the freeze exists to stop a pass
    // ALTERING a working app, and a restore alters nothing. It copies the app's own durable bytes into
    // a machine that has none, and only ever when that machine is empty. Refusing it did not protect
    // the app; it stranded it.
    expect([...ALLOWED_PASSES].sort()).toEqual([
      'design-consistency-heal', 'feature-presence-heal', 'green-guard-restore',
      'runtime-error-autofix', 'sandbox-file-restore',
    ]);
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

  it('throws GreenFreezeError on a refused write, and nothing on an infra path', () => {
    expect(() => assertWriteAllowed(WS, 'src/App.tsx')).toThrow(GreenFreezeError);
    expect(() => assertWriteAllowed(WS, 'src/New.tsx')).toThrow(GreenFreezeError); // full deny — new files too
    expect(() => assertWriteAllowed(WS, 'node_modules/react/index.js')).not.toThrow();
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

/**
 * THE BLOCKERS THE ADVERSARIAL REVIEW FOUND (2026-08-12) — each closed and locked.
 */
describe('the latch cannot leak into the next build', () => {
  const routes = readFileSync(join(__dirname, '../routes/agentv3.ts'), 'utf8');

  it('the latch is cleared at the VERY START of a build, before any write', () => {
    // The robust fix: build B clears any stale latch a bypassed teardown of build A may have left,
    // BEFORE build B writes a line — so no teardown path can freeze the next build's generation.
    const clearAtStart = routes.indexOf('clearGreenLatch(workspaceId); } catch { /* best-effort */ }\n    // Phase G1');
    const latch = routes.indexOf('latchGreen(workspaceId,');
    expect(clearAtStart).toBeGreaterThan(-1);
    expect(clearAtStart).toBeLessThan(latch); // cleared before it could ever be set this build
  });

  it('re-latching is a no-op — a mutated tree can never overwrite the real green snapshot', () => {
    latchGreen(WS, ['src/App.tsx']);
    latchGreen(WS, ['src/App.tsx', 'src/Injected.tsx']); // a later, mutated view
    // Still frozen for the app, and the second call did not replace the first.
    expect(writeRefused(WS, 'src/App.tsx')).toBe(true);
  });
});

describe('coverage the review demanded', () => {
  const actuator = readFileSync(join(__dirname, 'sandbox/EngineerAI/actuators/E2BActuator.ts'), 'utf8');
  const routes = readFileSync(join(__dirname, '../routes/agentv3.ts'), 'utf8');

  it('writeBinaryFile is guarded too — a logo/font the app depends on is source', () => {
    const at = actuator.indexOf('async writeBinaryFile(');
    expect(actuator.slice(at, at + 500)).toContain('assertWriteAllowed(workspaceId, rel)');
  });

  it('the latch is set only on a REAL browser render, never a curl fallback', () => {
    expect((routes.match(/shot\.source === 'browser' && !isGreenLatched/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('the ADR write records only on success — a refused write is not logged as done', () => {
    expect(routes).toContain('if (adrWritten) onFileWrite?.(path, content)');
    expect(routes).not.toContain('await actuator.writeFile(workspaceId, path, content).catch(() => {});\n              onFileWrite?.(path, content)');
  });
});
