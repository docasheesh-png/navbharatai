import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { deriveWorkspaceId, agentV3KeyDiag, providerDebugTag, conversationAccess, tierToGeminiBuildModel, selectBuildModel, escalationEnabled, shouldEscalateBuild, escalationGate, userMonthlyCapUsd, checkMonthlyCap, readinessGateEnabled, maxBuildSeconds, sandboxDiag, resolveClaudeFirst, planGrokEnabled } from './agentv3';
import { analyzeRequest } from '../AgentV3/RequestAnalyser';
import { haikuModel, sonnetModel, opusModel } from '../AgentV3/models';
import { userCostStore } from '../lib/UserCostStore';

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

describe('planGrokEnabled — planning runs on Grok when a key is set', () => {
  it('enabled when a Grok/xAI key is present and not disabled', () => {
    expect(planGrokEnabled('xai-abc', undefined)).toBe(true);
    expect(planGrokEnabled('grok-key', '1')).toBe(true);
  });
  it('disabled when no key', () => {
    expect(planGrokEnabled(undefined, undefined)).toBe(false);
    expect(planGrokEnabled('', undefined)).toBe(false);
  });
  it('opt-out with AGENTV3_PLAN_GROK=0 / off even when a key is set', () => {
    expect(planGrokEnabled('xai-abc', '0')).toBe(false);
    expect(planGrokEnabled('xai-abc', 'off')).toBe(false);
  });
});

describe('selectBuildModel — admin cost-routing (small=Haiku, complex=Sonnet, power=Opus)', () => {
  it('small/simple app (gemini/haiku tier) builds on Haiku', () => {
    expect(selectBuildModel('gemini', false)).toBe(haikuModel());
    expect(selectBuildModel('haiku', false)).toBe(haikuModel());
    expect(selectBuildModel(undefined, false)).toBe(haikuModel());
  });
  it('complex app (sonnet/opus tier) builds on Sonnet', () => {
    expect(selectBuildModel('sonnet', false)).toBe(sonnetModel());
    expect(selectBuildModel('opus', false)).toBe(sonnetModel());
  });
  it('power mode always wins → Opus, regardless of tier', () => {
    expect(selectBuildModel('gemini', true)).toBe(opusModel());
    expect(selectBuildModel('sonnet', true)).toBe(opusModel());
  });
  it('maps real analyser verdicts: a calculator stays cheap (Haiku), an auth+DB app uses Sonnet', () => {
    const calc = analyzeRequest({ prompt: 'build me a calculator' });
    expect(selectBuildModel(calc.startTier, false)).toBe(haikuModel());
    const complex = analyzeRequest({ prompt: 'build a multi-tenant SaaS with auth, postgres database, billing and an admin dashboard' });
    expect(selectBuildModel(complex.startTier, false)).toBe(sonnetModel());
  });
});

describe('resolveClaudeFirst — v3.0 builds lead with Claude by default', () => {
  it('defaults to Claude-first when no opt and no env override', () => {
    expect(resolveClaudeFirst(undefined, undefined)).toBe(true);
  });
  it('reverts to cheap-first only when AGENTV3_BUILD_CLAUDE_FIRST=0 / off', () => {
    expect(resolveClaudeFirst(undefined, '0')).toBe(false);
    expect(resolveClaudeFirst(undefined, 'off')).toBe(false);
  });
  it('still Claude-first for any other env value', () => {
    expect(resolveClaudeFirst(undefined, '1')).toBe(true);
    expect(resolveClaudeFirst(undefined, 'true')).toBe(true);
  });
  it('explicit opts win (escalation forces Claude-first; explicit false honoured)', () => {
    expect(resolveClaudeFirst(true, '0')).toBe(true);
    expect(resolveClaudeFirst(false, undefined)).toBe(false);
  });
});

