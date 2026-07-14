import { describe, it, expect } from 'vitest';
import { generateStorageIntegration, isStorageProvider } from './StorageGenerator';

describe('generateStorageIntegration — S3-compatible', () => {
  const c = generateStorageIntegration('s3');

  it('server issues a presigned PUT URL (direct-to-storage, not proxied)', () => {
    const server = c.files['server/routes/upload.ts'];
    expect(server).toContain("import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'");
    expect(server).toContain('getSignedUrl');
    expect(server).toContain("uploadRouter.post('/presign'");
    expect(server).toContain('S3_ENDPOINT'); // supports R2/Supabase/MinIO
  });

  it('client PUTs the file to the presigned URL', () => {
    const client = c.files['src/lib/upload.ts'];
    expect(client).toContain('export async function uploadFile');
    expect(client).toContain("method: 'PUT'");
    expect(client).toContain('/api/upload/presign');
  });

  it('declares both aws-sdk deps + the core env keys', () => {
    expect(c.dependencies.map((d) => d.name)).toEqual(['@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner']);
    for (const k of ['S3_BUCKET', 'S3_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']) expect(c.envKeys).toContain(k);
  });
});

describe('generateStorageIntegration — Cloudinary', () => {
  const c = generateStorageIntegration('cloudinary');

  it('server issues an upload signature (secret never leaves the server)', () => {
    expect(c.files['server/routes/upload.ts']).toContain('cloudinary.utils.api_sign_request');
    expect(c.files['server/routes/upload.ts']).toContain("uploadRouter.post('/sign'");
    expect(c.files['src/lib/upload.ts']).toContain('api.cloudinary.com');
    expect(c.dependencies).toEqual([{ name: 'cloudinary', version: '^2' }]);
  });
});

describe('safety + guards', () => {
  it('blanks secret values in .env.example and has no TODO/stub placeholders', () => {
    for (const p of ['s3', 'cloudinary'] as const) {
      const cfg = generateStorageIntegration(p);
      for (const k of cfg.envKeys) expect(cfg.files['.env.example']).toContain(`${k}=`);
      expect(cfg.files['server/routes/upload.ts']).not.toMatch(/TODO|FIXME|not implemented|your-code-here/i);
    }
  });

  it('isStorageProvider guards; unknown → throws', () => {
    expect(isStorageProvider('s3')).toBe(true);
    expect(isStorageProvider('cloudinary')).toBe(true);
    for (const v of ['gcs', '', null]) expect(isStorageProvider(v)).toBe(false);
    // @ts-expect-error invalid
    expect(() => generateStorageIntegration('gcs')).toThrow();
  });
});
