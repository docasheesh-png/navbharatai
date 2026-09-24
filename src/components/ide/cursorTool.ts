/**
 * THE CURSOR TOOL, as pure decisions (admin 2026-09-24: the old Cursor popup's functions live on the
 * CUSTOM face of the Shortcuts popup now — "yaha wahi cursor wale function chahiye").
 *
 * Ported from `CursorPopup.tsx` (retired in the same change) so the arithmetic — especially DESELECT,
 * which shrinks a selection from one end — can be tested without an editor. The component hands in
 * the selection and the line lengths it needs and applies what comes back.
 */

export type CursorMode = 'neutral' | 'select' | 'deselect';
export type CursorMove = 'left' | 'right' | 'up' | 'down';

export interface SelectionLike {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

/** The two facts about the document the deselect arithmetic needs. */
export interface LineInfo {
  lineCount: number;
  /** 1-based; the column just past the last character of that line. */
  lineMaxColumn: (line: number) => number;
}

export type CursorAction =
  | { kind: 'command'; id: string }
  | { kind: 'setSelection'; selection: SelectionLike }
  | { kind: 'deleteAll' }
  | { kind: 'selectAll' }
  | { kind: 'none' };

/** Monaco's own cursor commands, by mode. */
const MOVE: Record<Exclude<CursorMode, 'deselect'>, Record<CursorMove, string>> = {
  neutral: { left: 'cursorLeft', right: 'cursorRight', up: 'cursorUp', down: 'cursorDown' },
  select: { left: 'cursorLeftSelect', right: 'cursorRightSelect', up: 'cursorUpSelect', down: 'cursorDownSelect' },
};

/**
 * What an arrow does. CHORD ("C" in the old popup) turns the arrows into delete keys: ← is Backspace,
 * → is Delete, ↑/↓ still move. Otherwise the mode decides: move, extend the selection, or shrink it.
 */
export function cursorMove(move: CursorMove, mode: CursorMode, chord: boolean, selection: SelectionLike, lines: LineInfo): CursorAction {
  if (chord) {
    if (move === 'left') return { kind: 'command', id: 'deleteLeft' };
    if (move === 'right') return { kind: 'command', id: 'deleteRight' };
    return { kind: 'command', id: MOVE.neutral[move] };
  }
  if (mode !== 'deselect') return { kind: 'command', id: MOVE[mode][move] };
  return { kind: 'setSelection', selection: shrink(move, selection, lines) };
}

/** DESELECT: pull the selection in from the side the arrow points away from. Never crosses itself. */
export function shrink(move: CursorMove, sel: SelectionLike, lines: LineInfo): SelectionLike {
  let { startLineNumber, startColumn, endLineNumber, endColumn } = sel;
  const nonEmpty = startLineNumber < endLineNumber || startColumn < endColumn;
  switch (move) {
    case 'left':
      // Give up the FIRST character.
      if (nonEmpty) {
        if (startColumn < lines.lineMaxColumn(startLineNumber)) startColumn++;
        else if (startLineNumber < lines.lineCount) { startLineNumber++; startColumn = 1; }
      }
      break;
    case 'right':
      // Give up the LAST character.
      if (nonEmpty) {
        if (endColumn > 1) endColumn--;
        else if (endLineNumber > 1) { endLineNumber--; endColumn = lines.lineMaxColumn(endLineNumber); }
      }
      break;
    case 'up':
      if (endLineNumber > startLineNumber) endLineNumber--;
      else if (endColumn > startColumn) endColumn = startColumn;
      break;
    case 'down':
      if (startLineNumber < endLineNumber) startLineNumber++;
      else if (startColumn < endColumn) startColumn = endColumn;
      break;
  }
  // A shrink can overshoot on a short line; collapse rather than invert.
  if (endLineNumber < startLineNumber || (endLineNumber === startLineNumber && endColumn < startColumn)) {
    endLineNumber = startLineNumber; endColumn = startColumn;
  }
  return { startLineNumber, startColumn, endLineNumber, endColumn };
}

/** ALL: select everything — or, with CHORD held, delete everything. */
export function cursorAll(chord: boolean): CursorAction {
  return chord ? { kind: 'deleteAll' } : { kind: 'selectAll' };
}

/** Toggle a mode button: pressing the active one returns to neutral. */
export function toggleCursorMode(current: CursorMode, pressed: 'select' | 'deselect'): CursorMode {
  return current === pressed ? 'neutral' : pressed;
}
