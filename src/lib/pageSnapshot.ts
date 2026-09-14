// A READABLE COPY OF WHAT AN ADMIN PAGE ACTUALLY SHOWS — text, deliberately, not a picture.
//
// ADMIN 2026-09-14: *"admin panel me ek floating 'copy' button bana … pure page ka screenshot le kar
// keyboard pe copy kar lena! pure 100% pages ko. woh page mai apko bhejunga, aur aap waha jo bhi
// problem ho, woh solve karoge!"*
//
// 🔴 WHY THIS COPIES TEXT AND NOT AN IMAGE, stated up front so nobody "fixes" it into a screenshot
// library later. A browser cannot photograph its own window. The two ways people try are:
//   • a DOM-painting library (html2canvas and friends) — it RE-DRAWS the page from the DOM and gets
//     it wrong often enough to mislead whoever reads the result. `ReportSheet.tsx` already recorded
//     this exact refusal for the user-facing report, and a wrong picture sent to a debugger is worse
//     than no picture: it sends the fix to the wrong place.
//   • `getDisplayMedia` — a permission prompt every single time, desktop-only, and absent from the
//     Android WebView the admin actually uses. That is not "100% of pages".
// A structured text copy is the one option that works on 100% of pages, on every device, with no
// prompt and no new dependency — and it carries strictly MORE of what a fix needs than an image does:
// the numbers, the labels, the empty states, the layout overruns and the errors, all as text.
// The phone's own screenshot button remains the right tool for a purely visual complaint.
//
// 🔒 SECRETS. This text leaves the device by design (the admin pastes it into a conversation), so the
// page must be able to say "not this part": any element carrying `data-nb-no-copy` is skipped whole,
// control values that look like credentials are masked, and `otpauth://` URIs — an exact, unambiguous
// credential format — are redacted by pattern wherever they appear.

/** The parts of a DOM node this reads. Structural, so a test can hand it plain objects. */
export interface SnapNode {
  /** 1 = element, 3 = text. Absent is treated as an element, which is what tests usually pass. */
  nodeType?: number;
  nodeValue?: string | null;
  tagName?: string;
  childNodes?: ArrayLike<SnapNode> | null;
  getAttribute?(name: string): string | null;
  /** Absent means "cannot measure" and the node is treated as VISIBLE — see `isVisible`. */
  getBoundingClientRect?(): { width: number; height: number };
}

export interface PageOutline {
  /** False means the page could not be read at all — NOT that the page is empty. */
  scanned: boolean;
  lines: string[];
  /** True when a budget ran out, so the outline is a prefix of the page rather than the page. */
  truncated: boolean;
  /** How many elements the walk looked at, so a suspiciously small number is visible. */
  elementsSeen: number;
}

/** Markup that carries no reader-visible text, or only noise. Skipped with their subtrees. */
const SKIP_TAGS = new Set([
  'script', 'style', 'noscript', 'template', 'head', 'link', 'meta', 'title',
  'svg', 'path', 'defs', 'circle', 'rect', 'line', 'polyline', 'polygon', 'g',
  'br', 'hr',
]);

/** Form controls describe themselves rather than holding text. */
const CONTROL_TAGS = new Set(['input', 'textarea', 'select']);

/** What each tag contributes to the shape of the outline. */
const PREFIX: Record<string, string> = {
  h1: '# ', h2: '# ', h3: '## ', h4: '## ', h5: '### ', h6: '### ',
  button: '[button] ',
  a: '[link] ',
  li: '- ',
  summary: '> ',
  option: '  · ',
};

/** A field whose value must never ride along in a copy. Matched on every naming surface a form has. */
const SENSITIVE = /token|secret|password|passwd|pin\b|api[-_ ]?key|\bkey\b|otp|cvv|credential/i;

/** Exact, unambiguous credential shape — safe to redact by pattern with no false positives. */
const OTPAUTH = /otpauth:\/\/\S+/gi;

/** Stop one pathological page from producing a megabyte of clipboard. */
const DEFAULT_ELEMENT_BUDGET = 6000;
const DEFAULT_MAX_LINES = 1200;
const DEFAULT_MAX_CHARS = 40000;

/** One cell's worth of text; a row of forty of these is still meant to be read. */
const MAX_LINE_CHARS = 300;

