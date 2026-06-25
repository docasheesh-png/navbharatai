import { callGemini, callClaude, callGroq } from '../lib/aiCalls';
import { retrieveKnowledge, formatKnowledge } from './knowledge';
import { CREATOR_IDENTITY } from '../lib/prompts';
import type { ProfessionalConfig } from './types';

export interface ProfessionalTurn { role: 'user' | 'assistant'; content: string; }

/**
 * Assemble a professional's full system prompt: persona, disclaimer, the knowledge
 * retrieved for this message, and the shared creator-attribution instruction (so every
 * professional credits Dr Asheesh and team consistently). Pure — exported so the
 * assembly (and the attribution injection) is unit-testable.
 */
export function buildProfessionalSystemPrompt(config: ProfessionalConfig, kbBlock = ''): string {
  return [config.systemPrompt, config.disclaimer, kbBlock, CREATOR_IDENTITY]
    .filter(Boolean)
    .join('\n\n');
}

/** Resilient model call: Gemini → Claude → Grok. System prompt is honoured by
 * Gemini/Claude; for the Grok fallback it is prepended to the message. */
async function resilientCall(systemPrompt: string, prompt: string): Promise<string> {
  try { const t = await callGemini(prompt, undefined, [], systemPrompt); if (t && t.trim()) return t; } catch { /* fall through */ }
  try { const t = await callClaude(prompt, undefined, [], systemPrompt); if (t && t.trim()) return t; } catch { /* fall through */ }
  try { const t = await callGroq(`${systemPrompt}\n\n${prompt}`, undefined, []); if (t && t.trim()) return t; } catch { /* fall through */ }
  throw new Error('All AI providers failed for this professional.');
}

/**
 * Run one professional chat turn: ground the persona in the config's knowledge
 * base (retrieved for this message), fold in recent conversation, call a model
 * resiliently, and return the reply. History format is normalised here, so
 * provider history-shape quirks can never break it.
 */
export async function runProfessionalChat(
  config: ProfessionalConfig,
  message: string,
  history: ProfessionalTurn[] = [],
): Promise<string> {
  const kbBlock = formatKnowledge(retrieveKnowledge(config.knowledge, message));
  const systemPrompt = buildProfessionalSystemPrompt(config, kbBlock);

  const transcript = (history || [])
    .slice(-8)
    .map((m) => `${m.role === 'user' ? 'User' : config.name}: ${m.content}`)
    .join('\n');
  const prompt = transcript ? `Conversation so far:\n${transcript}\n\nUser: ${message}` : message;

  return resilientCall(systemPrompt, prompt);
}
