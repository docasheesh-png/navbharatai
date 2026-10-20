/**
 * Source-aware SERVER redaction. The shared redactor also ships to the browser through
 * observability/sanitize, so the compiler must never be imported by SecretRedactor itself.
 *
 * A secret-shaped NAME is not proof of a secret VALUE: `password: string;` is a type,
 * not a password. The old assignment regexp removed both that type and its punctuation
 * from retained reports. Only compiler-proven, primitive annotations can bypass that
 * regexp here. Everything else still passes through the unchanged generic redactor.
 * Secret-named declaration initializers, object values, assignment RHSs, binding defaults,
 * and non-primitive types are masked as WHOLE syntax nodes, not text prefixes. Object
 * shorthand/method/accessor values become masked properties; JSX attributes are masked too.
 * Credential-bearing literals are replaced whole; comment delimiters remain outside their
 * re-redacted bodies only when that cannot split a generic credential match. The mask is a quoted literal
 * in both value and type positions, so a later pass still sees the same source structure.
 * No marker text is trusted: a marker plus another value is masked in its entirety.
 *
 * This is an optional, bounded source-evidence enhancement, not a compiler or general
 * secret-flow analysis. Primitive annotations are preserved only before the first parse
 * error and inside a code region. Source-only detection/fidelity requires completed,
 * bounded analysis and safe rewrite boundaries. If any size/node/depth/envelope/proof
 * budget is exhausted or analysis throws, discard ALL source spans and redact the
 * ORIGINAL input with the unchanged bundled generic helper. No partial exemptions or
 * emergency whole-input mask survive. That fallback keeps generic protection, not the
 * extra short/escaped-name/interpolation detection offered by successful source analysis.
 * The size cap applies on every pass, including after mask expansion. Ambiguous labels
 * and generic matches crossing lexical/AST boundaries also stay generic. No universal
 * source fidelity, parseability, executable/type-correct output or idempotence is promised.
 *
 * This changes evidence, never source files. A previously redacted report cannot be
 * reconstructed, and a new faithful report alone does not prove an old build worked.
 */
import * as ts from 'typescript';
import {
  SECRET_KEY_NAME,
  isNumericTokenCounter,
  redactSecrets as redactPlainSecrets,
  redactDeep as redactPlainDeep,
  redactEventForUser as redactPlainEvent,
} from './SecretRedactor';

export { redactPII, containsPII, redactPreviewUrls } from './SecretRedactor';

const MAX_SOURCE_CHARS = 200_000;
const MAX_NODES = 20_000;
const MAX_DEPTH = 128;
const MAX_SOURCE_REGIONS = 128;
const MASK = '[REDACTED:secret]';
// A quoted literal is valid both as an expression and as a TypeScript literal type.
const SOURCE_MASK = JSON.stringify(MASK);
// Candidate detection only: the compiler decodes names; no code is evaluated. The
// braced form admits leading-zero code points without an arbitrary digit limit.
const ESCAPED_NAME_CANDIDATE = /\\(?:u(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F])|x[0-9a-fA-F]{2})/;
const TEMPLATE_ASSIGNMENT_LABEL = new RegExp(
  `\\b[A-Za-z0-9_.-]*${SECRET_KEY_NAME.source}[A-Za-z0-9_.-]*[ \\t]*[=:]\\s*$`, 'i',
);
const MAX_BOUNDARY_CHECK_CHARS = 4_000_000;
interface Span { start: number; end: number; replacement?: string }
interface SourceRegion { start: number; end: number; code: boolean }

/** Primitive syntax only. No identifiers, literals, comments or expression text. */
function primitiveType(type: ts.TypeNode): boolean {
  switch (type.kind) {
    case ts.SyntaxKind.StringKeyword:
    case ts.SyntaxKind.NumberKeyword:
    case ts.SyntaxKind.BooleanKeyword:
    case ts.SyntaxKind.BigIntKeyword:
    case ts.SyntaxKind.SymbolKeyword:
    case ts.SyntaxKind.UnknownKeyword:
    case ts.SyntaxKind.AnyKeyword:
    case ts.SyntaxKind.NeverKeyword:
    case ts.SyntaxKind.VoidKeyword:
    case ts.SyntaxKind.ObjectKeyword:
    case ts.SyntaxKind.UndefinedKeyword:
      return true;
    default:
      if (ts.isArrayTypeNode(type)) return primitiveType(type.elementType);
      if (ts.isParenthesizedTypeNode(type)) return primitiveType(type.type);
      if (ts.isUnionTypeNode(type)) return type.types.every(primitiveType);
      return ts.isLiteralTypeNode(type) && type.literal.kind === ts.SyntaxKind.NullKeyword;
  }
}

