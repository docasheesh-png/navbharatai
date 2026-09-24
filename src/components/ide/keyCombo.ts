/**
 * THE KEY-COMBO ENGINE behind the CUSTOM face of the Shortcuts popup (admin 2026-09-24: "user koi bhi
 * combination bana ke command de, woh ho jaye … sabhi combination jo jo possible hai, sab kaam karne
 * chahiye").
 *
 * PURE. Text in, a decision out. Nothing here touches the DOM or the editor — `dispatchCombo.ts` is
 * the one place that does, and it does exactly what this module decides.
 *
 * HOW A COMBO IS RESOLVED, in order:
 *   1. our OWN table first (the 82 Shortcuts-panel entries) — `ctrl+a` runs the same command the
 *      dropdown runs, so the two paths cannot drift;
 *   2. a bare printable character with no modifier is TYPED into the editor;
 *   3. everything else becomes a REAL KeyboardEvent handed to Monaco, whose own keybinding table
 *      (~300 bindings) then applies — which is how "every combination" is honoured without a
 *      hand-written case for each;
 *   4. a short, explicit list of things a web page CANNOT do (Fn alone, Print Screen, Alt+Tab, the
 *      Windows key…) is refused with the reason — never a fake success.
 *
 * ⚠️ Monaco reads the LEGACY `keyCode` from a keyboard event to resolve a binding, so every synthetic
 * event carries one. A `key`/`code`-only event resolves to nothing there, silently.
 */

export type Modifier = 'ctrl' | 'shift' | 'alt' | 'meta';
export const MODIFIER_ORDER: readonly Modifier[] = ['ctrl', 'shift', 'alt', 'meta'];

/** One key press: its modifiers and, optionally, the key itself (a bare modifier has none). */
export interface Combo {
  modifiers: Modifier[];
  key: string | null;
  /** Every normalized token, in order — so a hardware key like Fn is seen even when another key follows it. */
  tokens?: string[];
}

/** Spellings people type or buttons carry → the one canonical name used everywhere below. */
const ALIASES: Record<string, string> = {
  control: 'ctrl', ctl: 'ctrl', ctrl: 'ctrl',
  shift: 'shift',
  alt: 'alt', option: 'alt', opt: 'alt',
  meta: 'meta', cmd: 'meta', command: 'meta', win: 'meta', windows: 'meta', super: 'meta',
  esc: 'escape', escape: 'escape',
  del: 'delete', delete: 'delete',
  return: 'enter', enter: 'enter',
  bksp: 'backspace', backspace: 'backspace',
  ins: 'insert', insert: 'insert',
  pgup: 'pageup', pageup: 'pageup', pgdn: 'pagedown', pagedown: 'pagedown',
  home: 'home', end: 'end',
  tab: 'tab',
  space: 'space', spacebar: 'space',
  up: 'up', '↑': 'up', arrowup: 'up',
  down: 'down', '↓': 'down', arrowdown: 'down',
  left: 'left', '←': 'left', arrowleft: 'left',
  right: 'right', '→': 'right', arrowright: 'right',
  capslk: 'capslock', capslock: 'capslock', caps: 'capslock',
  fn: 'fn',
  prtsc: 'printscreen', prtscn: 'printscreen', printscreen: 'printscreen',
  numlk: 'numlock', numlock: 'numlock', scrlk: 'scrolllock', scrolllock: 'scrolllock',
  pause: 'pause', break: 'pause',
};

export function normalizeToken(raw: string): string {
  if (raw === ' ') return 'space';
  const t = raw.trim();
  if (t === '') return '';
  const lower = t.toLowerCase();
  if (ALIASES[lower]) return ALIASES[lower];
  if (/^f([1-9]|1[0-2])$/.test(lower)) return lower;
  return lower;
}

const MODIFIERS = new Set<string>(MODIFIER_ORDER);

/**
 * Parse one press. `+` separates keys, and a `+` that ends the text or follows another `+` is the
 * plus KEY (`ctrl++` is Ctrl and Plus). Unknown tokens are kept as typed (lowercased) so a stray
 * word reaches the "unsupported" answer with its name intact rather than vanishing.
 */
