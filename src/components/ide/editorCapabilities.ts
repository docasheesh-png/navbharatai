/**
 * WHAT THE EDITOR CAN ACTUALLY DO — the gate that stops a control from claiming a capability we
 * have not built.
 *
 * 🔴 THE BUG THIS EXISTS FOR. The phone keyboard advertised four "🤖 AI CODING SHORTCUTS" —
 * Tab "Accept AI Suggestion", Esc "Reject AI Suggestion", Alt+] / Alt+[ for next and previous. They
 * dispatch Monaco's real `editor.action.inlineSuggest.*` commands, so nothing errors and nothing
 * warns. But an inline suggestion only exists if some code has called
 * `registerInlineCompletionsProvider`, and NOTHING in this codebase ever did. Monaco was being asked
 * to accept a suggestion it never had, and it did what it should: nothing at all.
 *
 * So a user tapped a button labelled "Accept AI Suggestion" and got silence. That is the second
 * absolute rule broken in its plainest form — *a button MUST do what it says* — and it is the worst
 * shape of broken, because there is no error to notice and no log to find. It looks like the feature
 * is simply shy.
 *
 * ═══ WHY A FLAG AND NOT JUST DELETING THE FOUR BUTTONS ═══
 *
 * Deleting them fixes today and teaches nothing. The CLASS of bug is *a control that advertises a
 * capability nobody checked was present*, and this file makes that check the only way to add one.
 *
 * The check could not be automatic here, and it is worth saying why rather than leaving the next
 * reader to try. Monaco's own `editor.getAction(id)` catches a command that does not EXIST — but
 * every one of these four exists. They are real, registered, built-in Monaco actions. What is
 * missing is the PROVIDER behind them, and Monaco offers no way to ask "does anything provide inline
 * completions right now?". A capability that cannot be detected has to be declared.
 *
 * ═══ HOW TO TURN ONE ON — read this before flipping a flag ═══
 *
 * A flag here is a CLAIM, and the claim is checked by a test that reads the real source. Setting
 * `inlineAiSuggestions: true` while no `registerInlineCompletionsProvider` call exists fails
 * `editorCapabilities.test.ts` by name. So the flag cannot drift ahead of the code: the day the
 * provider is genuinely registered, the test flips from "must be false" to "must be true", and the
 * four buttons reappear on their own with nothing else to remember.
 */

/** The capabilities a shortcut or menu item can depend on. */
export type EditorCapability = 'inlineAiSuggestions';

/**
 * Which capabilities are REALLY present in the shipped editor.
 *
 * ⚠️ Each entry is a statement about code that exists, not an intention. See the header: a test reads
 * the source and fails if a flag claims more than the code delivers.
 */
export const EDITOR_CAPABILITIES: Record<EditorCapability, boolean> = {
  /**
   * FALSE until something calls `monaco.languages.registerInlineCompletionsProvider`.
   *
   * When the AI autocomplete engine ships, flip this to true in the same change — the accept/reject/
   * next/previous shortcuts become visible again automatically, because they are filtered on it
   * rather than commented out.
   */
  inlineAiSuggestions: false,
};

/** Is a capability available right now? Unknown names are treated as absent — never as present. */
export function hasEditorCapability(cap: EditorCapability): boolean {
  return EDITOR_CAPABILITIES[cap] === true;
}

/** The minimum an item needs to be filterable: an optional capability it depends on. */
export interface CapabilityGated {
  requires?: EditorCapability;
}

/**
 * Drop every item whose capability is absent. PURE, and deliberately generic over the item type so
 * the keyboard, the command palette and the menu bar can all share ONE gate — two copies of this
 * rule would eventually disagree about which controls are honest.
 *
 * An item with no `requires` is always kept: most shortcuts depend on nothing but Monaco itself.
 */
export function availableItems<T extends CapabilityGated>(items: readonly T[]): T[] {
  return items.filter((item) => !item.requires || hasEditorCapability(item.requires));
}
