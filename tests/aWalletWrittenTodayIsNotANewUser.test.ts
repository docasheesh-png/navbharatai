// Admin Home capture 2026-11-18: "Registered Users 4654 · +465 today" beside "Active (24h) 2", and "Today Hits
// 2,625 · vs 0 yesterday" on a server up 54 minutes. Both were figures the platform never measured.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { walletsCreatedOn } from '../src/server/lib/adminUserActivity';
import { wholeDayHits } from '../src/server/lib/serverStats';

describe('a wallet written today is not a new user', () => {
  it('counts creation only — an old wallet updated today is not new', () => {
    const wallets = [
      { createdAt: '2026-11-18T09:00:00.000Z', updatedAt: '2026-11-18T09:00:00.000Z' },
      { createdAt: '2026-10-01T09:00:00.000Z', updatedAt: '2026-11-18T10:00:00.000Z' },
      { updatedAt: '2026-11-18T11:00:00.000Z' },
    ];
    expect(walletsCreatedOn(wallets, '2026-11-18')).toBe(1);
  });
  it('the admin route never reads updatedAt as a creation date again', () => {
    const src = readFileSync('src/server/routes/admin.ts', 'utf8');
    expect(src).not.toMatch(/updatedAt\s*\|\|\s*\w+\.createdAt/);
  });
});

describe('a day the server did not run is not a zero', () => {
  const day = '2026-11-17';
  const hits = new Map([['2026-11-17', 40]]);
  it('a process started today has no yesterday', () => {
    expect(wholeDayHits(new Map(), day, Date.parse('2026-11-18T17:30:00Z'))).toBeNull();
  });
  it('a process that started part-way through the day has no whole day either', () => {
    expect(wholeDayHits(hits, day, Date.parse('2026-11-17T12:00:00Z'))).toBeNull();
  });
  it('a process that ran the whole day reports it, zero included', () => {
    expect(wholeDayHits(hits, day, Date.parse('2026-11-16T12:00:00Z'))).toBe(40);
    expect(wholeDayHits(new Map(), day, Date.parse('2026-11-16T12:00:00Z'))).toBe(0);
  });
});
