/** Dormant server-only manifest. Public pricing is not account-specific evidence. */
import { createHash } from 'node:crypto';
import { canaryWorkspaceId } from './canaryIsolation';
export interface CanarySandboxManifest {
  version: 1; uid: string; requestId: string; fixtureHash: string; workspaceId: string;
  expiresAtMs: number; providerTtlMs: number; requestTimeoutMs: number;
  cpuCount: 2; memoryMiB: 4096;
  templateId: string; templateDigest: string; credentialSha256: string;
  tariffEvidence: string; providerContractEvidence: string; templateEvidence: string;
  allCostsApproved: true; maxAllCostsPaise: number;
  /** Conservative all-resource rate and rounded billing window, including startup/minimum charges. */
  nanoUsdPerBillableSecond: number; billableSecondsCeiling: number;
  preinstalledOfflineToolchain: true; noCredentialsInTemplate: true; filesystemConfinementVerified: true;
  providerEnforcedNoEgress: true; oneRequestAtMostOneSandbox: true;
  nativeIdAliasContainmentVerified: true;
}
export const sandboxManifestHash = (m: CanarySandboxManifest): string => createHash('sha256').update(JSON.stringify(m, Object.keys(m).sort())).digest('hex');
export function checkedSandboxManifest(value: unknown, binding: {uid: string; requestId: string; fixtureHash: string}, now: number): CanarySandboxManifest {
  const m = value as CanarySandboxManifest;
  const integer = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
  const digest = (s: unknown) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
  if (!m || m.version !== 1 || m.uid !== binding.uid || m.requestId !== binding.requestId || m.fixtureHash !== binding.fixtureHash
    || !digest(m.fixtureHash) || m.workspaceId !== canaryWorkspaceId(binding.uid, binding.requestId, binding.fixtureHash)
    || !integer(m.expiresAtMs) || m.expiresAtMs <= now || m.expiresAtMs - now > 900_000
    || !integer(m.providerTtlMs) || m.providerTtlMs > 900_000
    || !integer(m.requestTimeoutMs) || m.requestTimeoutMs > 30_000
    || !integer(m.billableSecondsCeiling) || m.billableSecondsCeiling < Math.ceil(m.providerTtlMs / 1000)
    || m.billableSecondsCeiling > 3600 || !integer(m.nanoUsdPerBillableSecond) || m.nanoUsdPerBillableSecond < 46_000
    || m.cpuCount !== 2 || m.memoryMiB !== 4096
    || !Number.isSafeInteger(m.nanoUsdPerBillableSecond * m.billableSecondsCeiling)
    || !integer(m.maxAllCostsPaise) || m.maxAllCostsPaise > 100_000
    || typeof m.templateId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(m.templateId)
    || !digest(m.templateDigest) || !digest(m.credentialSha256)
    || ![m.tariffEvidence, m.providerContractEvidence, m.templateEvidence].every(s => typeof s === 'string' && s.trim().length > 0)
    || m.allCostsApproved !== true || m.preinstalledOfflineToolchain !== true || m.noCredentialsInTemplate !== true
    || m.filesystemConfinementVerified !== true || m.providerEnforcedNoEgress !== true || m.oneRequestAtMostOneSandbox !== true || m.nativeIdAliasContainmentVerified !== true) {
    throw new Error('Restricted sandbox manifest is absent, unverified or outside its envelope');
  }
  return Object.freeze({ ...m });
}
