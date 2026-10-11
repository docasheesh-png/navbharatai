// A PRIVATE KEY IS ITS MATERIAL, NOT ITS MARKER (autopsy d0b2fcd6, 2026-10-07, Q-737).
//
// 🔴 WHAT HAPPENED. NavBharatAI's own iOS workflow (mobileShipKit.ts) rebuilds a canonical PEM from a
// repository secret, so its source contains the MARKERS as plain text:
//     BODY="$(… | sed -e 's/-----BEGIN PRIVATE KEY-----//' -e 's/-----END PRIVATE KEY-----//' …)"
//     { echo "-----BEGIN PRIVATE KEY-----"; printf '%s' "$BODY" | fold -w 64; echo "-----END PRIVATE KEY-----"; }
// There is no key there — the key arrives at run time from a secret. But every detector matched the marker:
//   • SecurityAnalysis reported "Private key committed in source" as a build-breaker;
//   • SecretRedactor's block regex spanned BEGIN…END across the `sed` and showed the model
//     `[REDACTED:private-key]` while the disk held the literal text — so the model's edits could never match
//     the file (6 failed `edit_file`s) and it rewrote our working workflow wholesale.
//
// 🔑 THE CLASS: a detector that keys on the label instead of the thing. A PEM private key is a base64 body
// between the markers. Code that MENTIONS the markers (a grep, a sed, a template that rebuilds a key from a
// secret, documentation) has no body. Every detector here now asks for the body.
//
// What counts as material: after the BEGIN marker, optional RFC 1421 header lines (`Proc-Type: …`,
// `DEK-Info: …`, PGP `Version: …`), then at least MIN_BODY base64 characters — allowing real newlines AND the
// two-character `\n` escape a key carries inside a JSON string (a service-account file), which is the leak
// that matters most. An END marker is NOT required: a key cut off mid-paste is still a leaked key. PURE.

/** Fewer base64 characters than this is not a key body (an EC P-256 PKCS#8 key alone is ~180). */
export const MIN_PEM_BODY = 40;

const LABEL = '(?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?';
const HEADERS = '(?:[A-Za-z][A-Za-z0-9-]*:[^\\r\\n]*(?:\\r?\\n|\\\\n)\\s*)*';
const BODY_CHAR = '(?:[A-Za-z0-9+/=]|\\s|\\\\[nr])';
const BODY = `(?:[A-Za-z0-9+/=]${BODY_CHAR}{${MIN_PEM_BODY - 1},})`;
const SOURCE = `-----BEGIN ${LABEL}-----\\s*(?:\\\\[nr]\\s*)*${HEADERS}${BODY}(?:-----END ${LABEL}-----)?`;

/** A fresh global regex over private-key blocks that carry material (for redaction). */
export function pemPrivateKeyBlocks(): RegExp {
  return new RegExp(SOURCE, 'g');
}

/** A NON-global regex for private-key material — safe to `.test()` repeatedly. */
export const PEM_PRIVATE_KEY_MATERIAL = new RegExp(SOURCE);

/** Does this text contain a private key — material, not just a marker? */
export function containsPemPrivateKey(text: string | null | undefined): boolean {
  return typeof text === 'string' && text.includes('PRIVATE KEY') && PEM_PRIVATE_KEY_MATERIAL.test(text);
}

/** The marker alone — a cheap pre-filter for line-based scanners, never a verdict by itself. */
export const PEM_PRIVATE_KEY_MARKER = new RegExp(`-----BEGIN ${LABEL}-----`);

/** How many lines after a marker can still belong to its key (a 4096-bit RSA key is ~52). */
const MAX_KEY_LINES = 80;

/**
 * For a line-based scanner: line `i` holds a BEGIN marker — is it the start of real key material? Reads the
 * marker's line and the lines that could belong to its key, from the marker onwards. PURE.
 */
export function pemKeyAtLine(lines: readonly string[], i: number): boolean {
  const line = lines[i];
  if (typeof line !== 'string') return false;
  const at = line.search(PEM_PRIVATE_KEY_MARKER);
  if (at < 0) return false;
  return containsPemPrivateKey([line.slice(at), ...lines.slice(i + 1, i + MAX_KEY_LINES)].join('\n'));
}
