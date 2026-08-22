// Tests for the domain page's on-device memory (admin 2026-08-22: "abhi lagta hai sab gayab ho gaya").
//
// The page always restored itself — from the SERVER, one round trip after mount — so every reopen
// painted an empty form first. Nothing was lost; the screen just said so for a moment, and on a cold
// start the moment is long.

import { describe, it, expect } from 'vitest';
import {
  readDomainDraft, writeDomainDraft, clearDomainDraft, draftKey, draftNotice, DRAFT_TTL_MS,
  type DraftStore,
} from './domainDraftCache';

const NOW = 1_700_000_000_000;
const mem = (seed: Record<string, string> = {}): DraftStore & { data: Record<string, string> } => ({
  data: { ...seed },
  getItem(k) { return this.data[k] ?? null; },
  setItem(k, v) { this.data[k] = v; },
  removeItem(k) { delete this.data[k]; },
});

describe('the page opens with what you already typed', () => {
  it('THE REPORT: a saved draft comes back with the domain and the records to copy', () => {
    const s = mem();
    writeDomainDraft(s, 'ws1', { domain: 'mitrify.com', records: [{ type: 'A', value: '1.2.3.4' }] }, NOW);
    const back = readDomainDraft(s, 'ws1', NOW + 60_000);
    expect(back?.domain).toBe('mitrify.com');
    expect(back?.records).toHaveLength(1);
  });

  it('two workspaces never show each other’s domain', () => {
    const s = mem();
    writeDomainDraft(s, 'ws1', { domain: 'a.com' }, NOW);
    writeDomainDraft(s, 'ws2', { domain: 'b.com' }, NOW);
    expect(readDomainDraft(s, 'ws1', NOW)?.domain).toBe('a.com');
    expect(readDomainDraft(s, 'ws2', NOW)?.domain).toBe('b.com');
    expect(draftKey('ws1')).not.toBe(draftKey('ws2'));
  });

  it('survives a long gap — someone finishing a half-done DNS change a fortnight later', () => {
    const s = mem();
    writeDomainDraft(s, 'ws1', { domain: 'mitrify.com' }, NOW);
    expect(readDomainDraft(s, 'ws1', NOW + 14 * 24 * 60 * 60 * 1000)).not.toBeNull();
  });

  it('ages out eventually, and forgets rather than lingering', () => {
    const s = mem();
    writeDomainDraft(s, 'ws1', { domain: 'mitrify.com' }, NOW);
    expect(readDomainDraft(s, 'ws1', NOW + DRAFT_TTL_MS + 1)).toBeNull();
    expect(s.data[draftKey('ws1')]).toBeUndefined();
  });
});

describe('a broken cache is never worse than no cache', () => {
  it('corrupt JSON reads as nothing saved', () => {
    expect(readDomainDraft(mem({ [draftKey('ws1')]: '{not json' }), 'ws1', NOW)).toBeNull();
  });

  it('a draft with no domain is neither written nor returned', () => {
    // An empty entry would restore a blank form — identical to the bug this exists to fix.
    const s = mem();
    expect(writeDomainDraft(s, 'ws1', { domain: '   ' }, NOW)).toBe(false);
    expect(readDomainDraft(s, 'ws1', NOW)).toBeNull();
    expect(readDomainDraft(mem({ [draftKey('ws1')]: JSON.stringify({ domain: '', savedAt: NOW }) }), 'ws1', NOW)).toBeNull();
  });

  it('a store that throws is survivable in both directions', () => {
    const boom: DraftStore = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('full'); },
      removeItem() { throw new Error('blocked'); },
    };
    expect(readDomainDraft(boom, 'ws1', NOW)).toBeNull();
    expect(writeDomainDraft(boom, 'ws1', { domain: 'a.com' }, NOW)).toBe(false);
    expect(() => clearDomainDraft(boom, 'ws1')).not.toThrow();
  });

  it('no store at all (server render, private mode) is simply nothing saved', () => {
    expect(readDomainDraft(null, 'ws1', NOW)).toBeNull();
    expect(writeDomainDraft(null, 'ws1', { domain: 'a.com' }, NOW)).toBe(false);
  });

  it('a pathological response cannot fill the user’s storage', () => {
    const s = mem();
    writeDomainDraft(s, 'ws1', { domain: 'a.com', records: Array.from({ length: 500 }, (_, i) => ({ i })) }, NOW);
    expect(readDomainDraft(s, 'ws1', NOW)?.records.length).toBeLessThanOrEqual(40);
  });
});

describe('🔒 it restores what to TYPE, never whether it WORKED', () => {
  it('the saved shape carries no verification state at all', () => {
    // The design decision this module exists for: a remembered "✓ verified" would be a real badge
    // from yesterday, and someone would read "connected" off a screen while their site was down.
    const s = mem();
    writeDomainDraft(s, 'ws1', {
      domain: 'mitrify.com',
      records: [{ type: 'A', value: '1.2.3.4' }],
    } as never, NOW);
    const saved = JSON.parse(s.data[draftKey('ws1')]);
    for (const forbidden of ['active', 'ownershipState', 'hostState', 'sslState', 'serving', 'status']) {
      expect(Object.keys(saved), forbidden).not.toContain(forbidden);
    }
  });

  it('says where the information came from, and never that it is connected', () => {
    const note = draftNotice(true, false) || '';
    expect(note).toMatch(/saved on this device/i);
    expect(note).toMatch(/checking/i);
    expect(note).not.toMatch(/connected|verified|active|live!/i);
  });

  it('the notice disappears the moment the server confirms, and never shows without a draft', () => {
    expect(draftNotice(true, true)).toBeNull();
    expect(draftNotice(false, false)).toBeNull();
  });
});

describe('disconnecting forgets the device copy', () => {
  it('so the next visit starts clean instead of offering a domain that is gone', () => {
    const s = mem();
    writeDomainDraft(s, 'ws1', { domain: 'mitrify.com' }, NOW);
    clearDomainDraft(s, 'ws1');
    expect(readDomainDraft(s, 'ws1', NOW)).toBeNull();
  });
});
