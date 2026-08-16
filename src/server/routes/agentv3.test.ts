import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deriveWorkspaceId, resolveJudgeKind, healRunnerRoutingOpts, weakFlagshipHealEnabled, agentV3KeyDiag, providerDebugTag, conversationAccess, needsFallbackConversationPersist, terminalConversationStatus, tierToGeminiBuildModel, selectBuildModel, isLargeExistingProject, shouldRouteStrongModel, oneShotDevPort, escalationEnabled, shouldEscalateBuild, escalationGate, userMonthlyCapUsd, checkMonthlyCap, readinessGateEnabled, reviewerShouldRun, maxBuildSeconds, buildMaxTokensPerTurn, maxBuildBudgetUsd, sandboxDiag, resolveClaudeFirst, planGrokEnabled, raceTimeout, cheapBuildFloorRunners, cheapFloorAllowedForTier, cheapFloorAllowedForUser, cheapFloorDecision, pickPreviewErrorBase, geminiLastResortEnabled, vertexPeerBuildEnabled, dominantProvider, fastLaneProviderLabel, parseModelLadder, parseKeyPool, chatWorkspaceContextLine, parseDevServerHealthCheck, isBuildRunningForWorkspace, shouldReclaimBuildLock, buildSandboxUnavailableInProd, resolveBuildIdentity, entitlementEmail, workspaceOwnershipOk, conversationIdForWorkspace, candidateConversationIds, resolveIdentityWithFallback, verifiedWorkspaceReadOk, shutdownGraceMs, rebuildGuardFlipsToEdit, shouldConfirmRebuild, zeroBillForUnrenderedPreview, zeroBillForFailedBuild, shouldRunIntegrityHeal, shouldRetryEmptyBuild, emptyBuildFailureSummary, finalSyntaxErrorSummary, failedImportPromptNote, importSurveyPromptNote, importHonestySummaryPrefix, IMPORT_HONESTY_PREFIX_MARK, enforceNoClaude, planRunnerChainNames, steerAllowedForBuild, sanitizeSteerMessage, redactProviderError, sandboxUnavailableNotice, statusEntitlement, isReportAdmin, balanceFloorLead, _resetFloorLeadCounter, type RunningBuild,
  postBuildCodeGateShouldRun,
} from './agentv3';
import { analyzeRequest } from '../AgentV3/RequestAnalyser';
import { haikuModel, sonnetModel, opusModel } from '../AgentV3/models';
import { isAgentV3FreeUser, buildRequiresSignIn } from '../AgentV3/featureFlag';
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

  it('anon-bucket records are readable (mirrors the #829 workspace exemption) — the "own transcript forbidden" fix', () => {
    // An identity-degraded build saved its FULL transcript under userId 'anon'; the signed-in user
    // opening that chat was refused → the restore fell back to an empty local copy. The anon bucket
    // has no real owner; its unguessable id is the capability.
    expect(conversationAccess({ userId: 'anon' }, 'u1')).toBe('ok');
    expect(conversationAccess({ userId: 'anon' }, null)).toBe('ok');
  });
});

describe('resolveIdentityWithFallback — the "history opens to 0 messages" regression lock', () => {
  it('uses the VERIFIED identity when the token verified — and it OVERRIDES a (possibly spoofed) claimed id', () => {
    // Token present + valid → the verified uid/email win, ignoring whatever the client claimed.
    expect(resolveIdentityWithFallback({ uid: 'real', email: 'real@x.com' }, 'spoofed', 'spoof@x.com'))
      .toEqual({ userId: 'real', email: 'real@x.com' });
  });

  it('falls back to the CLAIMED id when the token did NOT verify (the transient-failure path)', () => {
    // verifyIdToken returned null (expired/again-refreshed token, admin-SDK cert hiccup, cold start).
    // WITHOUT this fallback the conversation routes returned userId=null → list 400'd + get-one 404'd
    // → every history chat opened to "saved copy has 0 messages". Reverting to verified-only here
    // reintroduces that bug — this test is the guard.
    expect(resolveIdentityWithFallback(null, 'u1', 'u1@x.com')).toEqual({ userId: 'u1', email: 'u1@x.com' });
  });

  it('is fully anonymous (null identity) only when the token fails AND nothing was claimed', () => {
    expect(resolveIdentityWithFallback(null, null, null)).toEqual({ userId: null, email: null });
  });

  it('a verified token with no email still wins over a claimed email (no email spoofing)', () => {
    expect(resolveIdentityWithFallback({ uid: 'real', email: null }, 'x', 'claimed@x.com'))
      .toEqual({ userId: 'real', email: null });
  });
});

