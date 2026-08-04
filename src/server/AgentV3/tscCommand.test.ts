import { describe, it, expect } from 'vitest';
import { TSC_ENSURE, TSC_BIN, robustTscCommand } from './tscCommand';

describe('robust tsc command (build report 2026-07-21 — npx tsc → tsc@2.0.4 squatter footgun)', () => {
  it('runs the LOCAL binary directly, never `npx tsc`', () => {
    const cmd = robustTscCommand('--noEmit');
    expect(cmd).toContain('node_modules/.bin/tsc --noEmit');
    expect(cmd).not.toMatch(/npx\s+(--no-install\s+)?tsc/); // the footgun must be gone
  });

  it('ensures the compiler exists first (installs typescript only if the local binary is absent)', () => {
    expect(TSC_ENSURE).toContain('node_modules/.bin/tsc'); // guards on the binary
    expect(TSC_ENSURE).toContain('npm install typescript --no-save'); // installs the REAL compiler, no-save
    expect(robustTscCommand()).toMatch(/^if \[ ! -d node_modules \]/); // ensure runs before the check
  });

  it('never installs the bogus `tsc` package (that is the squatter this fixes)', () => {
    expect(TSC_ENSURE).not.toMatch(/npm install\s+tsc(\s|@|$)/); // installs `typescript`, never `tsc`
    expect(TSC_BIN).toBe('node_modules/.bin/tsc');
  });

  it('appends extra args and an optional pipe correctly', () => {
    const cmd = robustTscCommand('--noEmit --incremental --tsBuildInfoFile /tmp/x', '2>&1 | head -80');
    expect(cmd).toContain('node_modules/.bin/tsc --noEmit --incremental --tsBuildInfoFile /tmp/x 2>&1 | head -80');
    // no-pipe form has no trailing space garbage
    expect(robustTscCommand('--noEmit')).toMatch(/node_modules\/\.bin\/tsc --noEmit$/);
  });
});
