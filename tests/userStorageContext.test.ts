import { describe, it, expect } from 'vitest';
import { userStorageContext, STORAGE_PROVIDER_MARKER } from '../src/server/AgentV3/userStorageContext';

describe('userStorageContext — connected-storage instruction for the builder', () => {
  it('returns empty when no storage is connected', () => {
    expect(userStorageContext({})).toBe('');
    expect(userStorageContext(null)).toBe('');
    expect(userStorageContext(undefined)).toBe('');
    expect(userStorageContext({ SOME_OTHER_KEY: 'x' })).toBe('');
  });

  it('emits an S3 block naming the exact env vars + SDK when connected', () => {
    const ctx = userStorageContext({
      [STORAGE_PROVIDER_MARKER]: 's3',
      S3_BUCKET: 'my-bucket',
      S3_REGION: 'ap-south-1',
      AWS_ACCESS_KEY_ID: 'AKIA...',
      AWS_SECRET_ACCESS_KEY: 'secret',
    });
    expect(ctx).toContain('CONNECTED FILE STORAGE');
    expect(ctx).toContain('S3-compatible');
    expect(ctx).toContain('@aws-sdk/client-s3');
    expect(ctx).toContain('S3_BUCKET');
    expect(ctx).toContain('AWS_ACCESS_KEY_ID');
    expect(ctx).toContain('DO NOT CREATE A NEW ONE');
    // Presigned-upload guidance is carried through.
    expect(ctx).toContain('presigned');
  });

  it('emits a Cloudinary block with its exact env vars', () => {
    const ctx = userStorageContext({
      [STORAGE_PROVIDER_MARKER]: 'cloudinary',
      CLOUDINARY_CLOUD_NAME: 'demo',
      CLOUDINARY_API_KEY: '123',
      CLOUDINARY_API_SECRET: 'sec',
    });
    expect(ctx).toContain('Cloudinary');
    expect(ctx).toContain('CLOUDINARY_CLOUD_NAME');
    expect(ctx).toContain('CLOUDINARY_API_SECRET');
  });

  it('only names the env vars actually populated (partial credentials)', () => {
    const ctx = userStorageContext({
      [STORAGE_PROVIDER_MARKER]: 's3',
      S3_BUCKET: 'my-bucket',
      // region + keys left blank
    });
    expect(ctx).toContain('S3_BUCKET');
    expect(ctx).not.toContain('AWS_SECRET_ACCESS_KEY'); // blank → not named
  });

  it('infers the provider from populated env vars even without the marker', () => {
    const ctx = userStorageContext({ CLOUDINARY_CLOUD_NAME: 'demo', CLOUDINARY_API_KEY: '1', CLOUDINARY_API_SECRET: 's' });
    expect(ctx).toContain('Cloudinary');
    expect(ctx).toContain('CLOUDINARY_API_KEY');
  });

  it('a marker with no credentials yet still guides to the provider with an honest "set" note', () => {
    const ctx = userStorageContext({ [STORAGE_PROVIDER_MARKER]: 's3' });
    expect(ctx).toContain('S3');
    expect(ctx.toLowerCase()).toContain('set s3_bucket');
  });

  it('ignores an unknown provider marker with no recognizable env vars', () => {
    expect(userStorageContext({ [STORAGE_PROVIDER_MARKER]: 'totally-unknown-storage' })).toBe('');
  });

  it("never leaks a NavBharatAI AI-vendor name (it only names the user's own storage provider)", () => {
    const ctx = userStorageContext({ [STORAGE_PROVIDER_MARKER]: 'cloudinary', CLOUDINARY_CLOUD_NAME: 'd', CLOUDINARY_API_KEY: '1', CLOUDINARY_API_SECRET: 's' });
    expect(ctx).not.toMatch(/\b(glm|kimi|claude|anthropic|sonnet|opus|gemini|grok|openai)\b/i);
  });
});