export function redactSecrets(text: string): string {
  return text.replace(OTPAUTH, 'otpauth://[hidden]');
}

/** Collapse whitespace and trim. PURE. */
export function collapse(text: string | null | undefined): string {
  if (typeof text !== 'string') return '';
  return text.replace(/\s+/g, ' ').trim();
}

function attr(node: SnapNode, name: string): string {
  try {
    const v = typeof node.getAttribute === 'function' ? node.getAttribute(name) : null;
    return typeof v === 'string' ? v : '';
  } catch {
    return '';
  }
}

/**
 * Is the attribute PRESENT, whatever its value?
 *
 * ⚠️ NOT `attr(node, name)` truthiness. `data-nb-no-copy=""` — the form React emits for a valueless
 * attribute, and the form this repo uses — reads back as an EMPTY STRING, which is falsy. A presence
 * check written as a truthiness check therefore silently opts the element back IN. That is not a
 * style point: the first thing marked with it is a live TOTP secret on the admin Security tab.
 */
function hasAttr(node: SnapNode, name: string): boolean {
  try {
    return typeof node.getAttribute === 'function' && typeof node.getAttribute(name) === 'string';
  } catch {
    return false;
  }
}

function tagOf(node: SnapNode): string {
  return typeof node.tagName === 'string' ? node.tagName.toLowerCase() : '';
}

function isElement(node: SnapNode): boolean {
  return node.nodeType === undefined ? typeof node.tagName === 'string' : node.nodeType === 1;
}

function isText(node: SnapNode): boolean {
  return node.nodeType === 3;
}

/**
 * Does this element occupy space on the screen? PURE apart from the rect it asks for.
 *
 * ⚠️ A node with NO `getBoundingClientRect` counts as visible. That is for tests and for exotic
 * environments — in a real browser every element has the method, so `display:none` (a 0×0 box on the
 * element AND on everything inside it) is what actually gets filtered, and `display:contents` (a 0×0
 * box on a container whose children have real ones) correctly contributes nothing itself while its
 * children still do. This is why the walk never prunes a subtree on invisibility: it only declines to
 * EMIT from a box-less element.
 */
export function isVisible(node: SnapNode): boolean {
  if (typeof node.getBoundingClientRect !== 'function') return true;
  try {
    const r = node.getBoundingClientRect();
    return Number.isFinite(r.width) && Number.isFinite(r.height) && r.width > 0 && r.height > 0;
  } catch {
    return true;
  }
}

/** The element's OWN text — its direct text-node children, not its descendants'. PURE. */
export function ownText(node: SnapNode): string {
  const kids = node.childNodes;
  if (!kids || typeof kids.length !== 'number') return '';
  let out = '';
  for (let i = 0; i < kids.length; i += 1) {
    const k = kids[i];
    if (k && isText(k)) out += ` ${typeof k.nodeValue === 'string' ? k.nodeValue : ''}`;
  }
  return collapse(out);
}

/**
 * One line for a form control: what it is, what it is called, and what is in it. PURE.
 *
 * 🔒 A `password` control and anything whose name/id/placeholder/label reads like a credential report
 * `value=[hidden]` — never the characters. The admin panel holds a live admin token and a TOTP secret;
 * a copy button that quietly carried either into a chat would be a leak the admin never asked for.
 */
export function describeControl(node: SnapNode): string {
  const tag = tagOf(node);
  const type = collapse(attr(node, 'type')) || (tag === 'input' ? 'text' : tag);
  const name = collapse(attr(node, 'name') || attr(node, 'id'));
  const label = collapse(attr(node, 'aria-label') || attr(node, 'placeholder'));
  const raw = collapse(attr(node, 'value'));
  const checked = attr(node, 'checked');

  const secret = type.toLowerCase() === 'password'
    || SENSITIVE.test(name)
    || SENSITIVE.test(label)
    || SENSITIVE.test(collapse(attr(node, 'autocomplete')));

  const bits = [`[${type}]`];
  if (name) bits.push(name);
  if (label && label !== name) bits.push(`"${label}"`);
  if (type === 'checkbox' || type === 'radio') {
    bits.push(checked !== '' && checked !== null ? '= checked' : '= unchecked');
  } else if (secret) {
    bits.push('= [hidden]');
  } else if (raw) {
    bits.push(`= ${raw.slice(0, 80)}`);
  } else {
    bits.push('= (empty)');
  }
  return bits.join(' ');
}

