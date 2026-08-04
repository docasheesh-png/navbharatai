import { describe, it, expect } from 'vitest';
import { generateFileUploadIntegration } from './FileUploadGenerator';

describe('generateFileUploadIntegration', () => {
  const c = generateFileUploadIntegration();
  const server = c.files['server/lib/upload.ts'];

  it('emits detectFileType + validateUpload, dependency-free and server-side', () => {
    expect(server).toContain('export function detectFileType(');
    expect(server).toContain('export function validateUpload(');
    expect(server).not.toContain('import ');
    expect(c.files['src/lib/upload.ts']).toBeUndefined();
    expect((c as { dependency?: unknown }).dependency).toBeUndefined();
  });

  it('detects by magic bytes (real content), covering the common web types', () => {
    expect(server).toContain('0x89'); // PNG
    expect(server).toContain('0xff && buf[1] === 0xd8'); // JPEG
    expect(server).toContain("=== 'RIFF'"); // WebP
    expect(server).toContain("=== 'ftyp'"); // MP4
    expect(server).toContain('0x50 && buf[1] === 0x4b'); // ZIP
  });

  it('enforces a size cap and a type allowlist, returning an honest error', () => {
    expect(server).toContain('buf.length > opts.maxBytes');
    expect(server).toContain('opts.allowed.includes(type)');
    expect(server).toContain('ok: false');
    expect(server).toContain('ok: true');
  });

  it('never writes .env.example and only the server file', () => {
    expect(c.files['.env.example']).toBeUndefined();
    expect(Object.keys(c.files)).toEqual(['server/lib/upload.ts']);
    expect(c.instructions.toLowerCase()).toContain('magic bytes');
  });
});
