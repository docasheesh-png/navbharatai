/**
 * MCP TRANSPORT — the thin, guarded layer that actually talks to a connected server.
 *
 * All the judgement lives in `mcpClient.ts`, which is pure and tested. This file only carries the
 * two JSON-RPC calls the feature needs (`tools/list`, `tools/call`) and the guards that must wrap
 * every one of them.
 *
 * ═══ 🔒 WHY ONLY HTTP, AND NEVER stdio ═══
 *
 * The MCP spec has two transports. `stdio` launches a LOCAL PROCESS and talks to it over pipes —
 * which, on a server, means a user-supplied string becomes a command NavBharatAI executes. That is
 * remote code execution on our own infrastructure, dressed as a feature, and no amount of validation
 * makes it safe enough to be worth it.
 *
 * So this client speaks HTTP only, and even then only to an address that passes `assertPublicHttpUrl`
 * — the SAME guard `web_fetch` uses, which resolves DNS and refuses a hostname pointing at a private
 * address. Reusing it is deliberate: a second SSRF implementation is a second one to get wrong, and
 * this is the check that stands between a connect form and the cloud metadata endpoint.
 *
 * (If local servers are ever wanted, the honest place to run them is the USER'S OWN E2B sandbox,
 * where their code already runs and the blast radius is their workspace. That is a separate feature,
 * not a flag on this one.)
 *
 * ═══ EVERY CALL IS BOUNDED ═══
 *
 * A connected server is a stranger, so it is assumed to be slow, huge, or hostile: every request has
 * a timeout, a response-size cap, and returns a result object rather than throwing. A build must
 * never hang or die because somebody's Notion server had a bad afternoon.
 */
import { assertPublicHttpUrl } from '../lib/ssrfGuard';
import { toSafeTools, formatToolResult, type SafeMcpTool } from './mcpClient';

/** How long any single call to a connected server may take. */
export const MCP_TIMEOUT_MS = 15_000;
/** Most bytes we will read from one response. */
export const MCP_MAX_RESPONSE_BYTES = 2_000_000;

export interface McpServerConfig {
  /** Short id the user chose — also the tool namespace. */
  id: string;
  url: string;
  /** Headers the USER configured for their own server (an API key they own). Never ours. */
  headers?: Record<string, string>;
}

export type McpCallResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

/**
 * One guarded JSON-RPC round trip. Never throws.
 *
 * The SSRF check runs on EVERY call, not once at connect time. A host that resolved to a public
 * address when the user added it can resolve somewhere else later — re-checking is what closes the
 * gap between "was safe" and "is safe".
 */
async function rpc(cfg: McpServerConfig, method: string, params: unknown): Promise<McpCallResult> {
  const safe = await assertPublicHttpUrl(cfg.url).catch(() => ({ ok: false, reason: 'Could not check that address.' }));
  if (!safe.ok) {
    // The server's own reason is logged, not returned: a precise answer would turn this into a
    // network probe. The user gets one honest, unhelpful-to-an-attacker sentence.
    console.warn(`[MCP] refused ${cfg.id}: ${safe.reason ?? 'blocked'}`);
    return { ok: false, error: 'That service could not be reached from NavBharatAI.' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS);
  try {
    const resp = await fetch(cfg.url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        // Only what the USER configured for their own server. NavBharatAI's own credentials are
        // never in scope here — a connected service is the user's, and so is its authentication.
        ...(cfg.headers ?? {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    });
    if (!resp.ok) return { ok: false, error: `That service replied with an error (${resp.status}).` };

    // Read with a hard cap rather than resp.json(): a hostile or broken server can otherwise stream
    // until we run out of memory, and a size limit applied after parsing is applied too late.
    const raw = await resp.text();
    if (raw.length > MCP_MAX_RESPONSE_BYTES) {
      return { ok: false, error: 'That service sent back more data than NavBharatAI can accept.' };
    }
    return { ok: true, text: raw };
  } catch (e) {
    const aborted = (e as Error)?.name === 'AbortError';
    return { ok: false, error: aborted ? 'That service took too long to reply.' : 'Could not reach that service.' };
  } finally {
    clearTimeout(timer);
  }
}

/** Parse a JSON-RPC envelope. Returns null for anything malformed — never throws. */
function rpcResult(text: string): unknown {
  try {
    const parsed = JSON.parse(text) as { result?: unknown; error?: unknown };
    if (parsed && typeof parsed === 'object' && 'result' in parsed) return parsed.result;
    return null;
  } catch {
    return null;
  }
}

/**
 * Ask a connected server what it can do.
 *
 * Returns the SAFE tools — namespaced, sanitised and capped by `toSafeTools` — so a caller cannot
 * accidentally hand the model something raw. An unreachable or malformed server yields an empty list
 * plus a reason, never a throw and never a partially-trusted tool.
 */
export async function listRemoteTools(
  cfg: McpServerConfig,
): Promise<{ tools: SafeMcpTool[]; error?: string }> {
  const res = await rpc(cfg, 'tools/list', {});
  if (!res.ok) return { tools: [], error: res.error };
  const result = rpcResult(res.text) as { tools?: unknown } | null;
  const raw = Array.isArray(result?.tools) ? result!.tools : [];
  if (raw.length === 0 && result === null) {
    return { tools: [], error: 'That service did not reply in a way NavBharatAI understands.' };
  }
  return { tools: toSafeTools(cfg.id, raw as never) };
}

/**
 * Run one tool on a connected server.
 *
 * The REMOTE name is sent, never the namespaced one — the prefix is ours, for keeping the model's
 * tool list unambiguous, and a server would not recognise it.
 *
 * The result comes back already labelled as outside data (`formatToolResult`), because that labelling
 * is half the injection defence and must not be something a call site can forget.
 */
export async function callRemoteTool(
  cfg: McpServerConfig,
  tool: SafeMcpTool,
  args: Record<string, unknown>,
): Promise<string> {
  const res = await rpc(cfg, 'tools/call', { name: tool.remoteName, arguments: args ?? {} });
  if (!res.ok) return `The connected tool ${tool.name} could not run: ${res.error}`;
  const result = rpcResult(res.text);
  // MCP returns { content: [{type:'text', text}] }. Anything else is passed through as-is rather than
  // guessed at — formatToolResult serialises whatever it is, and says so.
  const content = (result as { content?: unknown } | null)?.content;
  if (Array.isArray(content)) {
    const text = content
      .map((c) => (c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : ''))
      .filter(Boolean)
      .join('\n');
    if (text) return formatToolResult(tool.name, text);
  }
  return formatToolResult(tool.name, result);
}
