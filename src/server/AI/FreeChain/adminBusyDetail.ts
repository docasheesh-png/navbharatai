/**
 * Admin-only Free Chat busy detail. Never includes API keys or raw provider payloads.
 * Ordinary users keep the friendly busy line only.
 */
import { cheaperInferenceAdminStatus } from '../../lib/cheaperInferencePolicy';
import type { FreeChainContext } from './rollout';

export type AdminBusyAttempt = { provider: string; reason: string; entered?: boolean };

/** Safe diagnostic fragment for verified admins. Returns undefined for non-admins. */
export function adminBusyDetail(input: {
  context: FreeChainContext;
  earlyReason?: string;
  attempts?: readonly AdminBusyAttempt[];
  env?: NodeJS.ProcessEnv;
}): string | undefined {
  if (input.context.isAdmin !== true) return undefined;
  const status = cheaperInferenceAdminStatus(input.env);
  const parts: string[] = [
    `CHEAPERINFERENCE=${status.mode}`,
    `keyConfigured=${status.apiKeyConfigured ? 'yes' : 'no'}`,
    `model=${sanitizeToken(status.defaultModel)}`,
  ];
  if (input.earlyReason) parts.push(`early=${sanitizeToken(input.earlyReason)}`);
  const attempts = input.attempts ?? [];
  if (attempts.length) {
    parts.push(`attempts=${attempts.map(a => `${sanitizeToken(a.provider)}:${sanitizeToken(a.reason)}`).join(',')}`);
  } else if (!input.earlyReason) {
    parts.push('attempts=(none)');
  }
  // Hard cap + strip anything that looks like a secret.
  return redactSecrets(parts.join(' | ')).slice(0, 500);
}

/** Append admin diagnostic under the friendly busy line. Non-admins unchanged. */
export function withAdminBusyDetail(friendlyBusy: string, detail: string | undefined): string {
  if (!detail) return friendlyBusy;
  return `${friendlyBusy}\n\n[admin diagnostic] ${redactSecrets(detail).slice(0, 500)}`;
}

function sanitizeToken(value: string): string {
  return String(value ?? '')
    .replace(/[^\w.:@/=+-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80) || 'unknown';
}

function redactSecrets(text: string): string {
  return text
    .replace(/\bci_live_[A-Za-z0-9_-]+\b/g, 'ci_live_[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[REDACTED]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]');
}
