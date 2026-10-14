#!/usr/bin/env node
// OWNER APPROVAL REQUIRED before running against any real project.
// READ-ONLY invariant check for the dual-written append-only ledger (wallet_ledger). It NEVER writes,
// never backfills, never mutates a wallet. It prints, per wallet, whether the wallet_ledger chain is
// unbroken and ends at the wallet's current tokenBalance.
//
//   node scripts/ledgerV2Check.mjs --project <gcp-project> --database <db-id> --uid <walletOwnerId> [--confirm-read-only]
//
// Without --confirm-read-only it only prints what it WOULD read, and exits.
import process from 'node:process';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const project = arg('--project'); const database = arg('--database') || '(default)'; const uid = arg('--uid');
if (!project || !uid) { console.error('usage: --project <id> --uid <walletOwnerId> [--database <id>] [--confirm-read-only]'); process.exit(2); }
if (!process.argv.includes('--confirm-read-only')) {
  console.log(`[dry-run] would READ user_token_wallets/${uid} and wallet_ledger where ownerId == ${uid} in ${project}/${database}. Nothing read, nothing written.`);
  process.exit(0);
}
const admin = (await import('firebase-admin')).default;
admin.initializeApp({ projectId: project });
const db = admin.firestore(); if (database !== '(default)') db.settings({ databaseId: database });
const wallet = (await db.collection('user_token_wallets').doc(uid).get()).data() || {};
const rows = (await db.collection('wallet_ledger').where('ownerId', '==', uid).get()).docs.map((d) => d.data());
// Same rule as checkLedgerV2Chain in src/server/lib/ledgerV2.ts (kept dependency-free on purpose).
function checkLedgerV2Chain(list, bal) {
  const problems = []; const s = [...list].sort((a, b) => a.seq - b.seq);
  s.forEach((r, i) => {
    if (r.balanceAfter !== r.balanceBefore + r.deltaTokens) problems.push(`seq ${r.seq}: after != before + delta`);
    if (i > 0 && (r.seq !== s[i - 1].seq + 1 || r.balanceBefore !== s[i - 1].balanceAfter)) problems.push(`seq ${r.seq}: broken link`);
  });
  if (s.length && bal !== undefined && s[s.length - 1].balanceAfter !== bal) problems.push('latest balanceAfter != wallet balance');
  return { ok: problems.length === 0, rows: s.length, problems };
}
console.log(JSON.stringify(checkLedgerV2Chain(rows, wallet.tokenBalance), null, 2));
