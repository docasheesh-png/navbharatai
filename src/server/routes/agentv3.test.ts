import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { deriveWorkspaceId, agentV3KeyDiag, providerDebugTag, conversationAccess, needsFallbackConversationPersist, tierToGeminiBuildModel, selectBuildModel, oneShotDevPort, escalationEnabled, shouldEscalateBuild, escalationGate, userMonthlyCapUsd, checkMonthlyCap, readinessGateEnabled, maxBuildSeconds, maxBuildBudgetUsd, sandboxDiag, resolveClaudeFirst, planGrokEnabled, raceTimeout, cheapBuildFloorRunners, cheapFloorAllowedForTier, cheapFloorAllowedForUser, dominantProvider, parseModelLadder, chatWorkspaceContextLine, parseDevServerHealthCheck, isBuildRunningForWorkspace, type RunningBuild } from './agentv3';
import { analyzeRequest } from '../AgentV3/RequestAnalyser';
import { haikuModel, sonnetModel, opusModel } from '../AgentV3/models';
import { userCostStore } from '../lib/UserCostStore';

describe('raceTimeout — bounds request-setup calls that run before the build deadline is armed', () => {
  it('resolves with the value when the promise settles in time', async () => {
    await expect(raceTimeout(Promise.resolve('ok'), 1000, 'x')).resolves.toBe('ok');
  });
  it('rejects with a labelled timeout when the promise hangs', async () => {
    const hangs = new Promise<string>(() => { /* never settles */ });
    await expect(raceTimeout(hangs, 20, 'classifyIntentSmart')).rejects.toThrow(/classifyIntentSmart timed out after 20ms/);
  });
  it('propagates a rejection from the wrapped promise unchanged', async () => {
    await expect(raceTimeout(Promise.reject(new Error('boom')), 1000, 'x')).rejects.toThrow('boom');
  });
  it('supports the fail-open .catch pattern used at the call sites', async () => {
    const hangs = new Promise<{ allowed: boolean }>(() => {});
    const r = await raceTimeout(hangs, 20, 'checkMonthlyCap').catch(() => ({ allowed: true }));
    expect(r.allowed).toBe(true);
  });
});

describe('conversationAccess (D7 ownership gate)', () => {
  it('allows the owner, forbids others, and reports not-found', () => {
    expect(conversationAccess({ userId: 'u1' }, 'u1')).toBe('ok');
    expect(conversationAccess({ userId: 'u1' }, 'u2')).toBe('forbidden');
    expect(conversationAccess({ userId: 'u1' }, null)).toBe('forbidden'); // anonymous can't read an owned build
    expect(conversationAccess(null, 'u1')).toBe('not-found');
  });
});

