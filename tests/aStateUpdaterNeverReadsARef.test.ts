/**
 * A STATE UPDATER NEVER READS A REF (admin 2026-09-25, phone screenshot of Other → Bot Builder:
 * "Something went wrong — null is not an object (evaluating 'k.current.id')", "ab bar yeh error aa
 * jati hai").
 *
 * The canvas moved a node with
 *   `setNodes(prev => prev.map(n => n.id === dragging.current!.id ? … : n))`.
 * An updater is not run when it is passed — React runs it later, while rendering. A finger that
 * lifts in between fires pointer-up, which sets `dragging.current = null`, and when the queued
 * updater finally runs it dereferences null INSIDE A RENDER. The error boundary catches that and
 * the whole screen is replaced by the crash card. The `!` told TypeScript "this cannot be null",
 * which was true when the line was written and false when it ran. It is common on a phone, where
 * touch moves and the final lift arrive close together.
 *
 * The fix reads the ref once, into a local, BEFORE queueing the update, so the updater closes over
 * a value that cannot change under it. This file locks the class: no `setX(prev => …)` updater in
 * client code may read `<something>.current.<field>`. The sibling hunt at the time found this one
 * occurrence and no other.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');

function clientFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (full.endsWith(join('src', 'server')) || name === 'node_modules') continue;
      clientFiles(full, out);
    } else if (/\.(tsx|ts)$/.test(name) && !/\.test\./.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** Every `setX(prev => …)` updater body in `src`, with the ref reads found inside it. */
function refReadsInUpdaters(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const found: string[] = [];
  const opener = /\bset[A-Z]\w*\(\s*(?:\(\s*)?\w+\s*\)?\s*=>/g;
  let m: RegExpExecArray | null;
  while ((m = opener.exec(code))) {
    const start = code.indexOf('(', m.index);
    let i = start + 1;
    let depth = 1;
    while (i < code.length && depth > 0) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')') depth--;
      i++;
    }
    const body = code.slice(start, i);
    for (const hit of body.match(/\b\w+\.current[!?]?\.\w+/g) ?? []) found.push(hit);
  }
  return found;
}

describe('the detector sees the exact shape that crashed', () => {
  it('catches the Bot Builder line as it was', () => {
    const was = 'setNodes(prev => prev.map(n => n.id === dragging.current!.id ? { ...n, x, y } : n));';
    expect(refReadsInUpdaters(was)).toEqual(['dragging.current!.id']);
  });

  it('catches an updater spread over several lines and one with parenthesised params', () => {
    const multi = `setItems((prev) =>\n  prev.filter(i =>\n    i.key !== selectedRef.current.key))`;
    expect(refReadsInUpdaters(multi)).toEqual(['selectedRef.current.key']);
  });

  it('leaves the fixed form, plain setters and comments alone', () => {
    expect(refReadsInUpdaters('const id = drag.id;\nsetNodes(prev => prev.map(n => n.id === id ? n : n));')).toEqual([]);
    expect(refReadsInUpdaters('setOpen(ref.current.open);')).toEqual([]);
    expect(refReadsInUpdaters('// setNodes(prev => dragging.current!.id)')).toEqual([]);
  });

  it('the failure it prevents is real: an updater run after the ref is cleared throws', () => {
    const dragging: { current: { id: string } | null } = { current: { id: 'n1' } };
    const queued = (prev: { id: string }[]) => prev.map((n) => (n.id === dragging.current!.id ? n : n));
    dragging.current = null; // pointer-up runs before React processes the update
    expect(() => queued([{ id: 'n1' }])).toThrow(TypeError);

    dragging.current = { id: 'n1' };
    const id = dragging.current.id; // the fix: read once, before queueing
    const safe = (prev: { id: string }[]) => prev.map((n) => (n.id === id ? { ...n, moved: true } : n));
    dragging.current = null;
    expect(safe([{ id: 'n1' }])).toEqual([{ id: 'n1', moved: true }]);
  });
});

describe('no client state updater reads a ref', () => {
  it('finds none anywhere in client code', () => {
    const offenders: string[] = [];
    for (const file of clientFiles(join(ROOT, 'src'))) {
      for (const hit of refReadsInUpdaters(readFileSync(file, 'utf8'))) {
        offenders.push(`${file.slice(ROOT.length + 1)}: ${hit}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
