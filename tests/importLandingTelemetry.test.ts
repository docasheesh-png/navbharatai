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

// ADMIN REPORT 2026-08-04: "puri build report save hi nahi hoti hai."
//
// He was right, and it invalidated part of an autopsy. recordCommand was wired ONLY into the
// ToolDispatcher (agentv3.ts ~6701), so the report captured commands the AGENT ran and NOTHING from
// the import preview boot — the phase that takes minutes and produces the recurring "Cannot GET".
// The autopsy of build cb03bdde consequently found a 238-second window with no events at all and
// could not attribute it. That was never a hole in TIME; it was a hole in the RECORDING.
//
// Rule 5 calls the build report "the single highest-signal evidence we will ever get". A report that
// is silently blind on the phase that fails most often makes every autopsy of that class a guess.
describe('import preview boot leaves a forensic trail (the report must not be blind)', () => {
  const SRC = readFileSync(fileURLToPath(new URL('../src/server/routes/agentv3.ts', import.meta.url)), 'utf8');

  it('records the boot command itself — the npm install + dev server launch', () => {
    expect(SRC).toContain('opts.diag?.recordCommand?.({');
    expect(SRC).toContain('command: bootCommand');
    expect(SRC).toContain("durationMs: Date.now() - bootStartedAt");
  });

  it('captures the boot log, which is the key artefact for the "Cannot GET" class', () => {
    const boot = SRC.slice(SRC.indexOf('const bootCommand ='));
    expect(boot).toContain('stdout: result.stdout');
    expect(boot).toContain('stderr: result.stderr');
    expect(boot).toContain('exitCode:');
  });

  it('no longer swallows the database provision outcome', () => {
    // It used to be a bare `catch {}`: a report could never say whether the database the app needs
    // actually came up, so an autopsy had to guess — which is how a wrong root cause gets shipped.
    expect(SRC).toContain("code: 'IMPORT_DB_PROVISIONED'");
    expect(SRC).toContain("code: 'IMPORT_DB_PROVISION_FAILED'");
  });

  it('a failed database provision is a WARNING that stays unresolved, not an info line', () => {
    // Window STARTS BEFORE the code marker: severity sits on the same line but ahead of it, so
    // slicing forward from the marker would silently cut the very field being asserted.
    const at = SRC.indexOf("code: 'IMPORT_DB_PROVISION_FAILED'");
    expect(at).toBeGreaterThan(-1);
    const block = SRC.slice(at - 200, at + 600);
    expect(block).toContain("severity: 'warning'");
    expect(block).toContain('autoResolved: false');
  });

  it('diagnostics never break a boot — every recording call is guarded', () => {
    const boot = SRC.slice(SRC.indexOf('const bootCommand ='), SRC.indexOf('const bootCommand =') + 1600);
    expect(boot).toContain('catch { /* diagnostics are best-effort and must never break a boot */ }');
  });
});
