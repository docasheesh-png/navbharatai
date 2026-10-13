import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { ChatCodeBlock } from './ChatCodeBlock';

describe('shared ChatCodeBlock', () => {
  it('is exported from the shared chat module and rendered through the one markdown renderer', () => {
    expect(typeof ChatCodeBlock).toBe('function');
    // 2026-10-13: the free chat no longer wires the block itself — ChatMarkdown.tsx does, for every surface.
    const renderer = readFileSync('src/components/chat/ChatMarkdown.tsx', 'utf8');
    expect(renderer).toContain("import { ChatCodeBlock } from './ChatCodeBlock';");
    const chat = readFileSync('src/components/ide/AIChat.tsx', 'utf8');
    expect(chat).toContain('<ChatMarkdown');
    expect(chat).not.toContain('const ChatCodeBlock');
    expect(chat).not.toContain('<ReactMarkdown');
  });
});
