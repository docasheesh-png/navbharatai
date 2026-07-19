import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  lockDurationMs,
  checkAdminLock,
  recordAdminFail,
  recordAdminSuccess,
  adminLockoutEnabled,
  _resetAdminLoginGuard,
  FAIL_THRESHOLD,
  BASE_LOCK_MS,
  MAX_LOCK_MS,
} from '../src/server/lib/adminLoginGuard';

describe('adminLoginGuard — escalating brute-force lockout (SEC 2026-07-19)', () => {
  beforeEach(() => _resetAdminLoginGuard());
  afterEach(() => {
    _resetAdminLoginGuard();
    delete process.env.ADMIN_LOGIN_LOCKOUT;
  });

  describe('lockDurationMs (pure escalation math)', () => {
    it('no lock below the failure threshold', () => {
      for (let f = 0; f < FAIL_THRESHOLD; f++) expect(lockDurationMs(f)).toBe(0);
    });

    it('first lock kicks in exactly at the threshold, at BASE_LOCK_MS', () => {
      expect(lockDurationMs(FAIL_THRESHOLD)).toBe(BASE_LOCK_MS);
    });

    it('doubles each threshold step (1m → 2m → 4m → 8m …)', () => {
      expect(lockDurationMs(FAIL_THRESHOLD)).toBe(BASE_LOCK_MS);       // step 1
      expect(lockDurationMs(FAIL_THRESHOLD * 2)).toBe(BASE_LOCK_MS * 2); // step 2
      expect(lockDurationMs(FAIL_THRESHOLD * 3)).toBe(BASE_LOCK_MS * 4); // step 3
      expect(lockDurationMs(FAIL_THRESHOLD * 4)).toBe(BASE_LOCK_MS * 8); // step 4
    });

    it('stays constant within a threshold band (5..9 fails all give BASE_LOCK_MS)', () => {
      for (let f = FAIL_THRESHOLD; f < FAIL_THRESHOLD * 2; f++) {
        expect(lockDurationMs(f)).toBe(BASE_LOCK_MS);
      }
    });

    it('never exceeds the hard cap MAX_LOCK_MS', () => {
      for (let f = FAIL_THRESHOLD; f < FAIL_THRESHOLD * 50; f += FAIL_THRESHOLD) {
        expect(lockDurationMs(f)).toBeLessThanOrEqual(MAX_LOCK_MS);
      }
      expect(lockDurationMs(FAIL_THRESHOLD * 1000)).toBe(MAX_LOCK_MS);
    });
  });

  describe('checkAdminLock / recordAdminFail', () => {
    const IP = '203.0.113.7';
    const T0 = 1_000_000_000_000; // fixed base time — no Date.now() reliance

    it('is not locked before the threshold is reached', () => {
      for (let i = 0; i < FAIL_THRESHOLD - 1; i++) recordAdminFail(IP, T0);
      expect(checkAdminLock(IP, T0).locked).toBe(false);
    });

    it('locks the IP once it crosses the threshold and reports remaining wait', () => {
      for (let i = 0; i < FAIL_THRESHOLD; i++) recordAdminFail(IP, T0);
      const lock = checkAdminLock(IP, T0);
      expect(lock.locked).toBe(true);
      expect(lock.retryAfterMs).toBe(BASE_LOCK_MS);
    });

    it('auto-expires: once the window passes, the IP is no longer locked', () => {
      for (let i = 0; i < FAIL_THRESHOLD; i++) recordAdminFail(IP, T0);
      expect(checkAdminLock(IP, T0).locked).toBe(true);
      // Just after the window ends.
      expect(checkAdminLock(IP, T0 + BASE_LOCK_MS + 1).locked).toBe(false);
    });

    it('escalates the window on continued failures past the next threshold', () => {
      for (let i = 0; i < FAIL_THRESHOLD * 2; i++) recordAdminFail(IP, T0);
      const lock = checkAdminLock(IP, T0);
      expect(lock.locked).toBe(true);
      expect(lock.retryAfterMs).toBe(BASE_LOCK_MS * 2);
    });

    it('is per-IP: one IP being locked does not lock a different IP', () => {
      for (let i = 0; i < FAIL_THRESHOLD; i++) recordAdminFail(IP, T0);
      expect(checkAdminLock(IP, T0).locked).toBe(true);
      expect(checkAdminLock('198.51.100.9', T0).locked).toBe(false);
    });
  });

  describe('recordAdminSuccess', () => {
    const IP = '203.0.113.42';
    const T0 = 1_000_000_000_000;

    it('a correct login clears the failure history immediately (admin never stuck)', () => {
      for (let i = 0; i < FAIL_THRESHOLD; i++) recordAdminFail(IP, T0);
      expect(checkAdminLock(IP, T0).locked).toBe(true);
      recordAdminSuccess(IP);
      expect(checkAdminLock(IP, T0).locked).toBe(false);
    });

    it('after a success the fail count restarts from zero (needs a full threshold again)', () => {
      for (let i = 0; i < FAIL_THRESHOLD; i++) recordAdminFail(IP, T0);
      recordAdminSuccess(IP);
      for (let i = 0; i < FAIL_THRESHOLD - 1; i++) recordAdminFail(IP, T0);
      expect(checkAdminLock(IP, T0).locked).toBe(false);
      recordAdminFail(IP, T0);
      expect(checkAdminLock(IP, T0).locked).toBe(true);
    });
  });

  describe('adminLockoutEnabled (kill switch)', () => {
    it('enabled by default', () => {
      delete process.env.ADMIN_LOGIN_LOCKOUT;
      expect(adminLockoutEnabled()).toBe(true);
    });

    it('disabled when ADMIN_LOGIN_LOCKOUT=off', () => {
      process.env.ADMIN_LOGIN_LOCKOUT = 'off';
      expect(adminLockoutEnabled()).toBe(false);
    });

    it('any other value keeps it enabled', () => {
      process.env.ADMIN_LOGIN_LOCKOUT = 'on';
      expect(adminLockoutEnabled()).toBe(true);
    });
  });
});
