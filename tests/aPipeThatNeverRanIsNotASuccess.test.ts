/**
 * Q-135: `missing-binary | head` exits 0, and the piped-exit-code check covered only compilers and test
 * runners — so `prisma migrate deploy | tail` on a project without prisma read as a success. Any pipe whose
 * first program the SHELL reports as not found is now named; output that merely contains the words is not.
 */
import { describe, it, expect } from 'vitest';
import { pipedGateExitCodeWarning } from '../src/server/AgentV3/pipedGateExitCode';

const warns = (cmd: string, out: string, code = 0) => pipedGateExitCodeWarning(cmd, code, out) !== null;

describe('a pipe whose first program never ran is not a success', () => {
  it('sh, bash and path forms, with env and npx prefixes', () => {
    expect(warns('prisma migrate deploy | tail -5', 'sh: 1: prisma: not found')).toBe(true);
    expect(warns('./node_modules/.bin/drizzle-kit push 2>&1 | head', '/bin/bash: line 1: ./node_modules/.bin/drizzle-kit: No such file or directory')).toBe(true);
    expect(warns('DATABASE_URL=x npx knex migrate:latest | tail', 'sh: 1: knex: not found')).toBe(true);
    expect(warns('cd app && seed-db | head', 'bash: seed-db: command not found')).toBe(true);
    expect(pipedGateExitCodeWarning('prisma migrate deploy | tail -5', 0, 'sh: 1: prisma: not found')).toMatch(/`prisma` was not found/);
  });

  it('never: output that only contains the words, another program\'s message, an OR, a real success, an honest exit code', () => {
    expect(warns('grep -r "command not found" app.log | head', 'app.log:3: sh: 1: foo: not found')).toBe(false);
    expect(warns('ls | head', 'sh: 1: foo: not found')).toBe(false);
    expect(warns('prisma migrate deploy || echo skip', 'sh: 1: prisma: not found')).toBe(false);
    expect(warns('prisma migrate deploy | tail -5', 'All migrations applied')).toBe(false);
    expect(warns('prisma migrate deploy | tail', 'sh: 1: prisma: not found', 127)).toBe(false);
  });
});
