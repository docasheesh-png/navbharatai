// Bot Builder → REAL build handoff (admin autopsy 2026-07-20).
//
// The Bot Builder was a genuine visual flow DESIGNER (nodes/edges/simulator/JSON export) that never
// BUILT anything — the tool's promise ("build a bot") ended at a JSON download. This pure module
// converts the designed flow into a complete NavBharatAI Pro v5.0 build prompt, so "Build Bot App"
// hands the design to the real engine and the user gets a working chatbot web app. Pure → tested.

export interface BotFlowNode {
  id: string;
  type: 'start' | 'message' | 'menu' | 'condition' | 'api' | 'end';
  data: {
    text?: string;
    options?: string[];
    condition?: string;
    apiUrl?: string;
    method?: string;
    responseVar?: string;
  };
}

export interface BotFlowEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

const MAX_TEXT = 300;

const t = (s: string | undefined): string => String(s || '').trim().slice(0, MAX_TEXT);

/** Human-readable one-line description of a node for the build prompt. Pure. */
function describeNode(n: BotFlowNode): string {
  switch (n.type) {
    case 'start': return `[${n.id}] START — conversation entry point`;
    case 'message': return `[${n.id}] MESSAGE — the bot says: "${t(n.data.text)}"`;
    case 'menu': return `[${n.id}] MENU — the bot says: "${t(n.data.text)}" and shows tappable quick-reply buttons: ${(n.data.options || []).map((o) => `"${t(o)}"`).join(', ') || '(none configured)'}`;
    case 'condition': return `[${n.id}] CONDITION — branch on: "${t(n.data.condition)}"`;
    case 'api': return `[${n.id}] API CALL — ${(n.data.method || 'GET').toUpperCase()} ${t(n.data.apiUrl) || '(no URL configured)'}${n.data.responseVar ? ` storing the response as "${t(n.data.responseVar)}"` : ''}`;
    case 'end': return `[${n.id}] END — conversation ends${n.data.text ? ` with: "${t(n.data.text)}"` : ''}`;
    default: return `[${n.id}] ${String(n.type).toUpperCase()}`;
  }
}

/**
 * Convert a designed bot flow into a complete, self-contained Pro v5.0 build prompt for a working
 * chatbot web app implementing that exact flow. Pure; deterministic order (nodes as given, edges as
 * given) so the same design always produces the same prompt.
 */
export function botFlowToBuildPrompt(
  nodes: BotFlowNode[],
  edges: BotFlowEdge[],
  platform: 'whatsapp' | 'telegram' | 'both',
): string {
  const platformLabel = platform === 'both' ? 'WhatsApp + Telegram style' : platform === 'whatsapp' ? 'WhatsApp style' : 'Telegram style';
  const theme = platform === 'telegram'
    ? 'a Telegram-inspired blue chat theme'
    : platform === 'whatsapp'
      ? 'a WhatsApp-inspired green chat theme'
      : 'a theme switcher offering WhatsApp-green and Telegram-blue chat looks';
  const nodeLines = nodes.map(describeNode).join('\n');
  const edgeLines = edges.map((e) => `${e.from} -> ${e.to}${e.label ? ` (when the user picks "${t(e.label)}")` : ''}`).join('\n');
  return `Build a complete chatbot web app (${platformLabel}) that implements EXACTLY this designed conversation flow.

THE FLOW — states:
${nodeLines}

THE FLOW — transitions:
${edgeLines}

REQUIREMENTS:
- A polished chat UI with ${theme}: message bubbles, timestamps, a typing indicator before each bot reply, and auto-scroll.
- MENU states render their options as tappable quick-reply buttons; tapping one sends it as the user's message and follows the matching transition.
- CONDITION states evaluate their rule against the user's latest input to choose the branch.
- API states really fetch the configured URL at runtime and store the response for later messages (show a brief loading state; on failure show an honest error message in-chat and continue gracefully).
- A "Restart conversation" control that resets to the START state.
- Keep the flow logic in a clean, well-separated state machine module so the flow is easy to extend.
- Mobile-first responsive layout.`;
}
