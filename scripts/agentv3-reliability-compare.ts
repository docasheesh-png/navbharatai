/**
 * Compare two build-reliability result files (scripts/agentv3-reliability-bench.ts output).
 *   npm run bench:compare -- <baseline.json> <candidate.json>
 * Prints both success rates with 95% Wilson intervals, the prompts each change fixed or broke, and a
 * verdict that refuses to call a difference real when the intervals overlap.
 */
import { readFileSync } from 'fs';
import { compareBench, formatComparison, type BenchResultFile } from '../src/server/AgentV3/reliability/benchHarness';

const [a, b] = process.argv.slice(2);
if (!a || !b) {
  console.error('usage: npm run bench:compare -- <baseline.json> <candidate.json>');
  process.exit(1);
}
const base = JSON.parse(readFileSync(a, 'utf8')) as BenchResultFile;
const cand = JSON.parse(readFileSync(b, 'utf8')) as BenchResultFile;
if (base.set !== cand.set) console.warn(`⚠️ comparing a ${base.set} run with a ${cand.set} run — rates are not like for like.`);
console.log(formatComparison(compareBench(base, cand), { baseline: base.label, candidate: cand.label }));