/**
 * The generation protocol may wrap several files, or end mid-file in a capped preview.
 * Blank only marker LINES in the parser's copy, preserving all offsets and lexical state.
 * Splitting/re-parsing each apparent file would turn a marker inside a template/comment
 * into a fresh source file and could expose literal secrets. Non-code regions never earn
 * annotation exemptions. Prose/Markdown with embedded markers is not a source envelope.
 */
function sourceEnvelope(input: string): { source: string; regions: SourceRegion[] } {
  const first = /^\s*<<<FILE [A-Za-z0-9_./@-]+>>>\r?\n/.test(input);
  if (!first) return { source: input, regions: [{ start: 0, end: input.length, code: true }] };
  const regions: SourceRegion[] = [];
  let active: SourceRegion | undefined;
  const source = input.replace(/^<<<(?:FILE ([A-Za-z0-9_./@-]+)|ENDFILE)>>>[ \t]*\r?$/gm, (line, path: string | undefined, offset: number) => {
    if (active) active.end = offset;
    active = path === undefined ? undefined : { start: offset + line.length, end: input.length, code: /\.[cm]?[jt]sx?$/i.test(path) };
    if (active) regions.push(active);
    if (regions.length > MAX_SOURCE_REGIONS) throw new Error('Source envelope budget exceeded');
    return ' '.repeat(line.length);
  });
  return { source, regions };
}

/** Only literal/identifier names are proven keys; never evaluate computed expressions. */
function sourceKey(name: ts.Node): string | undefined {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) return name.expression.text;
  if (ts.isPropertyAccessExpression(name)) return name.name.text;
  if (ts.isElementAccessExpression(name) && ts.isStringLiteralLike(name.argumentExpression)) return name.argumentExpression.text;
  if (ts.isParenthesizedExpression(name)) return sourceKey(name.expression);
  return undefined;
}

/** Only literal text directly before an interpolation supplies the credential label. */
function hasSecretInterpolation(node: ts.Node): boolean {
  if (ts.isTaggedTemplateExpression(node)) return hasSecretInterpolation(node.template);
  if (!ts.isTemplateExpression(node) && !ts.isTemplateLiteralTypeNode(node)) return false;
  return [node.head, ...node.templateSpans.slice(0, -1).map((span) => span.literal)]
    .some((literal) => TEMPLATE_ASSIGNMENT_LABEL.test(literal.text));
}

