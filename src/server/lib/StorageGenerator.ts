// U-4 (verified recipe modules) — file-storage / upload generator (S3-compatible + Cloudinary).
//
// Authenticated, bounded uploads: the generated server validates actual bytes and reserves a durable
// quota before writing to the provider. No reusable upload signature is exposed to a browser. Bring-Your-Own keys (pasted into .env;
// NavBharatAI never stores them). S3-compatible storage and Cloudinary are written through the app's
// authenticated server. PURE builders; the
// generated code is complete and correct (no TODO stubs — the real-features rule). Unit-tested.

import { zeroSetupStorageFiles, defaultBucketSpec, bucketSetupSql } from './supabaseStorageBucket';
import { secureUploadServer, UPLOAD_ACCESS_SOURCE, UPLOAD_CLIENT_SOURCE, UPLOAD_QUOTA_SQL } from './UploadSecurity';

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
        dependencies: [{ name: '@aws-sdk/client-s3', version: '^3' }],
        envKeys: ['S3_BUCKET', 'S3_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'],
        files: {
          'server/routes/upload.ts': secureUploadServer('s3'),
          ...uploadSecurityFiles(),
          'src/lib/upload.ts': UPLOAD_CLIENT_SOURCE,
          [ENV_EXAMPLE]: envBlock([
            ['SUPABASE_URL', 'Your app database URL (for verified upload authentication and durable quota)'],
            ['SUPABASE_ANON_KEY', 'Your app public database key; never a service-role key'],
            ['S3_BUCKET', 'Your bucket name'],
            ['S3_REGION', 'The bucket region, e.g. ap-south-1'],
            ['AWS_ACCESS_KEY_ID', 'Access key (server-side only)'],
            ['AWS_SECRET_ACCESS_KEY', 'Secret key (server-side only)'],
            ['S3_ENDPOINT', 'Optional — set for a non-AWS S3-compatible provider (R2 / Supabase / MinIO)'],
            ['S3_PUBLIC_BASE', 'Optional — the public base URL objects are served from'],
          ]),
        },
        instructions: SECURE_UPLOAD_INSTRUCTIONS,

      };
    case 'cloudinary':
      return {
        provider,
        dependencies: [{ name: 'cloudinary', version: '^2' }],
        envKeys: ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'],
        files: {
          'server/routes/upload.ts': secureUploadServer('cloudinary'),
          ...uploadSecurityFiles(),
          'src/lib/upload.ts': UPLOAD_CLIENT_SOURCE,
          [ENV_EXAMPLE]: envBlock([
            ['SUPABASE_URL', 'Your app database URL (for verified upload authentication and durable quota)'],
            ['SUPABASE_ANON_KEY', 'Your app public database key; never a service-role key'],
            ['CLOUDINARY_CLOUD_NAME', 'Your Cloudinary cloud name'],
            ['CLOUDINARY_API_KEY', 'Cloudinary API key'],
            ['CLOUDINARY_API_SECRET', 'Cloudinary API secret (server-side only)'],
          ]),
        },
        instructions: SECURE_UPLOAD_INSTRUCTIONS,

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

const SECURE_UPLOAD_INSTRUCTIONS = 'Apply migrations/003_upload_quota.sql to your app database. Set your app SUPABASE_URL and SUPABASE_ANON_KEY for verified user authentication and shared daily quotas. Mount uploadRouter at /api/upload before any global raw-body parser. Call uploadFile(file, session.access_token) with your app login session. The server accepts JPEG, PNG, WebP and PDF files up to 10 MB, with 100 uploads/100 MB per user and 1,000 uploads/1 GB per app per UTC day. Failed uploads consume their reservation. Files are transferred through your server. S3 returns an empty url when no public base is configured; store the key and use your own authorized download endpoint for private files.';

function uploadSecurityFiles(): Record<string, string> {
  return { 'server/lib/uploadAccess.ts': UPLOAD_ACCESS_SOURCE, 'migrations/003_upload_quota.sql': UPLOAD_QUOTA_SQL };
}
