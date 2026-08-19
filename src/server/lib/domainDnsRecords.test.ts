import { describe, it, expect } from 'vitest';
import { mergeStableRecords, dedupeRecords, dnsRecordKey } from './domainDnsRecords';

describe('domainDnsRecords — stable, never-forgotten DNS records', () => {
  describe('dnsRecordKey', () => {
    it('is case-insensitive on type/name and dot-insensitive on name', () => {
      expect(dnsRecordKey({ type: 'txt', name: 'Foo.COM.', value: 'x' })).toBe(dnsRecordKey({ type: 'TXT', name: 'foo.com', value: 'x' }));
    });
    it('keeps the value case-sensitive (a TXT token differs by case)', () => {
      expect(dnsRecordKey({ type: 'TXT', name: 'a', value: 'Token' })).not.toBe(dnsRecordKey({ type: 'TXT', name: 'a', value: 'token' }));
    });
  });

  describe('dedupeRecords', () => {
    it('drops incomplete records and de-duplicates by identity', () => {
      const out = dedupeRecords([
        { type: 'A', name: 'shop.com', value: '1.2.3.4' },
        { type: 'A', name: 'shop.com.', value: '1.2.3.4' }, // dup (trailing dot)
        { type: 'TXT', name: 'shop.com', value: '' },        // incomplete → dropped
      ]);
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ type: 'A', name: 'shop.com', value: '1.2.3.4' });
    });
  });

  describe('mergeStableRecords — the admin bug: records must not vanish', () => {
    it('marks an added-and-accepted record as done, and keeps it visible (never forgotten)', () => {
      // The user added the ownership TXT + A record; Firebase has since accepted them, so they are no
      // longer pending. They MUST still show — as ✓ done — not disappear.
      const stored = [
        { type: 'TXT', name: 'shop.com', value: 'hosting-site=nbai-abc', note: 'Ownership' },
        { type: 'A', name: 'shop.com', value: '199.36.158.100' },
      ];
      const pending: { type: string; name: string; value: string }[] = [];
      const merged = mergeStableRecords(stored, pending);
      expect(merged).toHaveLength(2);
      expect(merged.every((r) => r.done)).toBe(true);
    });

    it('a newly-required cert TXT is pending and listed FIRST; the accepted ones follow as done', () => {
      const stored = [
        { type: 'TXT', name: 'shop.com', value: 'hosting-site=nbai-abc' },   // accepted
        { type: 'A', name: 'shop.com', value: '199.36.158.100' },            // accepted
      ];
      const pending = [
        { type: 'TXT', name: '_acme-challenge.shop.com', value: 'acme-token-1' }, // new, still needed
      ];
      const merged = mergeStableRecords(stored, pending);
      expect(merged).toHaveLength(3);
      // Pending first.
      expect(merged[0]).toMatchObject({ type: 'TXT', name: '_acme-challenge.shop.com', done: false });
      // The two the user already added are still present, marked done.
      expect(merged.filter((r) => r.done)).toHaveLength(2);
    });

    it('a record present in BOTH stored and pending appears once, as pending (not yet accepted)', () => {
      const stored = [{ type: 'A', name: 'shop.com', value: '199.36.158.100' }];
      const pending = [{ type: 'A', name: 'shop.com', value: '199.36.158.100' }];
      const merged = mergeStableRecords(stored, pending);
      expect(merged).toHaveLength(1);
      expect(merged[0].done).toBe(false);
    });

    it('is empty only when both inputs are empty', () => {
      expect(mergeStableRecords([], [])).toEqual([]);
    });
  });
});
