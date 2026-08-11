/**
 * ZERO-SETUP FILE UPLOADS — a real storage bucket in the USER'S OWN Supabase project.
 *
 * ROADMAP §2. `generate_storage` already writes real upload code, but for S3/R2/Cloudinary with
 * **BYO keys**: the user has to go and create a bucket, mint credentials, and paste them into `.env`.
 * For the person this product is for, that is where the feature ends.
 *
 * THE THING THAT MAKES THIS BUILDABLE TODAY — and it was worth checking before declaring it blocked.
 * CLAUDE.md records that the published Supabase OAuth app deliberately does NOT hold the Storage
 * scope ("Storage can be added when Phase 1.4 needs it"), which reads like an admin action is
 * required first. It is not: a Supabase Storage bucket is a ROW in `storage.buckets`, and
 * `applySchemaToProject` already runs arbitrary SQL through the Management API's `database/query`
 * endpoint under the **Database read+write** scope, which every connected user has already granted.
 * So this ships with no new consent screen and no admin step.
 *
 * 🔒 STILL NO SERVICE-ROLE KEY. `fetchProjectCredentials` deliberately never fetches the service-role
 * key — "not fetching it means we cannot leak it" — and this does not change that. The generated app
 * uploads with the ANON key, and what a user may do is decided by the RLS policies written below,
 * inside the user's own project. A bucket that needed a bypass-RLS key in the client would be a worse
 * feature than no bucket.
 *
 * ⚠️ THE BUCKET LIVES IN THE USER'S ACCOUNT, and their storage quota pays for it. That is the standing
 * rule (user apps run on the USER's account, never NavBharatAI's), not an accident of implementation.
 */

/** A bucket name safe for a URL path, an SQL literal and Supabase's own validation. */
export const BUCKET_NAME_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

/**
 * THE one normalisation, used by BOTH the SQL and the generated upload helper.
 *
 * It exists because they drifted: the SQL lowercased the name while the helper used it as typed, so
 * a bucket called `MyUploads` was CREATED as `myuploads` and UPLOADED to as `MyUploads` — a 404 on
 * every upload, in an app that looked correctly generated. One function, both callers, no drift.
 */
export function normalizeBucketName(name: string | null | undefined): string {
  return String(name ?? '').trim().toLowerCase();
}

export interface BucketSpec {
  /** Bucket id/name, e.g. `app-uploads`. */
  name: string;
  /**
   * `true` → anyone with the URL can READ the file (product images, avatars). Writes are still
   * restricted to signed-in users. `false` → only signed-in users can read, via a signed URL.
   */
  publicRead: boolean;
  /** Hard ceiling per file, in bytes. Enforced by Supabase itself, not by the app's own code. */
  maxBytes: number;
  /** Allowed MIME types. Empty = any. Enforced server-side by Supabase. */
  mimeTypes: string[];
}

/** Sensible defaults for an app that just wants to accept uploads. 10 MB, images + PDF. */
export function defaultBucketSpec(name = 'app-uploads'): BucketSpec {
  return { name, publicRead: true, maxBytes: 10 * 1024 * 1024, mimeTypes: ['image/*', 'application/pdf'] };
}

/** Single-quote a value for SQL. The names are validated too, but this is the layer that must not be skipped. */
const lit = (v: string): string => `'${String(v).replace(/'/g, "''")}'`;

export type BucketSqlResult = { ok: true; sql: string } | { ok: false; message: string };

/**
 * The SQL that creates the bucket and its access rules, idempotently.
 *
 * Why the policies are written here rather than left to the user: a bucket with no RLS policy accepts
 * nothing, so an app would upload and get a permission error with no explanation. Writing the bucket
 * without its policies would be the "looks done, does nothing" state the second absolute rule forbids.
 *
 * The rules, deliberately conservative:
 *   • WRITE (insert/update/delete) — signed-in users only, and only inside a folder named after their
 *     own uid. One user therefore cannot overwrite or delete another's file, which is the mistake a
 *     hand-written policy usually makes.
 *   • READ — everyone when `publicRead`, otherwise signed-in users only.
 */
