import OpenAI from 'openai';
import ts from 'typescript';
import type { ComparisonCase, ComparisonModel } from '../../lib/deepinfraComparison';
import { assertLegacyInferenceAllowed } from '../AI/inferencePolicy';

export const COMPARISON_OUTPUT_TOKENS = 512;
export const DEEPINFRA_BASE_URL = 'https://api.deepinfra.com/v1/openai';
export interface ComparisonObservation {
  passed: boolean; reason: string; latencyMs: number; firstTokenMs: number | null;
  inputTokens: number | null; outputTokens: number | null;
}
const prompts: Record<ComparisonCase, string> = {
  hindi: 'Hindi mein ek chhota vaakya likho jo bataye ki Bharat ki rajdhani New Delhi hai. Devanagari lipi ka upyog karo.',
  math: 'Calculate 17 * 23. Reply with only the integer answer.',
  json: 'Return JSON with exactly name="NavbharatAI" and languages=["hi","en"].',
  tool: 'Call get_weather once for the city Jaipur. Do not invent a weather answer.',
  stream: 'Reply with exactly NAVBHARAT_OK and no other text.',
  typescript: 'Return only TypeScript, without markdown: export function add(a: number, b: number): number { return a + b; }',
};
const count = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0;
function typescriptCheck(text: string): boolean {
  // Parse generated code only. Never execute it, import it or give it access to the server.
  const file = ts.createSourceFile('candidate.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const compiled = ts.transpileModule(text, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022 } });
  if (compiled.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error) || file.statements.length !== 1) return false;
  const fn = file.statements[0];
  if (!ts.isFunctionDeclaration(fn) || fn.name?.text !== 'add' || fn.parameters.length !== 2 || !fn.body || fn.body.statements.length !== 1 ||
    fn.asteriskToken || fn.typeParameters?.length || fn.modifiers?.length !== 1 || fn.modifiers[0].kind !== ts.SyntaxKind.ExportKeyword || fn.type?.kind !== ts.SyntaxKind.NumberKeyword ||
    !fn.parameters.every((p, i) => !p.questionToken && !p.initializer && !p.dotDotDotToken && p.name.getText(file) === ['a', 'b'][i] && p.type?.kind === ts.SyntaxKind.NumberKeyword)) return false;
  const statement = fn.body.statements[0];
  return ts.isReturnStatement(statement) && !!statement.expression && ts.isBinaryExpression(statement.expression) &&
    statement.expression.operatorToken.kind === ts.SyntaxKind.PlusToken && statement.expression.left.getText(file) === 'a' && statement.expression.right.getText(file) === 'b';
}
export function checkComparisonText(task: ComparisonCase, text: string): boolean {
  if (!text.trim()) return false;
  if (task === 'hindi') return /[\u0900-\u097f]/.test(text) && /(?:नई\s*दिल्ली|नयी\s*दिल्ली|न्यू\s*दिल्ली)/.test(text);
  if (task === 'math') return text.trim() === '391';
  if (task === 'stream') return text.trim() === 'NAVBHARAT_OK';
  if (task === 'typescript') return typescriptCheck(text.trim());
  if (task === 'json') {
    try { const data = JSON.parse(text); return data && Object.keys(data).length === 2 && data.name === 'NavbharatAI' && JSON.stringify(data.languages) === '["hi","en"]'; }
    catch { return false; }
  }
  return false;
}
/** Fixed origin and explicit headers prevent SDK environment defaults leaking another account's auth. */
export function createComparisonClient(key: string): OpenAI {
  return new OpenAI({ apiKey: key, baseURL: DEEPINFRA_BASE_URL, maxRetries: 0, timeout: 12_000,
    organization: null, project: null, adminAPIKey: null, webhookSecret: null, logLevel: 'off',
    fetch: async (url, init) => {
      if (String(url) !== `${DEEPINFRA_BASE_URL}/chat/completions` || init?.method !== 'POST') throw new Error('INVALID_COMPARISON_ENDPOINT');
      return globalThis.fetch(url, { ...init, redirect: 'error', headers: {
        Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      } });
    },
  });
}
export async function executeComparisonCase(client: OpenAI, model: ComparisonModel, task: ComparisonCase, signal: AbortSignal): Promise<ComparisonObservation> {
  const start = Date.now();
  let firstTokenMs: number | null = null, inputTokens: number | null = null, outputTokens: number | null = null;
  const measure = (usage: unknown) => {
    const u = usage as { prompt_tokens?: unknown; completion_tokens?: unknown } | null;
    inputTokens = count(u?.prompt_tokens) ? u!.prompt_tokens as number : null;
    outputTokens = count(u?.completion_tokens) ? u!.completion_tokens as number : null;
  };
  try {
    signal.throwIfAborted(); assertLegacyInferenceAllowed('admin-deepinfra-comparison');
    const body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model, messages: [{ role: 'user', content: prompts[task] }], reasoning_effort: 'none',
      max_tokens: COMPARISON_OUTPUT_TOKENS, temperature: 0, stream: false,
      ...(task === 'json' ? { response_format: { type: 'json_schema', json_schema: { name: 'comparison', strict: true,
        schema: { type: 'object', properties: { name: { type: 'string' }, languages: { type: 'array', items: { type: 'string' } } }, required: ['name', 'languages'], additionalProperties: false } } } } : {}),
      ...(task === 'tool' ? { tools: [{ type: 'function', function: { name: 'get_weather', description: 'Get weather in a city',
        parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'], additionalProperties: false } } }],
        tool_choice: { type: 'function', function: { name: 'get_weather' } } } : {}),
    };
    let passed = false, modelMatched = true;
    if (task === 'stream') {
      const stream = await client.chat.completions.create({ ...body, stream: true, stream_options: { include_usage: true } }, { signal });
      let text = '', terminal = false, finished = false;
      try {
        for await (const chunk of stream) {
          if (chunk.model !== model) modelMatched = false;
          if (chunk.usage) measure(chunk.usage);
          const choice = chunk.choices[0], next = choice?.delta.content;
          if (next) { firstTokenMs ??= Date.now() - start; text += next; }
          if (choice?.finish_reason === 'stop') terminal = true;
        }
        finished = true; passed = terminal && checkComparisonText(task, text);
      } finally { if (!finished) stream.controller.abort(); }
    } else {
      const response = await client.chat.completions.create(body, { signal });
      modelMatched = response.model === model;
      measure(response.usage);
      const choice = response.choices[0];
      if (task === 'tool') {
        const calls = choice?.message.tool_calls;
        const call = calls?.length === 1 && calls[0].type === 'function' ? calls[0] : null;
        try { const args = JSON.parse(call?.function.arguments ?? 'null'); passed = choice?.finish_reason === 'tool_calls' && call?.function.name === 'get_weather' && args?.city === 'Jaipur' && Object.keys(args).length === 1; } catch { passed = false; }
      } else passed = choice?.finish_reason === 'stop' && checkComparisonText(task, choice.message.content ?? '');
    }
    return { passed: passed && modelMatched, reason: !modelMatched ? 'model-mismatch' : passed ? 'passed' : 'check-failed', latencyMs: Date.now() - start, firstTokenMs, inputTokens, outputTokens };
  } catch (error) {
    const status = (error as { status?: unknown })?.status;
    const reason = signal.aborted ? 'cancelled' : status === 429 ? 'rate-limit' : status === 401 || status === 403 ? 'authentication' : status === 404 ? 'model-unavailable' : error instanceof OpenAI.APIConnectionTimeoutError ? 'timeout' : 'provider-error';
    // A failed/partial request has unknown usage, even if an earlier stream chunk reported totals.
    return { passed: false, reason, latencyMs: Date.now() - start, firstTokenMs, inputTokens: null, outputTokens: null };
  }
}
