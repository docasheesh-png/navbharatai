// Q-618 (forensic audit 2026-10-04; admin 2026-10-06 "ok banao") — the production image runs the server as
// the unprivileged `node` user, with the code it serves owned by root.
//
// Before: the runtime stage had no USER line, so the server ran as root and a code-execution bug could
// rewrite the server bundle or any module for every later request.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const lines = readFileSync('Dockerfile', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const runtimeAt = lines.findIndex((l) => /^FROM node:22-slim\b/.test(l));
const runtime = lines.slice(runtimeAt);
const at = (re: RegExp) => runtime.findIndex((l) => re.test(l));

describe('the server never runs as root', () => {
  it('the runtime stage switches to the node user before the server starts', () => {
    expect(runtimeAt).toBeGreaterThan(-1);
    const user = at(/^USER\s+/);
    expect(runtime[user]).toBe('USER node');
    expect(user).toBeLessThan(at(/^CMD\s/));
  });

  it('it is the LAST user switch, so nothing after it hands root back', () => {
    const users = runtime.filter((l) => /^USER\s+/.test(l));
    expect(users[users.length - 1]).toBe('USER node');
    expect(users.filter((u) => /root|^USER 0\b/.test(u))).toEqual([]);
  });

  it('the code is copied BEFORE the switch and without --chown, so the server cannot rewrite it', () => {
    const user = at(/^USER\s+/);
    runtime.forEach((l, i) => {
      if (/^COPY\b/.test(l)) {
        expect(i, l).toBeLessThan(user);
        expect(l, 'code stays owned by root').not.toMatch(/--chown/);
      }
    });
  });

  it('the no-sandbox fallback writes into a directory the node user can create', () => {
    expect(runtime).toContain('ENV WORKSPACES_ROOT=/tmp/workspaces');
    for (const f of [
      'src/server/AgentV3/sandbox/EngineerAI/actuators/LocalActuator.ts',
      'src/server/AgentV3/sandbox/AppMakerLab/WorkspaceManager.ts',
    ]) expect(readFileSync(f, 'utf8'), f).toContain('process.env.WORKSPACES_ROOT');
  });
});
