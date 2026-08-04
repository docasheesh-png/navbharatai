// Centralized safe error responses (SEC — admin 2026-07-19). Root-cause fix for the "verbose
// error leaks internals" class: many routes returned a raw `err.message` straight to the client
// (`res.status(500).json({ error: err.message })`). A raw error can leak internal file paths,
// stack fragments, upstream host names, database errors, or — worst for us — a third-party
// PROVIDER/vendor name (GLM / Kimi / Claude / Anthropic / E2B …), which also breaks the
// white-label law. This module gives every route ONE safe way to answer:
//
//   • the REAL error is always logged server-side (that is where the detail belongs);
//   • the CLIENT receives a curated, provider-anonymous message, never the raw internals;
//   • in development the detail is echoed back to aid debugging (never in production).
//
// It deliberately does NOT touch routes whose `err.message` is an intentionally-curated,
// user-facing message (build/validation guidance) — those pass a clean public message in.

import type { Response } from 'express';

/** True in the deployed environment (Cloud Run sets NODE_ENV=production). */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** Extract a plain string from an unknown thrown value (never throws itself). */
export function errToString(err: unknown): string {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  const msg = (err as { message?: unknown })?.message;
  if (typeof msg === 'string') return msg;
  try {
    return String(err);
  } catch {
    return '';
  }
}

// Vendor / model tokens that must NEVER reach an end user (white-label law). Case-insensitive.
const VENDOR_PATTERNS: RegExp[] = [
  /\bz\.?ai\b/gi,
  /\bglm[-\s]?[0-9.a-z]*/gi,
  /\bkimi[-\s]?[0-9.a-z]*/gi,
  /\bmoonshot\b/gi,
  /\banthropic\b/gi,
  /\bclaude[-\s]?[0-9.a-z]*/gi,
  /\bsonnet\b/gi,
  /\bopus\b/gi,
  /\bhaiku\b/gi,
  /\bgemini[-\s]?[0-9.a-z]*/gi,
  /\bvertex(?:\s*ai)?\b/gi,
  /\bgrok[-\s]?[0-9.a-z]*/gi,
  /\bxai\b/gi,
  /\bdeepseek\b/gi,
  /\bopenai\b/gi,
  /\bbedrock\b/gi,
  /\bE2B\b/g,
];

/**
 * Turn any raw error text into a client-safe string: strip URLs (incl. token-embedded clone
 * URLs), credentials/secrets, and every third-party vendor/model name, then cap the length.
 * Pure — unit-tested. This is the white-label + no-secret-leak backstop applied by construction.
 */
export function toSafeClientMessage(raw: unknown, fallback = 'Something went wrong. Please try again.'): string {
  let s = errToString(raw);
  if (!s) return fallback;
  s = s
    .replace(/https?:\/\/[^\s)]+/gi, '[link]')
    .replace(/x-access-token:[^@\s]+/gi, '[token]')
    .replace(/\b(bearer|token|key|secret|password|api[_-]?key)[\s:=]+[A-Za-z0-9._\-]{6,}/gi, '$1 [redacted]');
  for (const re of VENDOR_PATTERNS) s = s.replace(re, 'NavBharatAI');
  s = s.replace(/\s+/g, ' ').trim().slice(0, 200);
  return s || fallback;
}

/**
 * Send a safe error response. The real error is logged server-side; the client gets ONLY
 * `publicMessage` (which is itself passed through the vendor/secret redactor as a backstop).
 * In development the redacted raw detail is included to aid debugging — never in production.
 *
 * @param res            Express response
 * @param status         HTTP status code
 * @param publicMessage  Curated, user-safe message (no internal detail, no vendor name)
 * @param err            The caught error (logged server-side; dev-only echoed, redacted)
 * @param logContext     Optional short context string for the server log line
 */
export function sendSafeError(
  res: Response,
  status: number,
  publicMessage: string,
  err?: unknown,
  logContext?: string,
): Response {
  const rawDetail = errToString(err);
  // Server-side log carries the FULL raw detail — this is the right place for it.
  console.error(`[HTTP ${status}] ${logContext ? logContext + ': ' : ''}${publicMessage}${rawDetail ? ' — ' + rawDetail : ''}`);
  const safePublic = toSafeClientMessage(publicMessage, publicMessage);
  const body: { error: string; detail?: string } = { error: safePublic };
  // Dev-only debugging echo (still redacted so a leak can't slip through in a shared dev log).
  if (!isProduction() && rawDetail) body.detail = toSafeClientMessage(rawDetail, rawDetail);
  return res.status(status).json(body);
}