export function bucketSetupSql(spec: BucketSpec): BucketSqlResult {
  const name = normalizeBucketName(spec?.name);
  if (!BUCKET_NAME_RE.test(name)) {
    return { ok: false, message: 'A bucket name must be 3–63 characters, lowercase letters, numbers or dashes, and cannot start or end with a dash.' };
  }
  if (!Number.isFinite(spec.maxBytes) || spec.maxBytes <= 0 || spec.maxBytes > 5 * 1024 * 1024 * 1024) {
    return { ok: false, message: 'The per-file size limit must be between 1 byte and 5 GB.' };
  }
  const mimes = (spec.mimeTypes ?? []).filter((m) => typeof m === 'string' && /^[\w.+-]+\/[\w.*+-]+$/.test(m));
  const mimeSql = mimes.length > 0 ? `array[${mimes.map(lit).join(', ')}]::text[]` : 'null';
  const policy = (suffix: string) => lit(`nbai_${name}_${suffix}`);

  // `on conflict` + `drop policy if exists` make this safe to run again — a second build of the same
  // app must not fail because the bucket is already there.
  const sql = `
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (${lit(name)}, ${lit(name)}, ${spec.publicRead ? 'true' : 'false'}, ${Math.floor(spec.maxBytes)}, ${mimeSql})
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists ${policy('read')} on storage.objects;
create policy ${policy('read')} on storage.objects for select
  to ${spec.publicRead ? 'public' : 'authenticated'}
  using (bucket_id = ${lit(name)});

drop policy if exists ${policy('insert')} on storage.objects;
create policy ${policy('insert')} on storage.objects for insert
  to authenticated
  with check (bucket_id = ${lit(name)} and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists ${policy('update')} on storage.objects;
create policy ${policy('update')} on storage.objects for update
  to authenticated
  using (bucket_id = ${lit(name)} and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists ${policy('delete')} on storage.objects;
create policy ${policy('delete')} on storage.objects for delete
  to authenticated
  using (bucket_id = ${lit(name)} and (storage.foldername(name))[1] = auth.uid()::text);
`.trim();

  return { ok: true, sql };
}

/**
 * The upload helper written INTO the user's app. Uses supabase-js with the ANON key — the same client
 * the zero-setup database already wires — so there is no second credential and nothing new to leak.
 *
 * The path is always `<uid>/<filename>`, matching the RLS policies above. That is not decoration: the
 * policies key on the first folder segment, so a helper that wrote to the bucket root would upload
 * fine in development and fail for every real signed-in user.
 */
export function uploadHelperSource(spec: BucketSpec): string {
  // The SAME normalisation the SQL uses. Reading `spec.name` raw here is exactly how the two drifted.
  const bucket = normalizeBucketName(spec?.name);
  return `import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);

export const UPLOAD_BUCKET = '${bucket}';
/** Per-file ceiling, enforced by Supabase itself — this check only gives a nicer message first. */
export const MAX_UPLOAD_BYTES = ${Math.floor(spec.maxBytes)};

export interface UploadedFile {
  /** Storage path, e.g. "<userId>/photo.jpg" — store THIS, not the URL. */
  path: string;
  /** A URL the app can render${spec.publicRead ? '' : ' (expires — call getFileUrl again when it does)'}. */
  url: string;
}

/**
 * Upload one file for the signed-in user.
 *
 * Files are stored under the user's own id, which is what the bucket's security rules expect: one
 * user can never overwrite or delete another's file. Uploading while signed out is refused here with
 * a clear message rather than failing later inside storage.
 */
export async function uploadFile(file: File): Promise<UploadedFile> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) throw new Error('Please sign in before uploading a file.');
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(\`That file is too large. The limit is \${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.\`);
  }

  // A stable, collision-resistant name: the user's own folder + when + the original name.
  const safeName = file.name.replace(/[^\\w.-]+/g, '_').slice(-80);
  const path = \`\${userId}/\${Date.now()}_\${safeName}\`;

  const { error } = await supabase.storage.from(UPLOAD_BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw new Error(error.message);

  return { path, url: await getFileUrl(path) };
}

/** A URL for a stored file. Store the PATH in your database and call this when you need to show it. */
export async function getFileUrl(path: string): Promise<string> {
${spec.publicRead
  ? `  return supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(path).data.publicUrl;`
  : `  // Private bucket: a signed URL, valid for one hour.
  const { data, error } = await supabase.storage.from(UPLOAD_BUCKET).createSignedUrl(path, 3600);
  if (error) throw new Error(error.message);
  return data.signedUrl;`}
}

/** Delete one of the signed-in user's own files. Another user's file is refused by the storage rules. */
export async function deleteFile(path: string): Promise<void> {
  const { error } = await supabase.storage.from(UPLOAD_BUCKET).remove([path]);
  if (error) throw new Error(error.message);
}
`;
}

/** What the build writes into the workspace for a zero-setup bucket. No env keys — that is the point. */
export function zeroSetupStorageFiles(spec: BucketSpec): Record<string, string> {
  return { 'src/lib/uploads.ts': uploadHelperSource(spec) };
}
