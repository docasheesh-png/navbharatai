// Bot flow runner — the REAL conversation engine (admin 2026-07-23: "user sach me bot bana kar
// WhatsApp/Telegram par add kar sake"). A pure, deterministic state machine that executes a Bot-Builder
// flow (the same nodes/edges the designer produces) one user-turn at a time. It is platform-agnostic: the
// Telegram / WhatsApp connectors feed it the user's incoming text + the saved session, and it returns the
// bot's replies (with quick-reply buttons) + the next session state to persist.
//
// Honest scope (rules 2 & 3): this is a REAL executor — MESSAGE/MENU/CONDITION/API/END all run for real
// (API nodes actually fetch). It is intentionally a light, safe expression model (no eval of arbitrary
// code); CONDITION supports `input ==/!=/contains "value"` and label-based routing. Pure except for the
// injected fetch, so it is fully unit-testable without a network.

export type BotNodeType = 'start' | 'message' | 'menu' | 'condition' | 'api' | 'end';

export interface BotFlowNode {
  id: string;
  type: BotNodeType;
  data: {
    text?: string;
    options?: string[];
    condition?: string;
    apiUrl?: string;
    method?: string;
    responseVar?: string;
  };
}

export interface BotFlowEdge { id: string; from: string; to: string; label?: string }
export interface BotFlow { nodes: BotFlowNode[]; edges: BotFlowEdge[]; platform?: string }

/** Per-chat conversation state persisted between turns. `nodeId` is the node AWAITING the user's input
 *  (null = conversation not started / ended → the next turn starts from START). */
export interface BotSession { nodeId: string | null; vars: Record<string, string> }

export interface BotReply { text: string; buttons: string[] }
export interface BotTurnResult { replies: BotReply[]; session: BotSession; ended: boolean }

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

const STEP_BUDGET = 40; // hard cap so a mis-wired loop can never hang the webhook.

function nodeById(flow: BotFlow, id: string | null): BotFlowNode | null {
  return id ? (flow.nodes.find(n => n.id === id) || null) : null;
}
function startNode(flow: BotFlow): BotFlowNode | null {
  return flow.nodes.find(n => n.type === 'start') || null;
}
function outgoing(flow: BotFlow, id: string): BotFlowEdge[] {
  return flow.edges.filter(e => e.from === id);
}

const norm = (s: string | undefined): string => String(s || '').trim().toLowerCase();

/** Evaluate a simple CONDITION expression against the user's last input. Supported (case-insensitive):
 *  `input == "x"`, `input != "x"`, `input contains "x"`. Unparseable → true (take the first branch). */
