// DB-13 / tenant isolation: a user's DATABASE_URL must not point the server at private or internal hosts.
import { describe, it, expect } from 'vitest';
import { postgresHostAllowed, postgresHostOf, runPostgresQuery } from '../src/server/lib/postgresQuery';

const resolver = (map: Record<string, string[]>) => async (h: string) => {
  if (!(h in map)) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
  return map[h];
};
const DNS = resolver({ 'db.example.com': ['93.184.216.34'], 'evil.example.com': ['10.0.0.5'], 'mixed.example.com': ['93.184.216.34', '169.254.169.254'] });

describe('postgresHostAllowed', () => {
  it('allows a public host', async () => {
    expect(await postgresHostAllowed('postgresql://u:p@db.example.com:5432/x', DNS, {})).toBe(true);
  });
  it('refuses private, loopback, metadata and internal targets', async () => {
    for (const url of [
      'postgresql://u:p@127.0.0.1/x', 'postgresql://u:p@localhost/x', 'postgresql://u:p@10.1.2.3/x',
      'postgresql://u:p@169.254.169.254/x', 'postgresql://u:p@metadata.google.internal/x',
      'postgresql://u:p@[::1]/x', 'postgresql://u:p@evil.example.com/x', 'postgresql://u:p@mixed.example.com/x',
    ]) expect(await postgresHostAllowed(url, DNS, {}), url).toBe(false);
  });
  it('an unresolvable name is let through (the connect fails by itself)', async () => {
    expect(await postgresHostAllowed('postgresql://u:p@nope.example.com/x', DNS, {})).toBe(true);
  });
  it('PG_ALLOW_PRIVATE_HOSTS=on is the local-dev escape hatch', async () => {
    expect(await postgresHostAllowed('postgresql://u:p@127.0.0.1/x', DNS, { PG_ALLOW_PRIVATE_HOSTS: 'on' } as any)).toBe(true);
  });
  it('parses hosts', () => {
    expect(postgresHostOf('postgres://u:p@h.example.com:5432/db?sslmode=require')).toBe('h.example.com');
  });
});

describe('runPostgresQuery', () => {
  it('never opens a client for a private host, and says one generic thing', async () => {
    let made = 0;
    const r = await runPostgresQuery('postgresql://u:p@10.0.0.9/db', 'select 1', (() => { made++; return {} as never; }) as never, DNS);
    expect(made).toBe(0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/not reachable from NavBharatAI/);
  });
  it('closes the client when connect fails (no leaked socket)', async () => {
    let ended = 0;
    const client = { connect: async () => { throw new Error('timeout'); }, end: async () => { ended++; }, query: async () => ({ rows: [] }) };
    await runPostgresQuery('postgresql://u:p@db.example.com/db', 'select 1', (() => client) as never, DNS);
    expect(ended).toBe(1);
  });
});
