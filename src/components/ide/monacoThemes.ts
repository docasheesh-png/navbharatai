/**
 * P-DEV.9 — Monaco editor themes (runtime switcher).
 *
 * The editor was hardcoded to `vs-dark`. This adds selectable themes — the two built-ins plus
 * three custom ones (Monokai / Dracula / Solarized Dark) defined via `monaco.editor.defineTheme`.
 * The theme list + custom definitions + the persisted-choice helpers are pure and unit-tested;
 * `registerEditorThemes(monaco)` is the only side-effecting call (it registers the custom themes).
 */

export type EditorThemeId = 'vs-dark' | 'vs' | 'monokai' | 'dracula' | 'solarized-dark';

export interface EditorThemeOption { id: EditorThemeId; label: string; custom: boolean }

export const EDITOR_THEMES: EditorThemeOption[] = [
  { id: 'vs-dark', label: 'VS Dark', custom: false },
  { id: 'vs', label: 'VS Light', custom: false },
  { id: 'monokai', label: 'Monokai', custom: true },
  { id: 'dracula', label: 'Dracula', custom: true },
  { id: 'solarized-dark', label: 'Solarized Dark', custom: true },
];

export const DEFAULT_EDITOR_THEME: EditorThemeId = 'vs-dark';
const STORAGE_KEY = 'editorTheme';

/** Minimal subset of a Monaco theme definition (avoids a hard monaco type dependency here). */
interface ThemeData {
  base: 'vs' | 'vs-dark';
  inherit: boolean;
  rules: Array<{ token: string; foreground?: string; fontStyle?: string }>;
  colors: Record<string, string>;
}

/** Custom theme definitions, keyed by id. Built-ins (`vs`/`vs-dark`) are not listed — Monaco ships them. */
export const CUSTOM_THEME_DATA: Record<string, ThemeData> = {
  monokai: {
    base: 'vs-dark', inherit: true,
    rules: [
      { token: 'comment', foreground: '88846f', fontStyle: 'italic' },
      { token: 'string', foreground: 'e6db74' },
      { token: 'number', foreground: 'ae81ff' },
      { token: 'keyword', foreground: 'f92672' },
      { token: 'type', foreground: '66d9ef', fontStyle: 'italic' },
    ],
    colors: { 'editor.background': '#272822', 'editor.foreground': '#f8f8f2' },
  },
  dracula: {
    base: 'vs-dark', inherit: true,
    rules: [
      { token: 'comment', foreground: '6272a4', fontStyle: 'italic' },
      { token: 'string', foreground: 'f1fa8c' },
      { token: 'number', foreground: 'bd93f9' },
      { token: 'keyword', foreground: 'ff79c6' },
      { token: 'type', foreground: '8be9fd', fontStyle: 'italic' },
    ],
    colors: { 'editor.background': '#282a36', 'editor.foreground': '#f8f8f2' },
  },
  'solarized-dark': {
    base: 'vs-dark', inherit: true,
    rules: [
      { token: 'comment', foreground: '586e75', fontStyle: 'italic' },
      { token: 'string', foreground: '2aa198' },
      { token: 'number', foreground: 'd33682' },
      { token: 'keyword', foreground: '859900' },
      { token: 'type', foreground: 'b58900' },
    ],
    colors: { 'editor.background': '#002b36', 'editor.foreground': '#839496' },
  },
};

export function isValidTheme(id: unknown): id is EditorThemeId {
  return typeof id === 'string' && EDITOR_THEMES.some((t) => t.id === id);
}

/** Register the custom themes on a Monaco instance. Safe to call more than once. */
export function registerEditorThemes(monaco: { editor: { defineTheme: (name: string, data: ThemeData) => void } }): void {
  for (const [name, data] of Object.entries(CUSTOM_THEME_DATA)) {
    monaco.editor.defineTheme(name, data);
  }
}

/** Read the persisted theme choice (validated), falling back to a default. */
export function loadSavedTheme(fallback: EditorThemeId = DEFAULT_EDITOR_THEME): EditorThemeId {
  try {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return isValidTheme(saved) ? saved : fallback;
  } catch {
    return fallback;
  }
}

/** Persist the theme choice (no-op if invalid or storage unavailable). */
export function saveTheme(id: EditorThemeId): void {
  try {
    if (isValidTheme(id) && typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, id);
  } catch { /* storage unavailable — non-fatal */ }
}
