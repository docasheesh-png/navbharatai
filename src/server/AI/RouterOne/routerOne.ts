/**
 * Router One (OpenAI-compatible aggregator) — Pro builder backend (owner 2026-11-01).
 *
 *  • WEAK: admitted Surplus → eligible Router One → GLM → the existing tail.
 *          Owner 2026-11-01 supersedes the old test-profile pin for Weak.
 *  • Other bands retain the earlier test-profile pin and their existing routing.
 *  • Unknown supplier expense remains absorbed, not a measured zero or an estimated tariff.
 *
 * Env (read per call, so a Cloud Run env change applies on the next revision):
 *   ROUTER_ONE_API_KEY   Bearer key (required for both pin and public fallback)
 *   ROUTER_ONE_ENABLED   Weak defaults eligible with key; explicit off disables (other-band pin is separate)
 *   ROUTER_ONE_MODEL     comma list of Router One model ids, tried in order (all Router One)
 *   ROUTER_ONE_BASE_URL  default https://api.router.one/v1
 *   ROUTER_ONE_PIN       off ⇒ z@gmail.com goes back to the old Surplus-only path
 *
 * Brand: the provider label is the neutral "ENGINE_R1"; nothing here reaches end-user copy.
 */
import { isZTestAccount } from '../../lib/zTestAccount';
import { resolveRouterOneModels } from './routerOneCatalog';

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
  // Catalog sync engine (routerOneCatalog.ts) ranks cheapest coding models; falls back to this env list.
  return resolveRouterOneModels(list.length ? list : [ROUTER_ONE_DEFAULT_MODEL], env, list.length > 0);
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

/** Weak policy (owner 2026-11-01): eligible by default with a key; explicit off remains a kill switch. */
export function routerOneWeakFallbackEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return routerOnePublicFallbackEnabled({ ...env, ROUTER_ONE_ENABLED: off(env.ROUTER_ONE_ENABLED) ? 'off' : 'on' });
}
/** The earlier test-profile pin must not bypass the new Weak order. Other bands retain their policy. */
export function routerOnePinnedForTier(tier: string, email?: string | null, uid?: string | null): boolean {
  return tier !== 'weak' && routerOnePinnedFor(email, uid);
}
