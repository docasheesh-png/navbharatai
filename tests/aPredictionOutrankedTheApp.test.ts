import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { shellStillAwaited } from '../src/server/AgentV3/ProjectPlan';
import { readEvidenceLedger, fillGateFromLedger } from '../src/server/AgentV3/evidenceLedger';
import { releaseGate, type RuntimeEvidence } from '../src/server/AgentV3/releaseGate';
import { decideMarkupOnProof } from '../src/server/AgentV3/previewEarnsMarkup';

/**
 * 🧬 A PLAN-TIME PREDICTION MUST NEVER OUTRANK AN OBSERVED FACT — autopsy `50378049`, 2026-10-12.
 *
 * BlockWorld, a voxel game. Project Mode's module 1 was *"Shared Types & Constants"*, which does not
 * own the app's entry, so `shellModuleFor` predicted a later module would assemble the app and the
 * module prompt told the builder *"do NOT start or publish a preview this turn"*.
 *
 * The builder ignored the scope and wrote the WHOLE GAME — 56 files — then published a real address
 * with `update_preview`. The build's own timeline carries both of these, verbatim:
 *
 *   PREVIEW_PUBLISHED  "Preview address is live at https://5173-i6p2mx9hgq3xqukkl2q3o.e2b.app"
 *   RUNTIME_VERIFIED   "the app ran in the browser with no actionable console errors"
 *
 * And in the same report, about that same build:
 *
 *   RELEASE_GATE: UNKNOWN        "no live preview was ever available, so nothing here was proven to RUN"
 *   E2E_SCAFFOLD_SKIPPED         (no preview URL)
 *   LAST_CHANCE_PROOF_SKIPPED    "No preview URL was ever available"
 *   MARKUP_WAIVED_NO_PREVIEW     billed $1.3366 instead of $5.0098
 *   …and the user was told, about a running game: "There is nothing to open yet"
 *
 * TWO root causes, both fixed here, because either one alone reproduces the report:
 *
 *  1. **The preview subscriber discarded the address** while the prediction stood (`&& !moduleAwaitsShell`),
 *     so `lastPreviewUrl` stayed empty and every proof gated on it stood down.
 *  2. **The gate wrote an explicit `false`** for `previewUrlPublished` (`= Boolean(lastPreviewUrl)`), and
 *     `fillGateFromLedger` fills only `undefined` — so the ledger's own `PREVIEW_PUBLISHED` record could
 *     never correct it. A negative nobody is allowed to contradict is not evidence.
 *
 * ⚠️ SECOND APPEARANCE OF THE FALSE SENTENCE. `releaseGate.ts`'s `previewUrlPublished` field was added
 * for exactly this lie on the Fight 3D report (`5e2de8c4`, 2026-08-27). That fix corrected the READER
 * and left the SOURCE suppressible, so the class came back seven weeks later. This file locks the
 * source, and the census below fails the build when a NEW reader of the raw prediction appears.
 */

const ROUTE = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

/** The report's two real timeline records, by the codes the engine actually wrote. */
const REPORTED_ISSUES = [
  { code: 'PREVIEW_PUBLISHED', severity: 'info', message: 'Preview address is live at https://5173-i6p2mx9hgq3xqukkl2q3o.e2b.app' },
  { code: 'RUNTIME_VERIFIED', severity: 'info', message: 'the app ran in the browser with no actionable console errors' },
];

const CLEAN = { blockers: 0, highSeverity: 0, warnings: 0, warningLabels: [] as string[] };

const unprovenEvidence = (over: Partial<RuntimeEvidence> = {}): RuntimeEvidence => ({
  buildOk: true,
  preview: 'not-run',
  pages: 'not-run',
  journeys: 'not-run',
  typecheck: 'not-run',
  tests: 'not-run',
  ...over,
});

