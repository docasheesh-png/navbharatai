import { guardSurplusNarrative, withServiceIdentity } from './surplusNarrativeIdentity';
import { readScopeFailure, tagScopeFailure, type ScopeFailureDiagnostic } from '../scopeFailureDiagnostic';
import { tagRawErrorDetail } from '../rawErrorDetail';
import { PublicBuildEngineError, publicBuildEngineError, type PublicBuildEngineSafeReason } from '../../lib/buildEngineError';
import { assertAiAvailable, aiMaintenanceStore, AiMaintenanceError } from '../../lib/aiMaintenance';
import type { RunTurnParams, TurnResult, TurnRunner, TurnUsage } from '../ClaudeClient';
import { BuildStoppedError, onStop, raceStop, throwIfStopped } from '../stopSignal';
import { turnDeadline, BUDGET_EXHAUSTED_MESSAGE, BUDGET_REACHED_MESSAGE } from '../turnDeadline';
import { parseOpenAiCompletion, transcriptToOpenAI, toolDefsToOpenAI, type OpenAiCompletionLike, type OpenAiMessage, type OpenAiTool } from './OpenAiToolAdapter';

/** Server-issued, one-call authority. Only the reviewed session may construct this contract. */
export interface SurplusTurnPermit {
  buildId: string;
  callId: string;
  model: string;
  providerId: string;
  /** Observed registry candidate for audit; not a claim that the wire API supports an offer pin. */
  offerId: string;
  endpoint: string;
  priceGeneration: string;
  /** Estimated reservation only; never an actual cost or guaranteed spend cap. */
  estimatedMicroUsd?: string;
  policyVersion: string;
  maxTokens: number;
  /** Exact objective/provider binding supplied by the reviewed capability adapter. */
  requestRouting: Readonly<Record<string, unknown>>;
  /** Must verify actual response model/provider against this permit before returning a completion. */
  validateResponse(raw: unknown): OpenAiCompletionLike;
  /** Final expiry/revocation fence immediately before a physical HTTP request. */
  assertCurrent?(): void;
}
export interface SurplusTurnRequest extends Record<string, unknown> {
  model: string;
  messages: OpenAiMessage[];
  tools?: OpenAiTool[];
  tool_choice?: 'auto';
  max_tokens: number;
  stream: false;
}
/** Internal-only facts. No provider error text or response data crosses this contract. */
export interface SurplusTurnFailure {
  readonly stage: 'dispatch' | 'response_validation';
  readonly reason: 'dispatch_failed' | 'empty_completion' | 'content_filter' | 'invalid_completion';
  readonly attempt: number;
  readonly hasResponse: boolean;
}
/** Issued only after the session has reconciled this failed attempt to durable, known expense. */
export interface SurplusFailureResolution {
  retry: true;
  receiptDurablyRecorded: true;
}
export interface SurplusRunnerAuthority {
  authorize(params: RunTurnParams): Promise<SurplusTurnPermit>;
  /** Dedicated min90 transport only. Must disable SDK retries and verify the permit is still current. */
  dispatch(request: SurplusTurnRequest, signal: AbortSignal, permit: SurplusTurnPermit): Promise<unknown>;
  /** Trusted accounting mapper, never a conversion of buyer_cost_micro into a settled receipt. */
  onResponse?(raw: unknown, permit: SurplusTurnPermit, result: TurnResult): Promise<TurnUsage['surplusReceipt'] | undefined>;
  /** Retain expense without publishing failed output. Absent/uncertain accounting always denies retry. */
  onFailure?(raw: unknown, permit: SurplusTurnPermit, error: unknown, failure?: SurplusTurnFailure): Promise<void | SurplusFailureResolution>;
  /** Optional, default OFF. Must issue a fresh permit after a positive durable onFailure decision. */
  authorizeFallback?(params: RunTurnParams, previousPermit: SurplusTurnPermit, failure: SurplusTurnFailure): Promise<SurplusTurnPermit | undefined>;
  onTurnComplete?(result: TurnResult, used: 'SURPLUS'): void;
  onProviderUsed?(permit: SurplusTurnPermit): void;
  timeoutMs?: number;
}