describe('needsFallbackConversationPersist (fast-lane "memory gone after reload" fix)', () => {
  it('needs a fallback when nothing was persisted for this workspace during the build', () => {
    expect(needsFallbackConversationPersist([], 'ws-1', 1000)).toBe(true);
    expect(needsFallbackConversationPersist([{ workspaceId: 'ws-other', updatedAt: 2000 }], 'ws-1', 1000)).toBe(true);
  });
  it('does NOT need a fallback when the agentic runner already persisted this workspace during the build', () => {
    expect(needsFallbackConversationPersist([{ workspaceId: 'ws-1', updatedAt: 1500 }], 'ws-1', 1000)).toBe(false);
  });
  it('a STALE record for the same workspace from BEFORE this build started still needs a fallback', () => {
    // An older conversation for the same workspace (e.g. from a fast-lane build hours ago) must not
    // be mistaken for "this build already persisted" — only an updatedAt AT/AFTER buildStartedAt counts.
    expect(needsFallbackConversationPersist([{ workspaceId: 'ws-1', updatedAt: 500 }], 'ws-1', 1000)).toBe(true);
  });
  it('a record updated exactly at buildStartedAt counts as already-persisted (inclusive boundary)', () => {
    expect(needsFallbackConversationPersist([{ workspaceId: 'ws-1', updatedAt: 1000 }], 'ws-1', 1000)).toBe(false);
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

describe('chatWorkspaceContextLine — v3.0 always knows its real file count, even in plain chat', () => {
  it('is empty for a brand-new/empty workspace — nothing honest to add', () => {
    expect(chatWorkspaceContextLine(0)).toBe('');
    expect(chatWorkspaceContextLine(-1)).toBe('');
    expect(chatWorkspaceContextLine(NaN)).toBe('');
  });
  it('injects the REAL count so "kितni files hai?" is answered honestly, not guessed', () => {
    const line = chatWorkspaceContextLine(12);
    expect(line).toContain('12 file(s)');
    expect(line).toContain('REAL number');
    expect(line).toContain('never guess');
  });
  it('scales with whatever the real count is (not a fixed/guessed number)', () => {
    expect(chatWorkspaceContextLine(1)).toContain('1 file(s)');
    expect(chatWorkspaceContextLine(200)).toContain('200 file(s)');
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

describe('cheapBuildFloorRunners — optional GLM/Kimi cheap floor, DEFAULT OFF (instant rollback)', () => {
  const ENV = ['AGENTV3_CHEAP_FLOOR', 'GLM_API_KEY', 'GLM_BASE_URL', 'GLM_MODEL', 'KIMI_API_KEY', 'KIMI_BASE_URL', 'KIMI_MODEL'];
  let saved: Record<string, string | undefined>;
  beforeEach(() => { saved = {}; for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  it('returns [] by default (flag unset) — chain stays byte-for-byte today\'s Claude path', () => {
    expect(cheapBuildFloorRunners()).toEqual([]);
  });
  it('returns [] when explicitly off', () => {
    process.env.AGENTV3_CHEAP_FLOOR = 'off';
    expect(cheapBuildFloorRunners()).toEqual([]);
  });
  it('returns [] when the flag names a provider but its KEY is absent (second off-switch)', () => {
    process.env.AGENTV3_CHEAP_FLOOR = 'glm'; // no GLM_API_KEY
    expect(cheapBuildFloorRunners()).toEqual([]);
    process.env.AGENTV3_CHEAP_FLOOR = 'kimi'; // no KIMI_API_KEY
    expect(cheapBuildFloorRunners()).toEqual([]);
  });
  it('wires GLM as a 2-rung ladder by default (newest → 1-step-back) when flag=glm AND key present', () => {
    process.env.AGENTV3_CHEAP_FLOOR = 'glm';
    process.env.GLM_API_KEY = 'glm-test-key';
    const runners = cheapBuildFloorRunners();
    // default ladder = ['glm-4.7','glm-4.6'] → two runners, both named GLM (clean deliveredVia split)
    expect(runners.map((r) => r.name)).toEqual(['GLM', 'GLM']);
  });
  it('wires KIMI as a 2-rung ladder by default when flag=kimi AND key present', () => {
    process.env.AGENTV3_CHEAP_FLOOR = 'kimi';
    process.env.KIMI_API_KEY = 'kimi-test-key';
    expect(cheapBuildFloorRunners().map((r) => r.name)).toEqual(['KIMI', 'KIMI']);
  });
  it('a single GLM_MODEL override → one rung (backward-compatible with the run-sheet)', () => {
    process.env.AGENTV3_CHEAP_FLOOR = 'glm';
    process.env.GLM_API_KEY = 'glm-test-key';
    process.env.GLM_MODEL = 'glm-4.7';
    expect(cheapBuildFloorRunners().map((r) => r.name)).toEqual(['GLM']);
  });
  it('a comma-separated GLM_MODEL → one rung per id (the model fallback ladder)', () => {
    process.env.AGENTV3_CHEAP_FLOOR = 'glm';
    process.env.GLM_API_KEY = 'glm-test-key';
    process.env.GLM_MODEL = 'glm-5.2, glm-4.7 , glm-4.6';
    expect(cheapBuildFloorRunners().map((r) => r.name)).toEqual(['GLM', 'GLM', 'GLM']);
  });
  it('an unknown floor value is treated as off (not "anything but off" — a stray/typo value must never silently enable paid calls)', () => {
    process.env.AGENTV3_CHEAP_FLOOR = 'deepseek';
    process.env.GLM_API_KEY = 'x';
    expect(cheapBuildFloorRunners()).toEqual([]);
  });

  it('"both"/"on" makes GLM and KIMI "friends" — both ladders included, GLM first (admin decision, 2026-07-01)', () => {
    process.env.AGENTV3_CHEAP_FLOOR = 'both';
    process.env.GLM_API_KEY = 'glm-test-key';
    process.env.GLM_MODEL = 'glm-4.7'; // pin to 1 rung each for a clean, exact assertion
    process.env.KIMI_API_KEY = 'kimi-test-key';
    process.env.KIMI_MODEL = 'kimi-k2.7-code';
    expect(cheapBuildFloorRunners().map((r) => r.name)).toEqual(['GLM', 'KIMI']);

    process.env.AGENTV3_CHEAP_FLOOR = 'on';
    expect(cheapBuildFloorRunners().map((r) => r.name)).toEqual(['GLM', 'KIMI']);
  });

  it('with "both" set, GLM alone still works if only GLM has a key (KIMI independently no-ops) — and vice versa', () => {
    process.env.AGENTV3_CHEAP_FLOOR = 'both';
    process.env.GLM_API_KEY = 'glm-test-key';
    process.env.GLM_MODEL = 'glm-4.7';
    // KIMI_API_KEY intentionally absent
    expect(cheapBuildFloorRunners().map((r) => r.name)).toEqual(['GLM']);

    delete process.env.GLM_API_KEY;
    process.env.KIMI_API_KEY = 'kimi-test-key';
    process.env.KIMI_MODEL = 'kimi-k2.7-code';
    expect(cheapBuildFloorRunners().map((r) => r.name)).toEqual(['KIMI']);
  });

  it('"glm"/"kimi" still pin to exactly ONE provider (explicit single-provider testing/rollback) even when the other has a key too', () => {
    process.env.AGENTV3_CHEAP_FLOOR = 'glm';
    process.env.GLM_API_KEY = 'glm-test-key';
    process.env.GLM_MODEL = 'glm-4.7';
    process.env.KIMI_API_KEY = 'kimi-test-key'; // present but must NOT be used — floor pins to glm only
    expect(cheapBuildFloorRunners().map((r) => r.name)).toEqual(['GLM']);
  });
});

describe('cheapFloorAllowedForUser — account canary allowlist (your account before all users)', () => {
  const saved = process.env.AGENTV3_CHEAP_FLOOR_USERS;
  afterEach(() => { if (saved === undefined) delete process.env.AGENTV3_CHEAP_FLOOR_USERS; else process.env.AGENTV3_CHEAP_FLOOR_USERS = saved; });

  it('empty/unset allowlist → every user allowed (default, unchanged behaviour)', () => {
    delete process.env.AGENTV3_CHEAP_FLOOR_USERS;
    expect(cheapFloorAllowedForUser('anyone')).toBe(true);
    expect(cheapFloorAllowedForUser(null)).toBe(true);
    process.env.AGENTV3_CHEAP_FLOOR_USERS = '  ,  ';
    expect(cheapFloorAllowedForUser('anyone')).toBe(true);
  });
  it('a set allowlist → only listed uids (canary), everyone else stays on Claude', () => {
    process.env.AGENTV3_CHEAP_FLOOR_USERS = 'admin-uid, friend-uid';
    expect(cheapFloorAllowedForUser('admin-uid')).toBe(true);
    expect(cheapFloorAllowedForUser('friend-uid')).toBe(true);
    expect(cheapFloorAllowedForUser('random-user')).toBe(false);
    expect(cheapFloorAllowedForUser(null)).toBe(false); // anon never canaried
  });
  it('matches by EMAIL too (case-insensitive) — the admin can canary by their email', () => {
    process.env.AGENTV3_CHEAP_FLOOR_USERS = 'aashishcpmt09@gmail.com';
    expect(cheapFloorAllowedForUser('some-uid', 'aashishcpmt09@gmail.com')).toBe(true);
    expect(cheapFloorAllowedForUser('some-uid', 'AAShishCPMT09@Gmail.com')).toBe(true); // case-insensitive
    expect(cheapFloorAllowedForUser('some-uid', 'other@gmail.com')).toBe(false);
    expect(cheapFloorAllowedForUser('some-uid', null)).toBe(false);
  });
  it('a uid is matched case-sensitively (Firebase uids are case-sensitive)', () => {
    process.env.AGENTV3_CHEAP_FLOOR_USERS = 'AbCdEf123';
    expect(cheapFloorAllowedForUser('AbCdEf123')).toBe(true);
    expect(cheapFloorAllowedForUser('abcdef123')).toBe(false);
  });
});

describe('parseModelLadder — comma-separated newest→older model ladder', () => {
  it('splits a comma list and trims whitespace', () => {
    expect(parseModelLadder('glm-4.7, glm-4.6', ['x'])).toEqual(['glm-4.7', 'glm-4.6']);
  });
  it('a single id → a one-element ladder (old behaviour preserved)', () => {
    expect(parseModelLadder('glm-4.7', ['x'])).toEqual(['glm-4.7']);
  });
  it('empty / undefined / whitespace-only → the provided default ladder', () => {
    expect(parseModelLadder(undefined, ['a', 'b'])).toEqual(['a', 'b']);
    expect(parseModelLadder('', ['a', 'b'])).toEqual(['a', 'b']);
    expect(parseModelLadder('  ,  ', ['a', 'b'])).toEqual(['a', 'b']);
  });
  it('drops blank entries between commas', () => {
    expect(parseModelLadder('glm-4.7,,glm-4.6,', ['x'])).toEqual(['glm-4.7', 'glm-4.6']);
  });
});

describe('cheapFloorAllowedForTier — cheap floor leads only simple/medium (complex → strong model)', () => {
  const saved = process.env.AGENTV3_CHEAP_FLOOR_ALL_TIERS;
  afterEach(() => { if (saved === undefined) delete process.env.AGENTV3_CHEAP_FLOOR_ALL_TIERS; else process.env.AGENTV3_CHEAP_FLOOR_ALL_TIERS = saved; });

  it('allows the floor for simple/medium tiers (gemini, haiku) and unknown', () => {
    delete process.env.AGENTV3_CHEAP_FLOOR_ALL_TIERS;
    expect(cheapFloorAllowedForTier('gemini')).toBe(true);
    expect(cheapFloorAllowedForTier('haiku')).toBe(true);
    expect(cheapFloorAllowedForTier(undefined)).toBe(true); // cost-ladder off → allowed (Claude backstops)
  });
  it('SKIPS the floor for complex/power tiers (sonnet, opus)', () => {
    delete process.env.AGENTV3_CHEAP_FLOOR_ALL_TIERS;
    expect(cheapFloorAllowedForTier('sonnet')).toBe(false);
    expect(cheapFloorAllowedForTier('opus')).toBe(false);
  });
  it('AGENTV3_CHEAP_FLOOR_ALL_TIERS=1 overrides → floor allowed on every tier', () => {
    process.env.AGENTV3_CHEAP_FLOOR_ALL_TIERS = '1';
    expect(cheapFloorAllowedForTier('sonnet')).toBe(true);
    expect(cheapFloorAllowedForTier('opus')).toBe(true);
  });
});

describe('dominantProvider — PR4 deliveredVia (which model drove most build turns)', () => {
  it('returns the provider with the most turns (the dominant builder)', () => {
    const turns = new Map<string, number>([['GLM', 18], ['CLAUDE', 2]]);
    expect(dominantProvider(turns)).toBe('GLM'); // cheap floor carried the build
  });
  it('returns CLAUDE when escalation took over most turns', () => {
    const turns = new Map<string, number>([['GLM', 1], ['CLAUDE', 9]]);
    expect(dominantProvider(turns)).toBe('CLAUDE'); // fell back to Claude — the tripwire signal
  });
  it('keeps the first-seen provider on a tie (the leading provider)', () => {
    const turns = new Map<string, number>([['GLM', 5], ['CLAUDE', 5]]);
    expect(dominantProvider(turns)).toBe('GLM');
  });
  it('returns undefined for an empty map (non-agentic lanes record nothing)', () => {
    expect(dominantProvider(new Map())).toBeUndefined();
  });
});

describe('oneShotDevPort — preview port per framework for the one-shot lane', () => {
  it('maps frameworks to their dev-server port', () => {
    expect(oneShotDevPort('vite-react')).toBe(5173);
    expect(oneShotDevPort('vue')).toBe(5173);
    expect(oneShotDevPort('nextjs')).toBe(3000);
    expect(oneShotDevPort('angular')).toBe(4200);
    expect(oneShotDevPort('astro')).toBe(4321);
    expect(oneShotDevPort('static')).toBe(3000);
    expect(oneShotDevPort('python-fastapi')).toBe(8000);
  });
});

describe('parseDevServerHealthCheck — real "Diagnose" outcome from E2BActuator.runCommand output', () => {
  it('detects an UP dev server and extracts the real bound port', () => {
    const combined = 'npm install output...\n[health-check] dev server is UP on port 5173. Call update_preview with port=5173.';
    expect(parseDevServerHealthCheck(combined)).toEqual({ up: true, port: 5173 });
  });

  it('detects a DOWN dev server and extracts the port it failed on', () => {
    const combined = 'some crash log\n[health-check] dev server did not come up on port 5173 — check the logs above, then start it again.';
    expect(parseDevServerHealthCheck(combined)).toEqual({ up: false, port: 5173 });
  });

  it('falls back to unknown-port-down when neither health-check line is present (unexpected output)', () => {
    expect(parseDevServerHealthCheck('some unrelated log with no health-check marker')).toEqual({ up: false, port: null });
  });

  it('picks the actually-bound port even when it drifted from the requested one', () => {
    const combined = '[health-check] dev server is UP on port 5174. Call update_preview with port=5174.';
    expect(parseDevServerHealthCheck(combined)).toEqual({ up: true, port: 5174 });
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
  it('defaults to 1080s (18 min)', () => {
    delete process.env.AGENTV3_MAX_BUILD_SECONDS;
    expect(maxBuildSeconds()).toBe(1080);
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
    expect(maxBuildSeconds()).toBe(1080);
  });
});

describe('maxBuildBudgetUsd (per-build cost cap — TEMPORARILY DISABLED by default, admin decision 2026-07-01)', () => {
  const prev = process.env.AGENTV3_MAX_BUILD_USD;
  afterEach(() => {
    if (prev === undefined) delete process.env.AGENTV3_MAX_BUILD_USD;
    else process.env.AGENTV3_MAX_BUILD_USD = prev;
  });
  it('defaults to 0 (disabled) — a build is never cut off mid-repair while bugs are still being fixed', () => {
    delete process.env.AGENTV3_MAX_BUILD_USD;
    expect(maxBuildBudgetUsd()).toBe(0);
  });
  it('honors a positive override (re-enabling the cap needs only an env var, no code change)', () => {
    process.env.AGENTV3_MAX_BUILD_USD = '25';
    expect(maxBuildBudgetUsd()).toBe(25);
  });
  it('treats an explicit 0 the same as unset (disabled)', () => {
    process.env.AGENTV3_MAX_BUILD_USD = '0';
    expect(maxBuildBudgetUsd()).toBe(0);
  });
  it('falls back to disabled on garbage', () => {
    process.env.AGENTV3_MAX_BUILD_USD = 'abc';
    expect(maxBuildBudgetUsd()).toBe(0);
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

describe('isBuildRunningForWorkspace — server-side session/workspace scoping for auto-resume + live-mirror', () => {
  // Root-caused 2026-07-01: a build genuinely still running in a DIFFERENT v3.0 session under the
  // same account was silently auto-attached/mirrored into whatever session the user had just opened
  // (e.g. right after "+ New chat"), because the running-build registry was checked account-wide
  // (userId only) with no idea WHICH session's build it actually was.
  const fakeRunningBuild = (overrides: Partial<RunningBuild> = {}): RunningBuild => ({
    abort: new AbortController(),
    buffer: [],
    subscribers: new Set(),
    ended: false,
    startedTs: Date.now(),
    ...overrides,
  });

  it('no running build at all → false regardless of workspaceId', () => {
    expect(isBuildRunningForWorkspace(undefined, 'agentv3-u1-s1')).toBe(false);
    expect(isBuildRunningForWorkspace(undefined, null)).toBe(false);
  });

  it('a running build that has already ended → false even if workspaceId matches', () => {
    const rb = fakeRunningBuild({ ended: true, workspaceId: 'agentv3-u1-s1' });
    expect(isBuildRunningForWorkspace(rb, 'agentv3-u1-s1')).toBe(false);
  });

  it('workspaceId omitted (null) → falls back to the account-wide check (back-compat)', () => {
    const rb = fakeRunningBuild({ workspaceId: 'agentv3-u1-s1' });
    expect(isBuildRunningForWorkspace(rb, null)).toBe(true);
  });

  it('running build IS for the requested workspace → true', () => {
    const rb = fakeRunningBuild({ workspaceId: 'agentv3-u1-s1' });
    expect(isBuildRunningForWorkspace(rb, 'agentv3-u1-s1')).toBe(true);
  });

  it('running build is for a DIFFERENT session under the same account → false (the actual fix)', () => {
    // This is the exact scenario from the report: a 12-file build still running in session A,
    // the user opens fresh session B ("+ New chat") — B must NOT see A's build as "running here".
    const rb = fakeRunningBuild({ workspaceId: 'agentv3-u1-OLD_SESSION' });
    expect(isBuildRunningForWorkspace(rb, 'agentv3-u1-NEW_SESSION')).toBe(false);
  });

  it('running build has no workspaceId recorded, but the CALLER requested a specific one → false (unknown ownership is never assumed to match)', () => {
    const rb = fakeRunningBuild({});
    expect(isBuildRunningForWorkspace(rb, 'agentv3-u1-s1')).toBe(false);
  });
});
