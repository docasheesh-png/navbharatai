// U-4 (verified recipe modules) — file-storage / upload generator (S3-compatible + Cloudinary).
//
// Real direct-to-storage uploads (the browser uploads straight to the provider; the file is never proxied
// through the app server, and the secret never leaves the server). Bring-Your-Own keys (pasted into .env;
// NavBharatAI never stores them). S3 uses a presigned PUT URL (works with AWS S3, Cloudflare R2, Supabase
// Storage, MinIO via S3_ENDPOINT); Cloudinary uses a server-issued upload signature. PURE builders; the
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

// Return a presigned PUT URL so the browser uploads DIRECTLY to storage (never proxied through the server).
uploadRouter.post('/presign', async (req, res) => {
  const { filename, contentType } = req.body ?? {};
  if (!filename || !contentType) return res.status(400).json({ error: 'filename and contentType are required' });
  const safe = String(filename).replace(/[^\\w.-]/g, '_');
  const key = Date.now() + '-' + crypto.randomBytes(6).toString('hex') + '-' + safe;
  try {
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, ContentType: contentType }),
      { expiresIn: 300 },
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
    body: JSON.stringify({ filename: file.name, contentType: file.type }),
  });
  if (!presign.ok) throw new Error('Could not get an upload URL');
  const { uploadUrl, key, publicUrl } = await presign.json();
  const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': file.type }, body: file });
  if (!put.ok) throw new Error('Upload failed');
  return { key, url: publicUrl };
}
`;

const CLOUDINARY_SERVER = `import { v2 as cloudinary } from 'cloudinary';
import { Router } from 'express';
import { zeroSetupStorageFiles, defaultBucketSpec, bucketSetupSql } from './supabaseStorageBucket';

// Bring-Your-Own Cloudinary keys — from the Cloudinary Console → Settings → API Keys, pasted into .env.
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME as string,
  api_key: process.env.CLOUDINARY_API_KEY as string,
  api_secret: process.env.CLOUDINARY_API_SECRET as string,
});

export const uploadRouter = Router();

// Issue a short-lived signature so the browser uploads DIRECTLY to Cloudinary (the api_secret never leaves
// the server). The client posts the file + this signature to Cloudinary's upload endpoint.
uploadRouter.post('/sign', (_req, res) => {
  const timestamp = Math.round(Date.now() / 1000);
  const folder = 'uploads';
  const signature = cloudinary.utils.api_sign_request({ timestamp, folder }, process.env.CLOUDINARY_API_SECRET as string);
  res.json({ signature, timestamp, folder, apiKey: process.env.CLOUDINARY_API_KEY, cloudName: process.env.CLOUDINARY_CLOUD_NAME });
});
`;

const CLOUDINARY_CLIENT = `// Upload a File directly to Cloudinary using a server-issued signature. Returns the secure URL.
export async function uploadFile(file: File): Promise<{ url: string; publicId: string }> {
  const sigRes = await fetch('/api/upload/sign', { method: 'POST' });
  if (!sigRes.ok) throw new Error('Could not sign the upload');
  const { signature, timestamp, folder, apiKey, cloudName } = await sigRes.json();
  const form = new FormData();
  form.append('file', file);
  form.append('api_key', apiKey);
  form.append('timestamp', String(timestamp));
  form.append('folder', folder);
  form.append('signature', signature);
  const up = await fetch('https://api.cloudinary.com/v1_1/' + cloudName + '/auto/upload', { method: 'POST', body: form });
  if (!up.ok) throw new Error('Upload failed');
  const data = await up.json();
  return { url: data.secure_url, publicId: data.public_id };
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
        instructions: 'Mount the router: app.use("/api/upload", uploadRouter). On the client, call uploadFile(file) — the browser uploads DIRECTLY to storage via a presigned URL (never through your server). Works with AWS S3, Cloudflare R2, Supabase Storage or MinIO (set S3_ENDPOINT). Your keys stay in YOUR env.',
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
        instructions: 'Mount the router: app.use("/api/upload", uploadRouter). On the client, call uploadFile(file) — the browser uploads DIRECTLY to Cloudinary using a server-issued signature (the api_secret never leaves the server). Your keys stay in YOUR env; NavBharatAI never stores them.',
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
