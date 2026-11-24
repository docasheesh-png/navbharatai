import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Admin analytics Firestore index deployment', () => {
  const firebase = JSON.parse(readFileSync('firebase.json', 'utf8'));
  const indexes = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'));

  it('registers the composite index manifest with Firebase CLI', () => {
    expect(firebase.firestore?.indexes).toBe('firestore.indexes.json');
  });

  it('indexes the SUCCESS payment filter and amountPaid aggregation together', () => {
    const index = indexes.indexes.find((candidate: any) =>
      candidate.collectionGroup === 'payment_transactions'
      && candidate.queryScope === 'COLLECTION'
      && candidate.fields.some((field: any) => field.fieldPath === 'paymentStatus' && field.order === 'ASCENDING')
      && candidate.fields.some((field: any) => field.fieldPath === 'amountPaid' && field.order === 'ASCENDING'),
    );
    expect(index).toBeDefined();
  });
});
