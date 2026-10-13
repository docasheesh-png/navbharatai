// A MINIMAL React stand-in for running GENERATED React code (a template's App.tsx, a recipe's hook) inside
// vitest, where there is no browser and no jsdom. It is bundled IN PLACE OF `react` and `react/jsx-runtime`
// (see `bundleWithHookRuntime`), so the real component, the real hook and the real engine run unchanged.
//
// It implements only what that code calls — useState, useEffect, useRef, useCallback, useMemo, Fragment and
// the automatic JSX runtime — with React's rules for them: state survives re-renders, an effect runs after
// the render that scheduled it and only when its deps change, its cleanup runs before the next run and on
// unmount, and a component that stops rendering is unmounted. Rendering is synchronous; a state update made
// from a promise callback re-renders at once. The result is a plain tree of host elements that the helpers
// below search, click and serialise to HTML (so it can be read the way the build's browser reads a page).

type Deps = readonly unknown[] | undefined;
interface Slot { ran?: boolean; v?: unknown; current?: unknown; deps?: Deps; fn?: unknown; cleanup?: (() => void) | null }
interface Instance { slots: Slot[] }
export interface El { type: unknown; props: Record<string, unknown>; key?: unknown }
export interface HostNode { type: string; props: Record<string, unknown>; children: Array<HostNode | string> }

export const Fragment = Symbol.for('hookRuntime.fragment');

export function jsx(type: unknown, props: Record<string, unknown> | null, key?: unknown): El {
  return { type, props: props ?? {}, key };
}
export const jsxs = jsx;
export const jsxDEV = jsx;
export function createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): El {
  return { type, props: { ...(props ?? {}), ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}) } };
}

const instances = new Map<string, Instance>();
let current: Instance | null = null;
let index = 0;
let pending: Array<() => void> = [];
let root: (() => unknown) | null = null;
let tree: Array<HostNode | string> = [];
let rendering = false;
let dirty = false;
let seen = new Set<string>();

function slot(): Slot {
  if (!current) throw new Error('hookRuntime: a hook was called outside a component render');
  const s = (current.slots[index] ??= {});
  index += 1;
  return s;
}
function changed(a: Deps, b: Deps): boolean {
  if (!a || !b) return true;
  return a.length !== b.length || a.some((x, i) => !Object.is(x, b[i]));
}

export function useState<T>(init: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] {
  const s = slot();
  if (!s.ran) { s.ran = true; s.v = typeof init === 'function' ? (init as () => T)() : init; }
  const set = (next: T | ((prev: T) => T)) => {
    const value = typeof next === 'function' ? (next as (prev: T) => T)(s.v as T) : next;
    if (Object.is(value, s.v)) return;
    s.v = value;
    schedule();
  };
  return [s.v as T, set];
}
export function useRef<T>(init: T): { current: T } {
  const s = slot();
  if (!s.ran) { s.ran = true; s.current = init; }
  return s as unknown as { current: T };
}
export function useCallback<F>(fn: F, deps: Deps): F {
  const s = slot();
  if (!s.ran || changed(s.deps, deps)) { s.ran = true; s.fn = fn; s.deps = deps; }
  return s.fn as F;
}
export function useMemo<T>(make: () => T, deps: Deps): T {
  const s = slot();
  if (!s.ran || changed(s.deps, deps)) { s.ran = true; s.v = make(); s.deps = deps; }
  return s.v as T;
}
export function useEffect(effect: () => void | (() => void), deps?: Deps): void {
  const s = slot();
  if (s.ran && !changed(s.deps, deps)) return;
  s.ran = true;
  s.deps = deps;
  pending.push(() => {
    if (s.cleanup) s.cleanup();
    const c = effect();
    s.cleanup = typeof c === 'function' ? c : null;
  });
}
export const useLayoutEffect = useEffect;