/** Only call with newly constructed local errors, never with upstream objects. */
function publicError<T extends Error>(error: T): T {
  error.name = 'Error';
  error.stack = `Error: ${error.message}`;
  return error;
}
const unavailable = (reason: PublicBuildEngineSafeReason = 'terminal_fold') => publicBuildEngineError(reason);
const ENDPOINT = 'https://api.surplusintelligence.ai/min90/v1';
const MAX_TURN_ATTEMPTS = 3;
const validationReasons = new WeakMap<object, SurplusTurnFailure['reason']>();
function validationError(reason: 'empty_completion' | 'content_filter'): Error {
  const error = new Error('Surplus returned an unusable completion');
  validationReasons.set(error, reason);
  return error;
}
function terminalAttemptError(error: unknown): boolean {
  try {
    // These are terminal control signals, not provider eligibility decisions. Do not inspect
    // upstream messages, HTTP statuses, or guessed marketplace error codes here.
    return error instanceof BuildStoppedError || error instanceof AiMaintenanceError ||
      (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'));
  } catch { return true; }
}
function failureReason(error: unknown): SurplusTurnFailure['reason'] {
  return error !== null && (typeof error === 'object' || typeof error === 'function')
    ? validationReasons.get(error) ?? 'invalid_completion' : 'invalid_completion';
}
const RESERVED = new Set(['model', 'messages', 'tools', 'tool_choice', 'max_tokens', 'stream', 'stream_options', '__proto__', 'constructor', 'prototype']);
function checkPermit(permit: SurplusTurnPermit, requested?: number): void {
  if (!permit || permit.endpoint !== ENDPOINT ||
      ![permit.buildId, permit.callId, permit.model, permit.providerId, permit.offerId, permit.priceGeneration, permit.policyVersion]
        .every(v => typeof v === 'string' && v.trim().length > 0) ||
      !Number.isSafeInteger(permit.maxTokens) || permit.maxTokens <= 0 ||
      (requested !== undefined && (!Number.isSafeInteger(requested) || requested <= 0 || permit.maxTokens > requested)) ||
      typeof permit.validateResponse !== 'function' || !permit.requestRouting ||
      typeof permit.requestRouting !== 'object' || Array.isArray(permit.requestRouting) ||
      Object.keys(permit.requestRouting).some(key => RESERVED.has(key))) {
    throw new Error('Surplus dispatch permit is invalid');
  }
}
function checkCompletion(completion: OpenAiCompletionLike, permit: SurplusTurnPermit, tools: OpenAiTool[]): void {
  const choice = completion?.choices?.[0];
  if (completion?.model === permit.model && Array.isArray(completion?.choices) && completion.choices.length === 0) {
    throw validationError('empty_completion');
  }
  if (completion?.model !== permit.model || completion?.choices?.length !== 1 ||
      !choice?.message || choice.message.role !== 'assistant' ||
      (choice.message.content !== null && typeof choice.message.content !== 'string') ||
      !['stop', 'length', 'tool_calls', 'content_filter'].includes(choice.finish_reason ?? '')) {
    throw new Error('Surplus returned an invalid completion');
  }
  // A refusal is terminal even when a compatible endpoint reports stop or includes tools.
  if ('refusal' in choice.message && choice.message.refusal != null) throw validationError('content_filter');
  const calls = choice.message.tool_calls;
  if (calls !== undefined && (!Array.isArray(calls) || calls.some(call =>
    !call || typeof call.id !== 'string' || !call.id.trim() || call.type !== 'function' ||
    typeof call.function?.name !== 'string' || !call.function.name.trim() || typeof call.function.arguments !== 'string') ||
    new Set(calls.map(call => call.id)).size !== calls.length)) {
    throw new Error('Surplus returned invalid tool call identities');
  }
  const allowedTools = new Set(tools.map(tool => tool.function.name));
  if (calls?.some(call => !allowedTools.has(call.function.name))) throw new Error('Surplus returned an unrequested tool');
  if (choice.finish_reason === 'tool_calls' && !calls?.length) throw new Error('Surplus returned an empty tool turn');
  if (choice.finish_reason === 'content_filter') throw validationError('content_filter');
  if (!choice.message.content?.trim() && !calls?.length) throw validationError('empty_completion');
  // A complete malformed call must never become an executable empty argument object.
  // Length-stopped JSON is deliberately delegated to the adapter's safe path-only salvage.
  if (choice.finish_reason !== 'length') {
    for (const call of calls ?? []) {
      let args: unknown;
      try { args = JSON.parse(call.function.arguments); } catch { throw new Error('Surplus returned malformed tool arguments'); }
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Surplus returned malformed tool arguments');
    }
  }
  if (completion.usage) {
    for (const count of [completion.usage.prompt_tokens, completion.usage.completion_tokens,
      completion.usage.cached_tokens, completion.usage.prompt_tokens_details?.cached_tokens]) {
      if (count !== undefined && (!Number.isSafeInteger(count) || count < 0)) throw new Error('Surplus returned invalid usage');
    }
  }
}

/** Native turns only. Bounded fallback is separately authorized, never an implicit model or cost guess. */
export function makeSurplusTurnRunner(authority: SurplusRunnerAuthority): TurnRunner {
  const configuredMs = authority.timeoutMs ?? 120_000;
  if (!Number.isFinite(configuredMs) || configuredMs <= 0) throw unavailable('misconfigured');
  return {
    async runTurn(params) {
      let diagnostic: ScopeFailureDiagnostic = { stage: 'authorization', reason: 'authorization_failed' };
      if (params.signal?.aborted) throw publicError(new BuildStoppedError());
      const bound = turnDeadline(configuredMs, params.deadlineAt);
      if (bound.expired) throw publicError(new Error(BUDGET_EXHAUSTED_MESSAGE));
      const expiresAt = Date.now() + bound.timeoutMs;
      const controller = new AbortController();
      let active = true;
      let maintenanceError: AiMaintenanceError | undefined;
      let deadlineError: Error | undefined;
      let policyRefused = false;
      const offStop = onStop(params.signal, () => controller.abort());
      let rejectMaintenance: (error: Error) => void = () => {};
      const maintenance = new Promise<never>((_, reject) => { rejectMaintenance = reject; });
      const offMaintenance = aiMaintenanceStore.onChange(state => {
        // Deliberate pause vs unreadable flag: both stop spend, but the user-facing string must differ.
        if (state.unavailable && state.enabled) {
          maintenanceError = new AiMaintenanceError({ unavailable: true });
          active = false;
          controller.abort();
          rejectMaintenance(maintenanceError);
        } else if (state.enabled) {
          maintenanceError = new AiMaintenanceError();
          active = false;
          controller.abort();
          rejectMaintenance(maintenanceError);
        }
        // fail-open (unavailable && !enabled) does not abort an in-flight turn.
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          active = false;
          controller.abort();
          if (bound.source === 'deadline') {
            deadlineError = new Error(BUDGET_REACHED_MESSAGE);
            reject(deadlineError);
          } else {
            reject(unavailable('turn_timeout'));
          }
        }, bound.timeoutMs);
      });
      const assertActive = () => {
        throwIfStopped(params.signal);
        if (maintenanceError) throw maintenanceError;
        if (!active) throw deadlineError ?? unavailable('turn_timeout');
        if (Date.now() >= expiresAt) {
          active = false;
          controller.abort();
          if (bound.source === 'deadline') deadlineError = new Error(BUDGET_REACHED_MESSAGE);
          throw deadlineError ?? unavailable('turn_timeout');
        }
      };
      const work = async (): Promise<TurnResult> => {
        await assertAiAvailable();
        assertActive();
        // Snapshot before authority/transport hooks can mutate their arguments. Failed attempts never
        // join the canonical transcript, and every request gets fresh copies of the identical history.
        const authorizedParams = {
          ...params, system: withServiceIdentity(params.system),
          messages: structuredClone(params.messages), tools: structuredClone(params.tools),
        };
        const freshParams = (): RunTurnParams => ({
          ...authorizedParams, messages: structuredClone(authorizedParams.messages),
          tools: structuredClone(authorizedParams.tools),
        });
        const tools = toolDefsToOpenAI(authorizedParams.tools);
        const messages = transcriptToOpenAI(authorizedParams.messages, authorizedParams.system);
        let permit = await authority.authorize(freshParams());
        const originalBuildId = permit?.buildId;
        const usedCallIds = new Set<string>();
        for (let attempt = 1; attempt <= MAX_TURN_ATTEMPTS; attempt++) {
          assertActive();
          checkPermit(permit, authorizedParams.maxTokens);
          if (permit.buildId !== originalBuildId || usedCallIds.has(permit.callId)) throw unavailable('terminal_fold');
          usedCallIds.add(permit.callId);
          const request: SurplusTurnRequest = {
            ...permit.requestRouting,
            model: permit.model,
            messages: structuredClone(messages),
            ...(tools.length ? { tools: structuredClone(tools), tool_choice: 'auto' as const } : {}),
            max_tokens: permit.maxTokens,
            stream: false,
          };
          await assertAiAvailable();
          assertActive();
          let raw: unknown;
          let failureAccounted = false;
          const accountFailure = async (error: unknown, failure: SurplusTurnFailure): Promise<void | SurplusFailureResolution> => {
            if (failureAccounted) return;
            failureAccounted = true;
            // A complete late response still carries supplier expense after Stop/deadline won.
            // Never publish its answer, tool calls, or successful-turn callbacks.
            try { return await authority.onFailure?.(raw, permit, error, failure); } catch { /* no invented expense */ }
          };
          const fallback = async (resolution: void | SurplusFailureResolution, failure: SurplusTurnFailure, error: unknown): Promise<SurplusTurnPermit | undefined> => {
            assertActive();
            if (attempt >= MAX_TURN_ATTEMPTS || terminalAttemptError(error) || failure.reason === 'content_filter' ||
                resolution?.retry !== true || resolution.receiptDurablyRecorded !== true || !authority.authorizeFallback) return;
            await assertAiAvailable();
            assertActive();
            const next = await authority.authorizeFallback(freshParams(), permit, failure).catch(error => {
              throw tagScopeFailure(error, { stage: 'authorization', reason: 'authorization_failed' });
            });
            assertActive();
            return next;
          };
          try {
            diagnostic = { stage: 'dispatch', reason: 'dispatch_failed' };
            raw = await authority.dispatch(request, controller.signal, permit);
          } catch (error) {
            const failure: SurplusTurnFailure = Object.freeze({ stage: 'dispatch', reason: 'dispatch_failed', attempt, hasResponse: false });
            const next = await fallback(await accountFailure(error, failure), failure, error);
            if (next) { permit = next; continue; }
            throw error;
          }
          let result: TurnResult;
          try {
            diagnostic = { stage: 'response_validation', reason: 'invalid_completion' };
            assertActive();
            const completion = permit.validateResponse(raw);
            checkCompletion(completion, permit, tools);
            // The shared parser can remember tool reasoning. This path does not pass it back and
            // must not mutate that cache for an attempt whose receipt may still fail.
            result = parseOpenAiCompletion({ ...completion, choices: completion.choices.map(choice => ({
              ...choice, message: { ...choice.message, reasoning_content: undefined },
            })) });
            // Only public narrative changes. Raw accounting identity and tool payloads stay intact.
            result.text = guardSurplusNarrative(result.text, permit);
            result.rawContent = result.rawContent.map(block => {
              if (!block || typeof block !== 'object' || (block as { type?: unknown }).type !== 'text') return block;
              const narrative = block as { type: 'text'; text: string };
              return { ...narrative, text: guardSurplusNarrative(narrative.text, permit) };
            });
          } catch (error) {
            const failure: SurplusTurnFailure = Object.freeze({ stage: 'response_validation', reason: failureReason(error), attempt, hasResponse: true });
            // Accounting can outlive the turn timer; a known refusal must never become availability.
            if (failure.reason === 'content_filter') policyRefused = true;
            const next = await fallback(await accountFailure(error, failure), failure, error);
            if (next) { permit = next; continue; }
            throw error;
          }
          result.usage.selectedMaxOutputTokens = permit.maxTokens;
          result.selectedMaxOutputTokens = permit.maxTokens;
          // A receipt rejection/unknown result is terminal. Do not repeat accounting or inference.
          if (authority.onResponse) {
            diagnostic = { stage: 'receipt', reason: 'receipt_failed' };
            const receipt = await authority.onResponse(raw, permit, result);
            if (receipt !== undefined) result.usage.surplusReceipt = receipt;
          }
          try { assertActive(); } catch (error) {
            await accountFailure(error, Object.freeze({ stage: 'response_validation', reason: 'invalid_completion', attempt, hasResponse: true }));
            throw error;
          }
          authority.onProviderUsed?.(permit);
          authority.onTurnComplete?.(result, 'SURPLUS');
          if (result.text) params.onText?.(result.text);
          return result;
        }
        throw unavailable('attempts_exhausted');
      };
      try {
        return await raceStop(Promise.race([work(), timeout, maintenance]), params.signal);
      } catch (error) {
        // Some SDKs reject their transport before raceStop wins: Stop still has one meaning.
        if (params.signal?.aborted) throw publicError(new BuildStoppedError());
        let maintenanceBlocked = Boolean(maintenanceError);
        try { maintenanceBlocked ||= error instanceof AiMaintenanceError; } catch { /* hostile prototype: generic error */ }
        if (maintenanceBlocked) {
          const from = maintenanceError ?? (error instanceof AiMaintenanceError ? error : null);
          throw publicError(new AiMaintenanceError(from?.statusUnavailable ? { unavailable: true } : undefined));
        }
        if (deadlineError && error === deadlineError) throw publicError(new Error(BUDGET_REACHED_MESSAGE));
        // A policy refusal stays terminal across the outer pre-write Weak fallback too.
        if (policyRefused || failureReason(error) === 'content_filter') throw unavailable('policy_refusal');
        // Never forward an upstream name, stack, cause, body, metadata, or even its error text.
        // Preserve an already-tagged PublicBuildEngineError (timeout / attempts_exhausted); else fold.
        if (error instanceof PublicBuildEngineError) throw tagRawErrorDetail(tagScopeFailure(publicError(error), readScopeFailure(error) ?? diagnostic), error, JSON.stringify(readScopeFailure(error) ?? diagnostic ?? null));
        try { console.warn('[SURPLUS_TURN] folded provider/transport failure to public build-engine boundary'); } catch { /* best-effort */ }
        throw tagRawErrorDetail(tagScopeFailure(unavailable('terminal_fold'), readScopeFailure(error) ?? diagnostic), error, JSON.stringify(readScopeFailure(error) ?? diagnostic ?? null));
      } finally {
        active = false;
        controller.abort();
        if (timer !== undefined) clearTimeout(timer);
        offStop();
        offMaintenance();
      }
    },
  };
}