export function parseCombo(text: string): Combo {
  const tokens: string[] = [];
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '+' && cur.trim() !== '') { tokens.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim() !== '') tokens.push(cur);
  const mods = new Set<Modifier>();
  let key: string | null = null;
  const seen: string[] = [];
  for (const raw of tokens) {
    const t = raw.trim() === '+' ? '+' : normalizeToken(raw);
    if (t === '') continue;
    seen.push(t);
    if (MODIFIERS.has(t)) { mods.add(t as Modifier); continue; }
    key = t; // the last non-modifier wins — "ctrl+a+b" is not a thing a keyboard can send
  }
  return { modifiers: MODIFIER_ORDER.filter((m) => mods.has(m)), key, tokens: seen };
}

/** Canonical id: modifiers in fixed order, then the key — the form the shortcut table is keyed in. */
export function comboId(c: Combo): string {
  return [...c.modifiers, ...(c.key ? [c.key] : [])].join('+');
}

/**
 * A CHORD is two presses in sequence (`ctrl+k ctrl+f`, `ctrl+k s`) — VS Code's own convention. Spaces
 * separate presses; the table stores its chord keys exactly this way.
 */
export function parseChord(text: string): Combo[] {
  // "CTRL + A" is one press written with spaces, not three; only whitespace that does not touch a `+`
  // separates presses. A `+` that is itself the key ("ctrl++") keeps working because the collapse
  // only removes the spaces AROUND a plus.
  const joined = text.replace(/\s*\+\s*/g, '+');
  return joined.trim().split(/\s+/).filter(Boolean).map(parseCombo);
}

export function chordId(chord: Combo[]): string {
  return chord.map(comboId).join(' ');
}

/** The keys that live ONLY on a physical machine — no browser page can see or send them. */
const UNSENDABLE: Record<string, string> = {
  fn: 'Fn is handled by the keyboard itself and never reaches a web page. Use the F1–F12 keys directly.',
  printscreen: 'Print Screen is captured by the operating system, not the page. Use your phone\'s screenshot gesture.',
  numlock: 'Num Lock is a hardware toggle a web page cannot switch.',
  scrolllock: 'Scroll Lock is a hardware toggle a web page cannot switch.',
  pause: 'Pause/Break is not delivered to web pages.',
  capslock: 'Caps Lock is a toggle, not a command — use the CAPS button to type capitals.',
};

/** Combos the BROWSER or OS owns: they act on the window, not the page, and cannot be simulated. */
const OS_OWNED: Record<string, string> = {
  'alt+tab': 'Alt+Tab switches windows — the operating system handles it, not the editor.',
  'alt+f4': 'Alt+F4 closes the window — the operating system handles it.',
  'ctrl+alt+delete': 'Ctrl+Alt+Delete is reserved by the operating system.',
  'meta': 'The Windows/Command key alone opens the system menu, not an editor command.',
  'meta+l': 'Win+L locks the computer — the operating system handles it.',
  'meta+d': 'Win+D shows the desktop — the operating system handles it.',
  'ctrl+shift+escape': 'Task Manager is the operating system\'s, not the page\'s.',
};

export type Resolution =
  | { kind: 'empty' }
  | { kind: 'table'; id: string; entry: TableEntry }
  | { kind: 'type'; text: string }
  | { kind: 'keyevent'; combo: Combo; init: KeyEventInit }
  | { kind: 'chord'; presses: KeyEventInit[]; id: string }
  | { kind: 'unsupported'; id: string; reason: string };

/** The slice of a Shortcuts-panel entry the engine needs. */
export interface TableEntry {
  key: string;
  label: string;
  command?: string;
  keys: string[];
}