describe('cost-ladder (P2) — tierToGeminiBuildModel + analyser integration', () => {
  it('routes the cheapest tier to Gemini Flash and every other tier to Pro', () => {
    expect(tierToGeminiBuildModel('gemini')).toBe('gemini-2.5-flash');
    expect(tierToGeminiBuildModel('haiku')).toBe('gemini-2.5-pro');
    expect(tierToGeminiBuildModel('sonnet')).toBe('gemini-2.5-pro');
    expect(tierToGeminiBuildModel('opus')).toBe('gemini-2.5-pro');
  });

  it('a simple app (calculator/todo) resolves to the cheap Flash build model', () => {
    const calc = analyzeRequest({ prompt: 'build me a calculator' });
    expect(calc.startTier).toBe('gemini');
    expect(tierToGeminiBuildModel(calc.startTier)).toBe('gemini-2.5-flash');

    const todo = analyzeRequest({ prompt: 'make a simple todo list app' });
    expect(tierToGeminiBuildModel(todo.startTier)).toBe('gemini-2.5-flash');
  });

  it('a complex app keeps the proven Pro build model', () => {
    const complex = analyzeRequest({
      prompt: 'build a full-stack e-commerce dashboard with authentication and payments',
    });
    expect(complex.startTier === 'sonnet' || complex.startTier === 'haiku').toBe(true);
    expect(tierToGeminiBuildModel(complex.startTier)).toBe('gemini-2.5-pro');
  });

  it('power mode forces Opus tier — still maps to Pro on the Gemini fallback (Claude is the real Opus path)', () => {
    const power = analyzeRequest({ prompt: 'build a calculator', powerMode: true });
    expect(power.startTier).toBe('opus');
    expect(tierToGeminiBuildModel(power.startTier)).toBe('gemini-2.5-pro');
  });
});

describe('cost-ladder escalation (P3) — dormant policy + gate', () => {
  const prev = process.env.AGENTV3_ESCALATION;
  afterEach(() => {
    if (prev === undefined) delete process.env.AGENTV3_ESCALATION;
    else process.env.AGENTV3_ESCALATION = prev;
  });

  it('is OFF by default — escalationEnabled() false, builds run once', () => {
    delete process.env.AGENTV3_ESCALATION;
    expect(escalationEnabled()).toBe(false);
    const simple = analyzeRequest({ prompt: 'build me a calculator' });
    expect(shouldEscalateBuild(simple, false)).toBe(false); // flag off → never escalate
  });

  it('only activates when the flag is exactly "on"', () => {
    process.env.AGENTV3_ESCALATION = 'true';
    expect(escalationEnabled()).toBe(false); // only literal "on" enables it
    process.env.AGENTV3_ESCALATION = 'on';
    expect(escalationEnabled()).toBe(true);
  });

  it('when ON, escalates a cheap-tier build with a higher tier available', () => {
    process.env.AGENTV3_ESCALATION = 'on';
    const simple = analyzeRequest({ prompt: 'build me a calculator' }); // starts on gemini
    expect(simple.startTier).toBe('gemini');
    expect(simple.escalationPath.length).toBeGreaterThan(1);
    expect(shouldEscalateBuild(simple, false)).toBe(true);
  });

  it('when ON, does NOT escalate power/Only-Opus builds (ladder bypassed)', () => {
    process.env.AGENTV3_ESCALATION = 'on';
    const power = analyzeRequest({ prompt: 'build a calculator', powerMode: true });
    expect(power.escalationPath).toEqual(['opus']); // single tier — nowhere to climb
    expect(shouldEscalateBuild(power, true)).toBe(false);
  });

  it('when ON, does NOT escalate a build already at the top tier (no higher tier)', () => {
    process.env.AGENTV3_ESCALATION = 'on';
    // A complex app starts at sonnet — the top of the normal ladder, path length 1.
    const complex = analyzeRequest({ prompt: 'production-grade scalable microservice architecture with auth and payments' });
    if (complex.escalationPath.length <= 1) {
      expect(shouldEscalateBuild(complex, false)).toBe(false);
    } else {
      expect(shouldEscalateBuild(complex, false)).toBe(true);
    }
  });

  it('escalationGate: ok build passes, failed build fails (triggers climb)', () => {
    expect(escalationGate(true)).toMatchObject({ pass: true, score: 100 });
    expect(escalationGate(false)).toMatchObject({ pass: false, score: 0 });
    expect(escalationGate(false).reason).toContain('escalate');
  });

  it('shouldEscalateBuild is false when there is no analysis', () => {
    process.env.AGENTV3_ESCALATION = 'on';
    expect(shouldEscalateBuild(undefined, false)).toBe(false);
  });
});

