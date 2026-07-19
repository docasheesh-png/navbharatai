// U-4 (verified recipe modules) — content-moderation generator (OpenAI Moderation + Perspective API).
//
// Real, working content moderation generated into the app, Bring-Your-Own-keys (the user pastes their
// provider key into .env; NavBharatAI never stores it). Any app with user-generated content (comments, chat,
// reviews, posts) needs to catch toxic/unsafe text before it is shown or stored. Each recipe is a SERVER
// helper (the key is a secret and must never reach the browser): moderate(text) → { flagged, score }. Both
// providers are plain REST APIs called with the built-in fetch, so NO npm dependency is needed. PURE
// builders; the generated code is correct and complete — no TODO stubs (the real-features rule). Unit-tested.

export type ModerationProvider = 'openai' | 'perspective';

export interface ModerationConfig {
  provider: ModerationProvider;
  files: Record<string, string>;
  envKeys: string[];
  /** Both providers use the global fetch against a REST API — no npm dependency. */
  dependency?: { name: string; version: string };
  instructions: string;
}

const ENV_EXAMPLE = '.env.example';

// ── OpenAI Moderation ────────────────────────────────────────────────────────────────────────────────────
const OPENAI_SERVER = `// Bring-Your-Own OpenAI key — platform.openai.com → API keys. Pasted into .env as OPENAI_API_KEY (the
// moderation endpoint is free to call). Server secret; must never reach the browser.
const KEY = process.env.OPENAI_API_KEY as string;

export interface ModerationResult { flagged: boolean; score: number; }

// Check text for unsafe content. \`flagged\` is OpenAI's boolean verdict; \`score\` is the highest category score
// (0..1). On any API error we fail OPEN (flagged=false) so moderation trouble never blocks the whole app —
// tighten to fail-closed if your product needs it.
export async function moderate(text: string): Promise<ModerationResult> {
  try {
    const r = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: text }),
    });
    const data = await r.json();
    const result = data?.results?.[0];
    const score = result ? Math.max(0, ...Object.values(result.category_scores ?? {}) as number[]) : 0;
    return { flagged: !!result?.flagged, score };
  } catch {
    return { flagged: false, score: 0 };
  }
}
`;

// ── Perspective API (Google Jigsaw) ──────────────────────────────────────────────────────────────────────
const PERSPECTIVE_SERVER = `// Bring-Your-Own Perspective API key — Google Cloud Console → enable "Perspective Comment Analyzer API",
// create a SERVER key. Pasted into .env as PERSPECTIVE_API_KEY. Server secret; must never reach the browser.
const KEY = process.env.PERSPECTIVE_API_KEY as string;
// Flag text at/above this TOXICITY probability (0..1). Tune for your product.
const THRESHOLD = Number(process.env.PERSPECTIVE_THRESHOLD || '0.8');

export interface ModerationResult { flagged: boolean; score: number; }

// Check text for toxicity. \`score\` is the TOXICITY probability; \`flagged\` is score >= THRESHOLD. On any API
// error we fail OPEN (flagged=false) so moderation trouble never blocks the whole app.
export async function moderate(text: string): Promise<ModerationResult> {
  try {
    const r = await fetch('https://commentanalyzer.googleapis.com/v1alpha1/comments:analyze?key=' + KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: { text }, languages: ['en'], requestedAttributes: { TOXICITY: {} } }),
    });
    const data = await r.json();
    const score = data?.attributeScores?.TOXICITY?.summaryScore?.value ?? 0;
    return { flagged: score >= THRESHOLD, score };
  } catch {
    return { flagged: false, score: 0 };
  }
}
`;

const OPENAI_INSTRUCTIONS =
  'OpenAI content moderation wired (the moderation endpoint is free). Paste OPENAI_API_KEY into .env — ' +
  'NavBharatAI never stores it. Import moderate(text) and call it before storing/showing user content; act on ' +
  '{ flagged, score }. It fails open (flagged=false) on an API error so a moderation outage never blocks the ' +
  'app — switch to fail-closed if your product requires it. The key stays server-side.';

const PERSPECTIVE_INSTRUCTIONS =
  'Perspective API content moderation wired. Enable "Perspective Comment Analyzer API" in Google Cloud, create ' +
  'a SERVER key, and paste it into .env as PERSPECTIVE_API_KEY — NavBharatAI never stores it. Optionally set ' +
  'PERSPECTIVE_THRESHOLD (default 0.8). Import moderate(text) and act on { flagged, score }. Fails open on an ' +
  'API error so moderation trouble never blocks the app. The key stays server-side.';

export function generateModerationIntegration(provider: ModerationProvider): ModerationConfig {
  if (provider === 'openai') {
    return {
      provider,
      files: {
        'server/lib/moderation.ts': OPENAI_SERVER,
        [ENV_EXAMPLE]: 'OPENAI_API_KEY=\n',
      },
      envKeys: ['OPENAI_API_KEY'],
      instructions: OPENAI_INSTRUCTIONS,
    };
  }
  return {
    provider,
    files: {
      'server/lib/moderation.ts': PERSPECTIVE_SERVER,
      [ENV_EXAMPLE]: 'PERSPECTIVE_API_KEY=\nPERSPECTIVE_THRESHOLD=\n',
    },
    envKeys: ['PERSPECTIVE_API_KEY', 'PERSPECTIVE_THRESHOLD'],
    instructions: PERSPECTIVE_INSTRUCTIONS,
  };
}

export function isModerationProvider(v: unknown): v is ModerationProvider {
  return v === 'openai' || v === 'perspective';
}
