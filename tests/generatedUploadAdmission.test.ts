import { describe, it, expect, vi } from 'vitest';
import { build } from 'esbuild';
import express from 'express';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { generateStorageIntegration } from '../src/server/lib/StorageGenerator';

async function loadRecipe(provider: 's3' | 'cloudinary') {
  const output = await build({
    stdin: { contents: generateStorageIntegration(provider).files['server/routes/upload.ts'], loader: 'ts', resolveDir: process.cwd() },
    platform: 'node', format: 'cjs', bundle: true, write: false, external: ['express', 'node:crypto'],
    plugins: [{ name: 'offline-storage', setup(b) {
      b.onResolve({ filter: /^(@aws-sdk\/|cloudinary$)/ }, args => ({ path: args.path, namespace: 'offline' }));
      b.onLoad({ filter: /.*/, namespace: 'offline' }, args => ({ contents: args.path === 'cloudinary'
        ? 'export const v2 = { config() {}, uploader: { upload_stream(params, done) { const stream = { once() {}, destroy() {}, end(bytes) { globalThis.__uploadProof = { ...params, bytes: bytes.length }; done(null, { secure_url: "https://storage.invalid/file", public_id: "fixture" }); } }; return stream; } } };'
        : args.path.includes('presigner')
          ? 'export async function getSignedUrl(client, command, options) { globalThis.__uploadProof = { input: command.input, options }; return "https://storage.invalid/upload"; }'
          : 'export class S3Client { constructor(input) {} } export class PutObjectCommand { constructor(input) { this.input = input; } }' }));
    } }],
  });
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', output.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  return module.exports as { uploadRouter: express.Router; configureUploadAccess: (access: any) => void };
}

describe.each(['s3', 'cloudinary'] as const)('generated %s upload admission', (provider) => {
  it('refuses missing auth/quota wiring, anonymous callers, invalid sizes and exhausted quota before signing', async () => {
    vi.stubEnv('CLOUDINARY_UPLOAD_PRESET', 'restricted-signed');
    const recipe = await loadRecipe(provider);
    const app = express(); app.use(express.json()); app.use('/api/upload', recipe.uploadRouter);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(r => server.once('listening', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/upload/${provider === 's3' ? 'presign' : 'file'}`;
    const call = (extra: any = {}) => fetch(url, { method: 'POST', headers: { 'content-type': provider === 's3' ? 'application/json' : (extra.contentType ?? 'image/png') }, body: provider === 's3' ? JSON.stringify({ filename: 'photo.png', size: 12, contentType: 'image/png', uid: 'forged-owner', ...extra }) : Buffer.alloc(extra.size ?? 12) });
    const reserve = vi.fn(async () => true);
    try {
      (globalThis as any).__uploadProof = undefined;
      expect((await call()).status).toBe(503);
      recipe.configureUploadAccess({ getUser: async () => null, reserveBytes: reserve });
      expect((await call()).status).toBe(401);
      expect(reserve).not.toHaveBeenCalled();
      recipe.configureUploadAccess({ getUser: async () => ({ uid: 'verified-user' }), reserveBytes: reserve });
      expect((await call({ size: 11 * 1024 * 1024 })).status).toBe(provider === 's3' ? 400 : 413);
      expect((await call({ contentType: 'text/html' })).status).toBe(400);
      expect(reserve).not.toHaveBeenCalled();
      reserve.mockResolvedValueOnce(false);
      expect((await call()).status).toBe(429);
      expect((globalThis as any).__uploadProof).toBeUndefined();
      expect((await call()).status).toBe(200);
      expect(reserve).toHaveBeenLastCalledWith('verified-user', 12);
      const proof = (globalThis as any).__uploadProof;
      if (provider === 's3') {
        expect(proof.input.Key).toMatch(/^verified-user\//);
        expect(proof.input.ContentLength).toBe(12);
        expect(proof.options.signableHeaders.has('content-length')).toBe(true);
      } else {
        expect(proof.folder).toBe('uploads/verified-user');
        expect(proof.overwrite).toBe(false);
        expect(proof.bytes).toBe(12);
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
      vi.unstubAllEnvs(); delete (globalThis as any).__uploadProof;
    }
  });
});
