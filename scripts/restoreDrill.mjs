#!/usr/bin/env node
// RESTORE DRILL — OWNER APPROVAL REQUIRED to run with --execute. DRY-RUN BY DEFAULT.
//
//   node scripts/restoreDrill.mjs --project <id> --export gs://bucket/firestore-backups/<ts> \
//        --target drill-2026-10-13 --location asia-southeast1            # prints the plan only
//
// --execute additionally requires --i-have-owner-approval, refuses any production database id, and
// only ever creates/imports/deletes a database whose id starts with `drill-`. It never writes to
// production and never deletes anything else. Document counts are left to the operator to read in the
// console for the scratch database (printed as steps), so this script needs no Admin SDK credentials.
import { spawnSync } from 'node:child_process';
import { buildDrillPlan } from './restoreDrillPlan.mjs';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const plan = buildDrillPlan({ project: arg('--project'), exportPrefix: arg('--export'), targetDatabase: arg('--target'), location: arg('--location') });
if (!plan.ok) { console.error('Refused:\n - ' + plan.errors.join('\n - ')); process.exit(2); }

const execute = process.argv.includes('--execute');
console.log(execute ? '[EXECUTE] restore drill' : '[DRY-RUN] restore drill — nothing will be run');
for (const s of plan.steps) console.log(` - ${s.what}${s.argv ? `: ${s.argv.join(' ')}` : ''}`);
if (!execute) process.exit(0);
if (!process.argv.includes('--i-have-owner-approval')) { console.error('Refused: --execute needs --i-have-owner-approval.'); process.exit(2); }
for (const s of plan.steps) {
  if (!s.argv) { console.log(`   (check ${s.count.collection} in the console for database ${s.count.database})`); continue; }
  const r = spawnSync(s.argv[0], s.argv.slice(1), { stdio: 'inherit' });
  if (r.status !== 0) { console.error(`Step failed: ${s.what}. Stopping. Clean up database ${plan.steps[0].argv[3]} by hand if it was created.`); process.exit(1); }
}