function sourceSpans(input: string): Span[] {
  const { source, regions } = sourceEnvelope(input);
  const sf = ts.createSourceFile('evidence.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const diagnostics = (sf as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  const firstError = diagnostics.reduce((at, d) => Math.min(at, d.start ?? 0), Infinity);
  const spans: Span[] = [];
  // Keep the historical formatting of a bare .env line. This is NOT proof of
  // source provenance: every candidate replacement also needs the generic-boundary
  // checks below, including assignments beside declarations or semicolons.
  const sourceAssignments = sf.statements.some((statement) =>
    !ts.isExpressionStatement(statement) || source[statement.end - 1] === ';');
  const maskValue = (value: ts.Node, key: string, context: ts.Node): void => {
    if (!rewriteSpanSafe(context.getStart(sf), value.end)) return;
    const numericCounter = (ts.isNumericLiteral(value) || ts.isStringLiteralLike(value))
      && isNumericTokenCounter(key, value.text);
    spans.push({ start: value.getStart(sf), end: value.end,
      replacement: numericCounter ? undefined : SOURCE_MASK });
  };
  // No rewrite may split a generic match that extends into surrounding
  // text. Ask the unchanged generic redactor, rather than duplicating its patterns:
  // insert an internal separator, redact, remove it, and require the exact same
  // generic result. The separator is never accepted from input as an exemption.
  // For AST values/types, include the credential label in the check: splitting the
  // key from its value would itself prevent the intended generic assignment match.
  // Never let a parser-recovered RHS or punctuation restore a generic-masked tail.
  // Unsafe rewrites are omitted, leaving generic masking intact. Exhausting this
  // work cap aborts the entire optional source analysis, including earlier masks and
  // primitive exemptions; the caller then applies generic masking to ORIGINAL input.
  const ordinaryBoundary = '\n\0source-boundary\0\n';
  const boundaryMarker = input.includes(ordinaryBoundary)
    ? `\n${'\0'.repeat(input.length + 1)}\n` : ordinaryBoundary;
  const generic = redactPlainSecrets(input);
  let boundaryCheckChars = 0;
  let boundaryRegions = [{ start: 0, end: input.length, text: input, generic }];
  if (generic !== input) {
    // Delimiters are NOT proof of source syntax: even semicolons inside a quoted
    // credential or PEM header are candidates. Only exact generic equivalence
    // permits cheaper local checks. Try fine segments, then complete lines, then
    // retain whole-input checks if either split would lose a cross-boundary match.
    for (const segments of [/[^\n;]*[\n;]|[^\n;]+$/g, /[^\n]*\n|[^\n]+$/g]) {
      const parts = input.match(segments) ?? [];
      if (parts.length <= 1 || parts.length > MAX_NODES) continue;
      boundaryCheckChars += input.length;
      let start = 0;
      const local = parts.map((text) => {
        const region = { start, end: start + text.length, text, generic: redactPlainSecrets(text) };
        start = region.end;
        return region;
      });
      if (local.map((region) => region.generic).join('') === generic) {
        boundaryRegions = local;
        break;
      }
    }
  }
  const checkedBoundaries = new Map<number, boolean>();
  const boundarySafe = (position: number): boolean => {
    // Nothing generic-masked can be restored when the generic pass changes nothing.
    if (generic === input) return true;
    const known = checkedBoundaries.get(position);
    if (known !== undefined) return known;
    let low = 0;
    let high = boundaryRegions.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (boundaryRegions[middle].start <= position) low = middle;
      else high = middle - 1;
    }
    const region = boundaryRegions[low];
    if (region.generic === region.text) return true;
    const local = position - region.start;
    boundaryCheckChars += region.text.length + boundaryMarker.length;
    if (boundaryCheckChars > MAX_BOUNDARY_CHECK_CHARS) throw new Error('Source boundary proof budget exceeded');
    const checked = redactPlainSecrets(region.text.slice(0, local) + boundaryMarker + region.text.slice(local));
    const safe = checked.includes(boundaryMarker) && checked.replace(boundaryMarker, '') === region.generic;
    checkedBoundaries.set(position, safe);
    return safe;
  };
  const rewriteSpanSafe = (start: number, end: number): boolean => {
    // Restoring adjacent source punctuation is safe, but never restore a following
    // word/value that the generic pass consumed as part of the same credential.
    while (end < input.length && /[;,()[\]{}.+!?*/:=<>|&%^~-]/.test(input[end])) end++;
    return boundarySafe(start) && boundarySafe(end);
  };
  const commentStarts = new Set<number>();
  const commentPositions = new Set<number>();
  const maskComments = (position: number): void => {
    if (commentPositions.has(position)) return;
    commentPositions.add(position);
    const comments = [...(ts.getLeadingCommentRanges(source, position) ?? []),
      ...(ts.getTrailingCommentRanges(source, position) ?? [])];
    for (const comment of comments) {
      if (commentStarts.has(comment.pos) || comment.kind !== ts.SyntaxKind.MultiLineCommentTrivia ||
        source.slice(comment.end - 2, comment.end) !== '*/') continue;
      commentStarts.add(comment.pos);
      const raw = input.slice(comment.pos, comment.end);
      if (redactPlainSecrets(raw) === raw || !rewriteSpanSafe(comment.pos, comment.end)) continue;
      // The text regexp may consume */ as part of an unquoted credential. Preserve
      // only the delimiter, and re-mask the entire body on EVERY pass, even when the
      // body already looks redacted. No source/string contents are exempted here.
      spans.push({ start: comment.pos, end: comment.end,
        replacement: `/*${redactPlainSecrets(input.slice(comment.pos + 2, comment.end - 2))}*/` });
    }
  };
  let visited = 0;
  const visit = (node: ts.Node, depth: number): void => {
    if (++visited > MAX_NODES || depth > MAX_DEPTH) throw new Error('Source redaction budget exceeded');
    maskComments(node.pos);
    maskComments(node.end);
    // Literal delimiters are also syntax. Mask a whole credential-bearing literal,
    // template (including its tag), regexp or JSX text rather than leaving a partial
    // interpolation/closing delimiter behind. Outer secret values still win below.
    if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node) || ts.isTaggedTemplateExpression(node) ||
      ts.isTemplateLiteralTypeNode(node) || ts.isRegularExpressionLiteral(node) || ts.isJsxText(node)) {
      const raw = input.slice(node.getStart(sf), node.end);
      // Closing JSX tags contain identifier text that generic masking may consume;
      // erase the containing literal element rather than restoring part of a match.
      const scope = ts.isJsxText(node) && node.parent &&
        (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) ? node.parent : node;
      const start = scope.getStart(sf);
      if ((redactPlainSecrets(raw) !== raw || hasSecretInterpolation(node)) && rewriteSpanSafe(start, scope.end)) {
        spans.push({ start, end: scope.end, replacement: SOURCE_MASK });
      }
    }
    if (ts.isParameter(node) || ts.isPropertySignature(node) || ts.isPropertyDeclaration(node) ||
      ts.isVariableDeclaration(node) || ts.isBindingElement(node) || ts.isPropertyAssignment(node)) {
      const name = node.name;
      const key = sourceKey(ts.isBindingElement(node) ? node.propertyName ?? name : name);
      if (key !== undefined && SECRET_KEY_NAME.test(key)) {
        const type = 'type' in node ? node.type : undefined;
        if (type) {
          const start = name.end;
          const end = type.end;
          // A parser recovery after an error is not proof. A later truncation does not
          // invalidate a complete, earlier annotation. The raw syntax check also keeps
          // comments (which can contain passwords) out of a preserved primitive type.
          const raw = source.slice(start, end);
          const validPrimitive = end <= firstError && primitiveType(type) &&
            /^[?!]?\s*:\s*[a-z\s()[\]|]+$/.test(raw) &&
            regions.some((r) => r.code && start >= r.start && end <= r.end);
          if (validPrimitive) spans.push({ start, end });
          else if (rewriteSpanSafe(node.getStart(sf), end)) {
            spans.push({ start: type.getStart(sf), end, replacement: SOURCE_MASK });
          }
        }
        if ('initializer' in node && node.initializer) {
          // Mask the WHOLE expression, including templates/calls/defaults, not just a
          // quoted prefix. A typed initializer was outside the generic regexp's match.
          maskValue(node.initializer, key, node);
        }
      }
    }
    if (ts.isJsxAttribute(node) && node.initializer && SECRET_KEY_NAME.test(node.name.getText(sf))) {
      maskValue(node.initializer, node.name.getText(sf), node);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      const key = sourceKey(node.left);
      if (key !== undefined && SECRET_KEY_NAME.test(key) &&
        (sourceAssignments || !ts.isIdentifier(node.left))) maskValue(node.right, key, node);
    }
    if (ts.isShorthandPropertyAssignment(node) || (node.parent && ts.isObjectLiteralExpression(node.parent) &&
      (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)))) {
      const key = sourceKey(node.name);
      if (key !== undefined && SECRET_KEY_NAME.test(key) && rewriteSpanSafe(node.getStart(sf), node.end)) {
        // Retain the key, but never preserve a shorthand's referenced value or a
        // secret-named object's callable/default body. A member is still a member.
        spans.push({ start: node.getStart(sf), end: node.end,
          replacement: `${redactPlainSecrets(node.name.getText(sf))}: ${SOURCE_MASK}` });
      }
    }
    ts.forEachChild(node, (child) => visit(child, depth + 1));
  };
  visit(sf, 0);
  return spans;
}

