import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { bucketSetupSql, defaultBucketSpec } from '../src/server/lib/supabaseStorageBucket';

describe('generated bucket migrations execute and enforce private ownership', () => {
  it('runs twice, retains four distinct policies even for long names, and refuses cross-user access', async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        create schema storage; create schema auth; create role authenticated;
        create function auth.uid() returns uuid language sql stable as
          $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
        create function storage.foldername(text) returns text[] language sql immutable as
          $$select string_to_array($1, '/')$$;
        create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
        create table storage.objects(bucket_id text, name text);
        alter table storage.objects enable row level security;
        grant usage on schema storage, auth to authenticated;
        grant select, insert, update, delete on storage.objects to authenticated;
      `);
      const name = 'a'.repeat(63);
      const sql = bucketSetupSql({ ...defaultBucketSpec(name), publicRead: false });
      if (!sql.ok) throw Error(sql.message);
      await db.exec(sql.sql); await db.exec(sql.sql);
      const policies = await db.query<{ count: number }>('select count(*)::int as count from pg_policies where tablename = \'objects\'');
      expect(policies.rows[0].count).toBe(4);
      // A valid short bucket equal to the long bucket's digest must not steal its policy names.
      const short = createHash('sha256').update(name).digest('hex').slice(0, 32);
      const other = bucketSetupSql({ ...defaultBucketSpec(short), publicRead: false });
      if (!other.ok) throw Error(other.message);
      await db.exec(other.sql);
      expect((await db.query<{ count: number }>('select count(*)::int as count from pg_policies where tablename = \'objects\'')).rows[0].count).toBe(8);

      const alice = '00000000-0000-0000-0000-000000000001';
      const bob = '00000000-0000-0000-0000-000000000002';
      await db.query('insert into storage.objects values ($1, $2), ($1, $3)', [name, alice + '/private.pdf', bob + '/private.pdf']);
      await db.exec(`set role authenticated; set request.jwt.claim.sub = '${alice}'`);
      expect((await db.query('select name from storage.objects')).rows).toEqual([{ name: alice + '/private.pdf' }]);
      expect((await db.query('delete from storage.objects where name = $1 returning name', [bob + '/private.pdf'])).rows).toEqual([]);
      await expect(db.query('insert into storage.objects values ($1, $2)', [name, bob + '/forged.pdf'])).rejects.toThrow();
      expect((await db.query('update storage.objects set name = $1 where name = $2 returning name', [alice + '/stolen.pdf', bob + '/private.pdf'])).rows).toEqual([]);
      await expect(db.query('update storage.objects set name = $1 where name = $2', [bob + '/moved.pdf', alice + '/private.pdf'])).rejects.toThrow();
    } finally { await db.close(); }
  });
});
