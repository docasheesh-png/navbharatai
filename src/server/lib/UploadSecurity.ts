/** Self-contained files written into generated apps, not imports from the builder's source tree. */
export const UPLOAD_ACCESS_SOURCE = `import type { Request, Response, NextFunction } from 'express';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
let active = 0;

export async function requireUploadUser(req: Request, res: Response, next: NextFunction) {
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\\/$/, '');
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
  if (!url || !key) return res.status(503).json({ error: 'Configure your app database authentication before accepting uploads.' });
  const authorization = req.get('authorization') || '';
  if (!/^Bearer [^\\s]+$/i.test(authorization) || authorization.length > 8192) return res.status(401).json({ error: 'Please sign in before uploading a file.' });
  try {
    const user = await fetch(url + '/auth/v1/user', { headers: { apikey: key, Authorization: authorization }, signal: AbortSignal.timeout(10000) });
    if (user.status === 401 || user.status === 403) return res.status(401).json({ error: 'Please sign in again before uploading.' });
    if (!user.ok) return res.status(503).json({ error: 'Upload authentication is temporarily unavailable.' });
    const body = await user.json();
    if (typeof body.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(body.id)) return res.status(401).json({ error: 'A verified account is required.' });
    if (active >= 4) return res.status(429).json({ error: 'Uploads are busy. Please retry shortly.' });
    active++;
    let released = false;
    const release = () => { if (!released) { released = true; active--; } };
    res.once('finish', release); res.once('close', () => { if (!res.locals.uploadInFlight) release(); });
    res.locals.releaseUpload = release;
    res.locals.uploadUser = body.id;
    res.locals.uploadAuth = { url, key, authorization };
    next();
  } catch { return res.status(503).json({ error: 'Upload authentication is temporarily unavailable.' }); }
}

/** Check the actual bytes, not a size/type asserted by the browser. SVG and executables are refused. */
export function uploadBytes(req: Request): Buffer | null {
  const bytes = req.body;
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_UPLOAD_BYTES) return null;
  const type = (req.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const starts = (hex: string) => bytes.subarray(0, hex.length / 2).toString('hex') === hex;
  const valid = type === 'image/jpeg' ? starts('ffd8ff')
    : type === 'image/png' ? starts('89504e470d0a1a0a')
    : type === 'image/webp' ? bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
    : type === 'application/pdf' ? bytes.subarray(0, 5).toString() === '%PDF-' : false;
  return valid ? bytes : null;
}

/** One database transaction enforces both user and app quotas across server instances. */
export async function reserveUpload(res: Response, bytes: number): Promise<boolean> {
  const { url, key, authorization } = res.locals.uploadAuth;
  try {
    const result = await fetch(url + '/rest/v1/rpc/nbai_reserve_upload', {
      method: 'POST', headers: { apikey: key, Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: bytes }), signal: AbortSignal.timeout(10000),
    });
    if (!result.ok) { res.status(503).json({ error: 'Upload quota is unavailable. Apply migrations/003_upload_quota.sql before accepting files.' }); return false; }
    if (await result.json() !== true) { res.status(429).json({ error: 'The daily upload allowance has been reached. Please try tomorrow.' }); return false; }
    return true;
  } catch { res.status(503).json({ error: 'Upload quota is temporarily unavailable. No file was uploaded.' }); return false; }
}
`;

