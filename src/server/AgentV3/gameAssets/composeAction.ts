/**
 * 🎬 ANY ACTION THE USER NAMES, MADE WHEN THE KIT DOES NOT HAVE IT (admin 2026-11-24: "user jo bole, woh agar kit me nahi
 * hai, navbharatai ai ko api call kar ke woh bhi bana sake … usi character jo abhi user ne select kiya woh karne lage").
 *
 * Library first: an action the kit already plays (play/actions.ts — pick-up, eat, open-door, wave …) is answered with the
 * call to make, and no model is asked. Anything else is designed by ONE model call as DATA (key poses for named limbs and
 * steps), validated by the same rules the kit applies (GameActionsGenerator.validateAction), and written to
 * src/game/actions/<name>.ts — which the kit reads by itself and plays on whatever character the user chose. A plan that
 * does not validate is refused honestly; nothing is guessed. The same free model path as generate_stand_in.
 */
import { ACTION_ROLES, ACTION_STEPS, actionFile, actionKey, LIBRARY_ACTIONS, validateAction, type ActionDef } from '../../lib/GameActionsGenerator';

export type ActionAsk = (prompt: string) => Promise<{ text: string } | null>;

const SHAPE = '{"name":"climb-ladder","seconds":1.2,"keys":[{"t":0,"pose":{}},{"t":0.5,"pose":{"rightUpperArm":[-0.2,1,0.2],"leftUpperArm":[0.2,0.6,0.3]}},{"t":1,"pose":{}}],"steps":[{"at":0.5,"do":"emit","event":"LADDER_CLIMBED"}]}';

/** The one prompt. Directions are in the character's own frame, so the action fits every rig. PURE. */
export function actionPrompt(name: string, description: string): string {
  return [
    'Design ONE character action for a 3D game as JSON. No prose, no code.',
    `Shape: ${SHAPE}`,
    `Limbs (pose keys): ${ACTION_ROLES.join(', ')}. Each is a direction [x,y,z] the limb points, in the character's own frame: +Z forward, +Y up, -X the character's right, +X its left. An arm hanging down is [0,-1,0].`,
    `Keys: 2 to 8, t from 0 to 1, the first and last with an empty pose (rest). seconds 0.3 to 4.`,
    `Steps (optional), each at a point t: ${ACTION_STEPS.join(', ')}. pickUp takes the nearest item (near: a word in its name); drop puts the held item down; open opens the nearest door or gate; consume eats or uses up the held item; emit sends an UPPER_CASE event the game can react to.`,
    `Action: ${String(name).slice(0, 40)}`,
    description ? `What it should look like: ${String(description).slice(0, 200)}` : '',
  ].filter(Boolean).join('\n');
}

/** The first JSON object in a model's reply. PURE. */
export function firstJson(text: string): unknown {
  const s = String(text ?? '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; } }
  }
  return null;
}

export type ComposedAction =
  | { kind: 'library'; name: string }
  | { kind: 'made'; def: ActionDef; path: string; source: string; fromModel: boolean }
  | { kind: 'refused'; reason: string };

const LIBRARY_NAMES: ReadonlySet<string> = new Set(LIBRARY_ACTIONS.map((a) => a.name));

/** Library first, then the supplied plan, then one model call. Never throws. */
export async function composeAction(name: string, description: string, ask: ActionAsk, supplied?: string): Promise<ComposedAction> {
  const key = actionKey(name);
  if (!key) return { kind: 'refused', reason: 'Name the action, in a few words (for example "climb ladder").' };
  if (LIBRARY_NAMES.has(key) && !supplied) return { kind: 'library', name: key };
  let raw: unknown = null;
  let fromModel = false;
  if (supplied) raw = firstJson(supplied);
  else {
    const reply = await ask(actionPrompt(key, description)).catch(() => null);
    raw = reply ? firstJson(reply.text) : null;
    fromModel = true;
    if (!reply) return { kind: 'refused', reason: 'The action could not be designed right now (no model answered). Pass action_json yourself in the same shape, or try again.' };
  }
  const def = validateAction(raw, key);
  if (!def) return { kind: 'refused', reason: 'The action plan did not validate (it needs at least two keys and a limb pose or a step). Nothing was written.' };
  def.name = key;
  const file = actionFile(def);
  return { kind: 'made', def, path: file.path, source: file.source, fromModel };
}
