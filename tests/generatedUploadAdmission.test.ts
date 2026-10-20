import { describe, it, expect, vi } from 'vitest';
import { build } from 'esbuild';
import express from 'express';
import { createRequire } from 'node:module';
import { posix } from 'node:path';
import type { AddressInfo } from 'node:net';
import { generateStorageIntegration } from '../src/server/lib/StorageGenerator';

async function loadRecipe(provider: 's3' | 'cloudinary', providerFetch: typeof fetch) {
  const files = generateStorageIntegration(provider).files;
  const output = await build({
    stdin: { contents: files['server/routes/upload.ts'], sourcefile: 'server/routes/upload.ts', loader: 'ts', resolveDir: process.cwd() },
    platform: 'node', format: 'cjs', bundle: true, write: false, external: ['express', 'node:crypto'],
    plugins: [{ name: 'offline-storage', setup(b) {
      b.onResolve({ filter: /^\./ }, args => {
        const importer = args.importer.replace(process.cwd() + '/', '');
        const path = posix.normalize(posix.join(posix.dirname(importer), args.path)) + '.ts';
        return path in files ? { path, namespace: 'generated' } : undefined;
      });
      b.onLoad({ filter: /.*/, namespace: 'generated' }, args => ({ contents: files[args.path], loader: 'ts' }));
      b.onResolve({ filter: /^(@aws-sdk\/|cloudinary$)/ }, args => ({ path: args.path, namespace: 'offline' }));
      b.onLoad({ filter: /.*/, namespace: 'offline' }, args => ({ contents: args.path === 'cloudinary'
        ? 'export const v2 = { config() {}, uploader: { upload_stream(params, done) { return { end(bytes) { globalThis.__uploadProof = { ...params, bytes: bytes.length }; done(null, { secure_url: "https://storage.invalid/file", public_id: params.public_id }); } }; } } };'
        : 'export class S3Client { async send(command) { globalThis.__uploadProof = { ...command.input, bytes: command.input.Body.length }; } } export class PutObjectCommand { constructor(input) { this.input = input; } }' }));
    } }],
  });
  const module = { exports: {} as { uploadRouter: express.Router } };
  new Function('require', 'module', 'exports', 'fetch', output.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports, providerFetch);
  return module.exports;
}

describe.each(['s3', 'cloudinary'] as const)('generated %s upload admission', (provider) => {
  it('runs the emitted router: real-session verification, actual byte bounds and durable quota precede storage', async () => {
    const uid = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
    let authStatus = 200;
    let quotaStatus = 200;
    let allowed = true;
    const providerFetch = vi.fn(async (url: string | URL | Request) => String(url).endsWith('/auth/v1/user')
      ? new Response(JSON.stringify({ id: uid }), { status: authStatus })
      : new Response(JSON.stringify(allowed), { status: quotaStatus }));
    vi.stubEnv('SUPABASE_URL', ''); vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_ANON_KEY', ''); vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const recipe = await loadRecipe(provider, providerFetch as typeof fetch);
    const app = express(); app.use(express.json()); app.use('/api/upload', recipe.uploadRouter);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(r => server.once('listening', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/upload/file`;
    const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
    const call = (body = png, contentType = 'image/png', signedIn = true) => fetch(url, {
      method: 'POST', headers: { 'content-type': contentType, 'x-user-id': 'forged-owner', ...(signedIn ? { authorization: 'Bearer real-app-session' } : {}) }, body,
    });
    try {
      (globalThis as any).__uploadProof = undefined;
      expect((await call()).status).toBe(503);
      vi.stubEnv('SUPABASE_URL', 'https://app.invalid'); vi.stubEnv('SUPABASE_ANON_KEY', 'public-app-key');
      expect((await call(png, 'image/png', false)).status).toBe(401);
      expect(providerFetch).not.toHaveBeenCalled();
      authStatus = 401;
      expect((await call()).status).toBe(401);
      authStatus = 503;
      expect((await call()).status).toBe(503);
      authStatus = 200;
      expect((await call(Buffer.alloc(11 * 1024 * 1024))).status).toBe(413);
      expect((await call(png, 'text/html')).status).toBe(400);
      expect((await call(Buffer.from('<html>forged image</html>'))).status).toBe(400);
      expect(providerFetch.mock.calls.some(([u]) => String(u).includes('/rest/v1/rpc/'))).toBe(false);
      allowed = false;
      expect((await call()).status).toBe(429);
      expect((globalThis as any).__uploadProof).toBeUndefined();
      allowed = true; quotaStatus = 503;
      expect((await call()).status).toBe(503);
      expect((globalThis as any).__uploadProof).toBeUndefined();
      quotaStatus = 200;
      const result = await call();
      expect(result.status).toBe(200);
      const answer = await result.json();
      expect(answer.key).toMatch(new RegExp('^' + uid + '/'));
      const proof = (globalThis as any).__uploadProof;
      expect(proof.bytes).toBe(png.length);
      if (provider === 's3') {
        expect(proof.Key).toBe(answer.key);
        expect(proof.ContentLength).toBe(png.length);
        expect(proof.Body.equals(png)).toBe(true);
      } else {
        expect(proof.public_id).toBe(answer.key);
        expect(proof.overwrite).toBe(false);
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
      vi.unstubAllEnvs(); delete (globalThis as any).__uploadProof;
    }
  });
});
