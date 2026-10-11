import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { ChatCodeBlock } from './ChatCodeBlock';

describe('shared ChatCodeBlock', () => {
  it('is exported from the shared chat module and used by the IDE chat (no local copy left)', () => {
    expect(typeof ChatCodeBlock).toBe('function');
    const chat = readFileSync('src/components/ide/AIChat.tsx', 'utf8');
    expect(chat).toContain("import { ChatCodeBlock } from '../chat/ChatCodeBlock';");
    expect(chat).not.toContain('const ChatCodeBlock');
  });
});