/** What `new KeyboardEvent('keydown', init)` needs for Monaco to resolve the press. */
export interface KeyEventInit {
  key: string;
  code: string;
  keyCode: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/** Legacy keyCodes — the field Monaco's keybinding resolver actually reads. */
const KEY_CODES: Record<string, [code: string, keyCode: number, key: string]> = {
  enter: ['Enter', 13, 'Enter'], backspace: ['Backspace', 8, 'Backspace'], tab: ['Tab', 9, 'Tab'],
  escape: ['Escape', 27, 'Escape'], space: ['Space', 32, ' '], delete: ['Delete', 46, 'Delete'],
  insert: ['Insert', 45, 'Insert'], home: ['Home', 36, 'Home'], end: ['End', 35, 'End'],
  pageup: ['PageUp', 33, 'PageUp'], pagedown: ['PageDown', 34, 'PageDown'],
  up: ['ArrowUp', 38, 'ArrowUp'], down: ['ArrowDown', 40, 'ArrowDown'],
  left: ['ArrowLeft', 37, 'ArrowLeft'], right: ['ArrowRight', 39, 'ArrowRight'],
  ';': ['Semicolon', 186, ';'], '=': ['Equal', 187, '='], ',': ['Comma', 188, ','],
  '-': ['Minus', 189, '-'], '.': ['Period', 190, '.'], '/': ['Slash', 191, '/'],
  '`': ['Backquote', 192, '`'], '[': ['BracketLeft', 219, '['], '\\': ['Backslash', 220, '\\'],
  ']': ['BracketRight', 221, ']'], "'": ['Quote', 222, "'"], '+': ['Equal', 187, '+'],
};

/** Shifted spellings of the symbol keys, so `shift+1` and `!` name the same physical key. */
const SHIFTED: Record<string, string> = {
  '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
  '_': '-', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/', '~': '`',
};

/** The event init for a key name, or null when the name is not a key a page can send. */
export function keyEventInit(c: Combo): KeyEventInit | null {
  if (!c.key) return null;
  let keyName = c.key;
  let shift = c.modifiers.includes('shift');
  if (SHIFTED[keyName]) { shift = true; keyName = SHIFTED[keyName]; }
  const base = { ctrlKey: c.modifiers.includes('ctrl'), shiftKey: shift, altKey: c.modifiers.includes('alt'), metaKey: c.modifiers.includes('meta') };
  const fixed = KEY_CODES[keyName];
  if (fixed) return { key: keyName === '+' ? '+' : fixed[2], code: fixed[0], keyCode: fixed[1], ...base };
  const f = /^f([1-9]|1[0-2])$/.exec(keyName);
  if (f) return { key: `F${f[1]}`, code: `F${f[1]}`, keyCode: 111 + Number(f[1]), ...base };
  if (/^[a-z]$/.test(keyName)) {
    return { key: shift ? keyName.toUpperCase() : keyName, code: `Key${keyName.toUpperCase()}`, keyCode: keyName.toUpperCase().charCodeAt(0), ...base };
  }
  if (/^[0-9]$/.test(keyName)) return { key: keyName, code: `Digit${keyName}`, keyCode: 48 + Number(keyName), ...base };
  return null;
}

/** Is this a single character a person could type — the "just insert it" case. */
function isPrintable(key: string | null): key is string {
  return !!key && [...key].length === 1 && key !== ' ';
}

/**
 * THE DECISION. `table` is the Shortcuts panel's own list; a match there wins over everything, so a
 * typed `ctrl+a` and a dropdown "Select All" are the same action by construction.
 */
export function resolveCombo(text: string, table: readonly TableEntry[]): Resolution {
  const chord = parseChord(text);
  if (chord.length === 0 || (chord.length === 1 && chord[0].modifiers.length === 0 && !chord[0].key)) return { kind: 'empty' };
  const id = chordId(chord);

  const entry = table.find((e) => e.key.toLowerCase() === id);
  if (entry) return { kind: 'table', id, entry };

  for (const press of chord) {
    for (const t of press.tokens ?? []) {
      if (UNSENDABLE[t]) return { kind: 'unsupported', id, reason: UNSENDABLE[t] };
    }
  }
  if (OS_OWNED[id]) return { kind: 'unsupported', id, reason: OS_OWNED[id] };

  if (chord.length > 1) {
    const presses = chord.map(keyEventInit);
    if (presses.some((p) => !p)) return { kind: 'unsupported', id, reason: `"${id}" is not a key sequence a keyboard can send.` };
    return { kind: 'chord', presses: presses as KeyEventInit[], id };
  }

  const [combo] = chord;
  if (combo.modifiers.length === 0 && isPrintable(combo.key)) return { kind: 'type', text: combo.key };
  if (combo.modifiers.length === 1 && combo.modifiers[0] === 'shift' && isPrintable(combo.key) && /^[a-z]$/.test(combo.key)) {
    return { kind: 'type', text: combo.key.toUpperCase() };
  }
  if (!combo.key) {
    return { kind: 'unsupported', id, reason: `${id} on its own is a modifier — add the key it should modify (for example ${id}+A).` };
  }
  const init = keyEventInit(combo);
  if (!init) return { kind: 'unsupported', id, reason: `"${combo.key}" is not a key this keyboard knows.` };
  return { kind: 'keyevent', combo, init };
}

/** Append a pressed key to the text in the box, joining with `+` the way a person would write it. */
export function appendKey(text: string, keyLabel: string): string {
  // A trailing space is a chord in progress ("Ctrl+K " then "S"): the next key starts a new press.
  if (text === '' || text.endsWith('+') || text.endsWith(' ')) return text + keyLabel;
  return `${text}+${keyLabel}`;
}
