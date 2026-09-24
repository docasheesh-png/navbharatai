/**
 * WHICH EDITOR ENGINE CODE STUDIO RUNS — one decision, made in one place (admin 2026-09-24:
 * "mobile me woh sab kaam hone chahiye jo desktop me ho sakte hai", and then "pura editor desktop
 * jaisa kaam kare").
 *
 * 🔴 THE BUG THIS REPLACES. `Editor.tsx` used to pick a plain `<textarea>` whenever
 * `window.innerWidth < 768`, on a comment reading "lightweight textarea fallback on mobile to avoid
 * Monaco memory issues". Nothing in this repo ever measured those issues. What the gate actually did:
 *   • the textarea never calls `onMount`, so `editorInstance` in CodeStudio stayed `null` on every
 *     phone — and ~55 of the 82 shortcuts in the Shortcuts panel (undo, select all, comment line,
 *     find, format, go to line, fold, rename, multi-cursor…) are dispatched through that instance.
 *     On a phone every one of them was a button that did nothing, with no error anywhere;
 *   • the Cursor popup is rendered only when `editorInstance` exists, so on a phone it never opened;
 *   • CodeStudio had carried a PHONE-TUNED Monaco option set since 2026-07-31 (no minimap, no sticky
 *     scroll, 14px touch scrollbars) that the gate discarded before it could ever apply.
 *
 * MEASURED before the default changed (Playwright, 390×844 mobile viewport, the real built
 * `dist/monaco`, an 8,000-line TypeScript file): load 0.4–1.9 s, JS heap 28–30 MB after load and
 * 37–42 MB while typing and scrolling, 2.0 MB on the wire (brotli, 22 files, half of it the
 * TypeScript worker). That is a small fraction of what an ordinary web page holds on the same phone.
 *
 * So the engine is now the SAME on every screen size, and the textarea is exactly two things:
 *   1. the load-failure fallback (Monaco's loader throws or times out — offline, a blocked script),
 *      unchanged, so a file can always be opened; and
 *   2. an explicit, persisted USER CHOICE — Settings → "Lite editor" — for a device that genuinely
 *      cannot run the full editor. A choice, never a guess made from the screen width.
 *
 * ⚠️ Nothing here reads `window.innerWidth`, and nothing should be added that does: the moment the
 * engine depends on the viewport, "works on desktop, dead on a phone" is one resize away again.
 */

export type EditorEngine = 'monaco' | 'textarea';

/** localStorage key of the user's choice. `'on'` ⇒ the plain editor; anything else ⇒ the full one. */
export const LITE_EDITOR_KEY = 'ide_liteEditor';

/** The minimal slice of `Storage` this module touches — so tests need no browser. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Read the persisted choice. A missing, unreadable or throwing store means "full editor". */
export function readLiteEditorPreference(store: KeyValueStore | null | undefined): boolean {
  try {
    return store?.getItem(LITE_EDITOR_KEY) === 'on';
  } catch {
    return false;
  }
}

/** Persist the choice. A store that throws (private mode, quota) is ignored — the setting still applies for this session. */
export function writeLiteEditorPreference(store: KeyValueStore | null | undefined, lite: boolean): void {
  try {
    store?.setItem(LITE_EDITOR_KEY, lite ? 'on' : 'off');
  } catch {
    /* the in-memory state is the source of truth for this session */
  }
}

export interface EngineInputs {
  /** The user asked for the plain editor in Settings. */
  liteEditor: boolean;
  /** Monaco failed to load in this session (loader threw or timed out). */
  monacoFailed: boolean;
}

/**
 * The one rule. PURE. Note what is NOT an input: screen width, touch capability, user agent.
 * A user choice or a real load failure picks the textarea; nothing else does.
 */
export function decideEditorEngine({ liteEditor, monacoFailed }: EngineInputs): EditorEngine {
  if (monacoFailed) return 'textarea';
  if (liteEditor) return 'textarea';
  return 'monaco';
}
