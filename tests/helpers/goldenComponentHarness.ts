import ts from 'typescript';

export interface SeedNode { type: unknown; props: Record<string, any>; }
/** Execute the shipped TSX, not a second implementation of its scoring/clock/storage logic.
 * This is a deterministic component-hook harness, not a claim of DOM/browser coverage. */
export function goldenComponentHarness(source: string) {
  const slots: any[] = []; let cursor = 0; let dirty = false;
  const effects: Array<() => void> = [];
  const cleanups: Array<() => void> = [];
  const same = (a: unknown[] | undefined, b: unknown[] | undefined) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial: any) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], (next: any) => { const value = typeof next === 'function' ? next(slots[i]) : next; if (!Object.is(value, slots[i])) { slots[i] = value; dirty = true; } }];
    },
    useRef(initial: any) { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }); },
    useMemo(fn: () => any, deps?: unknown[]) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useCallback(fn: () => any, deps?: unknown[]) { return react.useMemo(() => fn, deps); },
    useEffect(fn: () => void | (() => void), deps?: unknown[]) {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].deps, deps)) {
        slots[i] = { deps };
        effects.push(() => { cleanups[i]?.(); const clean = fn(); cleanups[i] = typeof clean === 'function' ? clean : () => {}; });
      }
    },
  };
  const jsx = (type: unknown, props: Record<string, any>): SeedNode => ({ type, props });
  const exports: { default?: () => SeedNode } = {};
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', js)((name: string) => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === './theme') return { default: () => null };
    throw new Error('Unexpected generated import: ' + name);
  }, exports);
  let tree: SeedNode;
  const flush = () => {
    let attempts = 0;
    do {
      if (++attempts > 30) throw new Error('Component did not settle');
      dirty = false; cursor = 0; tree = exports.default!();
      for (const effect of effects.splice(0)) effect();
    } while (dirty);
    return tree;
  };
  flush();
  const nodes = (): SeedNode[] => {
    const out: SeedNode[] = [];
    const walk = (x: any) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object' && x.props) { out.push(x); walk(x.props.children); } };
    walk(tree); return out;
  };
  const text = (x: any): string => Array.isArray(x) ? x.map(text).join('') : x && typeof x === 'object' ? text(x.props?.children) : x == null || typeof x === 'boolean' ? '' : String(x);
  const button = (label: string) => {
    const match = nodes().find(n => n.type === 'button' && (text(n) === label || n.props['aria-label'] === label));
    if (!match) throw new Error('No button: ' + label);
    return match;
  };
  return { flush, nodes, textOf: text, text: () => text(tree), button, click: (label: string) => { button(label).props.onClick(); flush(); }, dispose: () => cleanups.forEach(f => f?.()) };
}
