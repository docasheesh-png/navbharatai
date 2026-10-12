// A small, dependency-free DOM for running a generated browser script inside vitest (CI has no browser).
// It implements only what the scripts under test call, and it SERIALISES the tree the way a browser's
// `innerHTML` getter does for these elements, so "the DOM this script built" can be compared with "the HTML
// string an older version assigned". An `innerHTML` assignment is kept verbatim (never parsed) in `rawHtml`.

const VOID = new Set(['input', 'br', 'img', 'meta', 'link', 'hr']);
const escText = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export class MiniText {
  nodeType = 3;
  parentNode: MiniElement | null = null;
  constructor(public data: string) {}
}

type Child = MiniElement | MiniText;

/** `tag.class[attr][attr="v"]` — the selector shapes the scripts under test use. */
function matches(el: MiniElement, selector: string): boolean {
  const m = /^([a-z0-9]*)((?:\.[\w-]+)*)((?:\[[\w-]+(?:="[^"]*")?\])*)$/i.exec(selector.trim());
  if (!m) throw new Error(`miniDom: unsupported selector ${selector}`);
  if (m[1] && el.tagName !== m[1].toLowerCase()) return false;
  for (const c of (m[2] ?? '').split('.').filter(Boolean)) if (!el.classList.contains(c)) return false;
  for (const a of (m[3] ?? '').match(/\[[^\]]+\]/g) ?? []) {
    const [, name, value] = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(a)!;
    if (!el.hasAttribute(name!)) return false;
    if (value !== undefined && el.getAttribute(name!) !== value) return false;
  }
  return true;
}

export class MiniElement {
  nodeType = 1;
  parentNode: MiniElement | null = null;
  children: Child[] = [];
  attrs: Array<[string, string]> = [];
  rawHtml: string | null = null;
  listeners: Record<string, Array<(e: unknown) => void>> = {};
  [prop: string]: unknown;
  constructor(public tagName: string) { this.tagName = tagName.toLowerCase(); }

  setAttribute(name: string, value: string) {
    const at = this.attrs.findIndex(([k]) => k === name);
    if (at >= 0) this.attrs[at] = [name, String(value)]; else this.attrs.push([name, String(value)]);
  }
  getAttribute(name: string): string | null { return this.attrs.find(([k]) => k === name)?.[1] ?? null; }
  hasAttribute(name: string): boolean { return this.attrs.some(([k]) => k === name); }
  get className(): string { return this.getAttribute('class') ?? ''; }
  set className(v: string) { this.setAttribute('class', v); }
  get classList() { return { contains: (c: string) => this.className.split(/\s+/).includes(c) }; }
  set textContent(v: string) { this.children = []; this.rawHtml = null; this.appendChild(new MiniText(String(v))); }
  get textContent(): string { return this.children.map((c) => (c instanceof MiniText ? c.data : c.textContent)).join(''); }
  set innerHTML(v: string) { this.children = []; this.rawHtml = String(v); }
  /** What a browser's innerHTML getter would return — the assigned string, or the serialised children. */
  get innerHTML(): string { return this.rawHtml ?? this.children.map(serialize).join(''); }

  appendChild<T extends Child>(c: T): T {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    this.children.push(c);
    return c;
  }
  removeChild(c: Child) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; }
  insertBefore(c: Child, ref: Child | null) {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    const at = ref ? this.children.indexOf(ref) : -1;
    if (at < 0) this.children.push(c); else this.children.splice(at, 0, c);
    return c;
  }
  addEventListener(type: string, fn: (e: unknown) => void) { (this.listeners[type] ??= []).push(fn); }
  focus() { /* no layout */ }
  closest(selector: string): MiniElement | null {
    for (let n: MiniElement | null = this; n; n = n.parentNode) if (matches(n, selector)) return n;
    return null;
  }
  querySelectorAll(selector: string): MiniElement[] {
    const out: MiniElement[] = [];
    const walk = (n: MiniElement) => { for (const c of n.children) if (c instanceof MiniElement) { if (matches(c, selector)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelector(selector: string): MiniElement | null { return this.querySelectorAll(selector)[0] ?? null; }
}

export function serialize(n: Child): string {
  if (n instanceof MiniText) return escText(n.data);
  const attrs = n.attrs.map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${escText(v)}"`)).join('');
  if (VOID.has(n.tagName)) return `<${n.tagName}${attrs}>`;
  return `<${n.tagName}${attrs}>${n.innerHTML}</${n.tagName}>`;
}

/** A document + window pair; `run` executes a classic script against them, as a `<script>` tag would. */
export function miniBrowser(opts: { scriptAttrs?: Record<string, string>; storage?: Record<string, string> } = {}) {
  const html = new MiniElement('html');
  const head = html.appendChild(new MiniElement('head'));
  const body = html.appendChild(new MiniElement('body'));
  const currentScript = new MiniElement('script');
  for (const [k, v] of Object.entries(opts.scriptAttrs ?? {})) currentScript.setAttribute(k, v);
  const store = new Map(Object.entries(opts.storage ?? {}));
  const listeners: Record<string, Array<(e: unknown) => void>> = {};
  const document = {
    readyState: 'complete', head, body, currentScript,
    createElement: (t: string) => new MiniElement(t),
    createTextNode: (s: string) => new MiniText(String(s)),
    querySelector: (s: string) => html.querySelector(s),
    querySelectorAll: (s: string) => html.querySelectorAll(s),
    addEventListener: (type: string, fn: (e: unknown) => void) => { (listeners[type] ??= []).push(fn); },
  };
  const window = {
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, String(v)); } },
    dispatchEvent: () => true,
  } as Record<string, unknown>;
  class CustomEvent { constructor(public type: string, public init?: unknown) {} }
  const navigator = { globalPrivacyControl: false };
  return {
    document, window, body, store,
    run(src: string) {
      new Function('window', 'document', 'navigator', 'CustomEvent', src)(window, document, navigator, CustomEvent);
    },
  };
}
