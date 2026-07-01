#!/usr/bin/env node
/**
 * P-TQA.6 — Quality Gate CLI.
 *
 * Scores a generated-app workspace with the QualityEvaluationEngine and exits non-zero when the score
 * is below QUALITY_GATE_THRESHOLD (default 0.8 / 80). Intended for a GENERATED app's own CI (or manual
 * runs): `npx tsx scripts/quality-gate.ts <workspaceDir>`. Prints an honest "Quality Gate: N/100" line.
 *
 * NOTE: this gates GENERATED apps (what the QualityEvaluationEngine scores). NavBharatAI's OWN CI uses
 * its dedicated gates (typecheck/test/coverage/build/bundle/boot) — this script is not run there.
 */
import { QualityEvaluationEngine } from '../src/server/QualityEvaluationEngine/QualityEvaluationEngine';
import { qualityThreshold, passesQualityGate, formatGateLine } from '../src/server/QualityEvaluationEngine/qualityGate';

async function main(): Promise<void> {
  const target = process.argv[2] || process.cwd();
  const threshold = qualityThreshold();
  let score = 0;
  try {
    const report = await new QualityEvaluationEngine().evaluate(target);
    score = typeof report.overallScore === 'number' ? report.overallScore : 0;
  } catch (e: any) {
    console.error(`[quality-gate] evaluation failed for "${target}": ${e?.message || e}`);
    process.exit(1);
    return;
  }
  console.log(formatGateLine(score, threshold));
  if (!passesQualityGate(score, threshold)) {
    console.error(`[quality-gate] BLOCKED — score below threshold.`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
