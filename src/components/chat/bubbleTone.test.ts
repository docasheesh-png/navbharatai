import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { USER_BUBBLE_TONE, ASSISTANT_BUBBLE_TONE } from './bubbleTone';

describe('shared chat-bubble tones', () => {
  it('use theme tokens: accent for the user, card for the assistant', () => {
    expect(USER_BUBBLE_TONE).toBe('bg-accent text-on-accent'); // aligned to the theme token (was bg-indigo-600)
    expect(ASSISTANT_BUBBLE_TONE).toBe('bg-card text-body');
  });

  it('the Pro builder bubbles read their tone from the shared module', () => {
    const panel = readFileSync('src/components/agentv3/AgentV3Panel.tsx', 'utf8');
    expect(panel).toContain("from '../chat/bubbleTone'");
    expect(panel).toContain('${USER_BUBBLE_TONE} rounded-2xl rounded-br-sm');
    expect(panel).toContain('${ASSISTANT_BUBBLE_TONE} rounded-2xl rounded-bl-sm');
  });

  it('the IDE chat bubbles read their tone from the shared module too', () => {
    const chat = readFileSync('src/components/ide/AIChat.tsx', 'utf8');
    expect(chat).toContain("from '../chat/bubbleTone'");
    expect(chat).toContain('`${USER_BUBBLE_TONE} rounded-tr-none`');
    expect(chat).toContain('`${ASSISTANT_BUBBLE_TONE} border border-line rounded-tl-none');
  });
});
