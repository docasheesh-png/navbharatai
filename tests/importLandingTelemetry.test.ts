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
