import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE TDZ THAT KILLED THE FAST PATH (admin build report 2026-08-28, Hospital Emergency Management).
 *
 * `armKeepalive` closes over `devCommand`; the already-up fast path calls `armKeepalive` first. With
 * `let devCommand` declared BELOW the fast path, the closure hit the temporal dead zone and threw
 * "Cannot access 'devCommand' before initialization" — three TOOL_ERRORs in one real build, and the
 * adopted-server keepalive (the very case the fast path exists for) never armed.
 *
 * Source-ordering is the invariant, so it is pinned at source level: the declaration must precede
 * both the closure that captures it and the fast path that runs the closure. TypeScript itself does
 * not catch this — a closure's body is not checked against execution order.
 */
describe('devCommand is declared before anything that can run it', () => {
  const src = readFileSync(join(process.cwd(), 'src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts'), 'utf8');

  it('declaration precedes the armKeepalive closure AND the fast path', () => {
    const decl = src.indexOf('let devCommand = redirectDevServerOutput(');
    const closure = src.indexOf('const armKeepalive = async');
    const fastPath = src.indexOf("process.env.AGENTV3_DEVSERVER_FASTPATH !== 'off'");
    expect(decl).toBeGreaterThan(-1);
    expect(closure).toBeGreaterThan(-1);
    expect(fastPath).toBeGreaterThan(-1);
    expect(decl).toBeLessThan(closure);
    expect(decl).toBeLessThan(fastPath);
  });

  it('the .env wrap travels WITH the declaration, so both paths restart with the same command', () => {
    const decl = src.indexOf('let devCommand = redirectDevServerOutput(');
    const envWrap = src.indexOf('set -a; if [ -f .env ]');
    const closure = src.indexOf('const armKeepalive = async');
    expect(envWrap).toBeGreaterThan(decl);
    expect(envWrap).toBeLessThan(closure);
  });
});
