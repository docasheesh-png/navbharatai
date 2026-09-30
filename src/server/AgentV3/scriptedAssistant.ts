// AgentV3 — a chat that calls itself an assistant, and answers from text written into the app.
//
// 🔴 AUTOPSY 466c260a (2026-09-29). The user asked for "pro chat" among a workspace's tools. The app
// shipped a chat page, and the summary sold it as a "Smart chat interface … Instant assistant
// response". The app had no backend, no AI key and not one network call — every reply was text the
// builder had written into the page. The user was told they had an AI assistant; they had a script.
//
// `simulatedDataIssues` already discloses made-up PEOPLE; nothing looked at a made-up MIND. This is
// that sibling, and it follows the same rule: never fail the build (the real version needs an AI
// connection the user has not chosen yet), say in one plain sentence what is not real, and offer the
// real path.
//
// 🔒 PRECISION BY CONSTRUCTION. It fires only when BOTH hold for the whole project:
//   1. some source file builds a message whose role is the assistant/bot side of a chat, and
//   2. NO file anywhere makes a network or AI call (fetch, axios, a websocket, an AI SDK, a Supabase
//      function, our own `window.NavAI` gateway).
// With no way to reach a model, a reply can only be fixed text — so the sentence it produces is true
// whatever the code looks like. A request that ASKED for a scripted/rule-based/FAQ bot is left alone.
//
// PURE — no I/O.

export interface ScriptedAssistantFinding {
  /** The files that build assistant-side messages. */
  files: string[];
}

/** A message on the assistant/bot side of a chat: `role: 'assistant'`, `sender: "bot"`, `from: 'ai'`. */
const ASSISTANT_ROLE_RE = /\b(?:role|sender|from|author|type|who)\s*:\s*['"`](?:assistant|bot|ai|model|system-bot)['"`]/i;

/** Any way out of the page to something that could think. */
const NETWORK_RE =
  /\bfetch\s*\(|\baxios\b|\bXMLHttpRequest\b|\bnew\s+WebSocket\b|\bEventSource\b|\bnavigator\.sendBeacon\b|@anthropic-ai|\bopenai\b|@google\/generative-ai|@google\/genai|\bgroq-sdk\b|\bollama\b|\bsupabase\.functions\b|\bwindow\.NavAI\b|\bNavAI\.ask\b|\buseChat\b|@ai-sdk|\bai\/react\b/i;

/** The user asked for a bot that follows a script — then a script is exactly what was built. */
const ASKED_FOR_A_SCRIPT_RE = /\b(?:rule[\s-]?based|scripted|faq|canned|pre[\s-]?defined|predefined|fixed|keyword[\s-]?based|decision[\s-]?tree|offline)\s+(?:bot|chat\w*|answers?|replies|responses?)\b|\b(?:fake|dummy|mock|demo)\s+(?:ai|bot|chat\w*)\b/i;

const SOURCE_RE = /\.(?:tsx?|jsx?|mjs|vue|svelte)$/i;
const NOT_APP_RE = /(^|[\\/])(?:__mocks__|mocks?|tests?|__tests__|e2e|node_modules|dist|build)([\\/]|$)|\.(?:test|spec)\./i;

export function findScriptedAssistant(
  files: Readonly<Record<string, string>>,
  prompt = '',
): ScriptedAssistantFinding | null {
  if (ASKED_FOR_A_SCRIPT_RE.test(String(prompt ?? ''))) return null;
  const sources = Object.entries(files ?? {}).filter(
    ([p, c]) => typeof c === 'string' && c.length > 0 && SOURCE_RE.test(p) && !NOT_APP_RE.test(p),
  );
  if (sources.some(([, c]) => NETWORK_RE.test(c))) return null;
  const withAssistant = sources.filter(([, c]) => ASSISTANT_ROLE_RE.test(c)).map(([p]) => p).sort();
  return withAssistant.length > 0 ? { files: withAssistant } : null;
}

/**
 * The line appended to the user's summary. Plain words, no engine name (White-Label Law), and the real
 * path offered rather than promised. '' when there is nothing to disclose. PURE.
 */
export function scriptedAssistantNotice(finding: ScriptedAssistantFinding | null): string {
  if (!finding || finding.files.length === 0) return '';
  return [
    '',
    '',
    `⚠️ Heads-up: the chat in this app (${finding.files.slice(0, 3).join(', ')}) answers with fixed replies written into the app. `
      + 'It is not connected to an AI yet, so it cannot really understand or answer questions.',
    'Reply if you want it connected to a real AI, and I will wire it up.',
  ].join('\n');
}
