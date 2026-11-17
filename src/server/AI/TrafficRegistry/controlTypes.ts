/**
 * Traffic Manager V2, P2: the CONTROL STORE document — what is allowed right now (owner-approved, 2026-11-17).
 *
 * 🔒 P2 CAN ONLY NARROW. Every field here takes traffic AWAY from the gateway or from a provider/model; none can
 * add a surface the deployment env has not enabled, re-enable a provider the kill switch holds off, or widen any
 * limit. An empty store (never written) means "exactly what the env and the code do today" — so P2 changes no
 * production routing until an admin deliberately turns something off (owner requirement 9).
 *
 * Pure: shapes and strict validation only. Nothing here reads Firestore or the clock.
 */
import type { Surface } from '../InferenceGateway/types';
import { PROVIDER_UPSTREAM } from './upstreamFamilies';
import { redactSecrets } from '../../AgentV3/SecretRedactor';

/** Surfaces the gateway can serve today. A surface switch can only send one of them back to its legacy path. */
export const CONTROL_SURFACES: readonly Surface[] = Object.freeze(['chat', 'professional', 'doctor', 'sda', 'developer-api'] as Surface[]);
export type SurfaceMode = 'env' | 'legacy';
export type RouteState = 'enabled' | 'draining' | 'disabled';

/**
 * Production admission evidence for one model (owner: "No provider may receive production traffic without verified
 * capabilities, pricing, security review, and operational testing"). `required: false` = observe only: the gaps are
 * reported, nothing is blocked, so models already serving today keep serving. `required: true` = the planner refuses
 * the model until all four checks are present, in the past, and unexpired.
 */
export interface AdmissionEvidence {
  required: boolean;
  capabilityTestAtMs?: number;
  priceVerifiedAtMs?: number;
  priceSource?: string;
  securityReviewAtMs?: number;
  opsTestAtMs?: number;
  reviewer?: string;
  expiresAtMs?: number;
}

export interface RouteControl { state: RouteState; trafficCapPct: number }
export interface ModelControl extends RouteControl { admission?: AdmissionEvidence }

/** What an admin edits. */
export interface ControlBody {
  global: { gateway: 'on' | 'off' };
  surfaces: Partial<Record<Surface, SurfaceMode>>;
  /** Keyed by kill-switch family id (`glm`, `cheaperinference`, …). */
  providers: Record<string, RouteControl>;
  /** Keyed `<familyId>/<modelId>`. */
  models: Record<string, ModelControl>;
}

/** What is stored: the body plus who changed it, when and why. `revision` only ever goes up. */
export interface ControlDoc extends ControlBody {
  revision: number;
  updatedAtMs: number;
  actor: string;
  reason: string;
}


export class ControlInputError extends Error {}

const MAX_ENTRIES = 200;
const MODEL_ID = /^[A-Za-z0-9@][A-Za-z0-9_./:@+-]{0,199}$/;
const STATES: readonly RouteState[] = ['enabled', 'draining', 'disabled'];
const ADMISSION_KEYS = new Set(['required', 'capabilityTestAtMs', 'priceVerifiedAtMs', 'priceSource', 'securityReviewAtMs', 'opsTestAtMs', 'reviewer', 'expiresAtMs']);

function obj(v: unknown, what: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ControlInputError(`${what} must be an object.`);
  return v as Record<string, unknown>;
}
function onlyKeys(o: Record<string, unknown>, keys: readonly string[], what: string): void {
  const extra = Object.keys(o).filter(k => !keys.includes(k));
  if (extra.length) throw new ControlInputError(`${what} has unknown field(s): ${extra.slice(0, 3).join(', ')}.`);
}
function route(v: unknown, what: string): RouteControl {
  const o = obj(v, what);
  if (!STATES.includes(o.state as RouteState)) throw new ControlInputError(`${what}.state must be enabled, draining or disabled.`);
  const cap = o.trafficCapPct ?? 100;
  if (!Number.isInteger(cap) || (cap as number) < 0 || (cap as number) > 100) throw new ControlInputError(`${what}.trafficCapPct must be a whole number 0–100.`);
  return { state: o.state as RouteState, trafficCapPct: cap as number };
}
function epoch(v: unknown, what: string): number | undefined {
  if (v === undefined) return undefined;
  if (!Number.isSafeInteger(v) || (v as number) < 0) throw new ControlInputError(`${what} must be a millisecond timestamp.`);
  return v as number;
}
function text(v: unknown, what: string, max: number): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new ControlInputError(`${what} must be text of at most ${max} characters.`);
  return redactSecrets(v.trim());
}
function admission(v: unknown, what: string): AdmissionEvidence {
  const o = obj(v, what);
  const extra = Object.keys(o).filter(k => !ADMISSION_KEYS.has(k));
  if (extra.length) throw new ControlInputError(`${what} has unknown field(s): ${extra.slice(0, 3).join(', ')}.`);
  if (typeof o.required !== 'boolean') throw new ControlInputError(`${what}.required must be true or false.`);
  const out: AdmissionEvidence = { required: o.required };
  for (const k of ['capabilityTestAtMs', 'priceVerifiedAtMs', 'securityReviewAtMs', 'opsTestAtMs', 'expiresAtMs'] as const) {
    const t = epoch(o[k], `${what}.${k}`); if (t !== undefined) out[k] = t;
  }
  const source = text(o.priceSource, `${what}.priceSource`, 200); if (source) out.priceSource = source;
  const reviewer = text(o.reviewer, `${what}.reviewer`, 120); if (reviewer) out.reviewer = reviewer;
  return out;
}

