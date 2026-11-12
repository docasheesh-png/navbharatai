/** Attachment scope selection is NOT workspace authorization. Call only after the
 * conversation's persisted owner has been checked; storage always receives verified UID. */
export function attachmentSessionForConversation(
  uid: string, conversationId: string, record: { userId: string; workspaceId?: string },
): string | null {
  if (record.userId !== uid) return null;
  const id = record.workspaceId || conversationId;
  const prefix = `agentv3-${uid}-`;
  const session = id.startsWith(prefix) ? id.slice(prefix.length)
    : id.startsWith('v3_') ? id.slice(3)
      : id.startsWith('agentv3-') ? null : id;
  return session && /^[\w-]{1,160}$/.test(session) ? session : null;
}

export interface AttachmentLifecycleStore {
  list(uid: string, sessionId?: string): Promise<Array<{ sessionId: string; messageId: string }>>;
  erase(uid: string, scope: { sessionId: string; messageId?: string }): Promise<void>;
}

/** Must finish before transcript removal, so failed storage deletion remains retryable. */
export async function eraseConversationOriginals(
  store: AttachmentLifecycleStore, uid: string, sessionId: string | null,
  messageId?: unknown, unsend = false,
): Promise<void> {
  if (!sessionId) {
    // Unknown/legacy identity must not cause a broad erase of this owner's other chats.
    if ((await store.list(uid)).length) throw new Error('The attachment chat could not be identified. Please remove its files before deleting this chat.');
    return;
  }
  if (unsend && (typeof messageId !== 'string' || !/^[\w-]{1,160}$/.test(messageId))) {
    if ((await store.list(uid, sessionId)).length) throw new Error('The attached message could not be identified. Reopen the chat and retry Unsend.');
    return;
  }
  await store.erase(uid, { sessionId, ...(unsend ? { messageId: messageId as string } : {}) });
}
