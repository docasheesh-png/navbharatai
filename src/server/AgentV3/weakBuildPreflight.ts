import { admitWeakBuild, weakScopePolicyEnabled, type WeakAdmission } from './weakBuildAdmission';
import { weakBuildAdmissionAsk } from './weakBuildAdmissionAsk';
import { goldenScaffoldForPrompt } from './goldenScaffolds/registry';

export function weakCandidateActive(tier: string): boolean {
  return weakScopePolicyEnabled() && tier === 'weak';
}

export async function weakAdmissionForTurn(input: { prompt: string; intent: string; importing: boolean; tier: string }): Promise<WeakAdmission | null> {
  if (!weakCandidateActive(input.tier) || input.intent === 'chat' || input.importing) return null;
  const result = await admitWeakBuild(input.prompt, weakBuildAdmissionAsk, {
    template: process.env.AGENTV3_GOLDEN_SCAFFOLD !== 'off' && input.intent === 'new_build'
      && goldenScaffoldForPrompt(input.prompt) !== null,
  });
  console.log('[AGENTV3] Weak scope preflight', JSON.stringify(result));
  return result;
}

export function weakAdmissionBlocked(result: WeakAdmission | null): boolean {
  return result !== null && (result.scope === 'strong' || result.scope === null);
}

export function createWeakTextRepairAllowance(active: boolean): () => void {
  let used = false;
  return () => {
    if (!active) return;
    if (used) throw new Error('Weak repair allowance reached; progress is saved for the next request.');
    used = true;
  };
}

export async function resolveWeakComplexity<T>(result: WeakAdmission | null, score: number, fallback: () => Promise<T>): Promise<T | { verdict: 'simple' | 'complex'; score: number; source: 'model' | 'scaffold'; reason: string }> {
  if (result?.scope === 'simple' || result?.scope === 'complex') {
    return { verdict: result.scope, score, source: result.source === 'template' ? 'scaffold' : 'model',
      reason: result.source === 'template' ? 'the exact tested template supplies the requested scope; no classifier call was bought'
        : 'one bounded preflight classified the requested implementation scope' };
  }
  return fallback();
}

export function recordWeakAdmissionUsage(result: WeakAdmission | null, record: (usage: NonNullable<WeakAdmission['usage']>) => void): void {
  if (result?.usage) record(result.usage);
}

export function allowWeakChatAction(blocked: boolean, allowed: boolean): boolean {
  return !blocked && allowed;
}