describe('userMonthlyCapUsd (R1 §3.1 per-user monthly ceiling — env parsing)', () => {
  const prev = process.env.AGENTV3_USER_MONTHLY_CAP_USD;
  afterEach(() => {
    if (prev === undefined) delete process.env.AGENTV3_USER_MONTHLY_CAP_USD;
    else process.env.AGENTV3_USER_MONTHLY_CAP_USD = prev;
  });

  it('is disabled (0) by default so existing behaviour is unchanged', () => {
    delete process.env.AGENTV3_USER_MONTHLY_CAP_USD;
    expect(userMonthlyCapUsd()).toBe(0);
  });

  it('reads a positive cap from the env var', () => {
    process.env.AGENTV3_USER_MONTHLY_CAP_USD = '50';
    expect(userMonthlyCapUsd()).toBe(50);
  });

  it('treats a non-positive / invalid value as disabled', () => {
    process.env.AGENTV3_USER_MONTHLY_CAP_USD = '-5';
    expect(userMonthlyCapUsd()).toBe(0);
    process.env.AGENTV3_USER_MONTHLY_CAP_USD = 'abc';
    expect(userMonthlyCapUsd()).toBe(0);
  });
});

describe('checkMonthlyCap (R1 §3.1 — gate behaviour)', () => {
  const prev = process.env.AGENTV3_USER_MONTHLY_CAP_USD;
  afterEach(() => {
    if (prev === undefined) delete process.env.AGENTV3_USER_MONTHLY_CAP_USD;
    else process.env.AGENTV3_USER_MONTHLY_CAP_USD = prev;
    vi.restoreAllMocks();
  });

  it('allows everyone when the cap is disabled', async () => {
    delete process.env.AGENTV3_USER_MONTHLY_CAP_USD;
    const r = await checkMonthlyCap('u1');
    expect(r.allowed).toBe(true);
  });

  it('never caps anonymous (no userId) builds', async () => {
    process.env.AGENTV3_USER_MONTHLY_CAP_USD = '10';
    const r = await checkMonthlyCap(null);
    expect(r.allowed).toBe(true);
  });

  it('denies a user who has reached the cap this month', async () => {
    process.env.AGENTV3_USER_MONTHLY_CAP_USD = '10';
    vi.spyOn(userCostStore, 'get').mockResolvedValue({ userId: 'u1', month: '2026-06', totalBuilds: 9, totalCostUsd: 12.5, updatedAt: 0 });
    const r = await checkMonthlyCap('u1');
    expect(r.allowed).toBe(false);
    expect(r.cap).toBe(10);
    expect(r.spent).toBe(12.5);
  });

  it('allows a user still under the cap', async () => {
    process.env.AGENTV3_USER_MONTHLY_CAP_USD = '10';
    vi.spyOn(userCostStore, 'get').mockResolvedValue({ userId: 'u1', month: '2026-06', totalBuilds: 2, totalCostUsd: 3.0, updatedAt: 0 });
    const r = await checkMonthlyCap('u1');
    expect(r.allowed).toBe(true);
  });

  it('fails OPEN on a store error so a Firestore outage never locks users out', async () => {
    process.env.AGENTV3_USER_MONTHLY_CAP_USD = '10';
    vi.spyOn(userCostStore, 'get').mockRejectedValue(new Error('firestore down'));
    const r = await checkMonthlyCap('u1');
    expect(r.allowed).toBe(true);
  });
});

