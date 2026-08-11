/**
 * Zero-setup file uploads — a bucket in the USER'S OWN Supabase project.
 *
 * The dangerous mistakes here are not crashes. They are (a) a bucket with no access rules, which
 * accepts nothing and fails at runtime with no explanation, (b) rules that let one user overwrite
 * another's file, and (c) an upload helper whose path does not match the rules — which works in
 * development and fails for every real signed-in user. Each has a test.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  bucketSetupSql,
  defaultBucketSpec,
  uploadHelperSource,
  zeroSetupStorageFiles,
  BUCKET_NAME_RE,
  normalizeBucketName,
} from '../src/server/lib/supabaseStorageBucket';

const sqlOf = (spec = defaultBucketSpec()) => {
  const r = bucketSetupSql(spec);
  if (!r.ok) throw new Error(r.message);
  return r.sql;
};

describe('bucketSetupSql — the bucket', () => {
  it('creates the bucket with its limits', () => {
    const sql = sqlOf();
    expect(sql).toContain('insert into storage.buckets');
    expect(sql).toContain("'app-uploads'");
    expect(sql).toContain('file_size_limit');
    expect(sql).toContain("'image/*'");
  });

  it('is idempotent — a second build of the same app must not fail', () => {
    const sql = sqlOf();
    expect(sql).toContain('on conflict (id) do update');
    expect((sql.match(/drop policy if exists/g) || []).length).toBe(4);
  });

  it('rejects a name that could break the path or the SQL', () => {
    for (const bad of ['', 'a', 'has space', '-lead', 'trail-', 'x'.repeat(70), "quote'name"]) {
      expect(bucketSetupSql({ ...defaultBucketSpec(), name: bad }).ok, bad).toBe(false);
    }
    expect(BUCKET_NAME_RE.test('app-uploads')).toBe(true);
  });

  it('🔒 normalises the name in ONE place, so the SQL and the app cannot target different buckets', () => {
    // They drifted: the SQL lowercased `MyUploads` to `myuploads` while the generated helper uploaded
    // to `MyUploads` — a 404 on every upload, in an app that looked correctly generated.
    const spec = { ...defaultBucketSpec(), name: '  MyUploads  ' };
    expect(normalizeBucketName(spec.name)).toBe('myuploads');
    expect(sqlOf(spec)).toContain("'myuploads'");
    expect(uploadHelperSource(spec)).toContain("UPLOAD_BUCKET = 'myuploads'");
  });

  it('rejects a nonsense size limit instead of writing it', () => {
    for (const bytes of [0, -1, NaN, 6 * 1024 * 1024 * 1024]) {
      expect(bucketSetupSql({ ...defaultBucketSpec(), maxBytes: bytes }).ok, String(bytes)).toBe(false);
    }
  });

  it('drops MIME entries that are not MIME types rather than passing them through', () => {
    const sql = sqlOf({ ...defaultBucketSpec(), mimeTypes: ['image/png', "junk'; drop table x; --"] });
    expect(sql).toContain("'image/png'");
    expect(sql).not.toContain('drop table');
  });

  it('writes null (any type) when no MIME filter is given', () => {
    expect(sqlOf({ ...defaultBucketSpec(), mimeTypes: [] })).toContain('allowed_mime_types)\nvalues');
  });
});

describe('bucketSetupSql — the access rules, which are the whole security model', () => {
  it('🔒 one user can never write over another user\'s file', () => {
    // The policies key on the FIRST folder segment being the caller's own uid. Without this, any
    // signed-in user could overwrite any other's upload — the mistake a hand-written policy makes.
    const sql = sqlOf();
    for (const op of ['insert', 'update', 'delete']) {
      expect(sql, op).toContain(`for ${op}`);
    }
    expect((sql.match(/\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/g) || []).length).toBe(3);
  });

  it('never grants write access to anonymous callers', () => {
    const sql = sqlOf();
    // Every write policy is `to authenticated`; only READ may be public.
    const writeBlocks = sql.split('create policy').filter((b) => /for (insert|update|delete)/.test(b));
    expect(writeBlocks.length).toBe(3);
    for (const b of writeBlocks) expect(b).toContain('to authenticated');
  });

  it('a public bucket is public to READ only', () => {
    const sql = sqlOf({ ...defaultBucketSpec(), publicRead: true });
    expect(sql).toMatch(/for select\s+to public/);
  });

  it('a private bucket is not readable by anonymous callers at all', () => {
    const sql = sqlOf({ ...defaultBucketSpec(), publicRead: false });
    expect(sql).toMatch(/for select\s+to authenticated/);
    expect(sql).toContain('false,'); // public = false on the bucket row
  });

  it('always writes rules — a bucket without them accepts nothing and explains nothing', () => {
    expect((sqlOf().match(/create policy/g) || []).length).toBe(4);
  });
});

describe('the upload helper matches the rules it will be judged by', () => {
  const src = uploadHelperSource(defaultBucketSpec());

  it('uploads into the signed-in user\'s own folder', () => {
    // If this drifted to the bucket root, uploads would pass in dev and fail for every real user.
    expect(src).toContain('`${userId}/${Date.now()}_${safeName}`');
  });

  it('refuses to upload while signed out, with a sentence a user can act on', () => {
    expect(src).toContain('Please sign in before uploading a file.');
  });

  it('🔒 uses the ANON key only — never a service-role key', () => {
    expect(src).toContain('VITE_SUPABASE_ANON_KEY');
    expect(src.toLowerCase()).not.toContain('service_role');
    expect(src.toLowerCase()).not.toContain('service-role');
  });

  it('checks the size limit before uploading, and says the limit in MB', () => {
    expect(src).toContain('MAX_UPLOAD_BYTES');
    expect(src).toContain('That file is too large');
  });

  it('sanitises the filename so a path cannot escape the user\'s folder', () => {
    expect(src).toContain("file.name.replace(/[^\\w.-]+/g, '_')");
  });

  it('a public bucket gets a plain URL; a private one gets a signed, expiring URL', () => {
    expect(uploadHelperSource({ ...defaultBucketSpec(), publicRead: true })).toContain('getPublicUrl');
    const priv = uploadHelperSource({ ...defaultBucketSpec(), publicRead: false });
    expect(priv).toContain('createSignedUrl');
    expect(priv).toContain('3600');
  });

  it('ships as one file the app can import', () => {
    expect(Object.keys(zeroSetupStorageFiles(defaultBucketSpec()))).toEqual(['src/lib/uploads.ts']);
  });
});

describe('it needs no new permission from the user', () => {
  it('runs through the SQL path, which the Database scope already covers', () => {
    // CLAUDE.md records that the OAuth app deliberately has NO Storage scope. A bucket is a row in
    // storage.buckets, and applySchemaToProject already runs SQL under the granted Database scope —
    // which is why this ships with no new consent screen and no admin step.
    const provision = readFileSync('src/server/lib/supabaseProvision.ts', 'utf8');
    expect(provision).toContain('export async function applySchemaToProject');
    expect(provision).toContain('database/query');
  });

  it('does not start fetching the service-role key that module deliberately avoids', () => {
    const provision = readFileSync('src/server/lib/supabaseProvision.ts', 'utf8');
    expect(provision).toContain('The service-role key is deliberately NOT fetched');
  });
});
