/**
 * Router One (OpenAI-compatible aggregator) — Pro builder backend (owner 2026-11-01).
 *
 *  • PIN  : z@gmail.com (isZTestAccount) builds ONLY on Router One. No Surplus, no GLM/Kimi/Weak
 *           ladder, no Claude. If Router One fails, the build fails (raw error shown to that profile).
 *  • PUBLIC: everyone else keeps Weak = Surplus. Router One is inserted as a fallback AFTER Surplus
 *           (Surplus → Router One → Weak ladder) ONLY when ROUTER_ONE_ENABLED=on. Default OFF ⇒
 *           behaviour for every other user is byte-for-byte unchanged.
 *
 * Env (read per call, so a Cloud Run env change applies on the next revision):
 *   ROUTER_ONE_API_KEY   Bearer key (required for both pin and public fallback)
 *   ROUTER_ONE_ENABLED   on|true|1 ⇒ public fallback after Surplus (pin works without it)
 *   ROUTER_ONE_MODEL     comma list of Router One model ids, tried in order (all Router One)
 *   ROUTER_ONE_BASE_URL  default https://api.router.one/v1
 *   ROUTER_ONE_PIN       off ⇒ z@gmail.com goes back to the old Surplus-only path
 *
 * Brand: the provider label is the neutral "ENGINE_R1"; nothing here reaches end-user copy.
 */
import { isZTestAccount } from '../../lib/zTestAccount';

export const ROUTER_ONE_LABEL = 'ENGINE_R1';
export const ROUTER_ONE_DEFAULT_BASE_URL = 'https://api.router.one/v1';
export const ROUTER_ONE_DEFAULT_MODEL = 'deepseek-v4.1-flash';

const on = (v: unknown): boolean => ['on', 'true', '1', 'yes'].includes(String(v ?? '').trim().toLowerCase());
const off = (v: unknown): boolean => ['off', 'false', '0', 'no'].includes(String(v ?? '').trim().toLowerCase());

export function routerOneApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.ROUTER_ONE_API_KEY ?? '').trim();
}
export function routerOneBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.ROUTER_ONE_BASE_URL ?? '').trim() || ROUTER_ONE_DEFAULT_BASE_URL;
}
export function routerOneModels(env: NodeJS.ProcessEnv = process.env): string[] {
  const list = String(env.ROUTER_ONE_MODEL ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : [ROUTER_ONE_DEFAULT_MODEL];
}
/** Public fallback (after Surplus) for normal users: flag ON + key present. */
export function routerOnePublicFallbackEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return on(env.ROUTER_ONE_ENABLED) && routerOneApiKey(env) !== '';
}
/** z@gmail.com pin: Router One ONLY, no fallback. Independent of ROUTER_ONE_ENABLED. */
export function routerOnePinnedFor(email?: string | null, uid?: string | null, env: NodeJS.ProcessEnv = process.env): boolean {
  if (off(env.ROUTER_ONE_PIN)) return false;
  return isZTestAccount(email, uid);
}

export const ROUTER_ONE_NOT_CONFIGURED = 'Router One pin: ROUTER_ONE_API_KEY is not set on this server (no fallback for this profile).';
