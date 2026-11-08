import type { ProviderUsage } from './ProviderTypes';

const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const consistentTotal = (usage: ProviderUsage | undefined, total: unknown): ProviderUsage | undefined =>
  usage && (total === undefined || (count(total) && total === usage.inputTokens + usage.outputTokens)) ? usage : undefined;

export const openAiStreamFinished = (reason: unknown): boolean => typeof reason === 'string'
  && ['stop', 'length', 'tool_calls', 'content_filter', 'function_call'].includes(reason);

export const vertexStreamFinished = (reason: unknown): boolean => typeof reason === 'string'
  && ['STOP', 'MAX_TOKENS', 'SAFETY', 'RECITATION', 'LANGUAGE', 'OTHER', 'BLOCKLIST', 'PROHIBITED_CONTENT',
    'SPII', 'MALFORMED_FUNCTION_CALL', 'IMAGE_SAFETY', 'UNEXPECTED_TOOL_CALL', 'IMAGE_PROHIBITED_CONTENT',
    'NO_IMAGE', 'IMAGE_RECITATION', 'IMAGE_OTHER'].includes(reason);

/** Accounting needs both reported counters. Partial/null/string values are not zero usage. */
export function completeStreamUsage(inputTokens: unknown, outputTokens: unknown): ProviderUsage | undefined {
  return count(inputTokens) && count(outputTokens) ? { inputTokens, outputTokens } : undefined;
}

export function openAiStreamUsage(raw: unknown): ProviderUsage | undefined {
  const usage = raw as Record<string, unknown> | null | undefined;
  return usage && typeof usage === 'object'
    ? consistentTotal(completeStreamUsage(usage.prompt_tokens, usage.completion_tokens), usage.total_tokens) : undefined;
}

/** Google reports generated text and thinking separately; both are billed output. */
export function vertexStreamUsage(raw: unknown): ProviderUsage | undefined {
  const usage = raw as Record<string, unknown> | null | undefined;
  if (!usage || typeof usage !== 'object') return undefined;
  const thoughts = usage.thoughtsTokenCount === undefined ? 0 : usage.thoughtsTokenCount;
  if (!count(usage.candidatesTokenCount) || !count(thoughts)) return undefined;
  // No tools are requested by this adapter. Unexpected tool-prompt usage needs its own pricing review.
  if (usage.toolUsePromptTokenCount !== undefined && usage.toolUsePromptTokenCount !== 0) return undefined;
  return consistentTotal(completeStreamUsage(usage.promptTokenCount, usage.candidatesTokenCount + thoughts), usage.totalTokenCount);
}
