// ONE READER FOR JSX MARKUP — the scanner both accessibility analyzers now share.
//
// 🔴 WHY THIS FILE EXISTS (autopsy 8a92e5ed, 2026-09-20). A build report told a free user their
// working password generator had *"3 form field(s) with no label"*. All three were labelled — each
// checkbox sits inside its own wrapping `<label>` — and the app they were in is NavBharatAI's OWN
// golden scaffold.
//
// The day before, autopsy c847b523 had root-caused that exact defect and shipped the fix, plus
// `tests/ourOwnTemplatesPassOurOwnGate.test.ts`, whose docblock promises *"a new template with an
// unlabelled control can no longer reach `main`"*. Both were real. Both were aimed at
// `AccessibilityAnalysis.ts` — and **the `ACCESSIBILITY` line in a build report is not written by
// that module at all.** It comes from `AppMakerLab/intelligence/A11yLinter.ts`, by way of
// `buildQualityLint.ts`. The instance was fixed, the sibling was never hunted, and the lock was
// pointed at the analyzer that does not judge builds.
//
// 🔑 THE SENTENCE THAT NAMES THE CLASS, from A11yLinter's own docblock: *"regex on the HTML string,
// not a parser"*. It was written for **HTML**, and `lintBuiltApp` feeds it **JSX**. Nobody changed
// its reader. In HTML, `<input …>` really does end at the first `>`; in JSX,
//
//     <input checked={upper} onChange={(e) => setUpper(e.target.checked)} aria-label="Uppercase" />
//
// the first `>` belongs to the arrow, so `[^>]*` stops there and **every attribute after the first
// handler is invisible** — `aria-label` included. A correctly labelled control reads as unlabelled.
//
// So the reader lives here, once. `tagsOnLine` is the scanner c847b523 wrote (moved, not rewritten —
// `AccessibilityAnalysis.test.ts` proves it byte-for-byte); `scanMarkup` adds the two facts a rule
// needs and a regex cannot carry: whether an enclosing `<label>` is open, and whether the tag is an
// HTML element at all. Pure, dependency-free, total on its inputs. Plain HTML scans identically —
// it has no braces to be inside — so a caller that really is handed HTML loses nothing.

/** One opening tag found in a source file. */
export interface ScannedTag {
  /** The tag's full source text, `<` to `>` inclusive. */
  tag: string;
  /** The element name exactly as written — `input`, `Select`, `Dialog.Root`. */
  rawName: string;
  /** `rawName` lowercased. Only meaningful when `isElement` is true. */
  name: string;
  /**
   * True for an HTML ELEMENT (`<input>`), false for a COMPONENT (`<Input>`, `<Dialog.Root>`).
   *
   * JSX makes this DECIDABLE rather than a heuristic: a lowercase first letter is an intrinsic
   * element, a capital or a dot is a component reference. It matters because we cannot know a
   * component's contract — `<Select label="Category" />` has a real, working label and being judged
   * by the rules for HTML `<select>` is how eleven false findings reached one report.
   */
  isElement: boolean;
  /** 0-based line the tag was found on. */
  line: number;
  /** 0-based character offset of the tag's `<` in the source it was scanned from. */
  index: number;
  /** True when an enclosing `<label>` is still open at this tag — the control is labelled by its text. */
  insideLabel: boolean;
}

/**
 * Every opening tag that CLOSES on this line, with the text of the tag itself.
 *
 * Moved verbatim from `AccessibilityAnalysis.ts` (autopsy c847b523), which explains the rule it
 * encodes: track brace depth and quotes, and end the tag only at a `>` that is genuinely outside
 * `{…}`. A tag that does not close on its own line is skipped, exactly as before — an incomplete
 * attribute set must never produce a "missing attribute" finding.
 */
export function tagsOnLine(line: string): Array<{ tag: string; index: number }> {
  const out: Array<{ tag: string; index: number }> = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== '<') continue;
    if (!/[a-zA-Z]/.test(line[i + 1] ?? '')) continue; // `</div>` and stray `<` are not opening tags
    let depth = 0;
    let quote: string | null = null;
    let closed = -1;
    for (let j = i + 1; j < line.length; j++) {
      const c = line[j];
      if (quote) { if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '{') { depth++; continue; }
      if (c === '}') { if (depth > 0) depth--; continue; }
      if (depth > 0) continue;        // a `>` in here belongs to an arrow, not to the tag
      if (c === '<') break;           // a new tag opened: this one never closed on this line
      if (c === '>') { closed = j; break; }
    }
    if (closed >= 0) { out.push({ tag: line.slice(i, closed + 1), index: i }); i = closed; }
  }
  return out;
}

/** The element name exactly as written: `input`, `Select`, `Dialog.Root`. Empty when unreadable. */
export function tagName(tag: string): string {
  return (/^<\s*([A-Za-z][\w.-]*)/.exec(tag)?.[1] ?? '');
}

/** True for an HTML element (`<input>`), false for a component (`<Input>`, `<Dialog.Root>`). */
export function isHtmlElement(tag: string): boolean {
  const raw = tagName(tag);
  return raw !== '' && !raw.includes('.') && raw[0] === raw[0].toLowerCase();
}

/**
 * Does this tag carry `attr=`?
 *
 * `(?<![-\w])` rather than `\b`, so a different attribute ENDING in `attr` — `data-alt` for `alt`,
 * `formaction` for `action` — is not mistaken for it. `\b` matches after a hyphen, which is how
 * `<img data-alt="x">` was once read as HAVING alt and the missing-alt finding silently skipped.
 */
