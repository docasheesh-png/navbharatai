/**
 * AN INSTALL THAT FAILS ON THE MOMENT, NOT ON THE TREE, GETS ONE MORE MOMENT.
 *
 * Mitrify report a876b7bb (2026-08-15): the pre-migration `npm install` died with
 * `ENOTEMPTY: directory not empty, rmdir node_modules/yargs/build/lib/utils` (exit 217) — an
 * npm-on-overlayfs race with nothing wrong in the project. The migration step was skipped because of
 * it, the dev server booted against an empty database, and the IDENTICAL install succeeded seconds
 * later inside the boot. The reactive heal (retry the migration after the boot) already existed;
 * this predicate is the UPSTREAM half — the install itself retries once, so the skip never happens.
 *
 * 🔒 The predicate must stay NARROW: retrying a deterministic failure (ERESOLVE, 404, EINTEGRITY)
 * burns a minute to fail identically — the forbidden "retry loop around code that deterministically
 * fails". Every deterministic class is pinned here as a NO.
 */

import { describe, it, expect } from 'vitest';
import { isTransientNpmFsFailure } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/devServerHost';

describe('🔒 the exact failure from the report', () => {
  it('recognises the ENOTEMPTY rmdir race', () => {
    const log = [
      'npm error code ENOTEMPTY',
      'npm error syscall rmdir',
      "npm error path /home/user/workspace/node_modules/yargs/build/lib/utils",
      "npm error ENOTEMPTY: directory not empty, rmdir '/home/user/workspace/node_modules/yargs/build/lib/utils'",
      'exit status 217',
    ].join('\n');
    expect(isTransientNpmFsFailure(log)).toBe(true);
  });
});

describe('the transient family', () => {
  it('covers the sibling fs-race errnos', () => {
    expect(isTransientNpmFsFailure('npm error EBUSY: resource busy or locked, rmdir …')).toBe(true);
    expect(isTransientNpmFsFailure("npm error EEXIST: file already exists, mkdir 'node_modules/react'")).toBe(true);
    expect(isTransientNpmFsFailure("npm error ENOTDIR: not a directory, rename 'node_modules/.foo-x'")).toBe(true);
  });

  it('🔒 but EEXIST / ENOTDIR OUTSIDE node_modules is not claimed', () => {
    // Those errnos on arbitrary paths (a config file, a workspace path) are usually a real problem
    // with the project layout, not npm racing itself.
    expect(isTransientNpmFsFailure('EEXIST: file already exists, open /home/user/workspace/.env')).toBe(false);
    expect(isTransientNpmFsFailure('ENOTDIR: not a directory, scandir /home/user/workspace/src')).toBe(false);
  });
});

describe('🔒 deterministic failures are NEVER retried', () => {
  it('each deterministic class is a hard no', () => {
    for (const log of [
      'npm error code ERESOLVE\nnpm error ERESOLVE unable to resolve dependency tree',
      'npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/left-padd',
      'npm error code EINTEGRITY\nnpm error sha512-… integrity checksum failed',
      'npm error code ETARGET\nnpm error No matching version found for react@99.0.0',
      'npm error code EBADPLATFORM',
    ]) {
      expect(isTransientNpmFsFailure(log), log.slice(0, 40)).toBe(false);
    }
  });

  it('🔒 deterministic wins even when an fs errno ALSO appears in the same log', () => {
    // A 404 that leaves a half-written directory still fails on the next try for the 404 —
    // the fs noise around it must not win the classification.
    const log = 'npm error code E404\nnpm error 404 Not Found\nnpm warn cleanup ENOTEMPTY: directory not empty';
    expect(isTransientNpmFsFailure(log)).toBe(false);
  });

  it('a clean or empty log is not a failure at all', () => {
    expect(isTransientNpmFsFailure('')).toBe(false);
    expect(isTransientNpmFsFailure('added 312 packages in 24s')).toBe(false);
    expect(isTransientNpmFsFailure(null as never)).toBe(false);
  });
});
