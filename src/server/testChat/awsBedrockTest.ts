/**
 * 🧪 Test Chat — dedicated AWS Bedrock GLM-5 provider (ISOLATED, debug-only).
 *
 * PURPOSE: validate AWS Bedrock GLM-5 access independently of NavBharatAI's production AI
 * providers/router.
 *
 * WHY THE bedrock-mantle ENDPOINT (verified 2026-07-10 against official AWS docs): GLM-5 (and other
 * third-party models like Qwen) are served through Amazon Bedrock's **Mantle** endpoint — an
 * OpenAI-compatible HTTP API — NOT through the classic bedrock-runtime InvokeModel/Converse APIs.
 * That is why the model works in the new Bedrock console ("Workbench") but returns
 * "ValidationException: Operation not allowed" through @aws-sdk/client-bedrock-runtime:
 *   • bedrock-runtime  (BedrockRuntimeClient, Converse/InvokeModel)  → zai.glm-5 not invocable here.
 *   • bedrock-mantle   (https://bedrock-mantle.<region>.api.aws/v1)  → OpenAI Chat Completions; GLM works.
 * Refs: docs.aws.amazon.com/bedrock/latest/userguide/bedrock-mantle.html and the AWS "new console
 * experience optimized for Anthropic/OpenAI-compatible APIs" announcement.
 *
 * So this client calls the Mantle Chat Completions endpoint over plain HTTPS with the Amazon Bedrock
 * API key as a bearer token (Authorization: Bearer <AWS_BEARER_TOKEN_BEDROCK>). No AWS SDK is used;
 * it does NOT touch NavBharatAI's production provider router, model selector, or live chat path.
 * Every step is logged and the COMPLETE raw response/error is surfaced — no generic masking.
 */

/** A single structured log line returned to the UI so debugging needs no server access. */
export interface TestChatLog {
  at: string; // step order label, not a wall clock — kept simple for the debug panel
  level: 'info' | 'error';
  message: string;
  data?: unknown;
}

export interface TestChatResult {
  ok: boolean;
  /** The assistant text, when a call succeeded. */
  text: string | null;
  /** Which API actually produced the answer (or was attempted). */
  apiUsed: 'mantle' | 'none';
  region: string;
  modelId: string | null;
  /** The exact endpoint URL called. */
  endpoint: string | null;
  /** Exact request payload sent. */
  requestPayload: unknown;
  /** Exact response payload received (parsed where possible). */
  responsePayload: unknown;
  /** AWS request id from the response header, when present. */
  requestId: string | null;
  /** HTTP status code, when present. */
  httpStatus: number | null;
  /** The COMPLETE raw error, never a generic message. Null when ok. */
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
  return process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
}

/** The Amazon Bedrock API key (bearer token, prefix "ABSK…"). Accept either env var name. */
function readBearerToken(): string {
  return process.env.AWS_BEARER_TOKEN_BEDROCK || process.env.BEDROCK_API_KEY || '';
}

/** The official Mantle OpenAI-compatible Chat Completions endpoint for a region. */
function mantleEndpoint(region: string): string {
  return `https://bedrock-mantle.${region}.api.aws/v1/chat/completions`;
}

/**
 * Run one Test Chat turn against Amazon Bedrock (Mantle / OpenAI Chat Completions).
 * Single user message in, full debug result out. Never throws — every failure is captured.
 */
export async function runBedrockGlmTest(userMessage: string): Promise<TestChatResult> {
  const logs: TestChatLog[] = [];
  const log = (level: TestChatLog['level'], message: string, data?: unknown) => {
    logs.push({ at: `step-${logs.length + 1}`, level, message, data });
    const line = `[TestChat/BedrockMantle] ${message}`;
    if (level === 'error') console.error(line, data ?? '');
    else console.log(line, data ?? '');
  };

  const region = readRegion();
  const modelId = readModelId();
  const bearerToken = readBearerToken();
  const endpoint = mantleEndpoint(region);

  log('info', 'AWS Region', region);
  log('info', 'Endpoint (bedrock-mantle, OpenAI Chat Completions)', endpoint);
  log('info', 'Model ID (from BEDROCK_GLM_MODEL)', modelId);
  log('info', 'Bearer token present', {
    AWS_BEARER_TOKEN_BEDROCK: Boolean(process.env.AWS_BEARER_TOKEN_BEDROCK),
    BEDROCK_API_KEY: Boolean(process.env.BEDROCK_API_KEY),
  });

  const base = { region, modelId, endpoint, logs };

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
          'BEDROCK_GLM_MODEL environment variable is not set. Set it to the exact Mantle model id from your AWS Bedrock account (e.g. zai.glm-5).',
      },
    };
  }

  if (!bearerToken) {
    log('error', 'No Bedrock API key — set AWS_BEARER_TOKEN_BEDROCK (the "ABSK…" key).');
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
          'No Amazon Bedrock API key configured. Set AWS_BEARER_TOKEN_BEDROCK to your Bedrock API key (single token, starts with "ABSK…"). Also set AWS_REGION and BEDROCK_GLM_MODEL.',
      },
    };
  }

  // OpenAI-compatible Chat Completions request body.
  const requestBody = {
    model: modelId,
    messages: [{ role: 'user', content: userMessage }],
    max_tokens: 1024,
    temperature: 0.7,
  };
  log('info', 'Request payload', requestBody);

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const httpStatus = resp.status;
    const requestId =
      resp.headers.get('x-amzn-requestid') || resp.headers.get('x-amzn-RequestId') || null;
    const rawText = await resp.text();
    let parsed: unknown = rawText;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      /* keep raw text if not JSON */
    }
    log('info', 'Response payload', parsed);
    log('info', 'HTTP status + request id', { httpStatus, requestId });

    if (!resp.ok) {
      // Surface the COMPLETE raw error body verbatim — no generic masking.
      log('error', 'Mantle call returned a non-2xx status', { httpStatus, body: parsed });
      return {
        ...base,
        ok: false,
        text: null,
        apiUsed: 'mantle',
        requestPayload: requestBody,
        responsePayload: parsed,
        requestId,
        httpStatus,
        error: parsed,
      };
    }

    const p = parsed as Record<string, any>;
    const text =
      p?.choices?.[0]?.message?.content ??
      p?.choices?.[0]?.text ??
      (typeof parsed === 'string' ? parsed : null);

    log('info', 'Mantle call succeeded');
    return {
      ...base,
      ok: true,
      text: (text as string) || '(could not locate text in response — see raw payload below)',
      apiUsed: 'mantle',
      requestPayload: requestBody,
      responsePayload: parsed,
      requestId,
      httpStatus,
      error: null,
    };
  } catch (err) {
    // Network / DNS / TLS failure (e.g. Mantle not available in this region) — surface it raw.
    const serialized =
      err instanceof Error ? { name: err.name, message: err.message } : { raw: String(err) };
    log('error', 'Fetch to Mantle endpoint threw', serialized);
    return {
      ...base,
      ok: false,
      text: null,
      apiUsed: 'mantle',
      requestPayload: requestBody,
      responsePayload: null,
      requestId: null,
      httpStatus: null,
      error: serialized,
    };
  }
}
