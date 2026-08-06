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

/**
 * NO PREVIEW AT ALL WAS THE ONE THING THE REPORT NEVER SAID (admin build 49a7a987, 2026-08-06).
 *
 * Every post-build verification is gated on a preview URL — the route smoke check, the page-render
 * check and the E2E scaffold all silently no-op without one. So EXACTLY when the app is most broken (it
 * never came up) we verify the LEAST, and the report reads clean. That build ran 18.8 minutes, reported
 * ok: true, charged ₹286.51, and the only trace of the failure was a passing mention inside the E2E skip
 * reason: "no live preview was available to point the tests at".
 *
 * PREVIEW_ERROR already existed, but it fires only when a preview ATTEMPT reports an error. A preview
 * that was never produced at all raised nothing.
 */
describe('a build that ends with no preview says so, loudly', () => {
  it('records PREVIEW_NEVER_CAME_UP as a warning on the build itself', () => {
    expect(route).toContain("code: 'PREVIEW_NEVER_CAME_UP'");
    const at = route.indexOf("code: 'PREVIEW_NEVER_CAME_UP'");
    const rec = route.slice(at - 300, at + 900);
    expect(rec).toContain("severity: 'warning'");
    expect(rec).toContain('autoResolved: false');
  });

  it('explains WHY the rest of the report looks quiet', () => {
    // Without this the reader concludes the build was clean, which is the opposite of the truth.
    const at = route.indexOf("code: 'PREVIEW_NEVER_CAME_UP'");
    const rec = route.slice(at, at + 900);
    expect(rec).toContain('nothing here has been');
    expect(rec).toContain('were skipped');
  });

  it('fires only for a SUCCESSFUL, non-import build with no preview', () => {
    // A failed build already reports its own cause, and an import turn deliberately changes nothing.
    expect(route).toContain('if (result.ok && !lastPreviewUrl && !isImportTurn && !abort.signal.aborted)');
  });

  it('cannot affect the build — diagnostics are best-effort', () => {
    const at = route.indexOf("code: 'PREVIEW_NEVER_CAME_UP'");
    expect(route.slice(at, at + 1100)).toContain('catch');
  });
});
