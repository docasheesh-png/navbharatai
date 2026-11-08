import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CHAT_CLIENT_DEADLINE_MS, CHAT_SERVER_DEADLINE_MS, CHAT_FIRST_CONTENT_MS, CHAT_PROVIDER_ATTEMPT_MS } from '../src/lib/chatDeadline';
import { FREE_ANSWER_REQUEST_MS, FREE_ANSWER_CHAT_REQUEST_MS } from '../src/server/lib/freeAnswerQuotaStore';
const source = (path: string) => readFileSync(path, 'utf8');
describe('ordinary chat deadlines stay coordinated', () => {
  it('leaves the browser alive through server fallback and terminal settlement', () => {
    expect(CHAT_SERVER_DEADLINE_MS).toBe(240_000);
    expect(CHAT_CLIENT_DEADLINE_MS).toBe(CHAT_SERVER_DEADLINE_MS + 15_000);
    expect(FREE_ANSWER_CHAT_REQUEST_MS).toBe(CHAT_SERVER_DEADLINE_MS);
    expect(FREE_ANSWER_REQUEST_MS).toBe(90_000);
    expect(CHAT_FIRST_CONTENT_MS).toBe(15_000);
    expect(CHAT_PROVIDER_ATTEMPT_MS).toBe(90_000);
  });
  it('uses the same deadline for streaming/nonstream browser requests and chat gateway ingress', () => {
    const client = source('src/hooks/useChatEngine.ts');
    expect(client).toContain('setTimeout(() => controller.abort(), CHAT_CLIENT_DEADLINE_MS)');
    expect(client).toContain('AbortSignal.timeout(CHAT_CLIENT_DEADLINE_MS)');
    expect(source('src/server/routes/chat.ts')).toContain('Date.now() + CHAT_SERVER_DEADLINE_MS');
  });
  it('keeps wallet-paid chat ownership longer than its deadline without changing generic locks', () => {
    const quota = source('src/server/lib/freeAnswerQuota.ts');
    expect(quota).toContain('acquireInflight(principal,owner,Date.now(),requestMs === CHAT_SERVER_DEADLINE_MS ? CHAT_CLIENT_DEADLINE_MS : INFLIGHT_TTL_MS)');
    expect(quota).toContain("options.surface === 'chat' ? CHAT_SERVER_DEADLINE_MS : FREE_ANSWER_REQUEST_MS");
    expect(quota).toContain('leaseUntil:deadlineAt');
    expect(quota).toContain('Math.max(0,deadlineAt-Date.now())');
    expect(source('src/server/lib/unifiedWallet/store.ts')).toContain('INFLIGHT_TTL_MS = 120_000');
  });
});
