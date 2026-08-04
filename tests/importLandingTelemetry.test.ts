import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

// #2046 follow-up (admin 2026-08-03): writeWorkspaceFiles returns HOW the files landed (bulk tar vs
// per-file) and the bulk count-proof — but nothing recorded it into the build report, so a "files
// missing after import" report could not be diagnosed from evidence (the #2044→#2046 loss was
// invisible for exactly this reason). Source contract: the import landing path must thread that
// telemetry into buildDiag. (The route closure is not unit-instantiable, hence a source test — the
// same pattern zipUpload.test.ts uses.)
describe('import landing telemetry — landedVia/bulkVerifiedCount reach the build report', () => {
  const SRC = readFileSync(fileURLToPath(new URL('../src/server/routes/agentv3.ts', import.meta.url)), 'utf8');

  it('landImportedProject records IMPORT_LANDING with the landing mode and the count-proof', () => {
    expect(SRC).toContain("code: 'IMPORT_LANDING'");
    expect(SRC).toContain('landed.landedVia');
    expect(SRC).toContain('landed.bulkVerifiedCount');
    expect(SRC).toContain('landed.skipped.length');
  });

  it('both in-build land call sites pass buildDiag so the record actually lands in the report', () => {
    // The zip-extract site and the git-blobs materialize site each thread the diagnostics object.
    const diagArgs = SRC.match(/diag: buildDiag,/g) || [];
    expect(diagArgs.length).toBeGreaterThanOrEqual(2);
  });
});

// Mitrify autopsy 2026-08-04 ("Cannot GET /customer/home" again): the honest boot-verify shipped
// 2026-08-03 produced ZERO preview entries in the report, because narrations after the reply stream
// closes are dropped by design (emitLive) and the skip-gate's reason was never recorded anywhere.
// Source contract: every branch of the background import-preview boot leaves a buildDiag record —
// skipped (with why), started, serving/not-serving (the earned verdict), failed (both the clean-fail
// branch AND the exception/timeout catch).
describe('import preview boot — every lifecycle branch leaves a forensic record', () => {
  const SRC = readFileSync(fileURLToPath(new URL('../src/server/routes/agentv3.ts', import.meta.url)), 'utf8');

  it('the skip-gate records WHY the boot was not attempted', () => {
    expect(SRC).toContain("code: 'IMPORT_PREVIEW_SKIPPED'");
    expect(SRC).toContain('no package.json');
    expect(SRC).toContain('live preview is unavailable');
  });

  it('the boot start and the earned serve-verdict are recorded', () => {
    expect(SRC).toContain("code: 'IMPORT_PREVIEW_BOOT_STARTED'");
    expect(SRC).toContain("'IMPORT_PREVIEW_SERVING' : 'IMPORT_PREVIEW_NOT_SERVING'");
  });

  it('BOTH failure branches record — the clean did-not-boot path and the exception/timeout catch', () => {
    const fails = SRC.match(/code: 'IMPORT_PREVIEW_BOOT_FAILED'/g) || [];
    expect(fails.length).toBeGreaterThanOrEqual(2);
  });
});