describe('candidateConversationIds — a v3_ history entry finds its real server transcript', () => {
  it('tries the literal id, the signed-in workspace id, then the anon-degraded workspace id', () => {
    expect(candidateConversationIds('v3_sess-1234', 'u1')).toEqual([
      'v3_sess-1234',
      'agentv3-u1-sess-1234',
      'agentv3-anon-sess-1234',
    ]);
  });
  it('skips the uid candidate when there is no (or an unsafe) verified uid', () => {
    expect(candidateConversationIds('v3_sess-1234', null)).toEqual(['v3_sess-1234', 'agentv3-anon-sess-1234']);
    expect(candidateConversationIds('v3_sess-1234', 'bad uid!')).toEqual(['v3_sess-1234', 'agentv3-anon-sess-1234']);
  });
  it('non-v3_ ids resolve only to themselves', () => {
    expect(candidateConversationIds('agentv3-u1-sess-1234', 'u1')).toEqual(['agentv3-u1-sess-1234']);
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

describe('terminalConversationStatus (build-report autopsy 2026-08-02 — "na successful, na fail, na ₹")', () => {
  it('a definitive SUCCESS stamps status:complete (was left at "running" → reopen showed no verdict)', () => {
    expect(terminalConversationStatus({ ok: true })).toBe('complete');
  });
  it('a definitive FAILURE stamps status:error', () => {
    expect(terminalConversationStatus({ ok: false })).toBe('error');
  });
  it('a NULL/absent verdict leaves status UNTOUCHED — a resumable pause must never be clobbered', () => {
    expect(terminalConversationStatus(null)).toBeUndefined();
    expect(terminalConversationStatus(undefined)).toBeUndefined();
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

describe('workspaceOwnershipOk — fixes "Forbidden: this workspace does not belong to you"', () => {
  it('lets a user access their own real workspace (verified uid matches)', () => {
    expect(workspaceOwnershipOk('user1', null, 'agentv3-user1-sess-abc123')).toBe(true);
  });

  it('still BLOCKS a real workspace when the resolved uid does not match (IDOR stays closed)', () => {
    // A signed-in user (verified user2) must not reach user1's real workspace, even if they claim user1.
    expect(workspaceOwnershipOk('user2', 'user1', 'agentv3-user1-sess-abc123')).toBe(false);
    // A claimed id without a verified token does not grant access to another user's real workspace.
    expect(workspaceOwnershipOk(null, 'user1', 'agentv3-user2-sess-abc123')).toBe(false);
  });

  it('allows an anon-bucket workspace for any caller — the real fix for the Forbidden bug', () => {
    // The build degraded a signed-in user to anon (agentv3-anon-…); the preview call resolves them
    // to their REAL uid. Before the fix this mismatch → Forbidden on the user's OWN build.
    expect(workspaceOwnershipOk('user1', 'user1', 'agentv3-anon-62e136f0-0f0c')).toBe(true);
    // And a genuinely anonymous caller (no token, no claim) still reaches the anon bucket.
    expect(workspaceOwnershipOk(null, null, 'agentv3-anon-62e136f0-0f0c')).toBe(true);
  });

  it('rejects a malformed / non-agentv3 workspace id', () => {
    expect(workspaceOwnershipOk('user1', null, '')).toBe(false);
    expect(workspaceOwnershipOk('user1', null, 'not-a-workspace')).toBe(false);
  });

});

// SECURITY Phase 3.2 (IDOR) — the diagnostics + decision-trace GET routes had NO ownership check;
// anyone who learned a workspaceId (e.g. via the now-closed enumeration leak) could download another
// user's full build report / decision trace. These reads now gate on the STRICTER
// verifiedWorkspaceReadOk — verified-uid ONLY (no spoofable claimed-uid fallback, since the uid is
// embedded in the workspaceId, so a claimed fallback would let a token-less attacker who learned
// `agentv3-victim-{sid}` pass by claiming userId=victim). Anon reads stay by unguessable sid.
describe('verifiedWorkspaceReadOk — Phase 3.2 strict owner gate for private report/trace reads', () => {
  it('THE IDOR: a token-less attacker who learned the victim\'s workspaceId is REFUSED (no claimed fallback)', () => {
    expect(verifiedWorkspaceReadOk(null, 'agentv3-victim-sess-9a8b7c')).toBe(false);
    // even a DIFFERENT verified user cannot read the victim's real workspace
    expect(verifiedWorkspaceReadOk('attacker', 'agentv3-victim-sess-9a8b7c')).toBe(false);
  });
  it('the real owner (verified) reads their own report/trace', () => {
    expect(verifiedWorkspaceReadOk('victim', 'agentv3-victim-sess-9a8b7c')).toBe(true);
  });
  it('anon-capability preserved: an agentv3-anon-* workspace is reachable by its unguessable id (Fix 26)', () => {
    expect(verifiedWorkspaceReadOk(null, 'agentv3-anon-62e136f0-0f0c')).toBe(true);
    expect(verifiedWorkspaceReadOk('anyone', 'agentv3-anon-62e136f0-0f0c')).toBe(true);
  });
  it('rejects malformed / non-agentv3 ids', () => {
    expect(verifiedWorkspaceReadOk('victim', '')).toBe(false);
    expect(verifiedWorkspaceReadOk('victim', 'not-a-workspace')).toBe(false);
  });
});

describe('conversationIdForWorkspace — one conversation per SESSION, not per message/build', () => {
  it('is STABLE for a given workspace (every message/build in a session shares one conversation)', () => {
    const ws = deriveWorkspaceId('user1', 'sess-abcdef');
    // The SAME session-workspace always maps to the SAME conversation id — so build 2, 3, … append to
    // build 1's conversation instead of forking a new history entry each time.
    expect(conversationIdForWorkspace(ws)).toBe(conversationIdForWorkspace(ws));
    expect(conversationIdForWorkspace(ws)).toBe(ws);
  });

  it('is DISTINCT across different sessions (a real new chat is a real new entry)', () => {
    const a = conversationIdForWorkspace(deriveWorkspaceId('user1', 'sess-aaaaaa'));
    const b = conversationIdForWorkspace(deriveWorkspaceId('user1', 'sess-bbbbbb'));
    expect(a).not.toBe(b);
  });
});

describe('chatWorkspaceContextLine — v5.0 always knows its real file count, even in plain chat', () => {
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

describe('reviewerShouldRun — a "do not change any files" import/survey turn gets NO post-build reviewer', () => {
  // ROOT-CAUSE lock (autopsy build 77bd487b): a read-only survey import ran the reviewer ~16 min AND its
  // heal edited the imported project (added imports + 12 package.json deps) — because the gate keyed off
  // `wroteFiles`, which INFRA writes (the .env that loads the user's keys) push above zero on a survey turn.
  it('is FALSE on an import turn even when infra files were written (the exact 77bd487b failure)', () => {
    expect(reviewerShouldRun({ wroteFiles: true, isImportTurn: true, fastLaneGated: false, reviewFastlaneForced: false, startTierSonnet: true })).toBe(false);
  });
  it('is FALSE when nothing was written (nothing to review)', () => {
    expect(reviewerShouldRun({ wroteFiles: false, isImportTurn: false, fastLaneGated: false, reviewFastlaneForced: false, startTierSonnet: true })).toBe(false);
  });
  it('RUNS on a real agentic build that wrote files (not fast-lane-gated, not an import turn)', () => {
    expect(reviewerShouldRun({ wroteFiles: true, isImportTurn: false, fastLaneGated: false, reviewFastlaneForced: false, startTierSonnet: false })).toBe(true);
  });
  it('is skipped for a fast-lane build unless forced or a Sonnet-tier prompt', () => {
    expect(reviewerShouldRun({ wroteFiles: true, isImportTurn: false, fastLaneGated: true, reviewFastlaneForced: false, startTierSonnet: false })).toBe(false);
    expect(reviewerShouldRun({ wroteFiles: true, isImportTurn: false, fastLaneGated: true, reviewFastlaneForced: true, startTierSonnet: false })).toBe(true);
    expect(reviewerShouldRun({ wroteFiles: true, isImportTurn: false, fastLaneGated: true, reviewFastlaneForced: false, startTierSonnet: true })).toBe(true);
  });
  it('an import turn is NEVER reviewed, whatever the other flags say', () => {
    for (const fastLaneGated of [true, false]) {
      for (const startTierSonnet of [true, false]) {
        expect(reviewerShouldRun({ wroteFiles: true, isImportTurn: true, fastLaneGated, reviewFastlaneForced: true, startTierSonnet })).toBe(false);
      }
    }
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

// Model Routing Policy (admin 2026-07-12): judge is mode-aware — Free=Grok, Paid=Grok/Sonnet, Power=Opus.
describe('resolveJudgeKind — mode-aware judge selection', () => {
  it('POWER → always Opus (judge runs on Opus like everything in power mode)', () => {
    expect(resolveJudgeKind('power', undefined, undefined)).toBe('opus');
    expect(resolveJudgeKind('power', 'grok-key', 'sonnet')).toBe('opus'); // power ignores grok/env
  });
  it('FREE → Grok when a Grok key exists; never a Claude judge', () => {
    expect(resolveJudgeKind('free', 'grok-key', undefined)).toBe('grok');
  });
  it('FREE without a Grok key → "sonnet" signal (caller SKIPS the judge — free never spends Claude)', () => {
    expect(resolveJudgeKind('free', undefined, undefined)).toBe('sonnet');
  });
  it('PAID → Grok when a key exists and reviewer≠sonnet; Sonnet otherwise (today\'s behaviour)', () => {
    expect(resolveJudgeKind('paid', 'grok-key', undefined)).toBe('grok');
    expect(resolveJudgeKind('paid', 'grok-key', 'sonnet')).toBe('sonnet'); // AGENTV3_REVIEWER=sonnet forces Sonnet
    expect(resolveJudgeKind('paid', undefined, undefined)).toBe('sonnet'); // no grok → Sonnet
  });
});

// Model Routing Policy (admin 2026-07-12): a FREE build must NEVER touch Claude — the post-build heal
// gates (integrity/preview/C9/runtime) + the no-files retry go cheap-only on a free build.
describe('healRunnerRoutingOpts — free heal is cheap-only (no Claude); paid/power stays Claude-first', () => {
  const prev = process.env.AGENTV3_WEAK_FLAGSHIP_HEAL;
  afterEach(() => { if (prev === undefined) delete process.env.AGENTV3_WEAK_FLAGSHIP_HEAL; else process.env.AGENTV3_WEAK_FLAGSHIP_HEAL = prev; });

  it('FREE build → the GRADUATED heal ladder by default: flagship reachable but LAST, never Claude-first', () => {
    /**
     * ADMIN 2026-08-13, stated three times: "top module last me chalne, starting me nahi" /
     * "flagship use kar sakte hai, LAST me". The default therefore no longer LEADS with the flagship —
     * a weak repair climbs cheap coder → flagship, so the expensive rung is only paid for when the
     * cheaper one could not fix it. The 2026-08-02 flagship-led behaviour is one env away.
     */
    delete process.env.AGENTV3_WEAK_FLAGSHIP_HEAL; // default: graduated
    expect(healRunnerRoutingOpts(true)).toEqual({ claudeFirst: false, cheapOnly: true, allowCheapFloor: true, free: true, heal: true });
    expect(weakFlagshipHealEnabled()).toBe(false);
  });

  it('AGENTV3_WEAK_FLAGSHIP_HEAL=on restores the flagship-LED heal (2026-08-02 behaviour)', () => {
    process.env.AGENTV3_WEAK_FLAGSHIP_HEAL = 'on';
    expect(healRunnerRoutingOpts(true)).toEqual({ claudeFirst: false, cheapOnly: true, allowCheapFloor: true, free: true, flagship: true });
    expect(weakFlagshipHealEnabled()).toBe(true);
  });
  it('the graduated default keeps a real floor — it can never fall through to Gemini/Haiku', () => {
    /**
     * THE TRAP THIS FIXES (admin 2026-08-13). This used to assert `{ claudeFirst: false, cheapOnly: true }`
     * — no `allowCheapFloor` — and that does NOT mean "cheap coders instead of the flagship".
     * `buildTurnRunner` only builds the GLM/Kimi floor when `allowCheapFloor` is set, and `cheapOnly`
     * self-disables without one, so the weak heal chain collapsed to VERTEX → GEMINI → Haiku with no
     * GLM/Kimi in it at all.
     *
     * Which made the "cheaper" switch the MOST EXPENSIVE option, on precisely the tier NavBharatAI pays
     * for itself: gemini-pro is $10/MTok out and Haiku $5, against glm-5.2's $4.40 and kimi-k2.7's $4.00.
     * The flag now does what its name says.
     */
    process.env.AGENTV3_WEAK_FLAGSHIP_HEAL = 'off';
    expect(healRunnerRoutingOpts(true)).toEqual({ claudeFirst: false, cheapOnly: true, allowCheapFloor: true, free: true, heal: true });
    expect(weakFlagshipHealEnabled()).toBe(false);
  });

  it('BOTH weak-heal settings keep a real GLM/Kimi floor — neither can silently route to Gemini/Haiku', () => {
    // The property that matters more than either branch: `allowCheapFloor` is what makes a floor exist
    // at all, so a weak heal must never be configured without it. This is the assertion that would have
    // caught the trap above.
    for (const v of ['on', 'off']) {
      process.env.AGENTV3_WEAK_FLAGSHIP_HEAL = v;
      expect(healRunnerRoutingOpts(true), v).toMatchObject({ allowCheapFloor: true, free: true, cheapOnly: true, claudeFirst: false });
    }
  });
  it('PAID / POWER build → Claude-first, not cheap-only (UNCHANGED — flagship weak-heal never touches paid)', () => {
    expect(healRunnerRoutingOpts(false)).toEqual({ claudeFirst: true, cheapOnly: false });
  });
});

describe('cheapBuildFloorRunners flagshipOnly — weak-fail repair runs on the TOP GLM/Kimi rung only', () => {
  const ENV = ['AGENTV3_CHEAP_FLOOR', 'GLM_API_KEY', 'KIMI_API_KEY', 'AGENTV3_FREE_GLM_MODEL', 'AGENTV3_FREE_KIMI_MODEL', 'AGENTV3_FLOOR_BALANCE'];
  let saved: Record<string, string | undefined>;
  beforeEach(() => { saved = {}; for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; } _resetFloorLeadCounter(); process.env.AGENTV3_FLOOR_BALANCE = 'off'; });
  afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  it('free + flagshipOnly keeps ONLY the last (flagship) rung of each free ladder — no cheap flash/coder rungs', () => {
    process.env.GLM_API_KEY = 'k'; process.env.KIMI_API_KEY = 'k';
    // free default ladders: GLM [flash,4.7,5.2] · KIMI [k2.5,k2.6,k2.7-code] → flagshipOnly → 1 GLM + 1 KIMI
    const runners = cheapBuildFloorRunners({ free: true, flagshipOnly: true });
    expect(runners.filter((r) => r.name === 'GLM').length).toBe(1);
    expect(runners.filter((r) => r.name === 'KIMI').length).toBe(1);
  });
  it('free WITHOUT flagshipOnly keeps the full cheapest-first ladder (3 GLM + 3 KIMI rungs)', () => {
    process.env.GLM_API_KEY = 'k'; process.env.KIMI_API_KEY = 'k';
    const runners = cheapBuildFloorRunners({ free: true });
    expect(runners.filter((r) => r.name === 'GLM').length).toBe(3);
    expect(runners.filter((r) => r.name === 'KIMI').length).toBe(3);
  });
});

describe('pickPreviewErrorBase — a late preview error must never fork the evidence (jungle-game reports)', () => {
  const rep = (ws: string) => ({ workspaceId: ws, marker: ws });
  it('prefers the durable copy when present', () => {
    const durable = rep('ws-1'); const mem = rep('ws-1');
    expect(pickPreviewErrorBase(durable, mem, 'ws-1')).toBe(durable);
  });
  it('falls back to the in-memory copy when durable is missing (the fork that hid CANVAS_HEIGHT)', () => {
    const mem = rep('ws-1');
    expect(pickPreviewErrorBase(null, mem, 'ws-1')).toBe(mem);
  });
  it('rejects an in-memory copy from a DIFFERENT workspace (per-user map can hold another project)', () => {
    expect(pickPreviewErrorBase(null, rep('ws-other'), 'ws-1')).toBeNull();
  });
  it('null when neither copy exists — nothing to attach to (honest, not a blind ok)', () => {
    expect(pickPreviewErrorBase(null, null, 'ws-1')).toBeNull();
  });
});

describe('cheapFloorDecision — honest routing reason for every build report', () => {
  const base = { allowCheapFloor: true, routeStrong: false, freeTierBuildActive: false, tierAllowed: true, userAllowed: true };
  it('ACTIVE when flag on + a key present + allowed', () => {
    const d = cheapFloorDecision({ AGENTV3_CHEAP_FLOOR: 'on', GLM_API_KEY: 'k' } as any, base);
    expect(d.active).toBe(true);
    expect(d.reason).toMatch(/ACTIVE/);
  });
  it('OFF reason when the flag is explicitly off', () => {
    const d = cheapFloorDecision({ AGENTV3_CHEAP_FLOOR: 'off', GLM_API_KEY: 'k' } as any, base);
    expect(d.active).toBe(false);
    expect(d.reason).toMatch(/AGENTV3_CHEAP_FLOOR=off/);
  });
  it('KEY-MISSING reason when flag on but no GLM/KIMI key (the fae70e42 mystery, made explicit)', () => {
    const d = cheapFloorDecision({ AGENTV3_CHEAP_FLOOR: 'on' } as any, base);
    expect(d.active).toBe(false);
    expect(d.reason).toMatch(/no matching API key/);
    expect(d.reason).toMatch(/GLM_API_KEY\/KIMI_API_KEY/);
  });
  it('CANARY reason when a key is present but the account is not in AGENTV3_CHEAP_FLOOR_USERS', () => {
    const d = cheapFloorDecision({ AGENTV3_CHEAP_FLOOR: 'on', GLM_API_KEY: 'k' } as any,
      { ...base, allowCheapFloor: false, userAllowed: false });
    expect(d.active).toBe(false);
    expect(d.reason).toMatch(/AGENTV3_CHEAP_FLOOR_USERS/);
  });
  it('STRONG-ROUTE reason for a large/import build (skipped by design)', () => {
    const d = cheapFloorDecision({ AGENTV3_CHEAP_FLOOR: 'on', KIMI_API_KEY: 'k' } as any,
      { ...base, allowCheapFloor: false, routeStrong: true });
    expect(d.active).toBe(false);
    expect(d.reason).toMatch(/Large project \/ import/);
  });
  it('defaults the flag to on (unset) — key present + allowed → ACTIVE', () => {
    const d = cheapFloorDecision({ GLM_API_KEY: 'k' } as any, base);
    expect(d.active).toBe(true);
  });
});

describe('parseKeyPool — provider key rotation pool (ROADMAP Tier-4)', () => {
  it('splits a comma/whitespace list, trims, drops blanks, de-dupes', () => {
    expect(parseKeyPool('k1,k2')).toEqual(['k1', 'k2']);
    expect(parseKeyPool('k1, k2 , k3')).toEqual(['k1', 'k2', 'k3']);
    expect(parseKeyPool('k1  k2\nk3')).toEqual(['k1', 'k2', 'k3']); // whitespace-separated
    expect(parseKeyPool('k1,k1,k2')).toEqual(['k1', 'k2']); // de-dupe
    expect(parseKeyPool('  solo  ')).toEqual(['solo']); // single key → list of one
  });
  it('an empty/undefined env → [] (a second, independent off-switch)', () => {
    expect(parseKeyPool(undefined)).toEqual([]);
    expect(parseKeyPool('')).toEqual([]);
    expect(parseKeyPool('   , ,  ')).toEqual([]);
  });
});

describe('cheapBuildFloorRunners — GLM/Kimi cheap floor LEADS by default (admin: 1st call not Claude)', () => {
  const ENV = ['AGENTV3_CHEAP_FLOOR', 'GLM_API_KEY', 'GLM_BASE_URL', 'GLM_MODEL', 'KIMI_API_KEY', 'KIMI_BASE_URL', 'KIMI_MODEL', 'BEDROCK_API_KEY', 'BEDROCK_REGION', 'BEDROCK_GLM_MODEL', 'AGENTV3_FREE_GLM_MODEL', 'AGENTV3_FREE_KIMI_MODEL', 'AGENTV3_FLOOR_BALANCE', 'AGENTV3_FREE_KIMI_LEAD'];
  let saved: Record<string, string | undefined>;
  beforeEach(() => { saved = {}; for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; } _resetFloorLeadCounter(); });
  afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  it('returns [] when flag unset AND no keys — still byte-for-byte the Claude path (safe with no keys)', () => {
    // Default is now 'on', but a keyless rung is skipped by add(), so with NO GLM/KIMI keys the floor is
    // still empty and Claude leads — the default flip can never break a deployment that has no keys.
    expect(cheapBuildFloorRunners()).toEqual([]);
  });
  it('LEADS with GLM+Kimi by default (flag unset) when keys are present — 1st call is not Claude', () => {
    process.env.GLM_API_KEY = 'glm-test-key';
    process.env.KIMI_API_KEY = 'kimi-test-key';
    const runners = cheapBuildFloorRunners();
    expect(runners.length).toBeGreaterThan(0);
    expect(runners[0].name).toBe('GLM'); // flagship GLM (glm-5.2) leads the very first attempt
    expect(runners.some((r) => r.name === 'KIMI')).toBe(true);
  });
  it('returns [] when explicitly off (env-authoritative kill switch overrides the on default)', () => {
    process.env.AGENTV3_CHEAP_FLOOR = 'off';
    process.env.GLM_API_KEY = 'glm-test-key'; // even WITH a key, explicit off wins
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
    // default ladder = ['glm-5.2','glm-4.7'] → two runners, both named GLM (clean deliveredVia split)
    expect(runners.map((r) => r.name)).toEqual(['GLM', 'GLM']);
  });
  // 3 rungs since 2026-07-28: kimi-k3 was PREPENDED to the paid ladder (admin-approved), never
  // swapped in — so an unknown-id error on K3 falls through to k2.7-code exactly as before and no
  // build can break even if K3 is not a live model. Asserting the COUNT alone would pass for a
  // replacement too, which is the one shape we must not ship; the free-ladder test below pins the
  // other half of the decision (the weak module was deliberately left untouched).
  it('wires KIMI as a 3-rung ladder by default when flag=kimi AND key present, K3 leading', () => {
    process.env.AGENTV3_CHEAP_FLOOR = 'kimi';
    process.env.KIMI_API_KEY = 'kimi-test-key';
    const runners = cheapBuildFloorRunners();
    expect(runners.map((r) => r.name)).toEqual(['KIMI', 'KIMI', 'KIMI']);
    // k2.7-code must still be present BELOW k3 — the fall-through that makes adoption safe.
    expect(parseModelLadder(undefined, ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6']))
      .toEqual(['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6']);
  });

  it('the FREE/weak Kimi ladder is UNCHANGED — cheapest first, flagship last, no K3', () => {
    // Admin 2026-07-28: "weak module abhi jaisa hai vaise hi". The free ladder climbs cheapest-first,
    // so a newer flagship in front would invert the free tier's cost model. If someone later
    // "harmonises" the two ladders, this fails.
    const free = parseModelLadder(undefined, ['kimi-k2.5', 'kimi-k2.6', 'kimi-k2.7-code']);
    expect(free[0]).toBe('kimi-k2.5');
    expect(free).not.toContain('kimi-k3');
  });
  // FLOOR BALANCE (admin directive 2026-07-21 — "GLM par pura load na dalo, smartly divide"): the
  // GLM↔KIMI lead alternates per construction so first-attempt load spreads across both cheap coders.
  it('FLOOR BALANCE — the lead alternates GLM → KIMI → GLM across constructions (both keys present)', () => {
    process.env.GLM_API_KEY = 'glm-test-key';
    process.env.KIMI_API_KEY = 'kimi-test-key';
    const first = cheapBuildFloorRunners();
    const second = cheapBuildFloorRunners();
    const third = cheapBuildFloorRunners();
    expect(first[0].name).toBe('GLM');   // construction 1 — GLM leads (today's order)
    expect(second[0].name).toBe('KIMI'); // construction 2 — KIMI leads (the load-divide)
    expect(third[0].name).toBe('GLM');   // construction 3 — back to GLM
    // The SAME rung set every time — only the order rotates; nothing is dropped or added.
    const names = (rs: typeof first) => rs.map((r) => r.name).sort();
    expect(names(second)).toEqual(names(first));
    expect(names(third)).toEqual(names(first));
  });
  it('FREE-TIER KIMI LEAD — a free build leads with KIMI (GLM 429-storm autopsy 2026-08-02); GLM stays as fallback', () => {
    process.env.GLM_API_KEY = 'glm-test-key';
    process.env.KIMI_API_KEY = 'kimi-test-key';
    const free = cheapBuildFloorRunners({ free: true });
    expect(free[0].name).toBe('KIMI');                                     // KIMI leads on a free build
    expect(cheapBuildFloorRunners({ free: true })[0].name).toBe('KIMI');   // every free construction — no 50/50 flip
    expect(free.some((r) => r.name === 'GLM')).toBe(true);                 // GLM still present as the error-fallback
    // Paid build is UNCHANGED — still the GLM↔KIMI 50/50 alternation.
    _resetFloorLeadCounter();
    expect(cheapBuildFloorRunners()[0].name).toBe('GLM');
    expect(cheapBuildFloorRunners()[0].name).toBe('KIMI');
  });
  it('FREE-TIER KIMI LEAD — kill switch AGENTV3_FREE_KIMI_LEAD=off restores GLM-first for free too', () => {
    process.env.GLM_API_KEY = 'glm-test-key';
    process.env.KIMI_API_KEY = 'kimi-test-key';
    process.env.AGENTV3_FREE_KIMI_LEAD = 'off';
    expect(cheapBuildFloorRunners({ free: true })[0].name).toBe('GLM'); // off → falls back to the normal balance (GLM first)
  });
  it('FLOOR BALANCE — kill switch AGENTV3_FLOOR_BALANCE=off restores the fixed GLM-first order', () => {
    process.env.AGENTV3_FLOOR_BALANCE = 'off';
    process.env.GLM_API_KEY = 'glm-test-key';
    process.env.KIMI_API_KEY = 'kimi-test-key';
    expect(cheapBuildFloorRunners()[0].name).toBe('GLM');
    expect(cheapBuildFloorRunners()[0].name).toBe('GLM'); // no alternation when off
  });
  it('FLOOR BALANCE — a single-provider floor never rotates (nothing to balance)', () => {
    process.env.AGENTV3_CHEAP_FLOOR = 'glm';
    process.env.GLM_API_KEY = 'glm-test-key';
    expect(cheapBuildFloorRunners()[0].name).toBe('GLM');
    expect(cheapBuildFloorRunners()[0].name).toBe('GLM');
  });
  it('balanceFloorLead (pure) — kimiFirst moves the KIMI block ahead of GLM; identity otherwise', () => {
    const rs = [
      { name: 'GLM', runner: {} as never }, { name: 'GLM#2', runner: {} as never, reportAs: 'GLM' },
      { name: 'KIMI', runner: {} as never },
    ];
    expect(balanceFloorLead(rs, false)).toBe(rs); // identity — no reorder, same reference
    expect(balanceFloorLead(rs, true).map((r) => r.name)).toEqual(['KIMI', 'GLM', 'GLM#2']);
    // Single-provider input: identity even when kimiFirst (nothing to swap).
    const glmOnly = [{ name: 'GLM', runner: {} as never }];
    expect(balanceFloorLead(glmOnly, true)).toBe(glmOnly);
  });

  // KEY POOL / ROTATION (ROADMAP Tier-4 — GLM 429-saturation lever from deep-test App #9/#10).
  it('a comma-separated GLM_API_KEY pool emits a rung PER (model × key), model-major/key-minor', () => {
    process.env.AGENTV3_CHEAP_FLOOR = 'glm';
    process.env.GLM_API_KEY = 'key1, key2'; // 2 keys
    process.env.GLM_MODEL = 'glm-5.2,glm-4.7'; // 2 models
    const runners = cheapBuildFloorRunners();
    // model-major, key-minor: flagship tried on BOTH keys before dropping a tier.
    expect(runners.map((r) => r.name)).toEqual(['GLM', 'GLM#2', 'GLM', 'GLM#2']);
    // every rung reports as the base provider so telemetry/no-Claude stay one clean 'GLM' label.
    expect(runners.map((r) => r.reportAs ?? r.name)).toEqual(['GLM', 'GLM', 'GLM', 'GLM']);
  });
  it('a SINGLE key stays byte-for-byte today (no #2 rung, no reportAs)', () => {
    process.env.AGENTV3_CHEAP_FLOOR = 'glm';
    process.env.GLM_API_KEY = 'only-key';
    process.env.GLM_MODEL = 'glm-5.2';
    const runners = cheapBuildFloorRunners();
    expect(runners.map((r) => r.name)).toEqual(['GLM']);
    expect(runners[0].reportAs).toBeUndefined();
  });
  it('de-dupes a repeated key in the pool (a copy-paste never doubles a rung)', () => {
    process.env.AGENTV3_CHEAP_FLOOR = 'glm';
    process.env.GLM_API_KEY = 'dupe, dupe';
    process.env.GLM_MODEL = 'glm-5.2';
    expect(cheapBuildFloorRunners().map((r) => r.name)).toEqual(['GLM']);
  });
  // Amazon Bedrock GLM 5 cheap-floor rung (admin 2026-07-08) — reached via Bedrock's OpenAI-compatible
  // endpoint, same OpenAiToolRunner as GLM/KIMI. Off until BOTH the flag=bedrock AND BEDROCK_API_KEY.
  it('flag=bedrock with NO BEDROCK_API_KEY → [] (second off-switch, like GLM/KIMI)', () => {
    process.env.AGENTV3_CHEAP_FLOOR = 'bedrock';
    expect(cheapBuildFloorRunners()).toEqual([]);
  });
  it('flag=bedrock AND BEDROCK_API_KEY → a single BEDROCK-GLM rung (default model zai.glm-5)', () => {
    process.env.AGENTV3_CHEAP_FLOOR = 'bedrock';
    process.env.BEDROCK_API_KEY = 'bedrock-test-key';
    expect(cheapBuildFloorRunners().map((r) => r.name)).toEqual(['BEDROCK-GLM']);
  });
  it('bedrock is NOT enabled by the GLM/KIMI "on"/"both" pair (explicit opt-in only)', () => {
    process.env.BEDROCK_API_KEY = 'bedrock-test-key';
    process.env.AGENTV3_CHEAP_FLOOR = 'on'; // enables the GLM/KIMI friends, not Bedrock
    expect(cheapBuildFloorRunners().every((r) => r.name !== 'BEDROCK-GLM')).toBe(true);
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
  // Slice 3 (Model Routing Policy, admin 2026-07-12): a FREE build uses a graduated flash-first ladder.
  it('FREE ladder is flash-first + longer — default GLM = glm-4.7-flash,glm-4.7,glm-5.2 (3 rungs) vs paid 2', () => {
    process.env.AGENTV3_CHEAP_FLOOR = 'glm';
    process.env.GLM_API_KEY = 'glm-test-key';
    // default (paid/flagship-first) → 2 GLM rungs (glm-5.2, glm-4.7)
    expect(cheapBuildFloorRunners().map((r) => r.name)).toEqual(['GLM', 'GLM']);
    // free (flash-first) → 3 GLM rungs (glm-4.7-flash → glm-4.7 → glm-5.2)
    expect(cheapBuildFloorRunners({ free: true }).map((r) => r.name)).toEqual(['GLM', 'GLM', 'GLM']);
  });
  it('AGENTV3_FREE_GLM_MODEL overrides the free ladder without touching the paid GLM_MODEL', () => {
    process.env.AGENTV3_CHEAP_FLOOR = 'glm';
    process.env.GLM_API_KEY = 'glm-test-key';
    process.env.GLM_MODEL = 'glm-5.2'; // paid = 1 rung
    process.env.AGENTV3_FREE_GLM_MODEL = 'glm-4.7-flash,glm-4.7'; // free = 2 rungs
    expect(cheapBuildFloorRunners().map((r) => r.name)).toEqual(['GLM']); // paid unaffected
    expect(cheapBuildFloorRunners({ free: true }).map((r) => r.name)).toEqual(['GLM', 'GLM']);
  });

  it('"both"/"on" makes GLM and KIMI "friends" — both ladders included, lead ALTERNATING (2026-07-21 load-divide supersedes the fixed GLM-first of 2026-07-01)', () => {
    process.env.AGENTV3_CHEAP_FLOOR = 'both';
    process.env.GLM_API_KEY = 'glm-test-key';
    process.env.GLM_MODEL = 'glm-4.7'; // pin to 1 rung each for a clean, exact assertion
    process.env.KIMI_API_KEY = 'kimi-test-key';
    process.env.KIMI_MODEL = 'kimi-k2.7-code';
    expect(cheapBuildFloorRunners().map((r) => r.name)).toEqual(['GLM', 'KIMI']);

    // 2nd construction: the floor-balance rotation now leads KIMI (the admin's "GLM par pura load na
    // dalo" divide) — both ladders always present, only the lead swaps.
    process.env.AGENTV3_CHEAP_FLOOR = 'on';
    expect(cheapBuildFloorRunners().map((r) => r.name)).toEqual(['KIMI', 'GLM']);
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
  const savedEsc = process.env.AGENTV3_ESCALATION;
  afterEach(() => {
    if (saved === undefined) delete process.env.AGENTV3_CHEAP_FLOOR_ALL_TIERS; else process.env.AGENTV3_CHEAP_FLOOR_ALL_TIERS = saved;
    if (savedEsc === undefined) delete process.env.AGENTV3_ESCALATION; else process.env.AGENTV3_ESCALATION = savedEsc;
  });

  it('allows the floor for simple/medium tiers (gemini, haiku) and unknown', () => {
    delete process.env.AGENTV3_CHEAP_FLOOR_ALL_TIERS;
    delete process.env.AGENTV3_ESCALATION;
    expect(cheapFloorAllowedForTier('gemini')).toBe(true);
    expect(cheapFloorAllowedForTier('haiku')).toBe(true);
    expect(cheapFloorAllowedForTier(undefined)).toBe(true); // cost-ladder off → allowed (Claude backstops)
  });
  it('SKIPS the floor for complex/power tiers (sonnet, opus) when escalation is OFF (no Sonnet safety net)', () => {
    delete process.env.AGENTV3_CHEAP_FLOOR_ALL_TIERS;
    delete process.env.AGENTV3_ESCALATION;
    expect(cheapFloorAllowedForTier('sonnet')).toBe(false);
    expect(cheapFloorAllowedForTier('opus')).toBe(false);
  });
  it('ESCALATION on → ALL apps cheap-first (complex too), because a weak cheap build is caught + retried on Sonnet', () => {
    delete process.env.AGENTV3_CHEAP_FLOOR_ALL_TIERS;
    process.env.AGENTV3_ESCALATION = 'on';
    expect(cheapFloorAllowedForTier('sonnet')).toBe(true);
    expect(cheapFloorAllowedForTier('opus')).toBe(true);
    expect(cheapFloorAllowedForTier('gemini')).toBe(true);
  });
  it('AGENTV3_CHEAP_FLOOR_ALL_TIERS=1 overrides → floor allowed on every tier', () => {
    process.env.AGENTV3_CHEAP_FLOOR_ALL_TIERS = '1';
    delete process.env.AGENTV3_ESCALATION;
    expect(cheapFloorAllowedForTier('sonnet')).toBe(true);
    expect(cheapFloorAllowedForTier('opus')).toBe(true);
  });
});

// T1-escalation-on — the percentage canary (AGENTV3_ESCALATION_PCT). The exact failure class this
// locks out: a build OUTSIDE a partial rollout leading with the cheap floor on a complex app while
// shouldEscalateBuild denies it the Sonnet retry — a weak cheap build with NO safety net. The two
// gates must always AGREE for the same rollout key.
describe('escalation percentage canary — cheap floor and escalation retry always agree', () => {
  const savedAll = process.env.AGENTV3_CHEAP_FLOOR_ALL_TIERS;
  const savedEsc = process.env.AGENTV3_ESCALATION;
  const savedPct = process.env.AGENTV3_ESCALATION_PCT;
  afterEach(() => {
    if (savedAll === undefined) delete process.env.AGENTV3_CHEAP_FLOOR_ALL_TIERS; else process.env.AGENTV3_CHEAP_FLOOR_ALL_TIERS = savedAll;
    if (savedEsc === undefined) delete process.env.AGENTV3_ESCALATION; else process.env.AGENTV3_ESCALATION = savedEsc;
    if (savedPct === undefined) delete process.env.AGENTV3_ESCALATION_PCT; else process.env.AGENTV3_ESCALATION_PCT = savedPct;
  });

  it('on + no PCT = 100% — identical to the old "on" semantics (with or without a key)', () => {
    delete process.env.AGENTV3_CHEAP_FLOOR_ALL_TIERS;
    process.env.AGENTV3_ESCALATION = 'on';
    delete process.env.AGENTV3_ESCALATION_PCT;
    expect(cheapFloorAllowedForTier('sonnet')).toBe(true);
    expect(cheapFloorAllowedForTier('sonnet', 'ws-abc')).toBe(true);
    const simple = analyzeRequest({ prompt: 'build me a calculator' });
    expect(shouldEscalateBuild(simple, false, 'ws-abc')).toBe(true);
  });

  it('on + PCT=0 — a complex build must NOT lead cheap (no safety net) and must not escalate', () => {
    delete process.env.AGENTV3_CHEAP_FLOOR_ALL_TIERS;
    process.env.AGENTV3_ESCALATION = 'on';
    process.env.AGENTV3_ESCALATION_PCT = '0';
    expect(cheapFloorAllowedForTier('sonnet', 'ws-abc')).toBe(false); // conservative split holds
    expect(cheapFloorAllowedForTier('gemini', 'ws-abc')).toBe(true); // simple tiers keep the floor as before
    const simple = analyzeRequest({ prompt: 'build me a calculator' });
    expect(shouldEscalateBuild(simple, false, 'ws-abc')).toBe(false);
  });

  it('partial PCT — for ANY key, the cheap-floor lead on a complex tier and the escalation retry AGREE', () => {
    delete process.env.AGENTV3_CHEAP_FLOOR_ALL_TIERS;
    process.env.AGENTV3_ESCALATION = 'on';
    process.env.AGENTV3_ESCALATION_PCT = '50';
    const simple = analyzeRequest({ prompt: 'build me a calculator' });
    for (const key of ['ws-1', 'ws-2', 'ws-3', 'ws-4', 'ws-5', 'ws-6', 'ws-7', 'ws-8']) {
      expect(cheapFloorAllowedForTier('sonnet', key)).toBe(shouldEscalateBuild(simple, false, key));
    }
  });

  it('partial PCT with NO key — conservative: no complex cheap lead, no escalation', () => {
    delete process.env.AGENTV3_CHEAP_FLOOR_ALL_TIERS;
    process.env.AGENTV3_ESCALATION = 'on';
    process.env.AGENTV3_ESCALATION_PCT = '50';
    expect(cheapFloorAllowedForTier('sonnet')).toBe(false);
    const simple = analyzeRequest({ prompt: 'build me a calculator' });
    expect(shouldEscalateBuild(simple, false)).toBe(false);
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

describe('fastLaneProviderLabel — honest provider label for the fast lane (no fixed "anthropic")', () => {
  it('maps cheap-floor providers to their real label so a GLM/Kimi build is never mislabeled', () => {
    expect(fastLaneProviderLabel('GLM')).toBe('glm');
    expect(fastLaneProviderLabel('KIMI')).toBe('kimi');
    expect(fastLaneProviderLabel('BEDROCK-GLM')).toBe('bedrock');
  });
  it('maps every Claude tier (incl. the forced-Haiku backstop) to anthropic', () => {
    expect(fastLaneProviderLabel('CLAUDE')).toBe('anthropic');
    expect(fastLaneProviderLabel('CLAUDE_HAIKU')).toBe('anthropic');
  });
  it('maps the Vertex/Gemini last resort to google', () => {
    expect(fastLaneProviderLabel('VERTEX')).toBe('google');
    expect(fastLaneProviderLabel('GEMINI')).toBe('google');
  });
  it('is case-insensitive on the provider name', () => {
    expect(fastLaneProviderLabel('glm')).toBe('glm');
    expect(fastLaneProviderLabel('Claude')).toBe('anthropic');
  });
  it('falls back to the lower-cased name for an unknown provider (never silently hidden)', () => {
    expect(fastLaneProviderLabel('SOMENEW')).toBe('somenew');
  });
  it('defaults to anthropic for an empty/undefined provider', () => {
    expect(fastLaneProviderLabel(undefined)).toBe('anthropic');
    expect(fastLaneProviderLabel('')).toBe('anthropic');
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
  it('tier→model fidelity (admin 2026-07-13): Strong pins Sonnet, Powerful/Full Team pin Opus — regardless of analyser tier', () => {
    expect(selectBuildModel('gemini', 'mini')).toBe(sonnetModel());  // Strong = Sonnet 100%, never Opus
    expect(selectBuildModel('opus', 'mini')).toBe(sonnetModel());
    expect(selectBuildModel('gemini', 'medium')).toBe(opusModel());
    expect(selectBuildModel('haiku', 'max')).toBe(opusModel());
    expect(selectBuildModel('gemini', 'weak')).toBe(haikuModel());   // weak/off keep the adaptive routing
    expect(selectBuildModel('gemini', 'off')).toBe(haikuModel());
  });
  it('maps real analyser verdicts: a calculator stays cheap (Haiku), an auth+DB app uses Sonnet', () => {
    const calc = analyzeRequest({ prompt: 'build me a calculator' });
    expect(selectBuildModel(calc.startTier, false)).toBe(haikuModel());
    const complex = analyzeRequest({ prompt: 'build a multi-tenant SaaS with auth, postgres database, billing and an admin dashboard' });
    expect(selectBuildModel(complex.startTier, false)).toBe(sonnetModel());
  });

  // Admin decision 2026-07-05 ("badi apps direct Sonnet"): a LARGE existing project overrides the
  // prompt-based tier — the analyser saw "survey my app" as simple/haiku while the CONTEXT was a
  // 317-file import; the cheap floor then timed out 8× and fell to Claude anyway (Mitrify autopsy).
  it('a LARGE existing project builds on Sonnet even when the prompt tier says haiku', () => {
    expect(selectBuildModel('haiku', false, true)).toBe(sonnetModel());
    expect(selectBuildModel('gemini', false, true)).toBe(sonnetModel());
    expect(selectBuildModel(undefined, false, true)).toBe(sonnetModel());
  });
  it('power mode still beats the large-project override (Opus)', () => {
    expect(selectBuildModel('haiku', true, true)).toBe(opusModel());
  });
  it('largeProject=false keeps every existing route unchanged (backward compat)', () => {
    expect(selectBuildModel('haiku', false, false)).toBe(haikuModel());
    expect(selectBuildModel('sonnet', false, false)).toBe(sonnetModel());
  });
});

describe('isLargeExistingProject — the "badi app" threshold', () => {
  afterEach(() => { delete process.env.AGENTV3_LARGE_PROJECT_FILES; });
  it('Mitrify-scale (317 files) is large; a fresh v5.0 app (40 files) is not', () => {
    expect(isLargeExistingProject(317)).toBe(true);
    expect(isLargeExistingProject(40)).toBe(false);
  });
  it('boundary: default threshold 100 (99 no, 100 yes); 0 files (fresh build / list failed) never large', () => {
    expect(isLargeExistingProject(99)).toBe(false);
    expect(isLargeExistingProject(100)).toBe(true);
    expect(isLargeExistingProject(0)).toBe(false);
  });
  it('AGENTV3_LARGE_PROJECT_FILES tunes the threshold', () => {
    process.env.AGENTV3_LARGE_PROJECT_FILES = '50';
    expect(isLargeExistingProject(60)).toBe(true);
    expect(isLargeExistingProject(49)).toBe(false);
  });
});

describe('shouldRouteStrongModel (Fix 4 — imports skip Haiku/cheap floor)', () => {
  it('a large project routes strong', () => {
    expect(shouldRouteStrongModel(true, false)).toBe(true);
  });
  it('THE Mitrify fix: an import routes strong even when the file count is 0 (clone not landed yet)', () => {
    expect(shouldRouteStrongModel(false, true)).toBe(true);
  });
  it('a small non-import build stays on the normal ladder (Haiku/cheap floor allowed)', () => {
    expect(shouldRouteStrongModel(false, false)).toBe(false);
  });
});

describe('resolveClaudeFirst — v5.0 builds lead with Claude by default', () => {
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

  it('activates on any explicit yes, and only on an explicit yes', () => {
    // CONTRACT CHANGED DELIBERATELY (audit finding #1, 2026-08-09): "only literal on" was the DEFECT.
    // The codebase read flags seven different ways, so `true` here and `on` there silently disagreed.
    // One shared parser now accepts every spelling; an opt-in still requires an EXPLICIT yes.
    for (const v of ['on', 'true', '1', 'ON']) {
      process.env.AGENTV3_ESCALATION = v;
      expect(escalationEnabled(), v).toBe(true);
    }
    for (const v of ['off', 'false', '0', '']) {
      process.env.AGENTV3_ESCALATION = v;
      expect(escalationEnabled(), v).toBe(false);
    }
    delete process.env.AGENTV3_ESCALATION;
    expect(escalationEnabled()).toBe(false);
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
  it('defaults to 1800s (30 min)', () => {
    delete process.env.AGENTV3_MAX_BUILD_SECONDS;
    expect(maxBuildSeconds()).toBe(1800);
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
    expect(maxBuildSeconds()).toBe(1800);
  });
});

describe('buildMaxTokensPerTurn (B1 — per-turn output cap for the agentic build runner)', () => {
  const prev = process.env.AGENTV3_MAX_TOKENS_PER_TURN;
  afterEach(() => {
    if (prev === undefined) delete process.env.AGENTV3_MAX_TOKENS_PER_TURN;
    else process.env.AGENTV3_MAX_TOKENS_PER_TURN = prev;
  });
  it('defaults to 32000 (4× the old 8192 fallback so large files are not truncated)', () => {
    delete process.env.AGENTV3_MAX_TOKENS_PER_TURN;
    expect(buildMaxTokensPerTurn()).toBe(32000);
  });
  it('honors a positive override', () => {
    process.env.AGENTV3_MAX_TOKENS_PER_TURN = '48000';
    expect(buildMaxTokensPerTurn()).toBe(48000);
  });
  it('hard-caps at 64000 to stay within model limits', () => {
    process.env.AGENTV3_MAX_TOKENS_PER_TURN = '200000';
    expect(buildMaxTokensPerTurn()).toBe(64000);
  });
  it('falls back to the default on garbage or non-positive input', () => {
    process.env.AGENTV3_MAX_TOKENS_PER_TURN = 'abc';
    expect(buildMaxTokensPerTurn()).toBe(32000);
    process.env.AGENTV3_MAX_TOKENS_PER_TURN = '0';
    expect(buildMaxTokensPerTurn()).toBe(32000);
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
  // Root-caused 2026-07-01: a build genuinely still running in a DIFFERENT v5.0 session under the
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

describe('shouldReclaimBuildLock — never trap the account behind a dead/hung build', () => {
  const rb = (overrides: Partial<RunningBuild> = {}): RunningBuild => ({
    abort: new AbortController(),
    buffer: [],
    subscribers: new Set(),
    ended: false,
    startedTs: 1_000_000,
    ...overrides,
  });
  const NOW = 1_000_000;

  it('no registry entry for the lock (crash desync) → reclaim immediately', () => {
    expect(shouldReclaimBuildLock(undefined, NOW)).toBe(true);
  });

  it('an already-ended build still holding the lock → reclaim', () => {
    expect(shouldReclaimBuildLock(rb({ ended: true }), NOW + 5_000)).toBe(true);
  });

  it('ABANDONED: no attached subscriber and past the stall window → reclaim (the hung-build / dropped-client case)', () => {
    const build = rb({ startedTs: NOW, subscribers: new Set() });
    expect(shouldReclaimBuildLock(build, NOW + 31_000)).toBe(true);
  });

  it('a genuinely-active build WITH a live watcher → NEVER reclaim (keep the honest 409)', () => {
    const build = rb({ startedTs: NOW, subscribers: new Set([{ write() {}, end() {} }]) });
    expect(shouldReclaimBuildLock(build, NOW + 10 * 60_000)).toBe(false);
  });

  it('a freshly-started build with no watcher yet (client mid-connect) → do NOT reclaim before the stall window', () => {
    const build = rb({ startedTs: NOW, subscribers: new Set() });
    expect(shouldReclaimBuildLock(build, NOW + 5_000)).toBe(false);
  });

  // GA-2 in-process reaper: a build grossly past the HARD max is a zombie (the run aborts at maxBuildSeconds),
  // so reclaim it even WITH a lingering subscriber — a single zombie must not trap the account forever.
  it('ZOMBIE: a build WITH a watcher but past the hard-max duration → reclaim (cleanup never fired)', () => {
    const hardMaxMs = 15 * 60_000; // e.g. 13-min max + 2-min grace
    const build = rb({ startedTs: NOW, subscribers: new Set([{ write() {}, end() {} }]) });
    expect(shouldReclaimBuildLock(build, NOW + hardMaxMs + 1_000, 30_000, hardMaxMs)).toBe(true);
  });

  it('a build WITH a watcher UNDER the hard max → NOT reclaimed (still genuinely active)', () => {
    const hardMaxMs = 15 * 60_000;
    const build = rb({ startedTs: NOW, subscribers: new Set([{ write() {}, end() {} }]) });
    expect(shouldReclaimBuildLock(build, NOW + 10 * 60_000, 30_000, hardMaxMs)).toBe(false);
  });

  it('hardMaxMs = 0 (max disabled) keeps only the abandoned-lock reclaim — a watched build is never duration-reaped', () => {
    const build = rb({ startedTs: NOW, subscribers: new Set([{ write() {}, end() {} }]) });
    expect(shouldReclaimBuildLock(build, NOW + 60 * 60_000, 30_000, 0)).toBe(false);
  });
});

describe('buildSandboxUnavailableInProd — A2 prod sandbox guard (defense-in-depth for C2 host RCE)', () => {
  it('refuses a build in production when neither E2B nor Docker is configured', () => {
    expect(buildSandboxUnavailableInProd({ NODE_ENV: 'production' } as any)).toBe(true);
  });
  it('allows the build when E2B is configured in production', () => {
    expect(buildSandboxUnavailableInProd({ NODE_ENV: 'production', E2B_API_KEY: 'e2b_x' } as any)).toBe(false);
  });
  it('allows the build when Docker is enabled in production', () => {
    expect(buildSandboxUnavailableInProd({ NODE_ENV: 'production', DOCKER_ENABLED: 'true' } as any)).toBe(false);
  });
  it('never blocks outside production — LocalActuator is intended in dev/CI/VITEST', () => {
    expect(buildSandboxUnavailableInProd({} as any)).toBe(false);
    expect(buildSandboxUnavailableInProd({ NODE_ENV: 'development' } as any)).toBe(false);
    expect(buildSandboxUnavailableInProd({ NODE_ENV: 'test' } as any)).toBe(false);
  });
});

describe('resolveBuildIdentity — C1 verified-identity gate for the build path', () => {
  it('uses the VERIFIED uid; ignores a matching claim', () => {
    expect(resolveBuildIdentity('u1', 'u1')).toEqual({ ok: true, userId: 'u1' });
    expect(resolveBuildIdentity('u1', null)).toEqual({ ok: true, userId: 'u1' });
  });
  it('genuine anonymous (no token, no claim) → ok with userId null (shared anon path preserved)', () => {
    expect(resolveBuildIdentity(null, null)).toEqual({ ok: true, userId: null });
  });
  it('a claimed userId with NO verified token DEGRADES to anonymous (never grants the claim, never hard-blocks)', () => {
    // Graceful-degrade revision: the claim is NOT trusted (so no cross-user access — C1 property holds)
    // but the build is NOT rejected either; it runs anonymously (userId=null) so the chat still works.
    const r = resolveBuildIdentity(null, 'victim-uid');
    expect(r).toEqual({ ok: true, userId: null });
  });
  it('REJECTS a token whose uid differs from the claimed userId → mismatch (the core spoof)', () => {
    const r = resolveBuildIdentity('real-uid', 'victim-uid');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('mismatch');
  });
});

describe('entitlementEmail — T0-9: billing/free-list email must be VERIFIED-only (no free-Opus spoof)', () => {
  const prevFreeList = process.env.AGENTV3_FREE_LIST;
  beforeEach(() => { process.env.AGENTV3_FREE_LIST = 'aashishcpmt09@gmail.com'; });
  afterEach(() => {
    if (prevFreeList === undefined) delete process.env.AGENTV3_FREE_LIST;
    else process.env.AGENTV3_FREE_LIST = prevFreeList;
  });

  it('returns the verified token email when the caller is verified', () => {
    expect(entitlementEmail({ email: 'real@user.com' })).toBe('real@user.com');
    expect(entitlementEmail({ email: null })).toBeNull(); // verified but no email → still null, never a claim
  });
  it('returns null for an UNVERIFIED caller — a claimed body email is discarded', () => {
    expect(entitlementEmail(null)).toBeNull();
  });
  it('SECURITY: an unverified caller spoofing a free-list email gets NO free-list status', () => {
    // The free-list matches by email alone: isAgentV3FreeUser(null, adminEmail) === true. Before the fix,
    // the handler passed the CLAIMED body email here, so an anon caller claiming the admin's address ran
    // billing-exempt (free Opus). Now the handler passes entitlementEmail(verified=null) === null.
    const claimedAdminEmail = 'aashishcpmt09@gmail.com';
    expect(isAgentV3FreeUser(null, claimedAdminEmail)).toBe(true);       // the raw function still matches email
    expect(isAgentV3FreeUser(null, entitlementEmail(null))).toBe(false); // but the handler now feeds it null → refused
  });
  it('SECURITY: an unverified free-list-email claim no longer bypasses the sign-in/billing gate', () => {
    // buildRequiresSignIn(null, allowlistEmail) === false was the Fix-26 degrade; feeding verified-only
    // email closes it — an anon caller is required to sign in (→ billable identity) before spending.
    expect(buildRequiresSignIn(null, entitlementEmail(null))).toBe(true);
  });
  it('a genuinely verified free-list admin is unaffected (their real email still grants free-list)', () => {
    expect(isAgentV3FreeUser('admin-uid', entitlementEmail({ email: 'aashishcpmt09@gmail.com' }))).toBe(true);
  });
});

describe('geminiLastResortEnabled — Vertex/Gemini as the true last resort, DEFAULT ON (admin 2026-07-07)', () => {
  it('is ON by default ("jab sab fail ho jaye to last me gemini/vertex se try karwao")', () => {
    // Given during a real all-provider outage: GLM/KIMI timing out + Anthropic credits exhausted —
    // every build died with no final resort. Vertex/Gemini only run after CLAUDE + HAIKU both threw.
    expect(geminiLastResortEnabled(undefined)).toBe(true);
    expect(geminiLastResortEnabled('')).toBe(true);
    expect(geminiLastResortEnabled('1')).toBe(true); // the old opt-in still enables
  });

  it("rolls back to the old exclusion with '0' or 'off'", () => {
    expect(geminiLastResortEnabled('0')).toBe(false);
    expect(geminiLastResortEnabled('off')).toBe(false);
    expect(geminiLastResortEnabled(' OFF ')).toBe(false);
  });
});

describe('vertexPeerBuildEnabled — Vertex/Gemini as a cheap-floor PEER (admin 2026-07-20 "GLM fail → Kimi AUR Vertex")', () => {
  it('is ON by default → floor-led build tries GLM → Kimi → Vertex/Gemini → Claude', () => {
    expect(vertexPeerBuildEnabled(undefined)).toBe(true);
    expect(vertexPeerBuildEnabled('')).toBe(true);
    expect(vertexPeerBuildEnabled('1')).toBe(true);
  });
  it("reverts to Vertex/Gemini as the absolute last resort with '0'/'off'", () => {
    expect(vertexPeerBuildEnabled('0')).toBe(false);
    expect(vertexPeerBuildEnabled('off')).toBe(false);
  });
});

describe('shutdownGraceMs (VAJRA V4-1c) — bounded grace for the SIGTERM build drain', () => {
  it('gives no grace when nothing is building (exit immediately)', () => {
    expect(shutdownGraceMs(0)).toBe(0);
    expect(shutdownGraceMs(-1)).toBe(0);
  });
  it('gives a bounded grace when builds are in flight, never exceeding the cap', () => {
    expect(shutdownGraceMs(1)).toBe(6_000);
    expect(shutdownGraceMs(50)).toBe(6_000); // capped — shutdown can never hang the platform
    expect(shutdownGraceMs(3, 3_000)).toBe(3_000);
  });
})

describe('rebuildGuardFlipsToEdit (Fix 27) — an infra hiccup can never turn an edit into a full rebuild', () => {
  // The real report (2026-07-07): "isme ek share button add karo" on a 46-file imported Expense
  // Tracker classified new_build (the countWorkspaceFiles probe failed open to 0) and the manifest
  // lane rebuilt all 40 files over the user's app.
  it('flips the report scenario to an edit: new_build + 46 durable source files + no fresh-start ask', () => {
    expect(rebuildGuardFlipsToEdit({
      intent: 'new_build', isEditMode: false, durableSourceCount: 46,
      freshStart: false, explicitCompleteBuild: false,
    })).toBe(true);
  });
  it('does NOT flip a genuinely fresh build (empty durable store)', () => {
    expect(rebuildGuardFlipsToEdit({
      intent: 'new_build', isEditMode: false, durableSourceCount: 0,
      freshStart: false, explicitCompleteBuild: false,
    })).toBe(false);
  });
  it('respects an explicit fresh start ("scrap this and start over")', () => {
    expect(rebuildGuardFlipsToEdit({
      intent: 'new_build', isEditMode: false, durableSourceCount: 46,
      freshStart: true, explicitCompleteBuild: false,
    })).toBe(false);
  });
  it('respects an explicit complete-app build (Fix 25 semantics kept)', () => {
    expect(rebuildGuardFlipsToEdit({
      intent: 'new_build', isEditMode: false, durableSourceCount: 3,
      freshStart: false, explicitCompleteBuild: true,
    })).toBe(false);
  });
  it('is a no-op when the turn is already an edit (never double-flips)', () => {
    expect(rebuildGuardFlipsToEdit({
      intent: 'edit_existing', isEditMode: true, durableSourceCount: 46,
      freshStart: false, explicitCompleteBuild: false,
    })).toBe(false);
    expect(rebuildGuardFlipsToEdit({
      intent: 'new_build', isEditMode: true, durableSourceCount: 46,
      freshStart: false, explicitCompleteBuild: false,
    })).toBe(false);
  });
});

describe('shouldConfirmRebuild (Fix 28) — a rebuild over an existing app always asks the user first', () => {
  it('asks when a rebuild-shaped turn targets a workspace that already holds an app', () => {
    // The admin rule: "agar AI rebuild ki koshish kare, to pehle user se puch le."
    expect(shouldConfirmRebuild({
      intent: 'new_build', isEditMode: false, hasImportIntent: false, durableSourceCount: 46,
    })).toBe(true);
    expect(shouldConfirmRebuild({
      intent: 'new_build', isEditMode: false, hasImportIntent: false, durableSourceCount: 3,
    })).toBe(true); // even a small existing app is asked about, never silently replaced
  });
  it('never asks on a genuinely fresh build (empty workspace) — zero friction on the common path', () => {
    expect(shouldConfirmRebuild({
      intent: 'new_build', isEditMode: false, hasImportIntent: false, durableSourceCount: 0,
    })).toBe(false);
  });
  it('never asks on an edit turn (edits are the default and touch nothing wholesale)', () => {
    expect(shouldConfirmRebuild({
      intent: 'edit_existing', isEditMode: true, hasImportIntent: false, durableSourceCount: 46,
    })).toBe(false);
    expect(shouldConfirmRebuild({
      intent: 'new_build', isEditMode: true, hasImportIntent: false, durableSourceCount: 46,
    })).toBe(false);
  });
  it('never asks on an import turn (its pipeline forces edit mode; it never scaffolds over the import)', () => {
    expect(shouldConfirmRebuild({
      intent: 'new_build', isEditMode: false, hasImportIntent: true, durableSourceCount: 46,
    })).toBe(false);
  });
});

describe('zeroBillForUnrenderedPreview (Fix 35) — "preview theek chala to hi paise" enforced on the money', () => {
  it('bills ZERO when the server-verified preview did not render on an artifact build', () => {
    expect(zeroBillForUnrenderedPreview(true, true)).toBe(true);
  });
  it('bills normally when the preview verified OK, or verification never concluded failure', () => {
    expect(zeroBillForUnrenderedPreview(true, false)).toBe(false);
  });
  it('never zeroes a chat/analysis turn (no artifacts expected)', () => {
    expect(zeroBillForUnrenderedPreview(false, true)).toBe(false);
  });
});

describe('shouldRunIntegrityHeal (mitrify autopsy 2026-07-24) — never mutate files on a "do not change" import turn', () => {
  it('runs on a real build turn (expectsArtifacts) when enabled, ok, not aborted', () => {
    expect(shouldRunIntegrityHeal({ gateEnabled: true, resultOk: true, expectsArtifacts: true, aborted: false })).toBe(true);
  });
  it('NEVER runs on an import/survey turn (expectsArtifacts=false) — the reported instruction violation', () => {
    // The user said "Do not change any files yet"; expectsArtifacts is false on every import turn, so the
    // file-mutating heal must be skipped even though the gate is on and the build is ok.
    expect(shouldRunIntegrityHeal({ gateEnabled: true, resultOk: true, expectsArtifacts: false, aborted: false })).toBe(false);
  });
  it('does not run when the gate is off, the build failed, or the turn was aborted', () => {
    expect(shouldRunIntegrityHeal({ gateEnabled: false, resultOk: true, expectsArtifacts: true, aborted: false })).toBe(false);
    expect(shouldRunIntegrityHeal({ gateEnabled: true, resultOk: false, expectsArtifacts: true, aborted: false })).toBe(false);
    expect(shouldRunIntegrityHeal({ gateEnabled: true, resultOk: true, expectsArtifacts: true, aborted: true })).toBe(false);
  });
});

// A BUILD REQUEST THAT WROTE NOTHING IS NOT AN "EDIT THAT CHANGED NOTHING" (admin report 2026-08-16,
// build 5b4f9b63 — "ab to choti moti apps bhi nahi ban rahi hai"). "Build a to-do list app…" was typed
// into a workspace holding an unrelated 179-file imported project. The non-empty-workspace guard flipped
// it to an edit — correctly, so the request could not bulldoze the existing app — and that flip handed it
// the exemption written for "fix the server" / "why is this failing". The agent found a page whose NAME
// matched, wrote zero files, and answered "Your to-do list app is complete and ready!". No retry fired.
describe('shouldRetryEmptyBuild — the reclassified build request', () => {
  const base = {
    expectsArtifacts: true, filesWritten: 0, isEditMode: true,
    existingProjectFiles: 179, aborted: false, withinCostCap: true,
  };

  it('RETRIES when the user asked for an app and not one file was written (the reported failure)', () => {
    expect(shouldRetryEmptyBuild({ ...base, userAskedToBuildAnApp: true })).toBe(true);
  });

  it('still exempts a genuine edit that legitimately changed nothing (Shiv Medical Store)', () => {
    // "continue and fix the build so the app works end-to-end" — the agent diagnosed it, started the
    // dev server, published a working preview and wrote nothing, because nothing needed to change.
    // Re-running that whole build on a second model doubled a 15.6-minute, ₹567 build for no reason.
    expect(shouldRetryEmptyBuild({ ...base, userAskedToBuildAnApp: false })).toBe(false);
    expect(shouldRetryEmptyBuild(base)).toBe(false); // signal absent ⇒ old behaviour, unchanged
  });

  it('a NEW build on an empty workspace still retries, as it always did', () => {
    expect(shouldRetryEmptyBuild({ ...base, isEditMode: false, existingProjectFiles: 0, userAskedToBuildAnApp: true })).toBe(true);
  });

  it('never retries when files WERE written, the user stopped it, or the cost cap is blown', () => {
    expect(shouldRetryEmptyBuild({ ...base, filesWritten: 3, userAskedToBuildAnApp: true })).toBe(false);
    expect(shouldRetryEmptyBuild({ ...base, aborted: true, userAskedToBuildAnApp: true })).toBe(false);
    expect(shouldRetryEmptyBuild({ ...base, withinCostCap: false, userAskedToBuildAnApp: true })).toBe(false);
    expect(shouldRetryEmptyBuild({ ...base, expectsArtifacts: false, userAskedToBuildAnApp: true })).toBe(false);
  });
});

describe('emptyBuildFailureSummary (deep-test App #7) — an empty build is never "✓ Done"', () => {
  it('fails an artifact build that produced 0 files because the sandbox was unavailable', () => {
    const s = emptyBuildFailureSummary(true, 0, true);
    expect(s).toBeTruthy();
    expect(s).toContain('sandbox was unavailable');
    expect(s).toContain('not been charged');
  });
  it('fails an artifact build that produced 0 files for any other reason', () => {
    const s = emptyBuildFailureSummary(true, 0, false);
    expect(s).toBeTruthy();
    expect(s).toContain('no files');
    expect(s).not.toContain('sandbox was unavailable');
  });
  it('FAILS even a "produced files" build when the sandbox was unavailable (App #11: 0 file par 100/100)', () => {
    // The 23 in-memory files never reached the 403-blocked sandbox — nothing was installed/compiled/run,
    // so the app cannot be "READY". A dead sandbox is a failure regardless of the phantom file count.
    const s = emptyBuildFailureSummary(true, 23, true);
    expect(s).toBeTruthy();
    expect(s).toContain('sandbox was unavailable');
  });
  it('does NOT fail a build that produced files when the sandbox WAS available (a real app shipped)', () => {
    expect(emptyBuildFailureSummary(true, 12, false)).toBeNull();
    expect(emptyBuildFailureSummary(true, 1, false)).toBeNull();
  });
  it('does NOT fail a chat/analysis/import turn (no artifacts expected), even if the sandbox was down', () => {
    expect(emptyBuildFailureSummary(false, 0, true)).toBeNull();
    expect(emptyBuildFailureSummary(false, 5, true)).toBeNull();
  });
});

describe('finalSyntaxErrorSummary (sibling of the reviewer-CRITICAL false-success fix, 2026-07-21)', () => {
  it('never claims success — states the app does not compile / is not runnable', () => {
    const s = finalSyntaxErrorSummary(2);
    expect(s).not.toMatch(/✅|successful|console is clean/i);
    expect(s).toMatch(/don't compile yet/);
    expect(s).toMatch(/isn't runnable/);
    expect(s).toMatch(/2 files/);
  });
  it('promises the user was NOT charged (working app or free)', () => {
    expect(finalSyntaxErrorSummary(1)).toMatch(/have NOT been charged/);
  });
  it('is actionable + grammatical for the singular case (1 file / doesn\'t)', () => {
    const s = finalSyntaxErrorSummary(1);
    expect(s).toMatch(/\b1 file\b/);
    expect(s).toMatch(/doesn't compile yet/);
    expect(s).toMatch(/continue/);
    expect(s).not.toMatch(/\bfiles\b/);
  });
  it('WHITE-LABEL: never names a provider/model', () => {
    const s = finalSyntaxErrorSummary(3).toLowerCase();
    for (const v of ['glm', 'kimi', 'claude', 'sonnet', 'opus', 'gemini', 'grok', 'moonshot', 'anthropic', 'vertex']) {
      expect(s).not.toContain(v);
    }
  });
  it('clamps a zero/negative count to at least one', () => {
    expect(finalSyntaxErrorSummary(0)).toMatch(/\b1 file\b.*doesn't compile yet/);
  });
});

describe('failedImportPromptNote (Fix 41) — a failed GitHub import must never make the AI re-ask for the URL', () => {
  it('produces an instruction naming the exact URL + reason for a private-repo clone failure (the report)', () => {
    const note = failedImportPromptNote({ url: 'https://github.com/docasheesh-png/navbharatai', reason: 'the clone failed — most likely a PRIVATE repo the connected GitHub account cannot access, or the URL is wrong' });
    expect(note).toContain('https://github.com/docasheesh-png/navbharatai');
    expect(note).toContain('Do NOT ask the user for the repository URL');
    expect(note).toContain('⚙ → GitHub');
    expect(note.toLowerCase()).toContain('private');
  });
  it('is empty when no import failed (normal turns are unchanged)', () => {
    expect(failedImportPromptNote(null)).toBe('');
    expect(failedImportPromptNote(undefined)).toBe('');
    expect(failedImportPromptNote({ url: '', reason: 'x' })).toBe('');
  });
  it('forbids the model from cloning to a temp dir and reporting a false success (mitrify autopsy)', () => {
    const note = failedImportPromptNote({ url: 'https://github.com/o/r', reason: 'the clone failed' });
    expect(note).toContain('Do NOT clone the repository yourself into a temp');
    expect(note).toContain('would NOT persist');
  });
});

describe('importSurveyPromptNote (instant connect 2026-07-24) — the survey uses the API tree + key files', () => {
  const survey = {
    url: 'https://github.com/aashishcpmt093-ui/mitrify',
    fileCount: 165,
    structure: 'client/, server/, shared/, package.json',
    keyFiles: { 'package.json': '{"name":"mitrify","scripts":{"dev":"vite"}}' },
    truncated: false,
  };
  it('names the repo, file count, structure, and embeds the key files for an immediate survey', () => {
    const note = importSurveyPromptNote(survey);
    expect(note).toContain('https://github.com/aashishcpmt093-ui/mitrify');
    expect(note).toContain('165 file');
    expect(note).toContain('client/, server/, shared/, package.json');
    expect(note).toContain('----- package.json -----');
    expect(note).toContain('"name":"mitrify"');
    expect(note).toMatch(/Do not claim you cannot see the repository/i); // never re-ask / deny connection
  });
  it('flags a truncated (large) repo listing honestly', () => {
    expect(importSurveyPromptNote({ ...survey, truncated: true })).toMatch(/partial/i);
  });
  it('is empty when there is no instant-connect data (normal turns unchanged)', () => {
    expect(importSurveyPromptNote(null)).toBe('');
    expect(importSurveyPromptNote(undefined)).toBe('');
    expect(importSurveyPromptNote({ ...survey, url: '' })).toBe('');
  });
});

describe('importHonestySummaryPrefix (mitrify autopsy, rule 5) — a failed import can never read as success', () => {
  it('prepends an honest verdict naming the url + reason, ahead of the model prose', () => {
    const prefix = importHonestySummaryPrefix({ url: 'https://github.com/aashishcpmt093-ui/mitrify', reason: 'the clone failed' });
    const summary = `${prefix}## Mitrify App Survey\nSuccessfully cloned — ready for further work.`;
    expect(summary.startsWith(IMPORT_HONESTY_PREFIX_MARK)).toBe(true);            // truth leads
    expect(prefix).toContain('aashishcpmt093-ui/mitrify');
    expect(prefix).toContain('does not contain that repository');                 // no fake success
    expect(prefix.indexOf(IMPORT_HONESTY_PREFIX_MARK)).toBeLessThan(summary.indexOf('Successfully cloned'));
  });
  it('is empty when no import failed — a normal build summary is untouched', () => {
    expect(importHonestySummaryPrefix(null)).toBe('');
    expect(importHonestySummaryPrefix(undefined)).toBe('');
    expect(importHonestySummaryPrefix({ url: '', reason: 'x' })).toBe('');
  });
});

describe('enforceNoClaude — the UNBREAKABLE weak-module guard (admin rule 2026-07-13, HAIKU amendment same day)', () => {
  const chain = [
    { name: 'GLM' }, { name: 'KIMI' }, { name: 'CLAUDE' },
    { name: 'CLAUDE_HAIKU' }, { name: 'VERTEX' }, { name: 'GEMINI' },
  ];

  // THE exact leak (deep-test App #1): a weak/free build ran 4 claude-sonnet-4-6 calls on the heal gate
  // because the "no Claude" guarantee was tied only to cheapOnly. HAIKU AMENDMENT (admin verbatim:
  // "weak module me claude haiku add kar de? to last me … sonnet ya opus never never"): CLAUDE
  // (Sonnet/Opus) is still stripped no matter how the chain was assembled; the model-pinned
  // CLAUDE_HAIKU backstop is KEPT and moved to the END ("to last me").
  it('strips CLAUDE (Sonnet/Opus) and keeps the model-pinned Haiku backstop LAST', () => {
    const out = enforceNoClaude(chain, true).map((r) => r.name);
    expect(out).toEqual(['GLM', 'KIMI', 'VERTEX', 'GEMINI', 'CLAUDE_HAIKU']);
    expect(out).not.toContain('CLAUDE');
    expect(out[out.length - 1]).toBe('CLAUDE_HAIKU'); // haiku — to last me
  });

  it('leaves the chain untouched for a non-weak build (noClaude false)', () => {
    expect(enforceNoClaude(chain, false)).toBe(chain);
  });

  it('a weak build with only cheap providers is unchanged (nothing to strip or move)', () => {
    const cheapOnly = [{ name: 'GLM' }, { name: 'KIMI' }];
    expect(enforceNoClaude(cheapOnly, true).map((r) => r.name)).toEqual(['GLM', 'KIMI']);
  });

  it('is exhaustive — no Sonnet/Opus runner survives in any position; Haiku always lands last', () => {
    const weird = [{ name: 'CLAUDE' }, { name: 'CLAUDE_HAIKU' }, { name: 'GLM' }, { name: 'CLAUDE' }];
    const out = enforceNoClaude(weird, true).map((r) => r.name);
    expect(out).toEqual(['GLM', 'CLAUDE_HAIKU']); // Sonnet gone; mid-chain Haiku moved to the end
  });

  // REGRESSION (admin 2026-07-20, verbatim: "weak module me claude ka only haiku use hona chahiye. sonnet
  // never!!"): the vertex-peer reorder (AGENTV3_VERTEX_PEER) assembles the chain as
  // [...floorRunners, ...fallback, claude, ...withBackstop] = GLM → KIMI → VERTEX → GEMINI → CLAUDE → CLAUDE_HAIKU,
  // with the Sonnet/Opus 'CLAUDE' runner MID-chain (not at the tail as the old baseChain had it). Even so — and
  // even on the leak path where a heal gate set noClaude WITHOUT cheapOnly, so the build took this !cheapOnly
  // vertex-peer branch — enforceNoClaude must still strip that mid-chain CLAUDE and keep ONLY the pinned Haiku last.
  it('the vertex-peer chain shape (CLAUDE mid-chain) still yields NO Sonnet/Opus for a weak build', () => {
    const vertexPeerChain = [
      { name: 'GLM' }, { name: 'KIMI' }, { name: 'VERTEX' }, { name: 'GEMINI' },
      { name: 'CLAUDE' }, { name: 'CLAUDE_HAIKU' },
    ];
    const out = enforceNoClaude(vertexPeerChain, true).map((r) => r.name);
    expect(out).toEqual(['GLM', 'KIMI', 'VERTEX', 'GEMINI', 'CLAUDE_HAIKU']);
    expect(out).not.toContain('CLAUDE'); // Sonnet/Opus never — the admin's "sonnet never!!"
    expect(out[out.length - 1]).toBe('CLAUDE_HAIKU'); // only Haiku, and last
  });
});

describe('planRunnerChainNames — the plan phase respects WEAK ⇒ NO CLAUDE (audit fix 2026-07-13)', () => {
  // THE exact confirmed leak: grokPlanRunner hardwired [GROK → CLAUDE] OUTSIDE buildTurnRunner, so
  // enforceNoClaude never saw it — one Grok timeout ran a weak (free) build's plan turn on a real
  // Claude call. The chain membership is now this pure function, so the invariant is locked here.
  it('a noClaude (weak) build plans on Grok ALONE — no Claude fallback rung exists', () => {
    expect(planRunnerChainNames(true)).toEqual(['GROK']);
    expect(planRunnerChainNames(true)).not.toContain('CLAUDE');
  });

  it('a normal/paid build keeps the Grok → Claude fallback (resilience unchanged)', () => {
    expect(planRunnerChainNames(false)).toEqual(['GROK', 'CLAUDE']);
  });
});

describe('redactProviderError / sandboxUnavailableNotice — no raw infra error reaches the user (Fix 62)', () => {
  it('the E2B 403 the admin saw is scrubbed of the vendor name + billing wording', () => {
    const raw = '403: team is blocked: missing payment method';
    // The exact reported leak: the sandbox note now carries NO raw text at all.
    expect(sandboxUnavailableNotice()).not.toMatch(/E2B|payment method|team is blocked|403/i);
    expect(sandboxUnavailableNotice()).toMatch(/temporarily unavailable/i);
    // And if a redacted form is ever shown, the vendor name is gone.
    expect(redactProviderError(raw)).not.toMatch(/\bE2B\b/);
  });

  it('a token-embedded clone URL in a git error is redacted (secret leak closed)', () => {
    const raw = "fatal: unable to access 'https://x-access-token:ghp_SECRET123456@github.com/acme/private.git': 403";
    const out = redactProviderError(raw);
    expect(out).not.toContain('ghp_SECRET123456');
    expect(out).not.toContain('x-access-token:ghp_SECRET123456');
    expect(out).not.toMatch(/https?:\/\//);
  });

  it('caps length and never throws on odd input', () => {
    expect(redactProviderError('x'.repeat(500)).length).toBeLessThanOrEqual(200);
    expect(redactProviderError('')).toBe('');
    expect(redactProviderError(undefined as unknown as string)).toBe('');
  });

  it('White-Label Law: strips every AI vendor + model id so no provider name can reach the user', () => {
    const forbidden = [
      'Provider GLM failed: 429 from Z.ai — falling back',
      'claude-opus-4-8 rate limited; switching to Sonnet',
      'Kimi (Moonshot) timed out, retrying on gemini-2.5-pro',
      'xAI Grok returned an error; Anthropic backstop engaged',
      'OpenAI gpt-4o quota exceeded',
      'glm-5.2 and kimi-k2.7-code both unavailable, Vertex fallback',
    ];
    const banned = /\b(GLM|Z\.?ai|Kimi|Moonshot|Claude|Anthropic|Sonnet|Opus|Haiku|Gemini|Vertex|Grok|xAI|OpenAI|GPT|DeepSeek|glm-|kimi-|claude-|gemini-|grok-|gpt-)\b/i;
    for (const raw of forbidden) {
      const out = redactProviderError(raw);
      expect(out, `leaked a provider name from: ${raw}`).not.toMatch(banned);
    }
    // A vendor NAME degrades to our brand; a bare model id degrades to a neutral "the model".
    expect(redactProviderError('Provider GLM failed')).toContain('NavBharatAI');
    expect(redactProviderError('claude-opus-4-8 rate limited')).toContain('the model');
  });

  it('does not mangle ordinary error words that merely resemble nothing forbidden', () => {
    // A benign message with no provider token passes through (only cap/whitespace applied).
    expect(redactProviderError('the import errored (repository not found)')).toBe('the import errored (repository not found)');
  });
});

describe('Full Team mid-build steering gates (Fix 60)', () => {
  it("steerAllowedForBuild: ONLY the max (Full Team) tier — enforced on the BUILD's resolved tier", () => {
    expect(steerAllowedForBuild('max')).toBe(true);
    for (const t of ['weak', 'off', 'mini', 'medium', undefined, null, '']) {
      expect(steerAllowedForBuild(t as string | undefined | null)).toBe(false);
    }
  });

  it('sanitizeSteerMessage: trims, refuses empty/non-string, caps at 2000 chars', () => {
    expect(sanitizeSteerMessage('  make it red  ')).toBe('make it red');
    expect(sanitizeSteerMessage('')).toBeNull();
    expect(sanitizeSteerMessage('   ')).toBeNull();
    expect(sanitizeSteerMessage(42)).toBeNull();
    expect(sanitizeSteerMessage(undefined)).toBeNull();
    expect(sanitizeSteerMessage('x'.repeat(3000))).toHaveLength(2000);
  });
});

describe('statusEntitlement (T0-9 — /status money facts from the VERIFIED identity only)', () => {
  const prev = { ...process.env };
  beforeEach(() => { delete process.env.AGENTV3_FREE_LIST; process.env.AGENTV3_PAID_PUBLIC = 'true'; });
  afterEach(() => { process.env = { ...prev }; });

  it('an UNVERIFIED caller (verified=null) gets powerUnlocked=false even when a paid wallet is passed — closes the cross-user wallet leak (billed only reflects the GLOBAL paid-public flag, not per-user data)', () => {
    // The vulnerability was powerUnlocked reading a CLAIMED user's wallet; with verified=null it must never
    // report a paid wallet. `billed` derives only from the global flag + (verified) free-list, so it stays
    // true here — that is the global surface state, not a per-user secret.
    expect(statusEntitlement(null, { totalMoneySpent: 999 }).powerUnlocked).toBe(false);
    expect(statusEntitlement(null, null).powerUnlocked).toBe(false);
  });

  it('a verified user with NO purchase → powerUnlocked=false; WITH a purchase → true', () => {
    expect(statusEntitlement({ uid: 'u1', email: null }, null).powerUnlocked).toBe(false);
    expect(statusEntitlement({ uid: 'u1', email: null }, { totalMoneySpent: 100 }).powerUnlocked).toBe(true);
  });

  it('a free-list admin/tester (verified) → powerUnlocked=true regardless of wallet, billed=false', () => {
    process.env.AGENTV3_FREE_LIST = 'admin@x.com';
    const r = statusEntitlement({ uid: 'a', email: 'admin@x.com' }, null);
    expect(r.powerUnlocked).toBe(true);
    expect(r.billed).toBe(false);
  });

  it('billed=true only when paid-public is on AND the verified user is not free-listed', () => {
    expect(statusEntitlement({ uid: 'u', email: null }, null).billed).toBe(true);
    process.env.AGENTV3_PAID_PUBLIC = 'false';
    expect(statusEntitlement({ uid: 'u', email: null }, null).billed).toBe(false);
  });
});

// T0-9 identity convergence (2026-07-19 re-audit): two CONFIRMED claimed-identity risks were fixed —
// (A) the /chat abuse ledger + hard-block keyed off the spoofable req.body.userId (victim-framing DoS +
// self-block evasion), and (B) the /preview-error per-USER "latest report" slot written under the claimed
// body.userId after an anon-workspace ownership pass (cross-user report poisoning). Both now use the
// VERIFIED identity. This structural guard reads the route source and fails if either sink regresses back
// to a client-claimed identity (the route is impure/HTTP; a source assertion is the proportionate lock,
// same style as the tool-wiring guard).
describe('T0-9 — abuse ledger + preview-error report slot must use the VERIFIED identity, never req.body.userId', () => {
  const SRC = readFileSync(fileURLToPath(new URL('./agentv3.ts', import.meta.url)), 'utf8');

  it('the abuse ledger attributes to the verified `userId`, not the spoofable req.body.userId', () => {
    expect(SRC).toContain('const abuserUid = userId ||'); // verified identity resolved earlier in /chat
    // must not re-introduce a claimed body.userId as the abuse-attribution uid
    expect(SRC).not.toMatch(/abuserUid\s*=\s*\(?\s*req\.body\??\.userId/);
  });

  it('the preview-error per-user report slot is keyed off verifiedIdentity(req), not the claim', () => {
    // Scope to the /preview-error handler ONLY — elsewhere (e.g. /chat) saveLatestForUser(userId, …) is
    // correct because THAT `userId` is already the verified identity; here it was the claimed body.userId.
    const start = SRC.indexOf("app.post('/api/agentv3/preview-error'");
    const end = SRC.indexOf("app.get('/api/agentv3/preview-status'", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const handler = SRC.slice(start, end);
    expect(handler).toContain('const reportUid = (await verifiedIdentity(req))?.uid ?? null;');
    expect(handler).toContain('saveLatestForUser(reportUid,');
    expect(handler).toContain('loadLatestForUser(reportUid)');
    // within THIS handler the per-user sinks must never key off the spoofable claimed userId
    expect(handler).not.toContain('saveLatestForUser(userId,');
    expect(handler).not.toContain('loadLatestForUser(userId)');
  });
});

// T0-9 convergence (2026-07-19): the 4 DESTRUCTIVE write routes (exec, delete-files, import-files,
// visual-edit) must use the STRICT assertVerifiedWorkspaceOwner (verified-owner-or-anon-capability, no
// claimed-uid fallback), so a token-less caller who merely learned agentv3-victim-{sid} can't run a command
// or delete files by claiming the victim's uid. The other write routes keep the lenient never-break guard.
describe('T0-9 — destructive write routes require a VERIFIED workspace owner (no claimed-uid fallback)', () => {
  const SRC = readFileSync(fileURLToPath(new URL('./agentv3.ts', import.meta.url)), 'utf8');
  // Slice to the REAL end of the handler — the next route registration — not a fixed character count.
  // A magic window fails in both directions: it false-FAILED when a handler legitimately grew past it
  // (multi-element select, 2026-08-11) and would false-PASS if a neighbouring handler's guard happened
  // to fall inside the window. Either way the temptation is to bump the number, which quietly weakens a
  // security test. The handler's own boundary is the honest limit.
  const handlerOf = (path: string): string => {
    const i = SRC.indexOf(`app.post('${path}'`);
    if (i === -1) return '';
    const next = SRC.slice(i + 1).search(/\n\s{2}app\.(post|get|put|patch|delete)\s*\(/);
    return next === -1 ? SRC.slice(i) : SRC.slice(i, i + 1 + next);
  };

  for (const path of ['/api/agentv3/exec', '/api/agentv3/delete-files', '/api/agentv3/import-files', '/api/agentv3/visual-edit']) {
    it(`${path} uses the strict assertVerifiedWorkspaceOwner, not the lenient assertWorkspaceOwner`, () => {
      const h = handlerOf(path);
      expect(h.length).toBeGreaterThan(0);
      expect(h).toContain('assertVerifiedWorkspaceOwner(req, workspaceId)');
      expect(h).not.toContain('assertWorkspaceOwner(req, workspaceId)'); // must not use the claimed-fallback guard
    });
  }

  it('the strict guard is verified-only (delegates to verifiedWorkspaceReadOk, no claimed-uid input)', () => {
    const i = SRC.indexOf('async function assertVerifiedWorkspaceOwner(');
    const fn = SRC.slice(i, i + 260);
    expect(fn).toContain('verifiedWorkspaceReadOk(await verifyFirebaseToken(req), workspaceId)');
    expect(fn).not.toContain('req.body?.userId'); // never reads a claimed identity
  });
});

describe('isReportAdmin (Fix 68) — only the admin sees raw provider names in the build report', () => {
  const save = process.env.AGENTV3_REPORT_ADMINS;
  afterEach(() => { if (save === undefined) delete process.env.AGENTV3_REPORT_ADMINS; else process.env.AGENTV3_REPORT_ADMINS = save; });

  it('defaults to the known admins (case-insensitive) and fails closed on unknown/empty', () => {
    delete process.env.AGENTV3_REPORT_ADMINS;
    expect(isReportAdmin('aashishcpmt09@gmail.com')).toBe(true);
    expect(isReportAdmin('AASHISHCPMT09@GMAIL.COM')).toBe(true);
    expect(isReportAdmin('doc.asheesh@icloud.com')).toBe(true);
    expect(isReportAdmin('random.user@example.com')).toBe(false); // a normal user → anonymized view
    expect(isReportAdmin('')).toBe(false);
    expect(isReportAdmin(null)).toBe(false);
    expect(isReportAdmin(undefined)).toBe(false);
  });

  it('honours an explicit AGENTV3_REPORT_ADMINS override', () => {
    process.env.AGENTV3_REPORT_ADMINS = 'ops@navbharatai.in, second@navbharatai.in';
    expect(isReportAdmin('ops@navbharatai.in')).toBe(true);
    expect(isReportAdmin('second@navbharatai.in')).toBe(true);
    expect(isReportAdmin('aashishcpmt09@gmail.com')).toBe(false); // override replaces the default list
  });
});

// Large-zip-import GitHub durability backstop (report 2026-07-27 — "1gb zip firbase me nahi to
// github login karwao"). /api/agentv3/import-files gained a best-effort push-to-GitHub step for
// the FINAL chunk of a large bulk import when no Firestore-sized transport ceiling would ever be
// enough. Static-source checks (matching this file's existing style for this huge route file):
// gating must be narrow (bulk import + finalize + real size threshold + git storage active), and
// the whole block must never be able to fail the request.
describe('import-files GitHub backstop — gating + never-blocks (large-zip-import fix)', () => {
  const SRC = readFileSync(fileURLToPath(new URL('./agentv3.ts', import.meta.url)), 'utf8');
  const handler = (() => {
    const i = SRC.indexOf("app.post('/api/agentv3/import-files'");
    const j = SRC.indexOf("app.post('/api/agentv3/delete-files'");
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    return SRC.slice(i, j);
  })();

  it('only attempts the GitHub push for a bulk import, on the final chunk, over a real size threshold, with git storage active', () => {
    expect(handler).toContain("req.body?.source === 'import'");
    expect(handler).toContain('req.body?.finalize === true');
    expect(handler).toContain('totalBytes > LARGE_IMPORT_GITHUB_BACKSTOP_BYTES');
    expect(handler).toContain('githubStorageActive()');
  });

  it('the push itself is wrapped so a GitHub failure can never fail the import response', () => {
    const pushIdx = handler.indexOf('repoSync.pushAll(');
    expect(pushIdx).toBeGreaterThan(-1);
    const tryIdx = handler.lastIndexOf('try {', pushIdx);
    const catchIdx = handler.indexOf('} catch {', pushIdx);
    expect(tryIdx).toBeGreaterThan(-1);
    expect(catchIdx).toBeGreaterThan(pushIdx);
    // the route's own outer catch must still return a 500 only for real (non-GitHub) failures —
    // confirm the response is built (res.json) AFTER the best-effort GitHub block, not skipped by it.
    const resJsonIdx = handler.indexOf('res.json({ imported: written.length');
    expect(resJsonIdx).toBeGreaterThan(catchIdx);
  });

  it('reports needsGithub only when the import is large and no token is available (never nags on small edits)', () => {
    const needsIdx = handler.indexOf('needsGithub = true');
    expect(needsIdx).toBeGreaterThan(-1);
    // needsGithub is set in the `else` branch of the userToken check, itself inside the size/gating `if`
    const elseIdx = handler.lastIndexOf('} else {', needsIdx);
    expect(elseIdx).toBeGreaterThan(-1);
    const gatingIfIdx = handler.lastIndexOf('if (req.body?.source === \'import\'', elseIdx);
    expect(gatingIfIdx).toBeGreaterThan(-1);
    expect(elseIdx).toBeGreaterThan(gatingIfIdx);
  });

  it('the LARGE_IMPORT_GITHUB_BACKSTOP_BYTES threshold is defined and reasonably sized (not trivially small)', () => {
    const m = SRC.match(/const LARGE_IMPORT_GITHUB_BACKSTOP_BYTES = ([\d_]+) \* 1024 \* 1024/);
    expect(m).not.toBeNull();
    const mb = Number((m as RegExpMatchArray)[1].replace(/_/g, ''));
    expect(mb).toBeGreaterThanOrEqual(1);
    expect(mb).toBeLessThanOrEqual(50);
  });
});

// ═══ IMPORT/SURVEY TURN MUST NOT MUTATE THE USER'S FILES (mitrify autopsy 2026-07-27) ═══
// ROOT CAUSE: the prompt was "Import this app … **Do not change any files yet**", yet the build
// reported "✅ Done — I changed 2 files in your project": the pre-flight dependency reconcile added
// `nanoid` to package.json, and the credential-log guard rewrote 8 console lines across 2 files.
// Both are SIBLINGS of the exact class `shouldRunIntegrityHeal` closed on 2026-07-24 — file-MUTATING
// passes that never checked `isImportTurn`. Every such pass is now gated; these tests lock all of them
// so a future pass can't silently reintroduce the violation.
describe('import/survey turn — every file-mutating pass is gated on !isImportTurn', () => {
  const SRC = readFileSync(fileURLToPath(new URL('./agentv3.ts', import.meta.url)), 'utf8');

  // Each entry: the env kill-switch that opens the pass, and what the pass writes.
  const MUTATING_PASSES: Array<{ flag: string; what: string }> = [
    { flag: 'AGENTV3_DEP_RECONCILE', what: 'adds missing deps to package.json' },
    { flag: 'AGENTV3_IMPORT_NORMALIZE', what: 'rewrites import specifiers' },
    { flag: 'AGENTV3_CSS_IMPORT_GUARD', what: 'injects a stylesheet import into the entry' },
  ];

  for (const { flag, what } of MUTATING_PASSES) {
    it(`${flag} (${what}) is guarded by !isImportTurn`, () => {
      const i = SRC.indexOf(`process.env.${flag} !== 'off'`);
      expect(i).toBeGreaterThan(-1);
      // the guard must be on the SAME condition, not merely somewhere later in the block
      const condition = SRC.slice(i, SRC.indexOf('{', i));
      expect(condition).toContain('!isImportTurn');
    });
  }

  it('the credential-log guard DETECTS on an import turn but writes nothing', () => {
    const i = SRC.indexOf("process.env.AGENTV3_CRED_LOG_GUARD !== 'off'");
    expect(i).toBeGreaterThan(-1);
    const block = SRC.slice(i, i + 2200);
    // it branches on isImportTurn...
    expect(block).toContain('if (isImportTurn)');
    // ...and the import-turn branch reports honestly instead of redacting
    const importBranch = block.slice(block.indexOf('if (isImportTurn)'), block.indexOf('} else {'));
    expect(importBranch).toContain('COMPLIANCE_LOG_LEAK_FOUND');
    expect(importBranch).toContain('NOT changed');
    expect(importBranch).not.toContain('actuator.writeFile'); // the whole point: no mutation
  });

  it('integrity FINDINGS are still recorded on an import turn (advisory, never hidden)', () => {
    // Honesty half of the fix: we gate the WRITES, never the reporting.
    expect(SRC).toContain('const obs = (message: string) => importTurnObservation(isImportTurn, message);');
    expect(SRC).toContain("code: 'INTEGRITY_UNUSED_DEP', ...obs(");
    expect(SRC).toContain("code: 'INTEGRITY_FOCUS_CONFLICT', ...obs(");
  });

  it('an imported repo names its own mirror repo (no instruction-shaped repo names)', () => {
    expect(SRC).toContain('readableAppNameForRepo({ importedRepo: parseGitHubRepo(importUrl)');
  });
});

// CENSUS TRIPWIRE — the invariant, not just today's four instances.
//
// The 2026-07-24 autopsy gated ONE mutating pass; three siblings stayed open and two of them fired
// again on 2026-07-27, because nothing forced a NEW pass to consider the read-only turn. Per-pass
// tests (above) lock the four we know about; this locks the CLASS: if anyone adds another writer to
// `writtenFiles`, this fails and makes them prove the import-turn case was considered.
//
// `writtenFiles` is the shared invariant three separate guarantees key off — the reviewer skip
// (`writtenFiles.size > 0`), the summary's honest "I analyzed your project — no files were changed"
// (`changedFiles === 0`), and the billing/artifact checks. A pass that writes to it on a survey turn
// silently breaks all three at once, which is exactly what shipped.
describe('writtenFiles census — a new writer must consider the read-only (import/survey) turn', () => {
  const SRC = readFileSync(fileURLToPath(new URL('./agentv3.ts', import.meta.url)), 'utf8');

  it('has exactly the audited set of writtenFiles.set call sites', () => {
    const count = (SRC.match(/writtenFiles\.set\(/g) ?? []).length;
    // Audited 2026-07-27 — each site is one of:
    //   1× the AGENT'S OWN tool write (onFileWrite) — deliberately NOT gated: if the model writes a
    //      file, the report must honestly say so; gating it would make the summary lie.
    //   1× one-shot fast lane import-path autofix — enclosing lane is already `&& !isImportTurn`.
    //   3× integrity passes (import-normalize / css-guard / cred-log) — gated by this change.
    //   3× post-build artifact passes (tests / index.html / scaffold) — gated on `expectsArtifacts`,
    //      which is false on every import turn.
    //   1× the unused-import sweep (first-build-correct, 2026-07-31) — gated on `result.ok &&
    //      expectsArtifacts && writtenFiles.size > 0`, so it NEVER writes on a read-only import/survey
    //      turn (same discipline as the artifact passes above). Considered ✓.
    //   1× the missing vite.config ensure (first-build-correct, 2026-07-31) — gated on `expectsArtifacts`
    //      (false on every import/survey turn), so it never writes on a read-only turn. It intentionally
    //      does NOT require result.ok (a missing vite.config is the fix for a FAILED build). Considered ✓.
    //   1× the entry-file duplicate-import sweep (duplicate-ErrorBoundary autopsy 2026-08-02) — gated on
    //      `result.ok && expectsArtifacts && writtenFiles.size > 0`, so it NEVER writes on a read-only
    //      import/survey turn (same discipline as the artifact passes above). Considered ✓.
    //   1× the PRE-VERDICT duplicate-import dedupe (duplicate-ErrorBoundary autopsy 2026-08-02, buildId
    //      a2f32f38) — gated on `expectsArtifacts && writtenFiles.size > 0` (false on every import/survey
    //      turn, so it never writes on a read-only turn). It intentionally does NOT require result.ok — a
    //      duplicate import is the fix for a FAILED build, and it runs BEFORE the verdict so the duplicate
    //      never fails the build in the first place (same "fix a failed build" discipline as vite.config). ✓.
    //   1× the golden-scaffold pre-seed (starter-template apps, 2026-08-02) — gated on
    //      `intent === 'new_build' && !isImportTurn` plus an exact chip-prompt match and an EMPTY src/
    //      tree, so it never writes on a read-only import/survey turn (or any edit/rebuild turn). ✓.
    //   1× the automatic E2E net (ROADMAP #1 Phase 4.3, 2026-08-05) — gated by `shouldAutoScaffoldE2e`,
    //      which refuses outright when `isImportTurn` is true (its own test asserts that, with the
    //      reason "your files were left untouched, as asked"). It also refuses a failed build, a
    //      project with no UI, and any project that already has an E2E setup — and writes CREATE-ONLY,
    //      so a file the user owns is never overwritten. Considered ✓.
    //   1× the sign-in flow spec (ROADMAP #1 Phase 4.5, 2026-08-05) — written INSIDE the same
    //      `shouldAutoScaffoldE2e` branch as the E2E net above, so it inherits every one of that
    //      decision's refusals (import/survey turn, failed build, no UI, existing E2E setup) rather
    //      than re-deriving them and drifting. Create-only, and written at all only when the login
    //      form's real selectors are readable from the markup. Considered ✓.
    //   1× the Vite client-types guard (dukaan autopsy 2026-08-12) — gated on `!isImportTurn` in the
    //      same integrity block as the css/import-normalize passes above, so it never writes on a
    //      read-only turn. It intentionally does NOT require result.ok: "Property 'env' does not exist
    //      on type 'ImportMeta'" is a cause of a FAILED build, so repairing it only on success would
    //      skip the builds that need it (same discipline as the vite.config ensure). It writes ONE
    //      types-only declaration, never overwrites an existing file, and stays silent unless the app
    //      genuinely reads import.meta.env with no `vite/client` declared anywhere. Considered ✓.
    //   1× the DESIGN-HEAL REVERT (2026-08-10) — puts a page back when the design repair left it
    //      unparseable. It lives inside `shouldRunIntegrityHeal`, which requires `expectsArtifacts`
    //      (false on every import/survey turn) AND `result.ok` AND the AGENTV3_DESIGN_GATE flag, so it
    //      cannot write on a read-only turn — and it only ever restores content the SAME pass had just
    //      overwritten, never anything the user owns. Considered ✓.
    expect(count).toBe(17);
  });

  it('the reviewer is gated on !isImportTurn, not just writtenFiles.size (build 77bd487b: infra writes defeated the size-only guard)', () => {
    // The size-only guard was DEFEATED in practice (build 77bd487b): infra writes on a read-only survey
    // turn — the `.env` that loads the user's saved keys, foundational scaffolding — pushed
    // writtenFiles.size above zero, so the reviewer RAN and its heal edited a "do not change any files"
    // import (Added 4 imports + 12 package.json deps). The gate now ALSO requires !isImportTurn via the
    // exported `reviewerShouldRun` predicate, so an analysis-only turn is NEVER reviewed regardless of
    // infra writes (this stacks on top of the writtenFiles.set write-site audit above — defense in depth).
    // If this stops being the gate, the "no reviewer on an analysis-only turn" guarantee needs re-deriving.
    expect(SRC).toContain('const reviewerAllowed = reviewerShouldRun(');
    expect(SRC).toContain('!opts.isImportTurn'); // reviewerShouldRun itself gates on the import turn
  });

  it('the build summary still reports honestly from writtenFiles.size', () => {
    // ProjectSummary picks "I analyzed your project — no files were changed" on changedFiles === 0.
    expect(SRC).toContain('changedFiles: writtenFiles.size');
  });
});

// "WORKING APP OR FREE" must not have a hole (autopsy 2026-07-27, buildId d1623410).
// The old guard read `expectsArtifacts && !result.ok`. expectsArtifacts is FALSE on every
// import/survey turn, so an import turn that failed with OUTCOME_SYNTAX_ERROR *and* BUILD_TIMEOUT
// after 29 minutes was still billed (₹19.08 recorded) — while the user-facing summary said
// verbatim "You have NOT been charged for this build".
describe('zeroBillForFailedBuild — a failed build is never charged, import turns included', () => {
  it('zeroes the bill whenever the build did not succeed', () => {
    expect(zeroBillForFailedBuild(false)).toBe(true);
  });

  it('leaves a SUCCESSFUL build billable (a real survey is delivered work)', () => {
    expect(zeroBillForFailedBuild(true)).toBe(false);
  });

  it('does not depend on expectsArtifacts — that dependence WAS the bug', () => {
    // The rule takes only `ok`. If a future refactor reintroduces an artifacts condition,
    // an import/survey turn silently becomes billable-on-failure again.
    expect(zeroBillForFailedBuild.length).toBe(1);
  });

  it('is wired into the billing path (not merely defined)', () => {
    const SRC = readFileSync(fileURLToPath(new URL('./agentv3.ts', import.meta.url)), 'utf8');
    expect(SRC).toContain('zeroBillForFailedBuild(result.ok) && effectiveBilledUsd > 0');
    expect(SRC).not.toContain('expectsArtifacts && !result.ok && effectiveBilledUsd > 0');
  });
});

/**
 * The post-build CODE gates and the import/survey turn (reports d5f0a2bc + 15985d3b, 2026-08-05).
 *
 * Found by measurement, not reading: the post-answer stretch showed the SAME ~97 seconds on two
 * separate Mitrify builds. The cause was a sibling of the reviewer's already-fixed size-only guard —
 * all four code gates ran when `writtenFiles.size > 0`, and the `.env` WE write on an import turn
 * pushes that above zero. So a "do not change any files" survey spent ~97s type-checking the user's
 * untouched 165-file project, and the tsc gate's repair pass could then have edited it.
 */
describe('post-build code gates never run on an import/survey turn', () => {
  const SRC = readFileSync(fileURLToPath(new URL('./agentv3.ts', import.meta.url)), 'utf8');
  const base = {
    enabled: true, fastLaneGated: false, buildOk: true, wroteFiles: true,
    isImportTurn: false, aborted: false,
  };

  it('runs for a normal build that wrote files', () => {
    expect(postBuildCodeGateShouldRun(base)).toBe(true);
  });

  it('NEVER runs on an import turn, however many files infra wrote', () => {
    // This is the whole bug: `.env` alone made wroteFiles true.
    expect(postBuildCodeGateShouldRun({ ...base, isImportTurn: true })).toBe(false);
  });

  it('respects every other condition it always had', () => {
    expect(postBuildCodeGateShouldRun({ ...base, enabled: false })).toBe(false);
    expect(postBuildCodeGateShouldRun({ ...base, fastLaneGated: true })).toBe(false);
    expect(postBuildCodeGateShouldRun({ ...base, buildOk: false })).toBe(false);
    expect(postBuildCodeGateShouldRun({ ...base, wroteFiles: false })).toBe(false);
    expect(postBuildCodeGateShouldRun({ ...base, aborted: true })).toBe(false);
  });

  it('EVERY code gate goes through the one predicate — a later one cannot repeat the bug', () => {
    // Five, not four: writing this test surfaced a late syntax re-parse that shared the same guard.
    // It is milder (it inspects only our own writtenFiles and never repairs), but leaving one gate
    // on the old shape is how someone later widens it and rebuilds the bug.
    expect((SRC.match(/postBuildCodeGateShouldRun\(\{/g) ?? []).length).toBe(5);
    // Anchored on the ENABLED FIELD, not the bare env name: each gate's name also appears in its
    // explanatory comment ("disable with …=off"), which sits above the call and would match first.
    for (const env of ['AGENTV3_AGENTIC_TSC_GATE', 'AGENTV3_MISSING_FILES_GATE', 'AGENTV3_SYNTAX_GATE', 'AGENTV3_MISSING_EXPORT_GATE']) {
      expect(SRC, env).toContain(`enabled: process.env.${env} !== 'off',`);
    }
  });

  it('the FE/BE partition line stays silent on a survey turn, instead of describing our .env', () => {
    // Report 15985d3b described a plainly full-stack 165-file app as "0 frontend, 0 backend, 0
    // shared, 1 other. No clean full-stack split" — true about the one file it measured (`.env`)
    // and false about the app. A confident, specific, misleading line in the admin's own diagnostic
    // is worse than no line.
    expect(SRC).toContain('if (result && result.ok && writtenFiles.size > 0 && !isImportTurn) {');
  });

  it('no code gate is left on the old size-only guard', () => {
    // The exact shape that let infra writes through, in any of the four.
    expect(SRC).not.toContain("&& result.ok && writtenFiles.size > 0 && !abort.signal.aborted");
  });
});