export const UPLOAD_QUOTA_SQL = `-- Apply in the app's own database before enabling uploads. Failed uploads consume their reservation.
create table if not exists public.nbai_upload_daily (
  scope text not null, day date not null, uploads integer not null default 0, bytes bigint not null default 0,
  primary key (scope, day)
);
alter table public.nbai_upload_daily enable row level security;
revoke all on public.nbai_upload_daily from public, anon, authenticated;
create or replace function public.nbai_reserve_upload(amount bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  who text := auth.uid()::text;
  today date := (now() at time zone 'UTC')::date;
  app_row public.nbai_upload_daily%rowtype;
  user_row public.nbai_upload_daily%rowtype;
begin
  if who is null or amount is null or amount < 1 or amount > 10485760 then return false; end if;
  insert into public.nbai_upload_daily(scope, day) values ('app', today) on conflict do nothing;
  select * into app_row from public.nbai_upload_daily where scope = 'app' and day = today for update;
  if app_row.uploads >= 1000 or app_row.bytes + amount > 1073741824 then return false; end if;
  insert into public.nbai_upload_daily(scope, day) values ('user:' || who, today) on conflict do nothing;
  select * into user_row from public.nbai_upload_daily where scope = 'user:' || who and day = today for update;
  if user_row.uploads >= 100 or user_row.bytes + amount > 104857600 then return false; end if;
  update public.nbai_upload_daily set uploads = uploads + 1, bytes = bytes + amount
    where day = today and scope in ('app', 'user:' || who);
  -- Retain only 7 days of quota counters; no uploaded file is deleted here.
  delete from public.nbai_upload_daily where day < today - 7;
  return true;
end $$;
revoke all on function public.nbai_reserve_upload(bigint) from public;
grant execute on function public.nbai_reserve_upload(bigint) to authenticated;
`;

export const UPLOAD_CLIENT_SOURCE = `// Pass your signed-in app session's access_token; do not use a NavBharatAI platform token.
export async function uploadFile(file: File, accessToken: string): Promise<{ key: string; url: string }> {
  if (!accessToken) throw new Error('Please sign in before uploading a file.');
  if (file.size < 1 || file.size > 10 * 1024 * 1024) throw new Error('Choose a file up to 10 MB.');
  const result = await fetch('/api/upload/file', {
    method: 'POST', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': file.type }, body: file,
  });
  const answer = await result.json();
  if (!result.ok) throw new Error(answer.error || 'The file could not be uploaded.');
  if (typeof answer.key !== 'string' || typeof answer.url !== 'string') throw new Error('The upload response was incomplete.');
  return answer;
}
`;

export function secureUploadServer(provider: 's3' | 'cloudinary'): string {
  const providerImport = provider === 's3'
    ? "import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';"
    : "import { v2 as cloudinary } from 'cloudinary';";
  const setup = provider === 's3' ? `const s3 = new S3Client({
  region: process.env.S3_REGION,
  ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true } : {}),
  credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID || '', secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '' },
});` : `cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET });`;
  const upload = provider === 's3' ? `    await s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: bytes,
      ContentLength: bytes.length, ContentType: req.get('content-type'), ContentDisposition: 'attachment' }));
    const base = String(process.env.S3_PUBLIC_BASE || '').replace(/\\/$/, '');
    res.json({ key, url: base ? base + '/' + key : '' });` : `    const uploaded = await new Promise<{ public_id: string; secure_url: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({ public_id: key, resource_type: 'auto', overwrite: false,
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'pdf'] }, (error, result) => {
        if (error || !result) reject(error || new Error('Upload failed')); else resolve(result);
      });
      stream.end(bytes);
    });
    res.json({ key: uploaded.public_id, url: uploaded.secure_url });`;
  return `${providerImport}
import { Router, raw } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { requireUploadUser, uploadBytes, reserveUpload, MAX_UPLOAD_BYTES } from '../lib/uploadAccess';
${setup}
export const uploadRouter = Router();
// Authenticate BEFORE parsing bytes; the route accepts only bounded images/PDFs. No reusable provider signature is exposed.
uploadRouter.post('/file', requireUploadUser, raw({ type: () => true, limit: MAX_UPLOAD_BYTES }), async (req, res) => {
  res.locals.uploadInFlight = true;
  try {
  const bytes = uploadBytes(req);
  if (!bytes) return res.status(400).json({ error: 'Choose a valid JPEG, PNG, WebP or PDF up to 10 MB.' });
  if (!await reserveUpload(res, bytes.length)) return;
  const key = res.locals.uploadUser + '/' + randomUUID();
  try {
${upload}
  } catch { res.status(502).json({ error: 'The upload could not be confirmed. Please check your files before retrying.' }); }
  } finally { res.locals.uploadInFlight = false; res.locals.releaseUpload(); }
});
uploadRouter.use((error: any, _req: Request, res: Response, next: NextFunction) => {
  if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'Choose a file up to 10 MB.' });
  next(error);
});
`;
}
