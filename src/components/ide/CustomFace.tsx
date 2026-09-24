import React, { useState, useRef } from 'react';
import { ArrowLeft, ArrowRight, ArrowUp, ArrowDown, RotateCcw, CheckSquare, Eraser, X, CornerDownLeft, Scissors } from 'lucide-react';
import { cn } from '../../lib/utils';
import { resolveCombo, appendKey, type TableEntry } from './keyCombo';
import { dispatchCombo, applyCursorTool, type EditorLike } from './dispatchCombo';
import { toggleCursorMode, type CursorMode } from './cursorTool';

/**
 * THE CUSTOM FACE of the Shortcuts popup (admin 2026-09-24): "user ko upar ek input box mile, jahan
 * user kuch bhi type kar sake! niche 'go' button ho! aur uske niche, desktop me use hone wale sabhi
 * button ho … user koi bhi combination bana ke command de, woh ho jaye!" — and the old Cursor tool's
 * functions live here too ("yaha wahi cursor wale function chahiye").
 *
 * Tapping a key APPENDS it to the box (`Ctrl` → `Ctrl+`, then `A` → `Ctrl+A`); the phone keyboard can
 * type into the same box; GO resolves the text through `keyCombo.ts` and applies it through
 * `dispatchCombo.ts`. The outcome is always said in words under the box — what ran, what was typed,
 * or why a web page cannot do it. Never a silent tap.
 */

export interface CustomFaceProps {
  editor: EditorLike | null;
  table: readonly TableEntry[];
  runShortcut: (keys: string[], command?: string) => void;
}

/** A physical key as a button: what it shows, what it appends. `w` is a relative width. */
interface KeyDef { label: string; value?: string; w?: number; shift?: string; kind?: 'mod' | 'action' | 'lock' }
const k = (label: string, extra: Partial<KeyDef> = {}): KeyDef => ({ label, ...extra });

/** A desktop keyboard, row by row. `shift` is the symbol the key gives with Shift held (shown small). */
const ROWS: KeyDef[][] = [
  [k('Esc', { kind: 'action' }), k('F1'), k('F2'), k('F3'), k('F4'), k('F5'), k('F6'), k('F7'), k('F8'), k('F9'), k('F10'), k('F11'), k('F12'), k('PrtSc', { kind: 'action' })],
  [k('`', { shift: '~' }), k('1', { shift: '!' }), k('2', { shift: '@' }), k('3', { shift: '#' }), k('4', { shift: '$' }), k('5', { shift: '%' }), k('6', { shift: '^' }), k('7', { shift: '&' }), k('8', { shift: '*' }), k('9', { shift: '(' }), k('0', { shift: ')' }), k('-', { shift: '_' }), k('=', { shift: '+' }), k('Backspace', { w: 2, kind: 'action' })],
  [k('Tab', { w: 1.5, kind: 'action' }), k('q'), k('w'), k('e'), k('r'), k('t'), k('y'), k('u'), k('i'), k('o'), k('p'), k('[', { shift: '{' }), k(']', { shift: '}' }), k('\\', { shift: '|', w: 1.5 })],
  [k('CapsLk', { w: 1.8, kind: 'lock' }), k('a'), k('s'), k('d'), k('f'), k('g'), k('h'), k('j'), k('k'), k('l'), k(';', { shift: ':' }), k("'", { shift: '"' }), k('Enter', { w: 2.2, kind: 'action' })],
  [k('Shift', { w: 2.3, kind: 'mod' }), k('z'), k('x'), k('c'), k('v'), k('b'), k('n'), k('m'), k(',', { shift: '<' }), k('.', { shift: '>' }), k('/', { shift: '?' }), k('Shift', { w: 2.3, kind: 'mod' })],
  [k('Ctrl', { w: 1.4, kind: 'mod' }), k('Win', { kind: 'mod' }), k('Alt', { kind: 'mod' }), k('Space', { w: 4, kind: 'action' }), k('Alt', { kind: 'mod' }), k('Fn', { kind: 'lock' }), k('Ctrl', { w: 1.4, kind: 'mod' })],
  [k('Ins', { kind: 'action' }), k('Home', { kind: 'action' }), k('PgUp', { kind: 'action' }), k('Del', { kind: 'action' }), k('End', { kind: 'action' }), k('PgDn', { kind: 'action' }), k('←', { kind: 'action' }), k('↑', { kind: 'action' }), k('↓', { kind: 'action' }), k('→', { kind: 'action' })],
];

