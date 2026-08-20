import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as crypto from 'crypto';
import { gzipSync } from 'zlib';

/**
 * THE root cause of every failed publish, and Google named it for us on 2026-08-20:
 *
 *   Firebase Hosting file upload failed (HTTP 400):
 *   "Couldn't process request (status=400): content hash doesn't match content"
 *
 * Firebase Hosting's upload contract is: gzip the file, and the hash declared in `populateFiles` is
 * the SHA256 of THAT gzipped payload — the same bytes you then PUT. The code hashed the RAW buffer
 * and uploaded the GZIPPED one, so the two could never agree and every file of every publish was
 * rejected. It is why the admin's Hosting console showed the default site and three `nbai-*` sites
 * all reading "Waiting for your first release": a release had genuinely never happened, on any.
 */
const src = readFileSync(join(__dirname, '..', 'src/server/AgentV3/Deployment.ts'), 'utf8');

describe('the declared hash matches the bytes actually uploaded', () => {
  it('hashes the GZIPPED payload, never the raw file', () => {
    expect(src).toContain('const gz = await gzip(buf);');
    expect(src).toContain("crypto.createHash('sha256').update(gz)");
    // The exact line that caused it. If it returns, every publish silently 400s again.
    expect(src).not.toContain("crypto.createHash('sha256').update(buf)");
  });

  it('uploads the SAME buffer it hashed — not a second gzip of the same file', () => {
    // Re-gzipping is not guaranteed byte-identical (compression level and OS header can differ), so
    // computing the hash and the payload separately is the shape that made this bug possible at all.
    expect(src).toContain('const gz = hashToGzip.get(hash);');
    expect(src).not.toContain('hashToBuffer');
  });

  it('demonstrates the contract on real bytes — raw and gzip hashes genuinely differ', () => {
    // Guards against anyone "simplifying" this back on the assumption it makes no difference.
    const content = Buffer.from('<!doctype html><h1>piano</h1>');
    const gz = gzipSync(content);
    const rawHash = crypto.createHash('sha256').update(content).digest('hex');
    const gzHash = crypto.createHash('sha256').update(gz).digest('hex');
    expect(gzHash).not.toBe(rawHash);
    // And the hash of the uploaded payload is reproducible from that payload alone — which is exactly
    // what the server checks on its side.
    expect(crypto.createHash('sha256').update(gz).digest('hex')).toBe(gzHash);
  });
});
