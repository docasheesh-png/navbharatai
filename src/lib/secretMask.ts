// Hide the VALUES of a secret file until the user asks to see them.
//
// THE INCIDENT (admin, 2026-08-06). The Files viewer rendered `.env` verbatim, so a screenshot taken to
// show something else entirely — a build problem — carried a live Neon database password and a payment
// secret out of the app. The credentials had to be rotated.
//
// WHAT MAKES THIS A DEFECT RATHER THAN BAD LUCK: the rest of the product already treats these values as
// too sensitive to display. Settings → Database deliberately never shows a saved credential back
// ("values aren't shown here — leave a field blank to keep its current value"), and the vault encrypts
// them at rest. Then the same secrets were readable in one tap in the Files tab, with a copy button. A
// promise kept on one screen and broken on the next is not a promise.
//
// THE KEYS STAY VISIBLE, ONLY THE VALUES GO. Which variables an app expects is the genuinely useful
// thing to see — it is how a user checks that a key they added actually reached the app. The value is
// the part they already know and the part a stranger must not learn.
//
// The mask is a FIXED width, deliberately: a dot run matching the real length would leak how long the
// secret is, which narrows a guess. PURE, so both the display and the copy path can use the same rule.

/** How a masked value is drawn. Fixed width — see above. */
export const SECRET_MASK = '••••••••••••';

/**
 * Files whose contents are credentials rather than code.
 *
 * Deliberately narrow: masking a source file would hide the very thing the viewer is for. These are the
 * files that hold nothing BUT secrets — every `.env` flavour, private keys, and the service-account JSON
 * that a cloud provider hands out.
 */
export function isSecretFile(path: string | null | undefined): boolean {
  const p = String(path ?? '').trim().toLowerCase().replace(/\\/g, '/');
  const base = p.split('/').pop() ?? '';
  if (/^\.env(\.[a-z0-9_-]+)?$/.test(base)) return true;
  if (/^\.?env(\.[a-z0-9_-]+)?$/.test(base) && base !== 'env.d.ts') return true;
  if (/\.(pem|key|p12|pfx|jks|keystore)$/.test(base)) return true;
  if (/^id_(rsa|dsa|ecdsa|ed25519)$/.test(base)) return true;
  if (/^(service[-_]?account|credentials|gcp[-_]?key)[a-z0-9_.-]*\.json$/.test(base)) return true;
  return false;
}

/**
 * Replace every value in a `KEY=value` file, keeping the key, comments and blank lines.
 *
 * A line that is NOT a key/value pair is dropped entirely rather than shown, because a non-env secret
 * file (a `.pem`, a service-account JSON) is secret in its whole body — there is no "key" half of it
 * that is safe to display. PURE.
 */
export function maskSecretContent(path: string | null | undefined, content: string | null | undefined): string {
  const text = String(content ?? '');
  if (!isSecretFile(path)) return text;
  const looksLikeEnv = /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=/m.test(text);
  if (!looksLikeEnv) {
    // A key file or a credentials blob: the whole body is the secret.
    return `${SECRET_MASK}\n\n(this file holds credentials — its contents are hidden)`;
  }
  return text.split('\n').map((line) => {
    const m = /^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=)(.*)$/.exec(line);
    if (!m) return line;                       // comment, blank line, or something we do not recognise
    if (m[2].trim() === '') return line;        // an EMPTY value is not a secret, and hiding it misleads
    return `${m[1]}${SECRET_MASK}`;
  }).join('\n');
}

/**
 * The one-line explanation shown under a masked file.
 *
 * Says WHY and says how to see it, because a user who cannot find their own value will assume the app
 * lost it — and that is a worse outcome than the one this protects against.
 */
export function maskNotice(path: string): string {
  return `${path} holds credentials, so its values are hidden — this is what stops a screenshot from carrying them. Tap Reveal to see them.`;
}
