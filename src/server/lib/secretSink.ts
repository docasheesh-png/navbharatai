// SECRET SINK — where provisioned credentials go (go-live PR 11, audit 2026-10-13).
//
// Today every provisioned credential is written to our own AES-GCM vault (`user_secrets`, secrets.ts).
// This module puts ONE seam in front of that, so GCP Secret Manager can take over without touching
// callers:
//   • SECRET_MANAGER_SINK=on AND SECRET_MANAGER_PROJECT set ⇒ write each value as a new version of
//     `nbai-<hash(uid,workspace,name)>` in Secret Manager, AND keep the vault write (dual) so every
//     existing reader keeps working. The vault is never skipped in this PR.
//   • otherwise ⇒ vault only (today's behaviour).
// A Secret Manager failure never loses the credential: the vault write decides success.
//
// 🔒 Values are never logged, never returned, never put in an error message. Secret ids are hashed so
// they do not reveal user ids or env names. OFF by default; nothing calls this yet.

import { createHash } from 'crypto';
import { parseEnvFlag } from './envFlag';

export type VaultWrite = (uid: string, values: Record<string, string>, workspaceId: string | null) => Promise<boolean>;
export type HttpFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number }>;
export type TokenFn = () => Promise<string>;

export interface SinkConfig { enabled: boolean; project: string | null }

export function secretSinkConfig(env: NodeJS.ProcessEnv = process.env): SinkConfig {
  const project = String(env.SECRET_MANAGER_PROJECT ?? '').trim();
  const on = parseEnvFlag(env.SECRET_MANAGER_SINK) ?? false;
  return { enabled: on && /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project), project: project || null };
}

export function secretIdFor(uid: string, workspaceId: string | null, name: string): string {
  return 'nbai-' + createHash('sha256').update([uid, workspaceId ?? '*', name].join('\u0000')).digest('hex').slice(0, 40);
}

export interface SinkResult { ok: boolean; vault: boolean; secretManager: 'off' | 'ok' | 'failed'; written: number }

export async function storeSecrets(
  input: { uid: string; workspaceId: string | null; values: Record<string, string> },
  deps: { vault: VaultWrite; fetch?: HttpFetch; token?: TokenFn; env?: NodeJS.ProcessEnv },
): Promise<SinkResult> {
  const names = Object.keys(input.values).filter((k) => /^[A-Z][A-Z0-9_]{0,63}$/.test(k) && typeof input.values[k] === 'string');
  const clean: Record<string, string> = {};
  for (const n of names) clean[n] = input.values[n];
  const vault = await deps.vault(input.uid, clean, input.workspaceId).catch(() => false);
  const cfg = secretSinkConfig(deps.env);
  if (!cfg.enabled || !deps.fetch || !deps.token) return { ok: vault, vault, secretManager: 'off', written: names.length };

  let smOk = true;
  try {
    const token = await deps.token();
    const base = `https://secretmanager.googleapis.com/v1/projects/${cfg.project}/secrets`;
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    for (const n of names) {
      const id = secretIdFor(input.uid, input.workspaceId, n);
      // Create is idempotent for our purpose: 409 (already exists) is fine.
      const c = await deps.fetch(`${base}?secretId=${id}`, { method: 'POST', headers, body: JSON.stringify({ replication: { automatic: {} }, labels: { owner: 'nbai' } }) });
      if (!c.ok && c.status !== 409) { smOk = false; continue; }
      const v = await deps.fetch(`${base}/${id}:addVersion`, { method: 'POST', headers, body: JSON.stringify({ payload: { data: Buffer.from(clean[n], 'utf8').toString('base64') } }) });
      if (!v.ok) smOk = false;
    }
  } catch {
    smOk = false;
  }
  if (!smOk) console.warn('[secretSink] Secret Manager write failed; the vault copy is authoritative.');
  return { ok: vault, vault, secretManager: smOk ? 'ok' : 'failed', written: names.length };
}
