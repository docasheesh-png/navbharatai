import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  bindRouterOneScopeToAbort,
  routerOneAccountingScope,
  routerOneAccountingScopeStopped,
} from '../src/server/AI/RouterOne/catalogueAccounting';

/**
 * #2407: a phone drop closed the build's HTTP response while the build kept running. The accounting
 * scope treated that close as "stop", so the next Router One call threw scope_stopped before any
 * request. The rung was never asked, and the build fell through already wounded.
 */
describe('Router One scope survives a viewer disconnect', () => {
  it('a response close does not stop the scope; the build abort does', () => {
    const res = new EventEmitter();
    routerOneAccountingScope({} as never, res as never, () => {
      res.emit('close');
      expect(routerOneAccountingScopeStopped()).toBe(false);
      const abort = new AbortController();
      bindRouterOneScopeToAbort(abort.signal);
      expect(routerOneAccountingScopeStopped()).toBe(false);
      abort.abort();
      expect(routerOneAccountingScopeStopped()).toBe(true);
    });
  });

  it('the route binds the scope to the build abort, not to the socket', () => {
    const accounting = readFileSync('src/server/AI/RouterOne/catalogueAccounting.ts', 'utf8');
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(accounting).not.toContain("res.once('close'");
    expect(route).toContain('routerOneAbortController(new AbortController())');
  });
});
