// Turning a picked element into a sentence the builder can act on.
//
// WHY A SENTENCE AND NOT COORDINATES (gap analysis 2026-09-10). The Visual Editor's exact-edit
// toolbar needs file:line:column, which only exists in the IN-BROWSER preview, where our own Babel
// plugin stamps it during compile. The live app is built by Vite inside the sandbox where that
// plugin does not run — and patching a plugin into the user's own vite.config to get it back is a
// way to break their build, which outranks any feature.
//
// So Live gets the capability the user actually wanted — point at a thing, say what to change —
// described the way a person would describe it. "The button that says Book now, under the heading
// Recent Orders, on /dashboard" is something the builder can locate in the source; a CSS path is not
// something the USER can check we got right.

export interface PickedElement {
  tag?: string;
  text?: string;
  id?: string;
  classes?: string;
  position?: string;
  section?: string;
  path?: string;
}

/**
 * A human sentence naming the picked element, or '' when there is nothing identifying to say.
 *
 * Returning '' matters: handing the AI "the <div>" with no other detail is worse than not offering
 * the action, because it looks like it worked and then edits the wrong thing.
 */
export function describePickedElement(el: PickedElement | null | undefined): string {
  if (!el || typeof el !== 'object') return '';
  const tag = (el.tag || '').trim().toLowerCase();
  const text = (el.text || '').trim();
  const section = (el.section || '').trim();
  const id = (el.id || '').trim();
  const position = (el.position || '').trim();
  const path = (el.path || '').trim();

  // Nothing to go on: no tag, no words, no id. Anything we produced here would be a guess.
  if (!tag && !text && !id) return '';

  const parts: string[] = [];
  parts.push(tag ? `the <${tag}>` : 'the element');
  if (text) parts.push(`that says "${text}"`);
  else if (id) parts.push(`with id "${id}"`);
  if (position) parts.push(position.replace(/^\s*\(/, '— item ').replace(/\)\s*$/, ' of its kind'));
  if (section) parts.push(`under the heading "${section}"`);
  if (path && path !== '/') parts.push(`on the ${path} page`);
  return parts.join(' ');
}

/** The full line handed to the chat, including the instruction the user still has to supply. */
export function pickedElementPrompt(el: PickedElement | null | undefined): string {
  const described = describePickedElement(el);
  return described ? `${described} in the live preview` : '';
}
