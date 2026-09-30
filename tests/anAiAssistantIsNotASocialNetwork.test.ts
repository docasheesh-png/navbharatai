// AN AI ASSISTANT'S "CHAT" IS WITH THE AI (autopsy d8ed307a, 2026-09-30). A Bengali "personal AI Assistant"
// prompt whose English words were "Chat History", "Chat" and "Clear History" was classified SOCIAL, and
// the report recommended auth, a realtime feed, notifications and moderation for a single-user tool.

import { describe, it, expect } from 'vitest';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';

const BENGALI = 'আমি একটি ব্যক্তিগত AI Assistant Software তৈরি করতে চাই।\n- Chat History\n- Clear History\n'
  + 'Button, Microphone, Chat, Memory, File Upload, Settings এবং History\nUser-এর File, Chat এবং Memory';

describe('the chat in an AI assistant is not a social network', () => {
  it('the report prompt is no longer social', () => {
    expect(analyzeRequirementGaps(BENGALI).domain).not.toBe('social');
  });
  it('English phrasings too', () => {
    expect(analyzeRequirementGaps('Build a personal AI assistant with chat history and a settings page').domain).not.toBe('social');
    expect(analyzeRequirementGaps('a chatbot that keeps past conversations and messages').domain).not.toBe('social');
  });
  it('people talking to each other keep their meaning, even beside an AI assistant', () => {
    expect(analyzeRequirementGaps('an AI assistant plus group chat for my team with profiles').domain).toBe('social');
    expect(analyzeRequirementGaps('a chat app where friends message each other, with an AI assistant').domain).toBe('social');
    expect(analyzeRequirementGaps('a chat app with friends, followers and a feed').domain).toBe('social');
  });
});