/** Every visible descendant's text, flattened into one string. Used for a table row. */
function flatten(node: SnapNode, budget: { left: number }): string {
  if (budget.left <= 0) return '';
  const tag = tagOf(node);
  if (SKIP_TAGS.has(tag)) return '';
  if (hasAttr(node, 'data-nb-no-copy')) return '';
  budget.left -= 1;

  if (CONTROL_TAGS.has(tag)) return describeControl(node);

  let out = isVisible(node) ? ownText(node) : '';
  const kids = node.childNodes;
  if (kids && typeof kids.length === 'number') {
    for (let i = 0; i < kids.length && budget.left > 0; i += 1) {
      const k = kids[i];
      if (!k || !isElement(k)) continue;
      const sub = flatten(k, budget);
      if (sub) out = out ? `${out} ${sub}` : sub;
    }
  }
  return collapse(out);
}

export interface OutlineOptions {
  elementBudget?: number;
  maxLines?: number;
  maxChars?: number;
}

/**
 * Walk a rendered page into an indented outline of everything a reader can see. PURE apart from the
 * rects it asks the nodes for.
 *
 * A table ROW becomes ONE line (`| a | b | c |`) rather than one line per cell: a fifty-row admin
 * table is the most common thing on these pages, and cell-per-line turns it into six hundred lines of
 * unreadable confetti. The row is the unit a person actually reads.
 */
export function outlinePage(root: SnapNode | null | undefined, opts: OutlineOptions = {}): PageOutline {
  const empty: PageOutline = { scanned: false, lines: [], truncated: false, elementsSeen: 0 };
  if (!root || !isElement(root)) return empty;

  const budget = { left: Math.max(1, opts.elementBudget ?? DEFAULT_ELEMENT_BUDGET) };
  const maxLines = Math.max(1, opts.maxLines ?? DEFAULT_MAX_LINES);
  const maxChars = Math.max(200, opts.maxChars ?? DEFAULT_MAX_CHARS);

  const lines: string[] = [];
  let chars = 0;
  let truncated = false;
  let seen = 0;

  const push = (depth: number, text: string): void => {
    if (truncated) return;
    const body = redactSecrets(text).slice(0, MAX_LINE_CHARS);
    if (!body) return;
    const line = `${'  '.repeat(Math.min(depth, 12))}${body}`;
    if (lines.length >= maxLines || chars + line.length > maxChars) { truncated = true; return; }
    lines.push(line);
    chars += line.length + 1;
  };

  const walk = (node: SnapNode, depth: number): void => {
    if (truncated || budget.left <= 0) { truncated = truncated || budget.left <= 0; return; }
    const tag = tagOf(node);
    if (SKIP_TAGS.has(tag)) return;
    // The opt-out, honoured before anything is read out of the element.
    if (hasAttr(node, 'data-nb-no-copy')) return;

    budget.left -= 1;
    seen += 1;

    if (CONTROL_TAGS.has(tag)) { push(depth, describeControl(node)); return; }

    if (tag === 'tr') {
      const cells: string[] = [];
      const kids = node.childNodes;
      if (kids && typeof kids.length === 'number') {
        for (let i = 0; i < kids.length; i += 1) {
          const k = kids[i];
          if (!k || !isElement(k)) continue;
          const t = tagOf(k);
          if (t !== 'td' && t !== 'th') continue;
          cells.push(flatten(k, budget));
        }
      }
      if (cells.some(Boolean)) push(depth, `| ${cells.join(' | ')} |`);
      return;
    }

    if (tag === 'img') {
      const alt = collapse(attr(node, 'alt'));
      push(depth, alt ? `[image] ${alt}` : '[image]');
      return;
    }

    const visible = isVisible(node);
    if (visible) {
      const text = ownText(node);
      if (text) {
        push(depth, `${PREFIX[tag] ?? ''}${text}`);
      } else if (tag === 'button' || tag === 'a') {
        // An icon-only control still matters — it is a thing on the page that can be pressed.
        const label = collapse(attr(node, 'aria-label') || attr(node, 'title'));
        if (label) push(depth, `${PREFIX[tag]}${label}`);
      }
    }

    const kids = node.childNodes;
    if (!kids || typeof kids.length !== 'number') return;
    const nextDepth = visible ? depth + 1 : depth;
    for (let i = 0; i < kids.length; i += 1) {
      const k = kids[i];
      if (!k || !isElement(k)) continue;
      walk(k, nextDepth);
      if (truncated) return;
    }
  };

  try {
    walk(root, 0);
  } catch {
    return { scanned: false, lines, truncated, elementsSeen: seen };
  }

  return { scanned: true, lines, truncated, elementsSeen: seen };
}

