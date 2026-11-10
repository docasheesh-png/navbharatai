import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { unavailableChatReply, CHAT_ROUTE_UNAVAILABLE } from '../src/lib/chatRouteOutcome';
import { FIXED_TEXT_CHAIN } from '../src/server/AI/fixedTextChain';
import { redactProviderError, redactProvidersText } from '../src/server/lib/providerRedaction';
import { QUBAX_TRIES_PER_TURN } from '../src/server/lib/qubaxMarket';

const read = (path: string) => readFileSync(path, 'utf8');

describe('admin test chat does not change user chat', () => {
  it('keeps end-user unavailable chat text brand-safe and unchanged', () => {
    expect(unavailableChatReply()).toEqual({
      ok: false,
      code: CHAT_ROUTE_UNAVAILABLE,
      reply: 'The AI service is temporarily unavailable. Please try again later.',
    });
    const chat = read('src/server/routes/chat.ts');
    expect(chat).toContain('The AI service is temporarily unavailable. Please try again later.');
    expect(chat).toContain('No verified free model is currently available. Please try again later.');
    expect(chat).toContain('engine went quiet before finishing this answer, so it stops here. Ask again and it will pick the thread back up.');
    expect(chat).toContain('WHITE-LABEL LAW');
    expect(chat).not.toContain('testChatBotDiagnostic');
    expect(chat).not.toContain('/api/admin/test-chat-bot');
    expect(chat).not.toContain('formatTestChatDiagnostic');
    expect(redactProvidersText('openai claude failed')).not.toMatch(/openai|claude/i);
    expect(redactProviderError('gemini 401 from generativelanguage.googleapis.com')).not.toMatch(/gemini|googleapis/i);
  });
  it('does not rewrite the user chat provider order or import the user chain orchestrator', () => {
    expect(FIXED_TEXT_CHAIN).toEqual(['glm45', 'glm47', 'groq', 'cloudflare', 'openrouter', 'mitrify', 'qubax', 'cheapinf', 'llama8b', 'dsv4flash', 'gpt5nano', 'glmflashx', 'geminipaid']);
    const impl = read('src/server/lib/testChatBot.ts');
    expect(impl).not.toMatch(/runFreeChain\b|orderForRoute\b|FIXED_TEXT_CHAIN/);
    expect(read('src/server/AI/FreeChain/runtime.ts')).not.toContain('runTestChat');
    expect(read('src/server/AI/FreeChain/runtime.ts')).not.toContain('onHttpError');
    expect(read('src/server/AI/FreeChain/runtime.ts')).not.toContain('adminErrorDetail');
    expect(read('src/server/AI/InferenceGateway/qubaxTransport.ts')).not.toContain('onHttpError');
    expect(read('src/server/AI/Router/AIRouter.ts')).not.toContain('runTestChat');
    expect(read('src/components/admin/TestChatBotPanel.tsx')).not.toMatch(/localStorage|sessionStorage|\/api\/chat|useChatEngine/);
  });
  it('keeps the shared provider-id contract imported only by the admin Test Chat Bot panel on the client', () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
    const files = walk('src').filter(path => /\.(?:ts|tsx)$/.test(path) && !path.startsWith('src/server/') && !/\.test\.[tj]sx?$/.test(path));
    const importers = files.filter(path => /(?:from\s+|import\s*\(\s*)['"][^'"]*\/testChatBot['"]/.test(read(path)));
    expect(importers).toEqual(['src/components/admin/TestChatBotPanel.tsx']);
  });

  it('keeps user-chat Qubax market auto-select and three tries unchanged', () => {
    expect(QUBAX_TRIES_PER_TURN).toBe(3);
    const runtime = read('src/server/AI/FreeChain/runtime.ts');
    const qubax = read('src/server/lib/qubax.ts');
    const market = read('src/server/lib/qubaxMarket.ts');
    expect(market).toContain('export const QUBAX_TRIES_PER_TURN = 3');
    expect(qubax).toContain('readQubaxMarketPlan');
    expect(qubax).toContain('marketTries');
    expect(qubax).toContain('qubax-tries-exhausted');
    expect(qubax).toContain('QUBAX_TRIES_PER_TURN');
    expect(runtime).toContain('attemptKey ?? `${requestId}:qubax`');
    expect(runtime).not.toContain('onHttpError');
    expect(runtime).not.toContain('onAttemptError');
    expect(runtime).not.toContain('adminErrorDetail');
    expect(runtime).not.toContain('runTestChat');
    expect(read('src/server/AI/InferenceGateway/qubaxTransport.ts')).not.toContain('onAttemptError');
    expect(read('src/server/lib/testChatBot.ts')).not.toMatch(/runFreeChain\b|orderForRoute\b|FIXED_TEXT_CHAIN/);
  });
});