/** Any source-analysis failure or budget exhaustion returns generic masking of the original input. */
export function redactSecrets(input: unknown): string {
  if (typeof input !== 'string' || !input || input.length > MAX_SOURCE_CHARS ||
    (!SECRET_KEY_NAME.test(input) && !ESCAPED_NAME_CANDIDATE.test(input)) || !/[=:({]/.test(input)) {
    return redactPlainSecrets(input);
  }
  try {
    const spans = sourceSpans(input).sort((a, b) => a.start - b.start || b.end - a.end);
    let cursor = 0;
    let out = '';
    for (const span of spans) {
      // An outer secret initializer/type wins over all of its nested annotations.
      if (span.start < cursor || span.end <= span.start) continue;
      out += redactPlainSecrets(input.slice(cursor, span.start));
      out += span.replacement ?? input.slice(span.start, span.end);
      cursor = span.end;
    }
    return out + redactPlainSecrets(input.slice(cursor));
  } catch {
    // Atomic fallback: never redact a partially transformed string or retain any
    // source exemption when the complete bounded analysis could not be established.
    return redactPlainSecrets(input);
  }
}

export function containsSecret(input: unknown): boolean {
  return typeof input === 'string' && redactSecrets(input) !== input;
}

/** Use the same recursion/event rules, with the server-only text redactor at every leaf. */
export function redactDeep(value: unknown, depth = 0): unknown {
  return redactPlainDeep(value, depth, redactSecrets);
}

export function redactEventForUser<T>(event: T): T {
  return redactPlainEvent(event, redactSecrets);
}
