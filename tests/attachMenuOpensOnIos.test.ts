/** Free/Pro paperclip must open the native picker on iOS Safari (admin 2026-10-26). */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AttachMenu, ATTACH_FILE_INPUT_CLASS } from '../src/components/AttachMenu';

const source = readFileSync(join(__dirname, '../src/components/AttachMenu.tsx'), 'utf8');

describe('AttachMenu opens the file picker on iOS Safari', () => {
  it('never hides file inputs with display:none / Tailwind hidden (iOS ignores .click() on those)', () => {
    expect(ATTACH_FILE_INPUT_CLASS).toContain('opacity-0');
    expect(ATTACH_FILE_INPUT_CLASS.split(/\s+/)).not.toContain('hidden');
    expect(source).not.toMatch(/type="file"[^>]*className="hidden"/);
    expect(source).not.toMatch(/className="hidden"[^>]*type="file"/);
    const html = renderToStaticMarkup(React.createElement(AttachMenu, {
      onFiles: () => {}, fileAccept: 'image/*',
    }));
    expect(html).toContain('type="file"');
    expect(html).toContain('opacity-0');
    expect(html).not.toMatch(/type="file"[^>]*class="[^"]*\bhidden\b/);
  });

  it('clicks the file input in the same user-gesture turn (no setTimeout)', () => {
    expect(source).not.toMatch(/setTimeout\s*\(\s*\(\)\s*=>\s*ref\.current\?\.click/);
    expect(source).toMatch(/ref\.current\?\.click\(\)/);
    // Close the sheet after the click so the gesture is not spent on setState first.
    const pick = source.slice(source.indexOf('const pick'), source.indexOf('const handleChange'));
    expect(pick.indexOf('ref.current?.click()')).toBeGreaterThan(-1);
    expect(pick.indexOf('ref.current?.click()')).toBeLessThan(pick.indexOf('setOpen(false)'));
  });

  it('keeps the sheet readable on a phone (fixed escape, not clipped in the tools strip)', () => {
    expect(source).toContain('data-attach-menu');
    expect(source).toContain('createPortal(');
    expect(source).toContain('document.body');
    expect(source).toContain('fixed z-[200]');
  });
});


describe('Pro native file selection regression', () => {
  it('places a full-size native input on each picker row and keeps it mounted until change', () => {
    expect(source).toContain('absolute inset-0 h-full w-full opacity-0 cursor-pointer');
    expect(source).toContain('accept={o.accept || undefined}');
    expect(source).toContain('onChange={handleChange}');
    expect(source).toContain("e.target.value = ''");
    expect(source).toContain('onPointerDown={(event) => event.stopPropagation()}');
  });
  it('does not filter Pro HTML or unknown file extensions out of the operating system picker', () => {
    const pro = readFileSync(join(__dirname, '../src/components/agentv3/AgentV3Panel.tsx'), 'utf8');
    expect(pro).toContain('fileAccept=""');
    expect(pro).toContain('stageAttachmentFiles(files, Array.from(list))');
    expect(pro).toContain('reader.onerror = () => reject(');
    expect(pro).toContain('reader.onabort = () => reject(');
  });
});