/** With Fn held, the number row is F1–F12 — what a laptop's Fn does. */
const FN_ROW: KeyDef[] = [k('Esc', { kind: 'action' }), k('F1'), k('F2'), k('F3'), k('F4'), k('F5'), k('F6'), k('F7'), k('F8'), k('F9'), k('F10'), k('F11'), k('F12'), k('Backspace', { w: 2, kind: 'action' })];

export const CustomFace: React.FC<CustomFaceProps> = ({ editor, table, runShortcut }) => {
  const [text, setText] = useState('');
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  const [caps, setCaps] = useState(false);
  const [fn, setFn] = useState(false);
  const [mode, setMode] = useState<CursorMode>('neutral');
  const [chord, setChord] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const go = () => {
    const res = resolveCombo(text, table);
    setOutcome(dispatchCombo(res, editor, runShortcut));
  };

  const tap = (key: KeyDef) => {
    if (key.kind === 'lock') {
      if (key.label === 'CapsLk') setCaps((c) => !c);
      else setFn((f) => !f);
      return;
    }
    let value = key.value ?? key.label;
    if (/^[a-z]$/.test(value) && caps) value = value.toUpperCase();
    setText((t) => appendKey(t, value));
    setOutcome(null);
  };

  const rows = fn ? [ROWS[0], FN_ROW, ...ROWS.slice(2)] : ROWS;

  return (
    <div className="flex flex-col gap-3">
      {/* The box + GO */}
      <div className="flex gap-2 h-12">
        <div className="relative flex-1 min-w-0">
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => { setText(e.target.value); setOutcome(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } }}
            placeholder="Type or tap keys — e.g. Ctrl+A"
            aria-label="Key combination"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="w-full h-full bg-raised border border-line rounded-2xl pl-4 pr-9 text-sm font-bold font-mono text-ink placeholder-faint outline-none focus:border-indigo-500/50"
          />
          {text && (
            <button type="button" onClick={() => { setText(''); setOutcome(null); inputRef.current?.focus(); }} aria-label="Clear" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-lg text-faint hover:text-ink">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={go}
          disabled={!text.trim()}
          aria-label="Go"
          className={cn(
            'shrink-0 w-14 h-full rounded-2xl flex flex-col items-center justify-center gap-0.5 font-black text-[10px] uppercase tracking-widest transition-all active:scale-95 shadow-xl',
            text.trim() ? 'bg-indigo-500 hover:bg-indigo-400 text-on-accent shadow-indigo-500/20' : 'bg-raised text-faint cursor-not-allowed border border-line',
          )}
        >
          <CornerDownLeft className="w-4 h-4" />
          Go
        </button>
      </div>

      {/* The outcome, in words — a tap is never silent */}
      <div role="status" aria-live="polite" className={cn('min-h-[1.25rem] text-[11px] font-bold leading-snug', outcome ? (outcome.ok ? 'text-success' : 'text-warn') : 'text-faint')}>
        {outcome ? outcome.message : 'Tap keys below or type — then GO. Ctrl, Shift, Alt, Win join with +.'}
      </div>

      {/* The keyboard — each row scrolls sideways on a narrow screen rather than shrinking below a finger */}
      <div className="flex flex-col gap-1.5" data-keyboard>
        {rows.map((row, ri) => (
          <div key={ri} className="flex gap-1 overflow-x-auto no-scrollbar pb-0.5">
            {row.map((key, ki) => {
              const isLockOn = (key.label === 'CapsLk' && caps) || (key.label === 'Fn' && fn);
              const shown = /^[a-z]$/.test(key.label) && caps ? key.label.toUpperCase() : key.label;
              return (
                <button
                  key={`${ri}-${ki}`}
                  type="button"
                  onClick={() => tap(key)}
                  aria-label={key.label}
                  aria-pressed={key.kind === 'lock' ? isLockOn : undefined}
                  style={{ flex: `${key.w ?? 1} 0 auto`, minWidth: `${Math.round(30 * (key.w ?? 1))}px` }}
                  className={cn(
                    'h-9 px-1.5 rounded-lg border text-[11px] font-black leading-none flex flex-col items-center justify-center gap-0.5 active:scale-95 transition-all select-none',
                    isLockOn ? 'bg-accent text-on-accent border-transparent'
                      : key.kind === 'mod' ? 'bg-indigo-500/15 border-indigo-500/30 text-accent-text'
                      : key.kind === 'action' || key.kind === 'lock' ? 'bg-well border-line text-muted'
                      : 'bg-raised border-line text-ink',
                  )}
                >
                  {key.shift && <span className="text-[8px] text-faint leading-none">{key.shift}</span>}
                  <span>{shown}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* The cursor tool — the old Cursor popup, on this face */}
      <div className="rounded-2xl border border-line bg-well overflow-hidden" data-cursor-tool>
        <div className="grid grid-cols-4 border-b border-line">
          <button type="button" onClick={() => setMode((m) => toggleCursorMode(m, 'select'))} aria-pressed={mode === 'select'} className={cn('flex flex-col items-center justify-center gap-1 py-2.5 border-r border-line text-[8px] font-black uppercase tracking-widest', mode === 'select' ? 'bg-indigo-500/20 text-accent-text' : 'text-faint hover:text-muted')}>
            <CheckSquare className="w-3.5 h-3.5" /> Select
          </button>
          <button type="button" onClick={() => setMode((m) => toggleCursorMode(m, 'deselect'))} aria-pressed={mode === 'deselect'} className={cn('flex flex-col items-center justify-center gap-1 py-2.5 border-r border-line text-[8px] font-black uppercase tracking-widest', mode === 'deselect' ? 'bg-red-500/20 text-danger' : 'text-faint hover:text-muted')}>
            <Eraser className="w-3.5 h-3.5" /> Deselect
          </button>
          <button type="button" onClick={() => setChord((c) => !c)} aria-pressed={chord} title="Chord: arrows delete, ALL clears" className={cn('flex flex-col items-center justify-center gap-1 py-2.5 border-r border-line text-[8px] font-black uppercase tracking-widest', chord ? 'bg-red-600 text-on-accent' : 'text-faint hover:text-ink')}>
            <Scissors className="w-3.5 h-3.5" /> Chord
          </button>
          <button type="button" onClick={() => applyCursorTool(editor, { type: 'undo' }, { mode, chord })} className="flex flex-col items-center justify-center gap-1 py-2.5 text-[8px] font-black uppercase tracking-widest text-faint hover:text-warn">
            <RotateCcw className="w-3.5 h-3.5" /> Undo
          </button>
        </div>
        <div className="grid grid-cols-5 gap-1 p-1.5">
          {([['left', ArrowLeft], ['right', ArrowRight], ['up', ArrowUp], ['down', ArrowDown]] as const).map(([dir, Icon]) => (
            <button key={dir} type="button" aria-label={`Cursor ${dir}`} onClick={() => applyCursorTool(editor, { type: dir }, { mode, chord })} className="h-9 flex items-center justify-center bg-raised border border-line rounded-xl active:scale-90 text-faint hover:text-ink">
              <Icon className="w-4 h-4" />
            </button>
          ))}
          <button type="button" aria-label="Select all (or delete all with Chord)" onClick={() => applyCursorTool(editor, { type: 'all' }, { mode, chord })} className="h-9 flex items-center justify-center bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-accent-text text-[8px] font-black uppercase tracking-[0.2em] active:scale-90">
            ALL
          </button>
        </div>
      </div>
    </div>
  );
};
