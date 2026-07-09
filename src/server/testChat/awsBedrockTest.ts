/**
 * 🧪 Test Chat — dedicated AWS Bedrock GLM-5 provider (ISOLATED, debug-only).
 *
 * PURPOSE: validate AWS Bedrock GLM-5 access independently of NavBharatAI's production AI
 * providers/router. This file talks ONLY to AWS Bedrock via AWS SDK v3 (SigV4 auth) — the same
 * approach the new Amazon Bedrock Workbench uses. It deliberately does NOT import or reuse the
 * production provider router, the AI abstraction, model selector, OpenRouter, OpenAI, Gemini, or
 * Claude. Nothing here is wired into any production path.
 *
 * It tries the Converse API first (the modern Bedrock chat API); if GLM-5 does not support Converse
 * on this account, it automatically falls back to InvokeModel. Every step is logged and the COMPLETE
 * raw AWS error/response is surfaced to the caller — no generic "something went wrong" masking.
 */
import {
  BedrockRuntimeClient,
  ConverseCommand,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

/** A single structured log line returned to the UI so debugging needs no server access. */
export interface TestChatLog {
  at: string; // ISO-ish label (step order), not a wall clock — kept simple for the debug panel
  level: 'info' | 'error';
  message: string;
  data?: unknown;
}

export interface TestChatResult {
  ok: boolean;
  /** The assistant text, when a call succeeded. */
  text: string | null;
  /** Which Bedrock API actually produced the answer (or was last attempted). */
  apiUsed: 'converse' | 'invoke_model' | 'none';
  region: string;
  modelId: string | null;
  /** Exact request payload sent to Bedrock (for the deliverables / debug panel). */
  requestPayload: unknown;
  /** Exact response payload received from Bedrock (parsed where possible). */
  responsePayload: unknown;
  /** AWS request id from $metadata, when present. */
  requestId: string | null;
  /** HTTP status code from $metadata, when present. */
  httpStatus: number | null;
  /** The COMPLETE raw AWS error, never a generic message. Null when ok. */
  error: unknown;
  /** Full ordered debug log of the whole attempt. */
  logs: TestChatLog[];
}

/** Read the model id ONLY from env — never hardcoded (requirement #5). */
function readModelId(): string | null {
  const m = process.env.BEDROCK_GLM_MODEL;
  return m && m.trim() ? m.trim() : null;
}

/** Region: BEDROCK region envs → AWS_REGION → a documented default. */
function readRegion(): string {
  return (
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    'us-east-1'
  );
}

/**
 * Serialize an AWS SDK error COMPLETELY (name, message, fault, metadata, and any extra fields the
 * SDK attaches) so the UI can show the exact AWS response. Errors are not plain objects, so we copy
 * own-enumerable props plus the well-known SDK fields explicitly.
 */
function serializeAwsError(err: unknown): Record<string, unknown> {
  if (!err || typeof err !== 'object') {
    return { raw: String(err) };
  }
  const e = err as Record<string, unknown> & {
    name?: string;
    message?: string;
    $fault?: string;
    $metadata?: Record<string, unknown>;
    $response?: unknown;
  };
  const out: Record<string, unknown> = {
    name: e.name,
    message: e.message,
    $fault: e.$fault,
    $metadata: e.$metadata,
  };
  // Copy any additional own-enumerable properties the SDK attached (e.g. Code, Type, reason).
  for (const key of Object.keys(e)) {
    if (!(key in out)) out[key] = e[key];
  }
  return out;
}

function metaOf(obj: unknown): { requestId: string | null; httpStatus: number | null } {
  const meta = (obj as { $metadata?: { requestId?: string; httpStatusCode?: number } } | undefined)
    ?.$metadata;
  return {
    requestId: meta?.requestId ?? null,
    httpStatus: meta?.httpStatusCode ?? null,
  };
}

/** Heuristic: does this Converse failure mean "this model doesn't do Converse" → try InvokeModel. */
function shouldFallbackToInvoke(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | undefined;
  const name = (e?.name || '').toLowerCase();
  const msg = (e?.message || '').toLowerCase();
  // ValidationException is what Bedrock returns when a model isn't wired for Converse; also catch
  // explicit "not support"/"converse" wording. We do NOT fall back on auth/access errors — those
  // are real and must be shown as-is.
  if (name.includes('accessdenied') || name.includes('unrecognizedclient') || msg.includes('security token')) {
    return false;
  }
  return (
    name.includes('validation') ||
    msg.includes('converse') ||
    msg.includes('not support') ||
    msg.includes("isn't supported") ||
    msg.includes('unsupported')
  );
}

/**
 * Run one Test Chat turn against AWS Bedrock GLM-5. Single user message in, full debug result out.
 * Never throws — every failure is captured into the returned TestChatResult.
 */
export async function runBedrockGlmTest(userMessage: string): Promise<TestChatResult> {
  const logs: TestChatLog[] = [];
  const log = (level: TestChatLog['level'], message: string, data?: unknown) => {
    const entry: TestChatLog = { at: `step-${logs.length + 1}`, level, message, data };
    logs.push(entry);
    // Also print to the server console with a clear, greppable prefix for full debug visibility.
    const line = `[TestChat/Bedrock] ${message}`;
    if (level === 'error') console.error(line, data ?? '');
    else console.log(line, data ?? '');
  };

  const region = readRegion();
  const modelId = readModelId();

  // Two supported auth modes:
  //  1. Bearer token — the newer "AWS Bedrock API key" (a single token, prefix "ABSK..."). The SDK
  //     picks it up from the AWS_BEARER_TOKEN_BEDROCK env var. We also accept BEDROCK_API_KEY and copy
  //     it into AWS_BEARER_TOKEN_BEDROCK so the SDK's bearer auth scheme activates.
  //  2. SigV4 — the classic AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY pair.
  // Bearer takes priority when present (it's the simplest and what the Bedrock console hands out now).
  const bearerToken = process.env.AWS_BEARER_TOKEN_BEDROCK || process.env.BEDROCK_API_KEY || '';
  if (bearerToken && !process.env.AWS_BEARER_TOKEN_BEDROCK) {
    // Make the SDK's bearer auth scheme find the token regardless of which var the admin set.
    process.env.AWS_BEARER_TOKEN_BEDROCK = bearerToken;
  }
  const hasSigV4 = Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
  const authMode: 'bearer' | 'sigv4' | 'none' = bearerToken ? 'bearer' : hasSigV4 ? 'sigv4' : 'none';

  log('info', 'AWS Region', region);
  log('info', 'Model ID (from BEDROCK_GLM_MODEL)', modelId);
  log('info', 'Auth mode', authMode);
  log('info', 'Auth env present', {
    AWS_BEARER_TOKEN_BEDROCK: Boolean(process.env.AWS_BEARER_TOKEN_BEDROCK),
    BEDROCK_API_KEY: Boolean(process.env.BEDROCK_API_KEY),
    AWS_ACCESS_KEY_ID: Boolean(process.env.AWS_ACCESS_KEY_ID),
    AWS_SECRET_ACCESS_KEY: Boolean(process.env.AWS_SECRET_ACCESS_KEY),
    AWS_SESSION_TOKEN: Boolean(process.env.AWS_SESSION_TOKEN),
  });

  const base: Omit<TestChatResult, 'ok' | 'text' | 'apiUsed' | 'requestPayload' | 'responsePayload' | 'requestId' | 'httpStatus' | 'error'> = {
    region,
    modelId,
    logs,
  };

  if (!modelId) {
    log('error', 'BEDROCK_GLM_MODEL is not set — cannot pick a model without it (never hardcoded).');
    return {
      ...base,
      ok: false,
      text: null,
      apiUsed: 'none',
      requestPayload: null,
      responsePayload: null,
      requestId: null,
      httpStatus: null,
      error: {
        name: 'ConfigError',
        message:
          'BEDROCK_GLM_MODEL environment variable is not set. Set it to the exact GLM-5 model id / inference-profile id from your AWS Bedrock account.',
      },
    };
  }

  if (authMode === 'none') {
    log('error', 'No AWS auth configured — set AWS_BEARER_TOKEN_BEDROCK (Bedrock API key) OR AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY.');
    return {
      ...base,
      ok: false,
      text: null,
      apiUsed: 'none',
      requestPayload: null,
      responsePayload: null,
      requestId: null,
      httpStatus: null,
      error: {
        name: 'ConfigError',
        message:
          'No AWS Bedrock auth configured. Provide EITHER a Bedrock API key as AWS_BEARER_TOKEN_BEDROCK (single token, starts with "ABSK…") OR the classic pair AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY. Also set AWS_REGION.',
      },
    };
  }

  // Build the client for the resolved auth mode. In bearer mode we pass NO explicit credentials —
  // the SDK's httpBearerAuth scheme reads AWS_BEARER_TOKEN_BEDROCK from the environment. In SigV4 mode
  // we pass the access key/secret pair explicitly.
  const client =
    authMode === 'bearer'
      ? new BedrockRuntimeClient({ region })
      : new BedrockRuntimeClient({
          region,
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
            ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}),
          },
        });

  // ── Attempt 1: Converse API (modern Bedrock chat) ──────────────────────────────────────────────
  const converseInput = {
    modelId,
    messages: [{ role: 'user' as const, content: [{ text: userMessage }] }],
    inferenceConfig: { maxTokens: 1024, temperature: 0.7 },
  };
  log('info', 'Converse request payload', converseInput);

  try {
    const resp = await client.send(new ConverseCommand(converseInput));
    const meta = metaOf(resp);
    log('info', 'Converse response payload', resp);
    const text =
      resp.output?.message?.content?.map((c) => ('text' in c ? c.text : '')).join('') ?? null;
    log('info', 'Converse succeeded', { requestId: meta.requestId, httpStatus: meta.httpStatus });
    return {
      ...base,
      ok: true,
      text: text || '(empty response text)',
      apiUsed: 'converse',
      requestPayload: converseInput,
      responsePayload: resp,
      requestId: meta.requestId,
      httpStatus: meta.httpStatus,
      error: null,
    };
  } catch (converseErr) {
    const meta = metaOf(converseErr);
    log('error', 'Converse failed', serializeAwsError(converseErr));

    if (!shouldFallbackToInvoke(converseErr)) {
      // Auth/access-type failure — real and must be shown as-is, no InvokeModel retry.
      return {
        ...base,
        ok: false,
        text: null,
        apiUsed: 'converse',
        requestPayload: converseInput,
        responsePayload: null,
        requestId: meta.requestId,
        httpStatus: meta.httpStatus,
        error: serializeAwsError(converseErr),
      };
    }

    // ── Attempt 2: InvokeModel (GLM native / OpenAI-style chat body) ─────────────────────────────
    log('info', 'Converse not supported for this model — falling back to InvokeModel.');
    const invokeBody = {
      messages: [{ role: 'user', content: userMessage }],
      max_tokens: 1024,
      temperature: 0.7,
    };
    const invokeInput = {
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(invokeBody),
    };
    log('info', 'InvokeModel request payload', { ...invokeInput, body: invokeBody });

    try {
      const resp = await client.send(new InvokeModelCommand(invokeInput));
      const meta = metaOf(resp);
      // Body is a Uint8Array; decode + try to JSON-parse for the debug panel.
      const rawText = new TextDecoder().decode(resp.body as Uint8Array);
      let parsed: unknown = rawText;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        /* keep rawText if not JSON */
      }
      log('info', 'InvokeModel response payload', parsed);

      // Extract assistant text across the common GLM/OpenAI-style shapes.
      const p = parsed as Record<string, any>;
      const text =
        p?.choices?.[0]?.message?.content ??
        p?.choices?.[0]?.text ??
        p?.output?.text ??
        p?.content?.[0]?.text ??
        p?.generation ??
        (typeof parsed === 'string' ? parsed : null);

      log('info', 'InvokeModel succeeded', { requestId: meta.requestId, httpStatus: meta.httpStatus });
      return {
        ...base,
        ok: true,
        text: (text as string) || '(could not locate text in response — see raw payload below)',
        apiUsed: 'invoke_model',
        requestPayload: { ...invokeInput, body: invokeBody },
        responsePayload: parsed,
        requestId: meta.requestId,
        httpStatus: meta.httpStatus,
        error: null,
      };
    } catch (invokeErr) {
      const im = metaOf(invokeErr);
      log('error', 'InvokeModel failed', serializeAwsError(invokeErr));
      return {
        ...base,
        ok: false,
        text: null,
        apiUsed: 'invoke_model',
        requestPayload: { ...invokeInput, body: invokeBody },
        responsePayload: null,
        requestId: im.requestId,
        httpStatus: im.httpStatus,
        // Show BOTH failures so debugging sees the full picture.
        error: {
          converseError: serializeAwsError(converseErr),
          invokeModelError: serializeAwsError(invokeErr),
        },
      };
    }
  }
}
