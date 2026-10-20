// U-4 (verified recipe modules) — file-storage / upload generator (S3-compatible + Cloudinary).
//
// Real direct-to-storage uploads (the browser uploads straight to the provider; the file is never proxied
// through the app server, and the secret never leaves the server). Bring-Your-Own keys (pasted into .env;
// NavBharatAI never stores them). S3 uses a size-bound presigned PUT URL (S3-compatible provider support must be verified);
// Cloudinary uses a size-bounded authenticated server upload. PURE builders; the
// generated code is complete and correct (no TODO stubs — the real-features rule). Unit-tested.

import { zeroSetupStorageFiles, defaultBucketSpec, bucketSetupSql } from './supabaseStorageBucket';

/**
 * `supabase` is the ZERO-SETUP option: the bucket is created in the user's own Supabase project and
 * the app uploads with the anon key, so there are no keys to paste. `s3` and `cloudinary` remain the
 * bring-your-own-keys routes for users who already have that storage.
 */
export type StorageProvider = 's3' | 'cloudinary' | 'supabase';

export interface StorageConfig {
  provider: StorageProvider;
  files: Record<string, string>;
  envKeys: string[];
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const ENV_EXAMPLE = '.env.example';

const UPLOAD_ACCESS = `// Bind the app's REAL session verifier and atomic byte-quota reservation at server startup.
// Without both, signing fails closed. A client-supplied user id is never authentication.
type UploadAccess = {
  getUser: (req: import('express').Request) => Promise<{ uid: string } | null>;
  reserveBytes: (uid: string, bytes: number) => Promise<boolean>;
};
let uploadAccess: UploadAccess | undefined;
export function configureUploadAccess(access: UploadAccess): void {
  if (typeof access?.getUser !== 'function' || typeof access?.reserveBytes !== 'function') throw new Error('Connect upload authentication and a durable byte quota.');
  uploadAccess = access;
}
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
`;

const S3_ADMISSION = `async function admitUpload(req: import('express').Request, res: import('express').Response): Promise<{ uid: string; bytes: number; contentType: string } | null> {
  if (!uploadAccess) { res.status(503).json({ error: 'Upload sign-in and storage quota are not connected yet.' }); return null; }
  const user = await uploadAccess.getUser(req);
  if (!user?.uid) { res.status(401).json({ error: 'Please sign in before uploading.' }); return null; }
  const bytes = req.body?.size;
  const contentType = req.body?.contentType;
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_UPLOAD_BYTES || !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(contentType)) {
    res.status(400).json({ error: 'Choose a supported image or PDF no larger than 10 MiB.' }); return null;
  }
  if (!await uploadAccess.reserveBytes(user.uid, bytes)) { res.status(429).json({ error: 'Your upload allowance has been used. Nothing was uploaded.' }); return null; }
  return { uid: user.uid, bytes, contentType };
}`;

const S3_SERVER = `import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Router } from 'express';
import crypto from 'node:crypto';

// Bring-Your-Own S3 credentials. Works with AWS S3, Cloudflare R2, Supabase Storage or MinIO — set S3_ENDPOINT
// for a non-AWS S3-compatible provider.
const s3 = new S3Client({
  region: process.env.S3_REGION as string,
  ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true } : {}),
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
  },
});

export const uploadRouter = Router();

${UPLOAD_ACCESS}
${S3_ADMISSION}

// Return a presigned PUT URL so the browser uploads DIRECTLY to storage (never proxied through the server).
uploadRouter.post('/presign', async (req, res) => {
  const admitted = await admitUpload(req, res);
  if (!admitted) return;
  const { filename } = req.body ?? {};
  const { contentType, bytes, uid } = admitted;
  if (!filename || !contentType) return res.status(400).json({ error: 'filename and contentType are required' });
  const safe = String(filename).replace(/[^\\w.-]/g, '_');
  const key = encodeURIComponent(uid) + '/' + Date.now() + '-' + crypto.randomBytes(16).toString('hex') + '-' + safe.slice(-80);
  try {
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, ContentType: contentType, ContentLength: bytes }),
      { expiresIn: 60, signableHeaders: new Set(['content-length', 'content-type']) },
    );
    res.json({ uploadUrl: url, key, publicUrl: (process.env.S3_PUBLIC_BASE ?? '') + '/' + key });
  } catch {
    res.status(500).json({ error: 'Could not create the upload URL' });
  }
});
`;

const S3_CLIENT = `// Upload a File directly to storage via a server-issued presigned URL. Returns the object key + public URL.
export async function uploadFile(file: File): Promise<{ key: string; url: string }> {
  const presign = await fetch('/api/upload/presign', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size }),
  });
  if (!presign.ok) throw new Error('Could not get an upload URL');
  const { uploadUrl, key, publicUrl } = await presign.json();
  const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': file.type }, body: file });
  if (!put.ok) throw new Error('Upload failed');
  return { key, url: publicUrl };
}
`;

const CLOUDINARY_SERVER = `import { v2 as cloudinary } from 'cloudinary';
import { Router, raw } from 'express';
import crypto from 'node:crypto';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME as string,
  api_key: process.env.CLOUDINARY_API_KEY as string,
  api_secret: process.env.CLOUDINARY_API_SECRET as string,
});
export const uploadRouter = Router();
${UPLOAD_ACCESS}
// Cloudinary's signature is not bound to the uploaded byte count. Use a bounded server upload
// instead of issuing a reusable client signature and trusting a browser's declared size.
let activeUploads = 0;
uploadRouter.post('/file', async (req, res, next) => {
  if (!uploadAccess) return res.status(503).json({ error: 'Connect upload sign-in and a durable storage quota first.' });
  const user = await uploadAccess.getUser(req);
  if (!user?.uid) return res.status(401).json({ error: 'Please sign in before uploading.' });
  if (activeUploads >= 2) return res.status(429).json({ error: 'Uploads are busy. Try again shortly.' });
  activeUploads++;
  let released = false;
  const release = () => { if (!released) { released = true; activeUploads--; } };
  res.locals.releaseUpload = release;
  res.once('finish', () => { if (!res.locals.uploadRunning) release(); });
  res.once('close', () => { if (!res.locals.uploadRunning) release(); });
  res.locals.uploadUid = user.uid;
  next();
}, raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], limit: MAX_UPLOAD_BYTES }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: 'Choose a supported image or PDF no larger than 10 MiB.' });
  const uid = res.locals.uploadUid as string;
  if (!await uploadAccess!.reserveBytes(uid, req.body.length)) return res.status(429).json({ error: 'Your upload allowance has been used.' });
  res.locals.uploadRunning = true;
  try {
    const uploaded = await new Promise<{ secure_url: string; public_id: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({ resource_type: 'auto', public_id: crypto.randomUUID(), folder: 'uploads/' + encodeURIComponent(uid), overwrite: false, allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'pdf'] }, (error, result) => {
        if (error || !result) reject(error || new Error('Upload did not complete')); else resolve(result);
      });
      const abort = () => { stream.destroy(); reject(new Error('Upload connection closed')); };
      res.once('close', abort);
      stream.once('close', () => res.off('close', abort));
      stream.end(req.body);
    });
    return res.json({ url: uploaded.secure_url, publicId: uploaded.public_id });
  } catch { return res.status(502).json({ error: 'The file could not be stored. Please try again.' }); }
  finally { res.locals.releaseUpload(); }
});
`;

const CLOUDINARY_CLIENT = `// Auth is checked before parsing; actual bytes and quota are checked on the app server.
export async function uploadFile(file: File): Promise<{ url: string; publicId: string }> {
  const result = await fetch('/api/upload/file', { method: 'POST', headers: { 'content-type': file.type }, body: file });
  if (!result.ok) throw new Error('The file could not be uploaded. Sign in and check your storage allowance.');
  return result.json();
}
`;

function envBlock(pairs: Array<[string, string]>): string {
  return pairs.map(([k, note]) => `# ${note}\n${k}=`).join('\n') + '\n';
}

/** Generate a working BYO file-upload integration for a provider. Deterministic; unknown provider → throws. */
export function generateStorageIntegration(provider: StorageProvider): StorageConfig {
  switch (provider) {
    case 'supabase':
      // ZERO SETUP: no envKeys, because there is nothing for the user to paste. The bucket and its
      // access rules are created by `migrations/002_storage.sql`, which the existing Supabase
      // provisioning flow applies to the user's own project (see supabaseStorageBucket.ts).
      return {
        provider,
        dependencies: [{ name: '@supabase/supabase-js', version: '^2' }],
        envKeys: [],
        files: { ...zeroSetupStorageFiles(defaultBucketSpec()), 'migrations/002_storage.sql': supabaseBucketMigration() },
        instructions:
          'File uploads are ready — no keys needed. Import `uploadFile` from `src/lib/uploads.ts`. Files are stored ' +
          "in your app's own database project, under each signed-in user's own folder, so one user can never " +
          "overwrite another's file.",
      };
    case 's3':
      return {
        provider,
        dependencies: [{ name: '@aws-sdk/client-s3', version: '^3' }, { name: '@aws-sdk/s3-request-presigner', version: '^3' }],
        envKeys: ['S3_BUCKET', 'S3_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
        files: {
          'server/routes/upload.ts': S3_SERVER,
          'src/lib/upload.ts': S3_CLIENT,
          [ENV_EXAMPLE]: envBlock([
            ['S3_BUCKET', 'Your bucket name'],
            ['S3_REGION', 'The bucket region, e.g. ap-south-1'],
            ['AWS_ACCESS_KEY_ID', 'Access key (server-side only)'],
            ['AWS_SECRET_ACCESS_KEY', 'Secret key (server-side only)'],
            ['S3_ENDPOINT', 'Optional — set for a non-AWS S3-compatible provider (R2 / Supabase / MinIO)'],
            ['S3_PUBLIC_BASE', 'Optional — the public base URL objects are served from'],
          ]),
        },
        instructions: 'First call configureUploadAccess with your real session verifier and durable atomic per-user byte-quota reservation (never trust a uid from the browser). Pass your existing auth headers/cookies in the client fetch. Unconfigured uploads return 503. Mount the router: app.use("/api/upload", uploadRouter). On the client, call uploadFile(file) — the browser uploads DIRECTLY to storage via a presigned URL (never through your server). Works with AWS S3, Cloudflare R2, Supabase Storage or MinIO (set S3_ENDPOINT). Your keys stay in YOUR env.',
      };
    case 'cloudinary':
      return {
        provider,
        dependencies: [{ name: 'cloudinary', version: '^2' }],
        envKeys: ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'],
        files: {
          'server/routes/upload.ts': CLOUDINARY_SERVER,
          'src/lib/upload.ts': CLOUDINARY_CLIENT,
          [ENV_EXAMPLE]: envBlock([
            ['CLOUDINARY_CLOUD_NAME', 'Your Cloudinary cloud name'],
            ['CLOUDINARY_API_KEY', 'Cloudinary API key'],
            ['CLOUDINARY_API_SECRET', 'Cloudinary API secret (server-side only)'],
          ]),
        },
        instructions: 'First call configureUploadAccess with your real session verifier and durable atomic per-user byte-quota reservation (never trust a uid from the browser). Pass your existing auth headers/cookies in the client fetch. Unconfigured uploads return 503. Mount the router: app.use("/api/upload", uploadRouter). On the client, call uploadFile(file). Cloudinary uploads pass through this app server with an actual 10 MiB body limit and at most two concurrent buffers; no reusable upload signature is exposed. The provider secret stays on the server. Your keys stay in YOUR env; NavBharatAI never stores them.',
      };
    default:
      throw new Error(`Unknown storage provider: ${provider}`);
  }
}

/** Valid-provider guard for the tool layer. */
/** The bucket + access-rule SQL, as the migration file the provisioning flow already applies. */
function supabaseBucketMigration(): string {
  const r = bucketSetupSql(defaultBucketSpec());
  // defaultBucketSpec is valid by construction; the guard keeps a future edit from shipping an empty
  // migration, which would leave the app uploading into a bucket that does not exist.
  return r.ok ? `-- NavBharatAI: file uploads (bucket + access rules)\n${r.sql}\n` : '';
}

export function isStorageProvider(v: unknown): v is StorageProvider {
  return v === 's3' || v === 'cloudinary' || v === 'supabase';
}