describe('readinessGateEnabled (R2 §1.1 — mandatory gate flag)', () => {
  const prev = process.env.AGENTV3_READINESS_GATE;
  afterEach(() => {
    if (prev === undefined) delete process.env.AGENTV3_READINESS_GATE;
    else process.env.AGENTV3_READINESS_GATE = prev;
  });

  it('is ON by default so "done" means verified', () => {
    delete process.env.AGENTV3_READINESS_GATE;
    expect(readinessGateEnabled()).toBe(true);
  });

  it('can be disabled with AGENTV3_READINESS_GATE=off (admin escape hatch)', () => {
    process.env.AGENTV3_READINESS_GATE = 'off';
    expect(readinessGateEnabled()).toBe(false);
  });

  it('any other value keeps it on', () => {
    process.env.AGENTV3_READINESS_GATE = 'on';
    expect(readinessGateEnabled()).toBe(true);
  });
});

describe('maxBuildSeconds (watchdog wall-clock cap)', () => {
  const prev = process.env.AGENTV3_MAX_BUILD_SECONDS;
  afterEach(() => {
    if (prev === undefined) delete process.env.AGENTV3_MAX_BUILD_SECONDS;
    else process.env.AGENTV3_MAX_BUILD_SECONDS = prev;
  });
  it('defaults to 720s (12 min)', () => {
    delete process.env.AGENTV3_MAX_BUILD_SECONDS;
    expect(maxBuildSeconds()).toBe(720);
  });
  it('honors a positive override', () => {
    process.env.AGENTV3_MAX_BUILD_SECONDS = '300';
    expect(maxBuildSeconds()).toBe(300);
  });
  it('allows disabling with 0', () => {
    process.env.AGENTV3_MAX_BUILD_SECONDS = '0';
    expect(maxBuildSeconds()).toBe(0);
  });
  it('falls back to the default on garbage', () => {
    process.env.AGENTV3_MAX_BUILD_SECONDS = 'abc';
    expect(maxBuildSeconds()).toBe(720);
  });
});

describe('sandboxDiag (why the Live-server/E2B preview tab is missing)', () => {
  const keys = ['E2B_API_KEY', 'DOCKER_ENABLED', 'E2B_PREVIEW_DOMAIN'] as const;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => { for (const k of keys) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  it('with no E2B key + no docker → LocalActuator, NO live preview (only in-browser tab)', () => {
    const d = sandboxDiag();
    expect(d.actuator).toBe('local');
    expect(d.e2bKeySet).toBe(false);
    expect(d.livePreviewAvailable).toBe(false); // ← this is why the "Live server" tab disappears
  });

  it('with E2B_API_KEY set → E2B actuator, live preview available', () => {
    process.env.E2B_API_KEY = 'e2b_xxx';
    const d = sandboxDiag();
    expect(d.actuator).toBe('e2b');
    expect(d.e2bKeySet).toBe(true);
    expect(d.livePreviewAvailable).toBe(true);
  });

  it('treats a blank E2B key as not set', () => {
    process.env.E2B_API_KEY = '   ';
    expect(sandboxDiag().e2bKeySet).toBe(false);
  });

  it('default preview domain (e2b.app) → no DNS warning', () => {
    const d = sandboxDiag();
    expect(d.previewDomain).toBe('e2b.app');
    expect(d.previewDomainIsCustom).toBe(false);
    expect(d.previewDomainWarning).toBeNull();
  });

  it('custom preview domain → warns it needs wildcard DNS (else previews 404)', () => {
    process.env.E2B_PREVIEW_DOMAIN = 'mitrify.xyz';
    const d = sandboxDiag();
    expect(d.previewDomainIsCustom).toBe(true);
    expect(d.previewDomain).toBe('mitrify.xyz');
    expect(d.previewDomainWarning).toContain('wildcard');
    expect(d.previewDomainWarning).toContain('mitrify.xyz');
  });
});
