/**
 * Admin-only error text for Pro Chain V2 — never a secret, never longer than one report line.
 *
 * The provider message, HTTP status, code, latency and model are what an autopsy needs; a bearer
 * token, an API key or a signed URL is never needed. Every configured key value is removed by exact
 * match first, then anything shaped like a credential. PURE.
 */
import { redactSecrets as redactSharedSecrets } from '../SecretRedactor';

const SHAPES: readonly RegExp[] = [
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(sk|pk|rk|mtf_live|mtf_test|qbx|qubax|sr1|r1)[-_][A-Za-z0-9._-]{8,}/gi,
  /\b(api[_-]?key|token|secret|password|authorization)\s*[=:]\s*["']?[^\s"',;]{6,}/gi,
  /\b[A-Za-z0-9_-]{32,}\b/g,
  /([?&](key|token|sig|signature|api_key)=)[^&\s]+/gi,
];

/**
 * Locked plan item 5 (weakness audit P1-6): this used to be a private copy with its own short pattern list, so a JWT,
 * a GitHub/AWS/Google key or a password inside a URL was masked by the shared redactor and NOT here. Now the shared
 * redactor (SecretRedactor.ts) runs first, and this module adds only what an admin error line needs on top: exact
 * configured values and the stricter shapes below. The line is also kept long enough for the useful tail of a
 * provider's error (it was cut at 600).
 */
export const ERROR_LINE_MAX = 1200;
export function redactSecrets(text: string, secrets: readonly string[] = []): string {
  let out = String(text ?? '');
  for (const s of secrets) {
    const v = String(s ?? '').trim();
    if (v.length >= 6) out = out.split(v).join('[redacted]');
  }
  out = redactSharedSecrets(out);
  for (const re of SHAPES) out = out.replace(re, (m, p1) => (typeof p1 === 'string' && /^[?&]/.test(p1) ? `${p1}[redacted]` : '[redacted]'));
  return out.length > ERROR_LINE_MAX ? `${out.slice(0, ERROR_LINE_MAX - 1)}…` : out;
}

/** The structured facts of one failed supplier call, from whatever the SDK threw. PURE. */
export function supplierErrorFacts(err: unknown): { status?: number; code?: string; message: string } {
  const e = (err ?? {}) as { status?: unknown; code?: unknown; message?: unknown; error?: { message?: unknown; code?: unknown } };
  const status = Number.isInteger(e.status) ? Number(e.status) : undefined;
  const codeRaw = e.code ?? e.error?.code;
  const code = codeRaw === undefined || codeRaw === null ? undefined : String(codeRaw).slice(0, 80);
  const message = String(e.error?.message ?? e.message ?? err ?? 'unknown error');
  return { ...(status !== undefined ? { status } : {}), ...(code ? { code } : {}), message };
}