function renderNode(node: unknown, path: string): Array<HostNode | string> {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap((c, i) => renderNode(c, `${path}.${(c as El | null)?.key ?? i}`));
  const el = node as El;
  if (el.type === Fragment) return renderNode(el.props.children, `${path}.f`);
  if (typeof el.type === 'function') {
    const key = `${path}:${(el.type as { name?: string }).name || 'C'}`;
    let inst = instances.get(key);
    if (!inst) { inst = { slots: [] }; instances.set(key, inst); }
    seen.add(key);
    const prev = current, prevIndex = index;
    current = inst; index = 0;
    let out: unknown;
    try { out = (el.type as (p: unknown) => unknown)(el.props); } finally { current = prev; index = prevIndex; }
    return renderNode(out, key);
  }
  if (typeof el.type !== 'string') throw new Error('hookRuntime: unsupported element type');
  const { children, ...props } = el.props;
  return [{ type: el.type, props, children: renderNode(children, `${path}>${el.type}`) }];
}

function unmountUnseen(): void {
  for (const [key, inst] of [...instances]) {
    if (seen.has(key)) continue;
    for (const s of inst.slots) if (s.cleanup) s.cleanup();
    instances.delete(key);
  }
}

function renderNow(): void {
  rendering = true;
  try {
    let rounds = 0;
    do {
      if (++rounds > 50) throw new Error('hookRuntime: more than 50 re-renders in a row');
      dirty = false;
      seen = new Set();
      tree = root ? renderNode({ type: root, props: {} }, 'root') : [];
      unmountUnseen();
      const effects = pending;
      pending = [];
      for (const run of effects) run();
    } while (dirty);
  } finally {
    rendering = false;
  }
}
function schedule(): void {
  if (rendering) { dirty = true; return; }
  renderNow();
}

/** Mount a component; returns the live tree and an unmount that runs every cleanup. */
export function mount(component: () => unknown): { tree: () => Array<HostNode | string>; unmount: () => void } {
  for (const inst of instances.values()) for (const s of inst.slots) if (s.cleanup) s.cleanup();
  instances.clear();
  pending = [];
  root = component;
  renderNow();
  return {
    tree: () => tree,
    unmount: () => {
      root = null;
      seen = new Set();
      unmountUnseen();
      tree = [];
    },
  };
}

// ── Reading the tree (pure; safe to import from a test directly) ────────────────────────────────────

export function textOf(nodes: Array<HostNode | string>): string {
  return nodes.map((n) => (typeof n === 'string' ? n : textOf(n.children))).join('');
}
export function findAll(nodes: Array<HostNode | string>, pred: (n: HostNode) => boolean): HostNode[] {
  const out: HostNode[] = [];
  const walk = (list: Array<HostNode | string>) => {
    for (const n of list) {
      if (typeof n === 'string') continue;
      if (pred(n)) out.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const VOID = new Set(['img', 'input', 'br', 'hr', 'meta', 'link']);
const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** The HTML a browser would hold for this tree (event handlers dropped, React prop names mapped). */
export function toHtml(nodes: Array<HostNode | string>): string {
  return nodes.map((n) => {
    if (typeof n === 'string') return esc(n);
    const attrs: string[] = [];
    for (const [k, v] of Object.entries(n.props)) {
      if (typeof v === 'function' || v === undefined || v === null || v === false || k === 'key') continue;
      const name = k === 'className' ? 'class' : k === 'htmlFor' ? 'for' : k.toLowerCase();
      if (k === 'style' && typeof v === 'object') {
        attrs.push(`style="${esc(Object.entries(v as Record<string, unknown>).map(([p, x]) => `${kebab(p)}: ${String(x)}`).join('; '))}"`);
      } else if (v === true) attrs.push(name);
      else attrs.push(`${name}="${esc(String(v))}"`);
    }
    const open = `<${n.type}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`;
    return VOID.has(n.type) ? open : `${open}${toHtml(n.children)}</${n.type}>`;
  }).join('');
}
