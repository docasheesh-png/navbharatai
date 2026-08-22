import { describe, it, expect } from 'vitest';
import { nodeEsmTornInstall, classifyDevServerFailure } from './sandbox/EngineerAI/actuators/DevServerRecovery';

/**
 * ADMIN, 2026-08-22 — verbatim from the preview:
 *
 *   Error [ERR_MODULE_NOT_FOUND]: Cannot find module
 *     '/home/user/workspace/node_modules/vite/dist/node/chunks/dist.js'
 *     imported from /home/user/workspace/node_modules/vite/dist/node/chunks/config.js
 *
 * A package's own internal file is missing — the tree is half-written, almost certainly because the
 * sandbox was paused mid-`npm install` (the idle reaper was not build-aware on the wake path; fixed
 * alongside this).
 *
 * 🔒 THE REPAIR ALREADY EXISTED and could not be reached. `missing_module` + `corruptPackage` removes
 * the package and reinstalls — but only via esbuild's `Could not resolve "…"` wording. Node's loader
 * says "Cannot find module", and the generic fallback matches "Module not found" — a different
 * sentence. So this landed in `unknown`, spent two blind retries on a deterministic failure, and then
 * failed identically on every later boot, because a torn tree cannot heal itself.
 */
const REAL_LOG = `
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/user/workspace/node_modules/vite/dist/node/chunks/dist.js' imported from /home/user/workspace/node_modules/vite/dist/node/chunks/config.js
    at finalizeResolution (node:internal/modules/esm/resolve:275:11)
    at moduleResolve (node:internal/modules/esm/resolve:861:10)
`;

describe('nodeEsmTornInstall', () => {
  it('THE REPORTED LOG: names the corrupt package and the file that is missing', () => {
    const t = nodeEsmTornInstall(REAL_LOG);
    expect(t).not.toBeNull();
    expect(t!.pkg).toBe('vite');
    expect(t!.missing).toContain('chunks/dist.js');
  });

  it('reads a scoped package name correctly', () => {
    const t = nodeEsmTornInstall(
      "Cannot find module '/w/node_modules/@vitejs/plugin-react/dist/x.js' imported from /w/node_modules/@vitejs/plugin-react/index.js",
    );
    expect(t!.pkg).toBe('@vitejs/plugin-react');
  });

  it('🔒 a USER file importing a missing package is NOT a torn install', () => {
    // That is a dependency they never added. Reinstalling for it burns a recovery attempt on the wrong
    // cure and leaves the real problem in place.
    expect(nodeEsmTornInstall(
      "Cannot find module '/w/node_modules/left-pad/index.js' imported from /home/user/workspace/src/App.tsx",
    )).toBeNull();
  });

  it('🔒 BOTH sides must be inside node_modules', () => {
    expect(nodeEsmTornInstall("Cannot find module '/w/src/a.js' imported from /w/src/b.js")).toBeNull();
  });

  it('unrelated logs and junk yield null, never a false reinstall', () => {
    expect(nodeEsmTornInstall('')).toBeNull();
    expect(nodeEsmTornInstall('EADDRINUSE: port 3000 already in use')).toBeNull();
    expect(nodeEsmTornInstall(undefined as never)).toBeNull();
  });
});

describe('classifyDevServerFailure — the reported log now reaches the repair that existed all along', () => {
  it('classifies it as a partial install and names the package to remove', () => {
    const d = classifyDevServerFailure(REAL_LOG);
    expect(d.cause).toBe('missing_module');
    expect(d.corruptPackage).toBe('vite');
    expect(d.detail).toContain('incomplete');
  });

  it('says the install was interrupted, which is the honest cause', () => {
    expect(classifyDevServerFailure(REAL_LOG).detail).toMatch(/partial or was interrupted/i);
  });

  it('does NOT hijack an ordinary code error', () => {
    const d = classifyDevServerFailure("Could not resolve './MissingThing'\n  src/App.tsx:3:8:");
    expect(d.corruptPackage).toBeUndefined();
  });
});
