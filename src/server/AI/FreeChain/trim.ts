import { estimateTokens } from '../../lib/metrics';
export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
/** Approximate context/quota admission with UTF-8 allowance; NOT a billing or tokenizer guarantee. */
export function estimateInputTokens(messages: ChatMessage[]): number { const text = JSON.stringify(messages); return estimateTokens(text) + Math.ceil((Buffer.byteLength(text, 'utf8') - text.length) / 2) + 256; }
export function trimForRung(message: string, history: unknown[], systemPrompt: string, maxInputTokens: number): { prompt: string; systemPrompt: string; inputTokens: number } | null {
  const turns: ChatMessage[] = (history ?? []).filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map(m => ({ role: (m.sender === 'user' || m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant', content: String(m.text ?? m.content ?? '') }));
  // Preserve complete messages and full system instructions, not substrings/surrogate fragments.
  let kept = turns;
  for (;;) {
    const prompt = kept.length ? `${kept.map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`).join('\n')}\nUser: ${message}` : message;
    const inputTokens = estimateInputTokens([{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }]);
    if (inputTokens <= maxInputTokens) return { prompt, systemPrompt, inputTokens };
    if (!kept.length) return null;
    kept = kept.slice(1);
  }
}
