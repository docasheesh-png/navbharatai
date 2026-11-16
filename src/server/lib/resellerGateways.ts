/**
 * DISCOUNT RESELLER GATEWAYS — admin Test Chat Bot only (owner 2026-11-16: "Moyi API, DiscountedTokens aur
 * mir api se shuru karo! abhi bas test chat bot me add karo").
 *
 * Three OpenAI-compatible resellers the owner is evaluating as low-cost suppliers. ONE place holds each
 * one's key, endpoint and model, so the status row, the call and the secret redaction can never disagree.
 * Nothing here is wired into user chat or the builder: this module is read only by the admin test page.
 *
 *   MOYI_API_KEY              MOYI_BASE_URL (optional)              MOYI_MODEL (optional)
 *   DISCOUNTEDTOKENS_API_KEY  DISCOUNTEDTOKENS_BASE_URL (optional)  DISCOUNTEDTOKENS_MODEL (optional)
 *   MIRAPI_API_KEY            MIRAPI_BASE_URL (required)            MIRAPI_MODEL (optional)
 *
 * WHAT IS KNOWN AND WHAT IS NOT (nothing is invented):
 *   - DiscountedTokens' base URL (`https://discountedtokens.com/v1`) and the model id `gpt-6-sol` come from
 *     its public API listing and the pricing page the owner supplied on 2026-11-16.
 *   - Moyi's base URL (`https://api.moyi-api.com/v1`) is the OpenAI-compatible endpoint shown on moyi-api.com's
 *     own home page (owner's screenshot, 2026-11-16).
 *   - MirAPI's API endpoint was not readable from the build environment, so it has NO default: the owner
 *     copies the base URL from MirAPI's own documentation into the env key. Until then the row says exactly
 *     that and no call is made.
 *   - A base URL is accepted only on the provider's own registered domain (or a subdomain of it), over
 *     https, with no port, credentials, query or fragment. A key can therefore never be sent to another host.
 *   - With no model configured the page reads the key's own GET /models list and uses a listed chat model.
 *
 * SPENDING CEILING: these gateways publish discounted prices this page cannot read at send time, so the
 * shared-budget reserve uses the dearest official LIST price among the models they sell (GPT-6 Astra,
 * USD 10 / 50 per 1M tokens). Every gateway price reviewed is below list, so this is a ceiling, not the bill.
 */
export const RESELLER_GATEWAY_IDS = ['moyi', 'discountedtokens', 'mirapi'] as const;
export type ResellerGatewayId = typeof RESELLER_GATEWAY_IDS[number];

interface GatewaySpec {
  label: string;
  /** The provider's registered domain; the configured base URL must be on it or on a subdomain of it. */
  domain: string;
  keyEnv: string;
  baseUrlEnv: string;
  modelEnv: string;
  defaultBaseUrl: string | null;
  defaultModel: string | null;
}

export const RESELLER_GATEWAYS: Readonly<Record<ResellerGatewayId, Readonly<GatewaySpec>>> = Object.freeze({
  moyi: { label: 'Moyi API', domain: 'moyi-api.com', keyEnv: 'MOYI_API_KEY', baseUrlEnv: 'MOYI_BASE_URL', modelEnv: 'MOYI_MODEL',
    defaultBaseUrl: 'https://api.moyi-api.com/v1', defaultModel: null },
  discountedtokens: { label: 'DiscountedTokens', domain: 'discountedtokens.com', keyEnv: 'DISCOUNTEDTOKENS_API_KEY',
    baseUrlEnv: 'DISCOUNTEDTOKENS_BASE_URL', modelEnv: 'DISCOUNTEDTOKENS_MODEL',
    defaultBaseUrl: 'https://discountedtokens.com/v1', defaultModel: 'gpt-6-sol' },
  mirapi: { label: 'MirAPI', domain: 'mirapi.ai', keyEnv: 'MIRAPI_API_KEY', baseUrlEnv: 'MIRAPI_BASE_URL', modelEnv: 'MIRAPI_MODEL',
    defaultBaseUrl: null, defaultModel: null },
});

/** Dearest official list price among the models these gateways sell; the reserve ceiling (see header). */
export const RESELLER_GATEWAY_CEILING_RATE = Object.freeze({ inputPerMTok: 10, outputPerMTok: 50 });

export function isResellerGatewayId(value: unknown): value is ResellerGatewayId {
  return typeof value === 'string' && (RESELLER_GATEWAY_IDS as readonly string[]).includes(value);
}

/** True when `hostname` is one of the gateways' own domains or a subdomain of one. Never a look-alike. */
export function isResellerGatewayHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return RESELLER_GATEWAY_IDS.some(id => host === RESELLER_GATEWAYS[id].domain || host.endsWith(`.${RESELLER_GATEWAYS[id].domain}`));
}

function onDomain(raw: string, domain: string): string | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash) return null;
  const host = url.hostname.toLowerCase();
  if (host !== domain && !host.endsWith(`.${domain}`)) return null;
  // Accept the base as documented (…/v1) or the full chat URL; the caller always appends /chat/completions.
  const path = url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  return `https://${host}${path}`;
}

export type ResellerGatewayState =
  | { ready: true; label: string; apiKey: string; baseUrl: string; model: string | null }
  | { ready: false; label: string; apiKey: string; configured: boolean; reason: string; model: string | null };

/** The one reading of a gateway's env. `ready` only with a usable key AND an endpoint on its own domain. */
export function resellerGatewayState(id: ResellerGatewayId, env: NodeJS.ProcessEnv = process.env): ResellerGatewayState {
  const spec = RESELLER_GATEWAYS[id];
  const rawKey = String(env[spec.keyEnv] ?? '').trim();
  const apiKey = rawKey && !/[\s,]/.test(rawKey) ? rawKey : '';
  const model = String(env[spec.modelEnv] ?? '').split(',').map(v => v.trim()).find(v => /^[\w.:/@+-]{1,128}$/.test(v)) || spec.defaultModel;
  if (!apiKey) return { ready: false, label: spec.label, apiKey: '', configured: false, model, reason: `No API credential is set on the server (${spec.keyEnv}).` };
  const rawBase = String(env[spec.baseUrlEnv] ?? '').trim() || spec.defaultBaseUrl || '';
  if (!rawBase) {
    return { ready: false, label: spec.label, apiKey, configured: true, model,
      reason: `The API endpoint is not set. Copy the base URL from ${spec.label}’s own API documentation into ${spec.baseUrlEnv} (it must be on ${spec.domain}).` };
  }
  const baseUrl = onDomain(rawBase, spec.domain);
  if (!baseUrl) {
    return { ready: false, label: spec.label, apiKey, configured: true, model,
      reason: `${spec.baseUrlEnv} must be an https URL on ${spec.domain} with no port, credentials or query. The key is never sent anywhere else.` };
  }
  return { ready: true, label: spec.label, apiKey, baseUrl, model };
}
