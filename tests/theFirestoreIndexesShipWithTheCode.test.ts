/**
 * 🗂️ THE INDEXES SHIP WITH THE QUERIES THAT NEED THEM (Q-3344, admin Home 2026-11-25).
 *
 * The admin Home said "total revenue (sum of successful payments) (9 FAILED_PRECONDITION: The query requires an
 * index …)". The index WAS in firestore.indexes.json; nothing deployed that file — Cloud Build deployed only
 * `firestore:rules`. These tests lock both halves: every merge deploys the indexes, and the index the revenue
 * query needs is in the file the deploy reads.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

type Step = { id?: string; args?: string[]; allowFailure?: boolean; waitFor?: string[] };
const steps = (load(readFileSync('cloudbuild.yaml', 'utf8')) as { steps: Step[] }).steps;
const at = steps.findIndex(s => s.id === 'deploy-firestore-indexes');
const script = (steps[at]?.args ?? []).join('\n');

describe('every merge deploys firestore.indexes.json', () => {
  it('🔴 a step deploys firestore:indexes to the server project, before traffic moves', () => {
    expect(at).toBeGreaterThan(-1);
    expect(script).toMatch(/deploy --only firestore:indexes --project gen-lang-client-0866594388 --non-interactive/);
    expect(script).not.toMatch(/--force/); // never deletes an index that exists only in the console
    expect(script).toContain('set -euo pipefail');
    const deployAt = steps.findIndex(s => (s.args ?? []).slice(0, 2).join(' ') === 'run deploy');
    expect(at).toBeLessThan(deployAt);
    expect(steps[at].waitFor).toBeUndefined();
  });
  it('optional (additive, asynchronous): a missing permission never holds a release', () => {
    expect(steps[at].allowFailure).toBe(true);
  });
  it('firebase.json points the deploy at the file that holds the indexes', () => {
    const cfg = JSON.parse(readFileSync('firebase.json', 'utf8'));
    // An array since Q-3700: one entry per database (the live server reads `(default)`), each with the file.
    const entries = Array.isArray(cfg.firestore) ? cfg.firestore : [cfg.firestore];
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(e.indexes).toBe('firestore.indexes.json');
  });
});

describe('the revenue sum\'s index is in that file', () => {
  it('(paymentStatus ==, sum amountPaid) on payment_transactions', () => {
    const route = readFileSync('src/server/routes/admin.ts', 'utf8');
    expect(route).toContain(".where('paymentStatus', '==', 'SUCCESS').aggregate({ total: AggregateField.sum('amountPaid') })");
    const { indexes } = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'));
    expect(indexes).toContainEqual(expect.objectContaining({
      collectionGroup: 'payment_transactions',
      fields: [{ fieldPath: 'paymentStatus', order: 'ASCENDING' }, { fieldPath: 'amountPaid', order: 'ASCENDING' }],
    }));
  });
});