export function hasAttr(tag: string, attr: string): boolean {
  return new RegExp(`(?<![-\\w])${attr}\\s*=`, 'i').test(tag);
}

/**
 * `hasAttr`, and ALSO the bare boolean form — `<input required>`, `<video controls>`.
 *
 * The two callers genuinely want different things and the difference is named here rather than
 * duplicated in each of them. An accessibility NAME is never a bare boolean: `<input aria-label>`
 * carries no text, so a rule asking "is this control named?" must demand a value (`hasAttr`). A
 * rule asking "is this attribute present at all?" — `required`, `controls`, `disabled` — must
 * accept the bare form or it reports valid markup as broken.
 */
export function hasAttrOrBareBoolean(tag: string, attr: string): boolean {
  return hasAttr(tag, attr) || new RegExp(`(?<![-\\w])${attr}(\\s|>|/|$)`, 'i').test(tag);
}

/** The tag's own text when an opening tag starts at `from`, else null. Spans lines. */
function readTagAt(source: string, from: number): { tag: string; end: number } | null {
  let depth = 0;
  let quote: string | null = null;
  for (let j = from + 1; j < source.length; j++) {
    const c = source[j];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') { depth++; continue; }
    if (c === '}') { if (depth > 0) depth--; continue; }
    if (depth > 0) continue;   // a `>` in here belongs to an arrow, not to the tag
    if (c === '<') return null; // a new tag opened before this one closed — not a tag we can read
    if (c === '>') return { tag: source.slice(from, j + 1), end: j };
  }
  return null;                 // unterminated: conservative, report nothing about it
}

/**
 * The opening tag that CONTAINS `offset`, across lines, or null when the offset is not inside one.
 *
 * Written for `SecurityAnalysis`'s `unsafe-target-blank` rule (autopsy Study-Racer, 2026-09-25),
 * whose guard read `rel="noopener"` off the SAME LINE as `target="_blank"` — the JSX-multiline class
 * this module was created to end (autopsy 8a92e5ed): a generated React `<a>` is routinely written
 * over four lines, so a correctly-guarded link was reported as a medium security issue on two builds
 * in a row, and the reviewer had to call the platform's own finding a false positive. Walks back
 * from the offset to the nearest `<` that opens a readable tag and asks whether that tag reaches the
 * offset. Bounded; conservative — an unreadable tag answers null, never a guess.
 */
export function enclosingTag(source: string, offset: number): string | null {
  if (typeof source !== 'string' || offset < 0 || offset >= source.length) return null;
  const floor = Math.max(0, offset - 4000);
  for (let i = offset; i >= floor; i--) {
    if (source[i] !== '<' || !/[a-zA-Z]/.test(source[i + 1] ?? '')) continue;
    const read = readTagAt(source, i);
    if (!read) continue;
    return read.end >= offset ? read.tag : null;
  }
  return null;
}

/**
 * Every opening tag in a whole source file, each carrying whether a `<label>` encloses it.
 *
 * Two facts a regex cannot carry, and both were false findings in one real report:
 *
 * **1. The wrapping label, tracked ACROSS LINES**, because the commonest React form shape in the
 * world spans three of them:
 *
 *     <label className="row">
 *       <input type="checkbox" checked={upper} onChange={(e) => setUpper(e.target.checked)} />
 *       Uppercase letters (A–Z)
 *     </label>
 *
 * That control is labelled, by the label's own text. Reading only the current line calls it
 * unlabelled — which is the finding this whole file exists because of.
 *
 * **2. The tag spans lines too.** A generated React input is routinely written over four lines, so a
 * scanner that gave up at the newline would stop reporting on exactly the markup this engine writes
 * most — trading false positives for silence rather than for correctness.
 */
export function scanMarkup(source: string): ScannedTag[] {
  const out: ScannedTag[] = [];
  if (typeof source !== 'string' || source === '') return out;
  let labelDepth = 0;
  let line = 0;
  let scanned = 0;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') { line++; continue; }
    if (source[i] !== '<') continue;
    // A closing `</label>` is the only closer this scanner has to understand.
    if (source.startsWith('</', i)) {
      if (/^<\/\s*label\s*>/i.test(source.slice(i, i + 16))) labelDepth = Math.max(0, labelDepth - 1);
      continue;
    }
    if (!/[a-zA-Z]/.test(source[i + 1] ?? '')) continue;
    const read = readTagAt(source, i);
    if (!read) continue;
    const rawName = tagName(read.tag);
    out.push({
      tag: read.tag,
      rawName,
      name: rawName.toLowerCase(),
      isElement: isHtmlElement(read.tag),
      line,
      index: i,
      insideLabel: labelDepth > 0,
    });
    // A self-closing `<label />` opens nothing; anything else does.
    if (rawName.toLowerCase() === 'label' && !/\/\s*>$/.test(read.tag)) labelDepth++;
    line += countOccurrences(read.tag, /\n/g);
    i = read.end;
    if (++scanned >= MAX_TAGS) break;
  }
  return out;
}

/**
 * Stop after this many tags.
 *
 * `lintBuiltApp` hands the linter every source file joined together, capped at 400,000 characters.
 * This is a second, cheap bound so a pathological minified line cannot turn a build-end advisory
 * into a measurable pause. Far above any real app: the whole Free Fire prototype in autopsy
 * 01037e20 is 23 files.
 */
const MAX_TAGS = 20_000;

/** How many times `re` matches in `s`. */
function countOccurrences(s: string, re: RegExp): number {
  return (s.match(re) || []).length;
}