describe('a prediction that nothing is openable cannot outlive an address that is open (autopsy 50378049)', () => {
  describe('shellStillAwaited — the correction itself', () => {
    it('🔴 THE REPORTED BUILD: an address went up, so the shell prediction is VOID', () => {
      expect(shellStillAwaited('App Shell & Game Loop', 'https://5173-i6p2mx9hgq3xqukkl2q3o.e2b.app')).toBeNull();
    });

    it('keeps the prediction when the module turn really published nothing — autopsy 6a5fb04b still holds', () => {
      expect(shellStillAwaited('App Shell & Game Loop', '')).toBe('App Shell & Game Loop');
      expect(shellStillAwaited('App Shell & Game Loop', null)).toBe('App Shell & Game Loop');
      expect(shellStillAwaited('App Shell & Game Loop', undefined)).toBe('App Shell & Game Loop');
      expect(shellStillAwaited('App Shell & Game Loop', '   ')).toBe('App Shell & Game Loop');
    });

    it('a turn with no prediction at all is unaffected either way', () => {
      expect(shellStillAwaited(null, '')).toBeNull();
      expect(shellStillAwaited(null, 'https://5173-x.e2b.app')).toBeNull();
      expect(shellStillAwaited('', 'https://5173-x.e2b.app')).toBeNull();
      expect(shellStillAwaited(undefined, undefined)).toBeNull();
    });

    it('never throws and never invents a name', () => {
      expect(shellStillAwaited(0 as unknown as string, 1 as unknown as string)).toBeNull();
      expect(shellStillAwaited({} as unknown as string, [] as unknown as string)).toBeNull();
    });
  });

  describe('the route reads the CORRECTED prediction, not the raw one', () => {
    /** Code only — the autopsy's own evidence is kept in comments and must not be swept. */
    const code = ROUTE.split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n');

    it('🔒 THE CENSUS: the raw prediction has exactly FOUR code sites, and a fifth fails this build', () => {
      const raw = [...code.matchAll(/moduleAwaitsShell/g)].length;
      // 1. `let moduleAwaitsShell` — the declaration
      // 2. `shellStillAwaited(moduleAwaitsShell, lastPreviewUrl)` — the accessor, the only corrector
      // 3. `moduleAwaitsShell = shell.name` — the assignment, at plan time
      // 4. `awaitingShell: moduleAwaitsShell` — shouldAttemptPlatformPreview, deliberately raw: it decides
      //    whether to CREATE a preview the module was told not to publish, not what to REPORT about one.
      // A fifth is a new reader of the uncorrected prediction, which is the whole defect. If one is
      // genuinely needed, it is argued here — never added silently.
      expect(raw).toBe(4);
      expect(code).toContain('const awaitsShellNow = (): string | null => shellStillAwaited(moduleAwaitsShell, lastPreviewUrl);');
    });

    it('🔴 THE PREVIEW SUBSCRIBER NO LONGER DISCARDS THE ADDRESS', () => {
      // The exact condition that lost a live game's address.
      expect(code).not.toContain("type === 'preview' && !moduleAwaitsShell");
      const sub = code.slice(code.indexOf("events.subscribe((e) => { if ((e as { type?: string }).type === 'preview'"));
      expect(sub.slice(0, 200)).toContain('lastPreviewUrl = u');
      expect(sub.slice(0, 200)).not.toContain('moduleAwaitsShell');
    });

    it('🔴 the gate asserts only the POSITIVE, so the evidence ledger can still answer', () => {
      expect(code).toContain('if (lastPreviewUrl) gateEvidence.previewUrlPublished = true;');
      // The form that made the ledger unreachable. A `Boolean(...)` here writes `false`, and
      // `fillGateFromLedger` fills only `undefined`.
      expect(code).not.toContain('gateEvidence.previewUrlPublished = Boolean(');
    });

    it('every sentence that could claim "nothing to open" reads the corrected value', () => {
      for (const anchor of [
        'awaitingShell: awaitsShellNow()',            // the recap, the markup notice, the runtime record
        '!abort.signal.aborted && !awaitsShellNow()', // the mobile + playtest proofs, the "no preview" notice
        'const reviewDeferredToShell = awaitsShellNow();',
      ]) expect(code).toContain(anchor);
    });
  });

  describe('end to end on the reported timeline — the false sentence cannot be printed again', () => {
    it('🔴 the ledger reads PREVIEW_PUBLISHED back, and the gate stops saying it never existed', () => {
      const ledger = readEvidenceLedger([], REPORTED_ISSUES);
      expect(ledger.previewUrlPublished).toBe(true);

      // What the route now does: assert nothing when there is no local URL, then let the ledger fill it.
      const gateEvidence = unprovenEvidence();
      fillGateFromLedger(gateEvidence, ledger);
      expect(gateEvidence.previewUrlPublished).toBe(true);
      expect(releaseGate(gateEvidence, CLEAN).unproven.join(' ')).not.toContain('no live preview was ever available');
    });

    it('🔴 REVERSION: the pre-fix explicit `false` reproduces the report verbatim', () => {
      const ledger = readEvidenceLedger([], REPORTED_ISSUES);
      // Exactly what `= Boolean(lastPreviewUrl)` wrote once the subscriber had dropped the address.
      const asItWas = unprovenEvidence({ previewUrlPublished: false });
      fillGateFromLedger(asItWas, ledger);
      expect(asItWas.previewUrlPublished).toBe(false); // the ledger is powerless against an explicit false
      expect(releaseGate(asItWas, CLEAN).unproven.join(' ')).toContain('no live preview was ever available');
    });

    it('RUNTIME_VERIFIED is still read as pages-proven, and that is unchanged by this fix', () => {
      const ledger = readEvidenceLedger([], REPORTED_ISSUES);
      expect(ledger.facts.pages?.outcome).toBe('passed');
    });
  });

  describe('the money sentence the prediction was telling the user', () => {
    const base = {
      decidedBilledUsd: 5.0098,
      realCostUsd: 1.3366,
      sandboxUsd: 0,
      previewProven: false,
      expectsArtifacts: true,
      enabled: true,
    };

    it('🔴 the waiver told a user with a running game there was "nothing to open"', () => {
      const withPrediction = decideMarkupOnProof({ ...base, awaitingShell: 'App Shell & Game Loop' });
      expect(withPrediction.userMessage).toContain('nothing to open');
    });

    it('…and with the prediction corrected by the live address, that sentence is gone', () => {
      const corrected = decideMarkupOnProof({
        ...base,
        awaitingShell: shellStillAwaited('App Shell & Game Loop', 'https://5173-i6p2mx9hgq3xqukkl2q3o.e2b.app'),
      });
      expect(corrected.userMessage).not.toContain('nothing to open');
      // The margin is still waived — nothing SAW it render on this path — but the reason is now true.
      // Collecting that proof is what the subscriber fix restores on the next real build.
      expect(corrected.markupApplied).toBe(false);
    });
  });
});
