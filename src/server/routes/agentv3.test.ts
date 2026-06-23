import { describe, it, expect, afterEach } from 'vitest';
import { deriveWorkspaceId, agentV3KeyDiag } from './agentv3';

describe('deriveWorkspaceId (session continuity)', () => {
  it('uses a stable session id so the same session reuses one workspace', () => {
    const a = deriveWorkspaceId('user1', 'sess-abc123');
    const b = deriveWorkspaceId('user1', 'sess-abc123');
    expect(a).toBe(b);
    expect(a).toBe('agentv3-user1-sess-abc123');
  });

  it('isolates different users and different sessions', () => {
    expect(deriveWorkspaceId('user1', 'sess-abc123')).not.toBe(deriveWorkspaceId('user2', 'sess-abc123'));
    expect(deriveWorkspaceId('user1', 'sess-aaaaaa')).not.toBe(deriveWorkspaceId('user1', 'sess-bbbbbb'));
  });

  it('falls back to a fresh timestamped workspace when sessionId is missing or unsafe', () => {
    const noSession = deriveWorkspaceId('user1', undefined);
    expect(noSession).toMatch(/^agentv3-user1-\d+$/);
    // Too short / illegal chars → not used as a session.
    expect(deriveWorkspaceId('user1', 'ab')).toMatch(/^agentv3-user1-\d+$/);
    expect(deriveWorkspaceId('user1', '../etc/passwd')).toMatch(/^agentv3-user1-\d+$/);
  });

  it('treats a missing/unsafe userId as anon', () => {
    expect(deriveWorkspaceId(null, 'sess-abc123')).toBe('agentv3-anon-sess-abc123');
    expect(deriveWorkspaceId('bad id!', 'sess-abc123')).toBe('agentv3-anon-sess-abc123');
  });
});

describe('agentV3KeyDiag (provider diagnosis)', () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prev;
  });

  it('flags a real sk-ant key as looking like an Anthropic key, without leaking it', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-SECRETSECRETSECRET';
    const d = agentV3KeyDiag();
    expect(d.anthropicKeySet).toBe(true);
    expect(d.looksLikeAnthropicKey).toBe(true);
    expect(d.anthropicKeyPrefix).toBe('sk-ant-');
    expect(d.keyHadSurroundingWhitespaceOrQuotes).toBe(false);
    // The secret body is never returned — only the public scheme prefix.
    expect(JSON.stringify(d)).not.toContain('SECRETSECRET');
  });

  it('detects stray whitespace/quotes around the key (a common 401 cause)', () => {
    process.env.ANTHROPIC_API_KEY = '  sk-ant-api03-SECRET\n';
    const d = agentV3KeyDiag();
    expect(d.keyHadSurroundingWhitespaceOrQuotes).toBe(true);
    expect(d.looksLikeAnthropicKey).toBe(true); // still valid once trimmed
  });

  it('flags a non-Anthropic (e.g. leftover proxy) key as NOT looking like an Anthropic key', () => {
    process.env.ANTHROPIC_API_KEY = 'aicredits_live_xyz123';
    const d = agentV3KeyDiag();
    expect(d.anthropicKeySet).toBe(true);
    expect(d.looksLikeAnthropicKey).toBe(false);
  });

  it('reports when no key is set', () => {
    delete process.env.ANTHROPIC_API_KEY;
    const d = agentV3KeyDiag();
    expect(d.anthropicKeySet).toBe(false);
    expect(d.anthropicKeyPrefix).toBeNull();
    expect(d.looksLikeAnthropicKey).toBe(false);
  });
});
