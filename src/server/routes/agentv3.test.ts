import { describe, it, expect, afterEach } from 'vitest';
import { deriveWorkspaceId, agentV3KeyDiag, providerDebugTag, conversationAccess } from './agentv3';

describe('conversationAccess (D7 ownership gate)', () => {
  it('allows the owner, forbids others, and reports not-found', () => {
    expect(conversationAccess({ userId: 'u1' }, 'u1')).toBe('ok');
    expect(conversationAccess({ userId: 'u1' }, 'u2')).toBe('forbidden');
    expect(conversationAccess({ userId: 'u1' }, null)).toBe('forbidden'); // anonymous can't read an owned build
    expect(conversationAccess(null, 'u1')).toBe('not-found');
  });
});

describe('providerDebugTag (temporary admin provider-debug, env-gated)', () => {
  const prev = process.env.AGENTV3_DEBUG_PROVIDER;
  afterEach(() => {
    if (prev === undefined) delete process.env.AGENTV3_DEBUG_PROVIDER;
    else process.env.AGENTV3_DEBUG_PROVIDER = prev;
  });

  it('is OFF by default — no tag, so users never see the provider', () => {
    delete process.env.AGENTV3_DEBUG_PROVIDER;
    expect(providerDebugTag('VERTEX')).toBe('');
  });

  it('tags the reply with the provider when AGENTV3_DEBUG_PROVIDER is enabled', () => {
    process.env.AGENTV3_DEBUG_PROVIDER = '1';
    expect(providerDebugTag('VERTEX')).toContain('VERTEX');
    expect(providerDebugTag('GEMINI')).toContain('replied via GEMINI');
    // An empty label still produces no tag.
    expect(providerDebugTag('')).toBe('');
  });
});

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

  it('reports FREE-router (Vertex/Gemini/Grok) provider configuration presence', () => {
    const keys = ['GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT_ID', 'GEMINI_API_KEY', 'GROK_API_KEY', 'XAI_API_KEY'] as const;
    const saved: Record<string, string | undefined> = {};
    for (const k of keys) { saved[k] = process.env[k]; delete process.env[k]; }
    try {
      expect(agentV3KeyDiag().vertexConfigured).toBe(false);
      expect(agentV3KeyDiag().geminiKeySet).toBe(false);
      expect(agentV3KeyDiag().grokKeySet).toBe(false);

      process.env.GOOGLE_CLOUD_PROJECT = 'my-proj';
      process.env.GEMINI_API_KEY = 'gm-key';
      process.env.XAI_API_KEY = 'xai-key';
      const d = agentV3KeyDiag();
      expect(d.vertexConfigured).toBe(true);
      expect(d.geminiKeySet).toBe(true);
      expect(d.grokKeySet).toBe(true); // XAI_API_KEY counts for Grok
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });
});
