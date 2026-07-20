import { describe, it, expect } from 'vitest';
import { quoteShellRouteGroupPaths } from './shellCommandSafety';

describe('quoteShellRouteGroupPaths — Next.js route-group paths (PulseBoard autopsy 2026-07-20)', () => {
  it('quotes the EXACT failing command (mkdir -p with (auth) route groups → was exit 2)', () => {
    const out = quoteShellRouteGroupPaths('mkdir -p src/app/(auth)/login src/app/(auth)/register');
    expect(out).toBe('mkdir -p "src/app/(auth)/login" "src/app/(auth)/register"');
  });

  it('quotes a single route-group path and leaves plain args untouched', () => {
    expect(quoteShellRouteGroupPaths('mkdir -p src/app/(dashboard)/settings')).toBe('mkdir -p "src/app/(dashboard)/settings"');
    expect(quoteShellRouteGroupPaths('mkdir -p src/app/login src/app/register')).toBe('mkdir -p src/app/login src/app/register');
  });

  it('handles nested/multiple groups in one path token as a single quoted token', () => {
    expect(quoteShellRouteGroupPaths('mkdir -p src/app/(auth)/(social)/callback')).toBe('mkdir -p "src/app/(auth)/(social)/callback"');
  });

  it('NEVER touches a real bash subshell or command substitution (no /( sequence)', () => {
    // These are the constructs the guard must never break — they have no `/(`.
    expect(quoteShellRouteGroupPaths('(cd src && npm run build)')).toBe('(cd src && npm run build)');
    expect(quoteShellRouteGroupPaths('echo $(ls src/app)')).toBe('echo $(ls src/app)');
    expect(quoteShellRouteGroupPaths('diff <(sort a) <(sort b)')).toBe('diff <(sort a) <(sort b)');
    expect(quoteShellRouteGroupPaths('FOO=$(date) npm run build')).toBe('FOO=$(date) npm run build');
  });

  it('is a no-op when there is no route group, and idempotent on already-quoted paths', () => {
    expect(quoteShellRouteGroupPaths('npm install && npm run dev')).toBe('npm install && npm run dev');
    const already = 'mkdir -p "src/app/(auth)/login"';
    expect(quoteShellRouteGroupPaths(already)).toBe(already); // already quoted → unchanged
    expect(quoteShellRouteGroupPaths('')).toBe('');
  });

  it('quotes route-group paths inside a compound command without harming the rest', () => {
    const out = quoteShellRouteGroupPaths('mkdir -p src/app/(auth)/login && echo done');
    expect(out).toBe('mkdir -p "src/app/(auth)/login" && echo done');
  });
});