export function isFamilyId(id: string): boolean { return Object.hasOwn(PROVIDER_UPSTREAM, id); }

/** Strict validation of an admin-submitted body. Throws `ControlInputError` with a plain reason. */
export function parseControlBody(raw: unknown): ControlBody {
  const o = obj(raw, 'The control document');
  onlyKeys(o, ['global', 'surfaces', 'providers', 'models'], 'The control document');
  const g = obj(o.global ?? { gateway: 'on' }, 'global');
  onlyKeys(g, ['gateway'], 'global');
  if (g.gateway !== 'on' && g.gateway !== 'off') throw new ControlInputError('global.gateway must be on or off.');
  const surfaces: ControlBody['surfaces'] = {};
  for (const [k, v] of Object.entries(obj(o.surfaces ?? {}, 'surfaces'))) {
    if (!CONTROL_SURFACES.includes(k as Surface)) throw new ControlInputError(`Unknown surface "${k}".`);
    if (v !== 'env' && v !== 'legacy') throw new ControlInputError(`Surface "${k}" must be env or legacy.`);
    surfaces[k as Surface] = v;
  }
  const providers: ControlBody['providers'] = {};
  const providerEntries = Object.entries(obj(o.providers ?? {}, 'providers'));
  for (const [k, v] of providerEntries) {
    if (!isFamilyId(k)) throw new ControlInputError(`Unknown provider "${k}".`);
    providers[k] = route(v, `providers.${k}`);
    onlyKeys(obj(v, k), ['state', 'trafficCapPct'], `providers.${k}`);
  }
  const models: ControlBody['models'] = {};
  const modelEntries = Object.entries(obj(o.models ?? {}, 'models'));
  if (providerEntries.length + modelEntries.length > MAX_ENTRIES) throw new ControlInputError(`At most ${MAX_ENTRIES} provider and model entries.`);
  for (const [k, v] of modelEntries) {
    const slash = k.indexOf('/');
    const family = slash > 0 ? k.slice(0, slash) : '';
    if (!isFamilyId(family) || !MODEL_ID.test(k.slice(slash + 1))) throw new ControlInputError(`Model key "${k}" must be <provider>/<model id>.`);
    const m = obj(v, `models.${k}`);
    onlyKeys(m, ['state', 'trafficCapPct', 'admission'], `models.${k}`);
    models[k] = { ...route(m, `models.${k}`), ...(m.admission !== undefined ? { admission: admission(m.admission, `models.${k}.admission`) } : {}) };
  }
  return { global: { gateway: g.gateway }, surfaces, providers, models };
}

/** Read a stored document. Anything unreadable is rejected whole: a half-understood control is never applied. */
export function parseControlDoc(raw: unknown): ControlDoc {
  const o = obj(raw, 'Stored control document');
  const body = parseControlBody({ global: o.global, surfaces: o.surfaces, providers: o.providers, models: o.models });
  if (!Number.isSafeInteger(o.revision) || (o.revision as number) < 1) throw new ControlInputError('Stored revision is invalid.');
  if (!Number.isSafeInteger(o.updatedAtMs)) throw new ControlInputError('Stored updatedAtMs is invalid.');
  return { ...body, revision: o.revision as number, updatedAtMs: o.updatedAtMs as number,
    actor: typeof o.actor === 'string' ? o.actor.slice(0, 120) : '', reason: typeof o.reason === 'string' ? o.reason.slice(0, 300) : '' };
}

export function bodyOf(doc: ControlDoc): ControlBody {
  return { global: doc.global, surfaces: doc.surfaces, providers: doc.providers, models: doc.models };
}
