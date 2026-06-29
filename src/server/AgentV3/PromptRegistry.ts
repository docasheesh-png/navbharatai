// AgentV3 — P-PE.2 prompt versioning / registry.
//
// The system prompts (architect / plan / edit / chat) were hardcoded in systemPrompt.ts with no
// version identity: you couldn't tell which prompt produced a given build, nor detect that a prompt
// changed. This registry gives every prompt a stable VERSION ID = `<id>@<semver>.<fingerprint>`:
//  • <semver> — a human-curated label bumped intentionally when a prompt's INTENT changes.
//  • <fingerprint> — a content hash that flips on ANY text edit, so drift is detectable (a test can
//    snapshot it; telemetry can record which version was active per build).
//
// Pure + dependency-free (reuses the FNV hash from PromptCache). The registry is an in-memory snapshot
// populated as prompts are built, exposed for diff/inspection.

import { hashKey } from './PromptCache';

/**
 * Human-curated semantic version per prompt id. BUMP intentionally when you change what a prompt is
 * meant to do (not for every wording tweak — the fingerprint already captures those).
 */
export const PROMPT_VERSIONS: Record<string, string> = {
  architect: '3.0',
  plan: '1.0',
  edit: '1.0',
  chat: '1.0',
};

/** Content fingerprint — flips on any text change. Pure. */
export function promptFingerprint(content: string): string {
  return hashKey([content]);
}

/** Stable version id for a prompt: `<id>@<semver>.<fingerprint>`. Pure. */
export function promptVersionId(id: string, content: string): string {
  const semver = PROMPT_VERSIONS[id] ?? '0';
  return `${id}@${semver}.${promptFingerprint(content)}`;
}

export interface RegisteredPrompt {
  id: string;
  semver: string;
  fingerprint: string;
  versionId: string;
  length: number;
}

const registry = new Map<string, RegisteredPrompt>();

/** Register (or refresh) a prompt's current content and return its version id. */
export function registerPrompt(id: string, content: string): string {
  const semver = PROMPT_VERSIONS[id] ?? '0';
  const fingerprint = promptFingerprint(content);
  const versionId = `${id}@${semver}.${fingerprint}`;
  registry.set(id, { id, semver, fingerprint, versionId, length: content.length });
  return versionId;
}

/** The registered snapshot for a prompt id, or null if it hasn't been registered yet. */
export function getRegisteredPrompt(id: string): RegisteredPrompt | null {
  return registry.get(id) ?? null;
}

/** All registered prompts (for an inspection endpoint / CI diff). */
export function listRegisteredPrompts(): RegisteredPrompt[] {
  return Array.from(registry.values());
}
