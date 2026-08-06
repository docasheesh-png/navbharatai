import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * BOTH provisioning paths must leave the same evidence (admin 2026-08-06).
 *
 * The import path recorded diagnostics on FAILURE only, and the fresh-build path recorded none at all —
 * `provisionBackend` talks to the sandbox directly rather than through `runCommand`, so the report never
 * saw its output. A build that WORKED therefore proved nothing about which route the sandbox took, which
 * is the one genuinely open question about the fetched-Postgres path.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const route = read('src/server/routes/agentv3.ts');
const dispatcher = read('src/server/AgentV3/ToolDispatcher.ts');

describe('The import path records the route on success as well as failure', () => {
  it('the success record names the source and carries the diagnostics', () => {
    const at = route.indexOf("code: 'IMPORT_DB_PROVISIONED'");
    expect(at).toBeGreaterThan(-1);
    const rec = route.slice(at - 200, at + 900);
    expect(rec).toContain('provisionPathSummary(prov.dbDiagnostics)');
    expect(rec).toContain('detail: prov.dbDiagnostics.slice(0, 800)');
  });

  it('the failure record names the route too — "it failed" without "on which route" is half a diagnosis', () => {
    const at = route.indexOf("code: 'IMPORT_DB_PROVISION_FAILED'");
    expect(at).toBeGreaterThan(-1);
    expect(route.slice(at, at + 1400)).toContain('provisionPathSummary(prov.dbDiagnostics)');
  });
});

describe('The fresh-build path leaves evidence through the channel the report already reads', () => {
  it('records the provisioning as a command entry', () => {
    expect(dispatcher).toContain("command: 'nbai: provision sandbox postgres'");
    expect(dispatcher).toContain('provisionPathSummary(prov?.dbDiagnostics)');
  });

  it('the exit code reflects the VERIFIED verdict, not merely that the call returned', () => {
    const at = dispatcher.indexOf("command: 'nbai: provision sandbox postgres'");
    expect(dispatcher.slice(at, at + 400)).toContain('exitCode: prov?.dbVerified === true ? 0 : 1');
  });

  it('diagnostics can never affect the build', () => {
    const at = dispatcher.indexOf("command: 'nbai: provision sandbox postgres'");
    expect(dispatcher.slice(at - 200, at + 600)).toContain('catch');
  });
});
