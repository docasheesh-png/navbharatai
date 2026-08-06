import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * THE SIBLING (rule 3, 2026-08-06). The legacy Engineer AI actuator carried an independent COPY of the
 * AgentV3 provisioner as it stood BEFORE the Mitrify autopsies, so it had every defect they killed —
 * plus the worst one of its own.
 *
 *   • `apt-get install`, `pg_ctlcluster` and `su postgres` are ALL root-only, and the sandbox runs
 *     unprivileged, so it could never start a database on any build, ever;
 *   • the image ships no PostgreSQL at all (measured: PSQL:none PGBIN:none), so there was nothing to
 *     start either way;
 *   • and on failure it printed DB_NOT_READY and then handed the caller a DATABASE_URL ANYWAY
 *     (`?? 'postgresql://…/myapp'`), which the loop wrote straight into `.env`. The app met
 *     ECONNREFUSED on boot while every status line said the backend was provisioned.
 *
 * Two copies of this is how one of them silently rots. There is one now.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const actuator = read('src/server/EngineerAI/actuators/E2BActuator.ts');
const loop = read('src/server/EngineerAI/EngineerAgentLoop.ts');
const iface = read('src/server/EngineerAI/actuators/IEngineerActuator.ts');

describe('Engineer AI provisions through the SHARED, verified script', () => {
  it('runs the shared script and parses the shared markers', () => {
    expect(actuator).toContain("from '../../AgentV3/sandbox/dbProvisionVerify'");
    expect(actuator).toContain('dbProvisionScript()');
    expect(actuator).toContain('parseDbProvision(pgResult?.stdout)');
  });

  it('the root-only copy is GONE — it could never have worked in this sandbox', () => {
    const at = actuator.indexOf('async provisionBackend(');
    // COMMENTS STRIPPED: the fix's own explanation names the root-only commands it removed, and an
    // assertion that cannot tell code from a comment about code is a test that fails on its own docs.
    const fn = actuator.slice(at, at + 3000)
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(fn).not.toContain('pg_ctlcluster');
    expect(fn).not.toContain('apt-get install');
    expect(fn).not.toContain('su postgres');
  });

  it('a URL is still returned, but it can no longer masquerade as success', () => {
    // `.env` must point at the local server so a late-starting database heals without a rewrite —
    // what changed is that `dbVerified` travels with it.
    expect(actuator).toContain('dbUrl = outcome.url ?? CANONICAL_DB_URL;');
    expect(actuator).toContain('dbVerified = outcome.verified;');
    expect(actuator).toContain('return { dbUrl, envVars, scaffoldFiles, dbVerified, dbVerifyFailure };');
    // The old fabricated fallback must never come back.
    expect(actuator).not.toContain("?? 'postgresql://postgres@localhost:5432/myapp'");
  });

  it('the verdict is part of the contract, not a private detail', () => {
    expect(iface).toContain('dbVerified?: boolean;');
    expect(iface).toContain('dbVerifyFailure?: string | null;');
  });
});

describe('The Engineer AI loop reports what actually happened', () => {
  it('says the database outcome through the SHARED wording', () => {
    // The step used to be reported purely from "the call returned" — and it returned a URL even when
    // the server never started, so the user read "backend provisioned" while the app was about to meet
    // ECONNREFUSED. One wording source, so this can never drift from AgentV3's.
    expect(loop).toContain('provisionOutcomeNote({');
    expect(loop).toContain('verified: result.dbVerified === true');
    expect(loop).toContain("from '../AgentV3/sandbox/dbProvisionVerify'");
  });

  it('only speaks when a database was actually asked for', () => {
    expect(loop).toContain("if (features.includes('db') && result.dbVerified !== undefined) {");
  });
});
