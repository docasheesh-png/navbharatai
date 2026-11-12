import { describe, expect, it, vi } from 'vitest';
import { attachmentSessionForConversation, eraseConversationOriginals } from '../src/server/lib/proAttachmentLifecycle';

describe('verified original deletion scope', () => {
  it('uses independently checked owner, never a matching workspace prefix alone', () => {
    expect(attachmentSessionForConversation('a', 'agentv3-a-b-chat', { userId: 'a-b' })).toBeNull();
    expect(attachmentSessionForConversation('a-b', 'agentv3-a-b-chat', { userId: 'a-b' })).toBe('chat');
    expect(attachmentSessionForConversation('a', 'agentv3-anon-chat', { userId: 'anon' })).toBeNull();
  });
  it('supports legacy session aliases without guessing another owner', () => {
    expect(attachmentSessionForConversation('a', 'v3_chat', { userId: 'a' })).toBe('chat');
    expect(attachmentSessionForConversation('a', 'chat', { userId: 'a' })).toBe('chat');
    expect(attachmentSessionForConversation('a', 'agentv3-other-chat', { userId: 'a' })).toBeNull();
    expect(attachmentSessionForConversation('a', '../bad', { userId: 'a' })).toBeNull();
  });
  it('uses explicit message identity only and waits for deletion success', async () => {
    const store = { list: vi.fn().mockResolvedValue([]), erase: vi.fn().mockRejectedValue(new Error('storage down')) };
    await expect(eraseConversationOriginals(store, 'a', 'chat', '123', true)).rejects.toThrow('storage down');
    expect(store.erase).toHaveBeenCalledWith('a', { sessionId: 'chat', messageId: '123' });
  });
  it('does not erase all previous turns when unsend identity is absent', async () => {
    const store = { list: vi.fn().mockResolvedValue([{ sessionId: 'chat', messageId: '123' }]), erase: vi.fn() };
    await expect(eraseConversationOriginals(store, 'a', 'chat', undefined, true)).rejects.toThrow('could not be identified');
    expect(store.erase).not.toHaveBeenCalled();
  });
  it('fences whole chat for explicit chat deletion only', async () => {
    const store = { list: vi.fn(), erase: vi.fn().mockResolvedValue(undefined) };
    await eraseConversationOriginals(store, 'a', 'chat');
    expect(store.erase).toHaveBeenCalledWith('a', { sessionId: 'chat' });
  });
  it('never broad-erases owner data when legacy chat identity is unknown', async () => {
    const store = { list: vi.fn().mockResolvedValue([{ sessionId: 'other', messageId: '123' }]), erase: vi.fn() };
    await expect(eraseConversationOriginals(store, 'a', null)).rejects.toThrow('could not be identified');
    expect(store.erase).not.toHaveBeenCalled();
  });
});
