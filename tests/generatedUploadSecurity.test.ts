import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import { UPLOAD_ACCESS_SOURCE, UPLOAD_QUOTA_SQL } from '../src/server/lib/UploadSecurity';
import { bucketSetupSql, defaultBucketSpec } from '../src/server/lib/supabaseStorageBucket';
import { mockReq, mockRes } from './helpers/routeTestUtils';

const uid = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const env = { SUPABASE_URL: 'https://app.example', SUPABASE_ANON_KEY: 'public-app-key' };
const fetch = vi.fn();
function load() {
  const exports: any = {};
  const code = ts.transpileModule(UPLOAD_ACCESS_SOURCE, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  runInNewContext(code, { exports, Buffer, fetch, process: { env }, AbortSignal });
  return exports;
}
function response() { return Object.assign(mockRes(), { locals: {} as any }); }

describe('generated upload security runs without the builder source tree', () => {
  beforeEach(() => fetch.mockReset());
  it('a caller cannot assert their own uid or skip authentication', async () => {
    const module = load();
    const res = response(); const next = vi.fn();
    await module.requireUploadUser(mockReq({ body: { uid } }), res, next);
    expect(res.statusCode).toBe(401); expect(next).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('an invalid session or unavailable auth cannot upload, while a verified app user can', async () => {
    for (const status of [401, 503, 200]) {
      const module = load();
      fetch.mockResolvedValue({ ok: status === 200, status, json: async () => ({ id: uid }) });
      const res = response(); const next = vi.fn();
      await module.requireUploadUser(mockReq({ headers: { authorization: 'Bearer real-session' } }), res, next);
      expect(res.statusCode).toBe(status);
      expect(next).toHaveBeenCalledTimes(status === 200 ? 1 : 0);
      if (status === 200) expect(res.locals.uploadUser).toBe(uid);
    }
  });
  it('checks actual bytes, refusing mismatched types, executable/SVG input and oversized payloads', () => {
    const module = load();
    const check = (body: Buffer, type = 'image/png') => module.uploadBytes(mockReq({ body, headers: { 'content-type': type } }));
    expect(check(Buffer.from('89504e470d0a1a0a0000', 'hex'))).not.toBeNull();
    expect(check(Buffer.from('%PDF-content'), 'application/pdf')).not.toBeNull();
    expect(check(Buffer.from('<svg></svg>'), 'image/svg+xml')).toBeNull();
    expect(check(Buffer.from('MZ-executable'))).toBeNull();
    expect(check(Buffer.alloc(10 * 1024 * 1024 + 1))).toBeNull();
  });
  it('refuses storage when the shared quota is missing, rejected or uncertain', async () => {
    const module = load();
    for (const [ok, allowed, status] of [[false, false, 503], [true, false, 429], [true, true, 200]] as const) {
      fetch.mockResolvedValue({ ok, json: async () => allowed });
      const res = response(); res.locals.uploadAuth = { url: env.SUPABASE_URL, key: env.SUPABASE_ANON_KEY, authorization: 'Bearer valid' };
      expect(await module.reserveUpload(res, 12)).toBe(allowed && ok);
      expect(res.statusCode).toBe(status);
    }
  });
});

describe('real PostgreSQL policies and quota function', () => {
  it('private bucket users read only their own folder; public assets stay public', async () => {
    const db = new PGlite();
    try {
      await db.exec(`create role authenticated; create role anon; create schema auth; create schema storage;
        create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
        create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1, '/') $$;
        create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
        create table storage.objects(bucket_id text, name text);
        alter table storage.objects enable row level security;
        grant usage on schema storage, auth to authenticated, anon;
        grant select, insert, update, delete on storage.objects to authenticated, anon;`);
      const sql = bucketSetupSql({ ...defaultBucketSpec(), name: 'private-files', publicRead: false });
      if (!sql.ok) throw new Error(sql.message);
      await db.exec(sql.sql);
      // PostgreSQL truncates identifiers after 63 bytes; the four policies must stay distinct.
      const long = bucketSetupSql({ ...defaultBucketSpec(), name: 'a'.repeat(63), publicRead: false });
      if (!long.ok) throw new Error(long.message);
      await db.exec(long.sql);
      const policies = await db.query<{ policyname: string }>("select policyname from pg_policies where tablename = 'objects'");
      expect(policies.rows).toHaveLength(8);
      for (const policy of policies.rows) expect(policy.policyname.length).toBeLessThanOrEqual(63);
      await db.exec(`insert into storage.objects values ('private-files', '${uid}/mine.pdf'), ('private-files', 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb/other.pdf');
        select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
      expect((await db.query('select name from storage.objects')).rows).toEqual([{ name: `${uid}/mine.pdf` }]);
      await expect(db.exec("insert into storage.objects values ('private-files', 'someone-else/attack.pdf')")).rejects.toThrow();
      await db.exec('reset role;');
      const publicSql = bucketSetupSql({ ...defaultBucketSpec(), name: 'public-files', publicRead: true });
      if (!publicSql.ok) throw new Error(publicSql.message);
      await db.exec(publicSql.sql);
      await db.exec("insert into storage.objects values ('public-files', 'anyone/logo.png'); set role anon;");
      expect((await db.query('select name from storage.objects')).rows).toEqual([{ name: 'anyone/logo.png' }]);
    } finally { await db.close(); }
  });
  it('authenticates reservations, caps real cumulative bytes and prevents direct counter writes', async () => {
    const db = new PGlite();
    try {
      await db.exec(`create role authenticated; create role anon; create schema auth;
        create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
        grant usage on schema auth to authenticated;`);
      await db.exec(UPLOAD_QUOTA_SQL);
      expect((await db.query('select public.nbai_reserve_upload(10) as allowed')).rows).toEqual([{ allowed: false }]);
      await db.exec(`select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
      for (let i = 0; i < 10; i++) expect((await db.query('select public.nbai_reserve_upload(10485760) as allowed')).rows).toEqual([{ allowed: true }]);
      expect((await db.query('select public.nbai_reserve_upload(1) as allowed')).rows).toEqual([{ allowed: false }]);
      await expect(db.exec("update public.nbai_upload_daily set bytes=0")).rejects.toThrow();
    } finally { await db.close(); }
  });
});