// ── The clipboard payload ────────────────────────────────────────────────────

export interface PageSnapshotInput {
  /** Which admin page this is — the tab's own label. */
  page: string;
  capturedAt?: string;
  /** The frontend bundle running in this tab (`__BUILD_TIME__`). */
  frontendBuild?: string;
  /** The native shell's build, when there is one — a stale install is its own common bug. */
  appBuild?: string | null;
  viewport?: string;
  dpr?: number;
  platform?: string;
  userAgent?: string;
  language?: string;
  online?: boolean;
  connection?: string;
  /** One line from `describeOverflow` — already says "not measured" when nothing was measured. */
  overflowLine?: string;
  errors?: string[];
  outline: PageOutline;
}

const RULE = '─'.repeat(60);

/**
 * Assemble the text that goes on the clipboard. PURE — every fact is handed in.
 *
 * 🔒 It says what it IS in its first line. A reader must never have to guess whether they are looking
 * at the whole page or a fragment, so the truncation and the "could not read" cases are stated in the
 * body rather than left to be inferred from a short outline.
 */
export function formatPageSnapshot(input: PageSnapshotInput): string {
  const out: string[] = [];
  out.push(`NavBharatAI — admin page copy (text, not an image)`);
  out.push(`Page: ${collapse(input.page) || 'Admin'}`);
  if (input.capturedAt) out.push(`Captured: ${input.capturedAt}`);

  const build: string[] = [];
  if (input.frontendBuild) build.push(`frontend ${input.frontendBuild}`);
  if (input.appBuild) build.push(`app ${input.appBuild}`);
  if (build.length) out.push(`Build: ${build.join(' · ')}`);

  const screen: string[] = [];
  if (input.viewport) screen.push(input.viewport);
  if (typeof input.dpr === 'number') screen.push(`@${input.dpr}x`);
  if (screen.length) out.push(`Screen: ${screen.join(' ')}`);

  const env: string[] = [];
  if (input.platform) env.push(input.platform);
  if (input.language) env.push(input.language);
  if (typeof input.online === 'boolean') env.push(input.online ? 'online' : 'OFFLINE');
  if (input.connection) env.push(input.connection);
  if (env.length) out.push(`Device: ${env.join(' · ')}`);
  if (input.userAgent) out.push(`Browser: ${collapse(input.userAgent).slice(0, 200)}`);
  if (input.overflowLine) out.push(input.overflowLine);

  const errors = (input.errors ?? []).filter((e) => typeof e === 'string' && e.trim());
  out.push('');
  if (errors.length) {
    out.push(`Recent errors in this tab (${errors.length}):`);
    errors.slice(0, 8).forEach((e, i) => out.push(`  ${i + 1}. ${redactSecrets(collapse(e)).slice(0, 200)}`));
  } else {
    out.push('Recent errors in this tab: none since the page loaded');
  }

  out.push('');
  if (!input.outline.scanned) {
    out.push('Page content: could not be read from this page.');
    return out.join('\n');
  }
  if (input.outline.lines.length === 0) {
    out.push('Page content: the page read as empty — nothing visible was found to copy.');
    return out.join('\n');
  }

  out.push(`Page content (${input.outline.lines.length} lines, ${input.outline.elementsSeen} elements):`);
  out.push(RULE);
  out.push(...input.outline.lines);
  out.push(RULE);
  if (input.outline.truncated) {
    out.push('⚠️ The page was longer than one copy can hold — this is the TOP of the page, not all of it.');
  }
  return out.join('\n');
}
