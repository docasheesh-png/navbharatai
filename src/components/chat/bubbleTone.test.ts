import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { USER_BUBBLE_TONE, ASSISTANT_BUBBLE_TONE } from './bubbleTone';

describe('shared chat-bubble tones', () => {
  it('keep the exact classes the chat UIs used, so adopting them is pixel-identical', () => {
    expect(USER_BUBBLE_TONE).toBe('bg-indigo-600 text-on-accent');
    expect(ASSISTANT_BUBBLE_TONE).toBe('bg-card text-body');
  });

  it('the Pro builder bubbles read their tone from the shared module', () => {
    const panel = readFileSync('src/components/agentv3/AgentV3Panel.tsx', 'utf8');
    expect(panel).toContain("from '../chat/bubbleTone'");
    expect(panel).toContain('${USER_BUBBLE_TONE} rounded-2xl rounded-br-sm');
    expect(panel).toContain('${ASSISTANT_BUBBLE_TONE} rounded-2xl rounded-bl-sm');
  });
});
