import { describe, it, expect } from 'vitest';
import {
  PROMPT_VERSIONS,
  promptFingerprint,
  promptVersionId,
  registerPrompt,
  getRegisteredPrompt,
  listRegisteredPrompts,
} from '../src/server/AgentV3/PromptRegistry';

/** P-PE.2 — prompt versioning / registry (pure). */

describe('PromptRegistry — fingerprint + versionId', () => {
  it('fingerprint is deterministic and content-sensitive', () => {
    expect(promptFingerprint('hello')).toBe(promptFingerprint('hello'));
    expect(promptFingerprint('hello')).not.toBe(promptFingerprint('hello!'));
  });

  it('versionId combines id, curated semver and fingerprint', () => {
    const id = promptVersionId('architect', 'some prompt body');
    expect(id.startsWith('architect@3.0.')).toBe(true);
    // Changing the content changes the fingerprint suffix but keeps the semver prefix.
    const id2 = promptVersionId('architect', 'a different body');
    expect(id2.startsWith('architect@3.0.')).toBe(true);
    expect(id).not.toBe(id2);
  });

  it('unknown prompt id falls back to semver 0', () => {
    expect(promptVersionId('mystery', 'x').startsWith('mystery@0.')).toBe(true);
  });

  it('exposes curated semvers for the core prompts', () => {
    expect(PROMPT_VERSIONS.architect).toBeTruthy();
    expect(PROMPT_VERSIONS.plan).toBeTruthy();
  });
});

describe('PromptRegistry — register/get/list', () => {
  it('registers and reads back a prompt snapshot', () => {
    const vid = registerPrompt('architect', 'PROMPT-A');
    const snap = getRegisteredPrompt('architect');
    expect(snap).not.toBeNull();
    expect(snap!.versionId).toBe(vid);
    expect(snap!.semver).toBe('3.0');
    expect(snap!.length).toBe('PROMPT-A'.length);
    expect(snap!.fingerprint).toBe(promptFingerprint('PROMPT-A'));
  });

  it('re-registering refreshes the snapshot in place', () => {
    registerPrompt('plan', 'v1 body');
    const first = getRegisteredPrompt('plan')!.versionId;
    registerPrompt('plan', 'v2 body changed');
    const second = getRegisteredPrompt('plan')!.versionId;
    expect(first).not.toBe(second);
    // Still a single entry for 'plan' (no duplicates).
    expect(listRegisteredPrompts().filter((p) => p.id === 'plan')).toHaveLength(1);
  });

  it('unknown id reads back null', () => {
    expect(getRegisteredPrompt('never-registered')).toBeNull();
  });

  it('list includes registered ids', () => {
    registerPrompt('chat', 'chat body');
    expect(listRegisteredPrompts().some((p) => p.id === 'chat')).toBe(true);
  });
});
