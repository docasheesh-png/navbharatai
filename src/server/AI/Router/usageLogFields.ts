import type { ProviderUsage } from './ProviderTypes';

/** Only reported usage is measured. Missing counts are absent, never fabricated zeros. */
export function usageLogFields(usage: ProviderUsage | undefined):
  { usageMeasured: false } | { usageMeasured: true; inputTokens: number; outputTokens: number } {
  return usage
    ? { usageMeasured: true, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }
    : { usageMeasured: false };
}
