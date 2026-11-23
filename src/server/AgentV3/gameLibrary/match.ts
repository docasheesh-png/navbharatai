// Intent match for the game library. The model reads the request in whatever language it arrived in.
// A low score, an unknown id, or no model answer means a normal from-scratch build. Keywords are not a fallback.
import { parseEnvFlag } from '../../lib/envFlag';
import { noteProviderCall } from '../../AI/ProviderHealth/trafficHealth';
import { seedableScaffoldFor, type GoldenScaffold } from '../goldenScaffolds/registry';
import { GAME_LIBRARY, gameById, gameScaffold, type GameTemplate } from './registry';

export const GAME_MATCH_CONFIDENCE = 0.7;

export interface GameChoice {
  id: string;
  confidence: number;
  title?: string;
  accent?: string;
  inputTokens: number;
  outputTokens: number;
}

export type GameAsk = (prompt: string) => Promise<{ text: string; inputTokens?: number; outputTokens?: number } | null>;

export function gameLibraryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseEnvFlag(env.AGENTV3_GAME_LIBRARY) !== false;
}

export function gameMatchPrompt(request: string, library: readonly GameTemplate[] = GAME_LIBRARY): string {
  const ids = library.map((game) => game.id).join(', ');
  return [
    'You match a request to one original game template. Read the intent, in any language or script.',
    `Templates: ${ids}.`,
    'Reply with JSON only: {"id":"<id or none>","confidence":0.0,"title":"short original name","accent":"#336699"}.',
    'confidence is how sure you are. Use none when it is not one of these games.',
    'No brand names.',
    `Request: ${request}`,
  ].join('\n');
}

export function parseGameReply(text: string, library: readonly GameTemplate[] = GAME_LIBRARY): GameChoice | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try { raw = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as { id?: unknown; confidence?: unknown; title?: unknown; accent?: unknown };
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const confidence = typeof row.confidence === 'number' ? row.confidence : Number(row.confidence);
  if (!id || id === 'none' || !Number.isFinite(confidence)) return null;
  if (!gameById(id, library)) return null;
  if (confidence < GAME_MATCH_CONFIDENCE) return null;
  return {
    id,
    confidence,
    title: typeof row.title === 'string' ? row.title : undefined,
    accent: typeof row.accent === 'string' ? row.accent : undefined,
    inputTokens: 0,
    outputTokens: 0,
  };
}

/** One cheap call. No key, or a bad answer, means from-scratch. */
export async function askGameClassifier(request: string, env: NodeJS.ProcessEnv = process.env): Promise<{ text: string; inputTokens?: number; outputTokens?: number } | null> {
  const key = (env.GROQ_API_KEY || env.FREE_CHAIN_GROQ_API_KEY || '').split(',')[0].trim();
  if (!key) return null;
  const model = env.FREE_CHAIN_GROQ_MODEL || 'llama-3.1-8b-instant';
  const started = Date.now();
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 80,
        messages: [{ role: 'user', content: gameMatchPrompt(request) }],
      }),
    });
    const data = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } } | null;
    const text = data?.choices?.[0]?.message?.content ?? '';
    noteProviderCall({
      provider: 'GROQ', surface: 'builder', ok: response.ok && !!text, totalMs: Date.now() - started, model,
      error: response.ok ? undefined : new Error(`HTTP ${response.status}`),
    });
    if (!response.ok || !text) return null;
    return { text, inputTokens: data?.usage?.prompt_tokens ?? 0, outputTokens: data?.usage?.completion_tokens ?? 0 };
  } catch (error) {
    noteProviderCall({ provider: 'GROQ', surface: 'builder', ok: false, totalMs: Date.now() - started, error });
    return null;
  }
}

export async function matchGameLibrary(request: string, ask: GameAsk, library: readonly GameTemplate[] = GAME_LIBRARY): Promise<GameChoice | null> {
  const asked = await ask(gameMatchPrompt(request, library));
  if (!asked?.text) return null;
  const parsed = parseGameReply(asked.text, library);
  if (!parsed) return null;
  return { ...parsed, inputTokens: asked.inputTokens ?? 0, outputTokens: asked.outputTokens ?? 0 };
}

/** Exact starter chips stay on their own path. A game match is used only when that path says no. */
export async function resolveBuildScaffold(prompt: string, ask: GameAsk = askGameClassifier): Promise<GoldenScaffold | null> {
  const exact = seedableScaffoldFor(prompt);
  if (exact) return exact;
  if (!gameLibraryEnabled()) return null;
  const match = await matchGameLibrary(prompt, ask);
  if (!match) return null;
  const game = gameById(match.id);
  if (!game) return null;
  return gameScaffold(game, { title: match.title, accent: match.accent });
}
