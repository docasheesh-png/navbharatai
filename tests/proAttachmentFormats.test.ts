import { describe, it, expect } from 'vitest';
import { validateAttachment, decodeAttachmentText, MAX_ATTACHMENT_BYTES } from '../src/server/lib/uploadValidation';
import { MAX_ATTACHMENT_BYTES as CLIENT_MAX, checkAttachmentSizes } from '../src/lib/attachmentLimits';
import { extractDocumentText, buildDocumentContext } from '../src/server/lib/attachmentText';

const file = (name: string, text: string | Buffer, type = 'application/octet-stream') => ({ name, type, base64: Buffer.from(text).toString('base64') });

describe('Pro broad file picker: bounded readable text, not executable content', () => {
  it.each(['index.html', 'page.HTML', 'component.vue', 'style.svelte', 'Dockerfile', 'README', 'config.custom', 'entry.mjs', 'entry.cjs'])('reads %s with generic MIME', async name => {
    const source = '<script>alert("not executed")</script>\nनमस्ते 👋';
    const attachment = file(name, source);
    expect(validateAttachment(attachment)).toEqual({ ok: true });
    expect(await extractDocumentText(attachment)).toBe(source);
  });

  it('keeps HTML as source text, never a rendered document', async () => {
    const text = await buildDocumentContext([file('page.html', '<html><script>throw new Error("never run")</script></html>', 'text/html')]);
    expect(text).toContain('```\n<html>');
    expect(text).toContain('never run');
  });

  it.each([Buffer.from([0, 1, 2]), Buffer.from([0xff, 0xfe, 0xfd])])('rejects unknown binary bytes honestly', async bytes => {
    const attachment = file('unknown.format', bytes);
    expect(validateAttachment(attachment).ok).toBe(false);
    expect(await extractDocumentText(attachment)).toBeNull();
    expect(await buildDocumentContext([attachment])).toContain('could not read this file type as text');
  });

  it.each(['program.exe', 'module.wasm', 'library.dll'])('does not accept %s as a source document even with a text MIME', async name => {
    expect(validateAttachment(file(name, 'printable header', 'text/plain')).ok).toBe(false);
    expect(await extractDocumentText(file(name, 'printable header', 'text/plain'))).toBeNull();
  });

  it.each(['../file.html', '/file.html', 'folder\\file.html', 'a\nfile.html', '..'])('rejects unsafe attachment name %s', name => {
    expect(validateAttachment(file(name, 'hello')).ok).toBe(false);
  });

  it('uses the same server/client size ceiling without increasing server allocation', () => {
    expect(CLIENT_MAX).toBe(15 * 1024 * 1024);
    expect(MAX_ATTACHMENT_BYTES).toBe(CLIENT_MAX);
    expect(checkAttachmentSizes([{ name: 'large.html', size: CLIENT_MAX + 1 }]).ok).toBe(false);
    const attachment = file('large.custom', Buffer.alloc(CLIENT_MAX + 1, 97));
    expect(validateAttachment(attachment).reason).toContain('too large');
  });

  it('does not mistake malformed base64 or invalid UTF-8 for readable source', () => {
    expect(decodeAttachmentText('not base64!')).toBeNull();
    expect(decodeAttachmentText('////')).toBeNull();
    expect(decodeAttachmentText('AA==')).toBeNull();
  });
});