export function evalCondition(condition: string | undefined, input: string): boolean {
  const c = String(condition || '').trim();
  const i = norm(input);
  let m = /^input\s*==\s*["']?(.+?)["']?$/i.exec(c);
  if (m) return i === norm(m[1]);
  m = /^input\s*!=\s*["']?(.+?)["']?$/i.exec(c);
  if (m) return i !== norm(m[1]);
  m = /^input\s+contains\s+["']?(.+?)["']?$/i.exec(c);
  if (m) return i.includes(norm(m[1]));
  return true;
}

/** Choose which outgoing edge to follow at a branching node (menu / condition / multi-exit message),
 *  given the user's input. Order: exact label → partial label → menu option index → condition eval →
 *  first edge. Pure. */
export function pickEdge(flow: BotFlow, node: BotFlowNode, input: string): BotFlowEdge | null {
  const edges = outgoing(flow, node.id);
  if (edges.length === 0) return null;
  if (edges.length === 1) return edges[0];
  const i = norm(input);

  let hit = edges.find(e => e.label && norm(e.label) === i && i.length > 0);
  if (!hit && i) hit = edges.find(e => e.label && (i.includes(norm(e.label)) || norm(e.label).includes(i)));

  if (!hit && (node.type === 'menu' || node.type === 'message') && node.data.options) {
    const idx = node.data.options.findIndex(o => norm(o) === i);
    if (idx >= 0 && edges[idx]) hit = edges[idx];
  }

  if (!hit && node.type === 'condition') {
    const truthy = evalCondition(node.data.condition, input);
    const yes = edges.find(e => /^(true|yes|haan|haa|1)$/i.test((e.label || '').trim()));
    const no = edges.find(e => /^(false|no|nahi|nhi|0)$/i.test((e.label || '').trim()));
    hit = truthy ? (yes || edges[0]) : (no || edges[Math.min(1, edges.length - 1)]);
  }

  return hit || edges[0];
}

/** Quick-reply button labels a MENU node should show (edge labels first, else the node's options). Pure. */
function menuButtons(flow: BotFlow, node: BotFlowNode): string[] {
  const fromEdges = outgoing(flow, node.id).map(e => e.label).filter((l): l is string => !!l && l.trim().length > 0);
  if (fromEdges.length > 0) return fromEdges;
  return (node.data.options || []).filter(o => o && o.trim().length > 0);
}

/**
 * Run ONE user turn. `input` is what the user just sent (empty on the first /start). Walks the flow from
 * the session's awaiting node, emitting the bot's replies, until it reaches the next node that needs the
 * user's input (a MENU / multi-exit branch) or the conversation ENDs. Returns the replies + the session to
 * persist. `fetchImpl` runs API nodes for real (injectable for tests). Never throws on a bad flow.
 */
export async function runBotTurn(
  flow: BotFlow,
  session: BotSession,
  input: string,
  fetchImpl?: FetchLike,
): Promise<BotTurnResult> {
  const replies: BotReply[] = [];
  const vars: Record<string, string> = { ...(session.vars || {}), input: String(input || '') };

  // Where do we resume? If a node was awaiting input, use the input to pick its outgoing edge; otherwise
  // (fresh / ended) begin at START.
  let cur: BotFlowNode | null;
  const awaiting = nodeById(flow, session.nodeId);
  if (awaiting) {
    const edge = pickEdge(flow, awaiting, input);
    cur = edge ? nodeById(flow, edge.to) : null;
  } else {
    const s = startNode(flow);
    cur = s ? (nodeById(flow, (outgoing(flow, s.id)[0]?.to)) ?? null) : (flow.nodes[0] ?? null);
  }

  let steps = 0;
  while (cur && steps++ < STEP_BUDGET) {
    if (cur.type === 'start') {
      cur = nodeById(flow, outgoing(flow, cur.id)[0]?.to);
      continue;
    }
    if (cur.type === 'end') {
      if (cur.data.text) replies.push({ text: cur.data.text, buttons: [] });
      return { replies, session: { nodeId: null, vars }, ended: true };
    }
    if (cur.type === 'message') {
      // A Message can now carry tappable quick-reply BUTTONS (admin 2026-07-23) — like a real
      // WhatsApp/Telegram message. When it has buttons, show them and await the user's tap (routed by
      // pickEdge, same as a menu). A plain message just flows to the next node.
      const btns = menuButtons(flow, cur);
      if (btns.length > 0) {
        replies.push({ text: cur.data.text || '', buttons: btns });
        return { replies, session: { nodeId: cur.id, vars }, ended: false };
      }
      if (cur.data.text) replies.push({ text: cur.data.text, buttons: [] });
      const nexts = outgoing(flow, cur.id);
      if (nexts.length === 1) { cur = nodeById(flow, nexts[0].to); continue; }
      if (nexts.length === 0) return { replies, session: { nodeId: null, vars }, ended: true };
      return { replies, session: { nodeId: cur.id, vars }, ended: false }; // multi-exit → await input
    }
    if (cur.type === 'menu') {
      replies.push({ text: cur.data.text || 'Choose an option:', buttons: menuButtons(flow, cur) });
      return { replies, session: { nodeId: cur.id, vars }, ended: false }; // await the user's choice
    }
    if (cur.type === 'condition') {
      const edge = pickEdge(flow, cur, vars.input);
      cur = edge ? nodeById(flow, edge.to) : null;
      continue;
    }
    if (cur.type === 'api') {
      const url = (cur.data.apiUrl || '').trim();
      const varName = (cur.data.responseVar || 'result').trim();
      if (url && fetchImpl) {
        try {
          const res = await fetchImpl(url, { method: (cur.data.method || 'GET').toUpperCase() });
          vars[varName] = (await res.text()).slice(0, 2000);
        } catch {
          vars[varName] = '';
          replies.push({ text: "I couldn't reach that service just now — let's continue.", buttons: [] });
        }
      }
      cur = nodeById(flow, outgoing(flow, cur.id)[0]?.to);
      continue;
    }
    // Unknown node type — stop safely.
    break;
  }

  // Fell off the flow (no END, or step budget) — end honestly.
  return { replies, session: { nodeId: null, vars }, ended: true };
}
