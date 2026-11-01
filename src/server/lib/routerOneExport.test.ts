import { describe, expect, it } from 'vitest';
import { ROUTER_ONE_EXPORT_HEADERS as headers, validateRouterOneExport as validate } from './routerOneExport';
const base = ['2026-01-01 12:00:00', 'synthetic-request', 'synthetic-model', 'Synthetic key', 'synthetic-key', '200', '100', '20', '50', '0', '120', '9.99', '10', '30', '', 'Wallet', '0.000001', ''];
const quote = (s: string) => `"${s.replaceAll('"', '""')}"`;
const file = (...rows: string[][]) => [headers, ...rows].map(r => r.map(quote).join(',')).join('\r\n');
const row = (changes: Record<string, string>) => base.map((v, i) => changes[headers[i]] ?? v);
describe('offline Router One export observations', () => {
  it('preserves exact micro USD without using list price or cache reconstruction', () => {
    const r = validate(file(base));
    expect(r).toMatchObject({ kind: 'unverified-export', billingAuthorized: false, errors: [] });
    expect(r.observations[0]).toMatchObject({ state: 'unverified', wallet: { kind: 'reported', microUsd: '1' } });
    expect(validate(file(row({ 'Wallet charged (USD)': '999999999999.999999' }))).observations[0].wallet)
      .toEqual({ kind: 'reported', microUsd: '999999999999999999' });
  });
  it.each(['', 'null'])('distinguishes unknown %j from explicit zero', value => {
    expect(validate(file(row({ 'Wallet charged (USD)': value }))).observations[0])
      .toMatchObject({ state: 'quarantined', wallet: { kind: 'unknown' } });
    expect(validate(file(row({ 'Wallet charged (USD)': '0' }))).observations[0].wallet)
      .toEqual({ kind: 'reported', microUsd: '0' });
  });
  it.each(['-1', 'NaN', 'Infinity', '1e-6', '0.0000001', ' 1', '+1', '01', '1000000000000'])('quarantines unsupported amount %s', value => {
    expect(validate(file(row({ 'Wallet charged (USD)': value }))).observations[0].reasons).toContain('invalid-wallet-amount');
  });
  it('handles quoted commas, escaped quotes, newlines, BOM and reordered headers', () => {
    const record = row({ 'API key': 'Test, "label"\nsecond line' });
    expect(validate('\uFEFF' + file(record) + '\r\n').observations).toHaveLength(1);
    const reordered = [[...headers].reverse(), [...record].reverse()].map(r => r.map(quote).join(',')).join('\n');
    expect(validate(reordered).observations[0].wallet).toEqual({ kind: 'reported', microUsd: '1' });
  });
  it.each(['"unterminated', 'a"b', '"a"x'])('rejects malformed CSV %s without leaking content', input => {
    expect(validate(input)).toMatchObject({ errors: ['invalid-csv'], observations: [] });
  });
  it('rejects missing, duplicate and extra headers', () => {
    for (const h of [headers.slice(1), [...headers, 'Unexpected'], [...headers.slice(1), headers[1]]]) {
      expect(validate(h.join(','))).toMatchObject({ errors: ['unsupported-schema'], observations: [] });
    }
    expect(validate(file(base.slice(1))).observations[0].reasons).toContain('column-count');
  });
  it('marks duplicates once and quarantines every conflicting version in either order', () => {
    expect(validate(file(base, base)).observations.map(o => o.state)).toEqual(['unverified', 'duplicate']);
    const changed = row({ 'Wallet charged (USD)': '0.000002' });
    for (const records of [[base, base, changed, base], [changed, base, base]]) {
      const r = validate(file(...records));
      expect(r.observations.every(o => o.state === 'quarantined' && o.reasons.includes('conflicting-records'))).toBe(true);
    }
  });
  it('quarantines conflicting invalid evidence and model changes; keeps distinct retries separate', () => {
    for (const changes of [{ Model: 'different-model' }, { 'Wallet charged (USD)': 'NaN' }]) {
      expect(validate(file(base, row(changes))).observations.every(o => o.state === 'quarantined')).toBe(true);
    }
    expect(validate(file(base, row({ 'Request ID': 'retry-request' }))).observations.map(o => o.state)).toEqual(['unverified', 'unverified']);
  });
  it('retains 499 charges with zero tokens; never infers free or billable work from status', () => {
    const r = validate(file(row({ 'Status code': '499', 'Input tokens': '0', 'Output tokens': '0', 'Cache read tokens': '0', 'Total tokens': '0' })));
    expect(r.observations[0]).toMatchObject({ state: 'unverified', wallet: { kind: 'reported', microUsd: '1' } });
    expect(r.billingAuthorized).toBe(false);
  });
  it('keeps plan zero distinct from list price and quarantines contradictory or unknown sources', () => {
    expect(validate(file(row({ 'Charge source': 'Plan', 'Wallet charged (USD)': '0' }))).observations[0].wallet).toEqual({ kind: 'reported', microUsd: '0' });
    expect(validate(file(row({ 'Charge source': 'Plan' }))).observations[0].reasons).toContain('plan-wallet-conflict');
    expect(validate(file(row({ 'Charge source': 'Future source' }))).observations[0].state).toBe('quarantined');
  });
  it('bounds input and validates attribution and diagnostics', () => {
    expect(validate('x'.repeat(2_000_001)).errors).toEqual(['file-too-large']);
    expect(validate(file(...Array.from({ length: 10_001 }, () => base))).errors).toEqual(['too-many-records']);
    const r = validate(file(row({ 'Request ID': '', 'Status code': 'ok', 'Time (Asia/Kolkata)': 'yesterday', 'Input tokens': '-1' })));
    expect(r.observations[0].reasons).toEqual(expect.arrayContaining(['invalid-identity', 'invalid-status', 'invalid-time', 'invalid-token-count']));
  });
});
