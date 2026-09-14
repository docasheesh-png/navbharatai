/**
 * Eleven saved credentials shown as "No credentials saved yet" (admin, 2026-09-14).
 *
 * The keys were genuinely in the vault. The screen rendered `rows ∩ metas`, and `metas` came from an
 * `onSnapshot` straight onto `user_secrets` FROM THE BROWSER — a collection only the server owns. Every
 * WRITE already went through `/api/secrets`, which uses the ADMIN SDK and bypasses security rules; a
 * browser READ does not, and the rule guarding it matched a per-user subtree that has never existed
 * (the server writes flat documents with auto-ids and a `user_id` FIELD). The query was refused, the
 * snapshot had no error callback, so the refusal arrived nowhere and the allow-list stayed empty.
 *
 * Three things are pinned here, and each of them failing is how this bug returns:
 *   • the list is read through the authenticated SERVER route, never from the client's Firestore handle;
 *   • a failed read is NOT rendered as an empty vault — the two say different sentences;
 *   • a failed read does not BLANK the list it already had.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const panel = read('src/components/SecretManager.tsx');
/** Comments explain the bug by NAME, so a prose mention must never satisfy a code assertion. */
const code = panel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const rules = read('firestore.rules');
/** Same reason as `code` above: the new rule QUOTES the old one to explain it, and a test that cannot
 *  tell the quotation from the rule would force that explanation to be deleted to stay green. */
const rulesCode = rules.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

describe('the key list is read from the server, not from the browser', () => {
  it('uses the authenticated listSecrets route', () => {
    expect(code).toMatch(/import \{[^}]*\blistSecrets\b[^}]*\} from '\.\.\/lib\/secretsApi'/);
    expect(code).toMatch(/await listSecrets\(userId\)/);
  });

  it('no longer touches the user_secrets collection from the client', () => {
    expect(code).not.toMatch(/user_secrets/);
    expect(code).not.toMatch(/onSnapshot/);
  });

  it('does not keep a client Firestore handle it no longer needs', () => {
    // An unused import is what CI's noUnusedImports catches; this asserts the INTENT — the panel has
    // no business holding a direct database handle at all.
    expect(code).not.toMatch(/from 'firebase\/firestore'/);
  });

  it('re-reads the list after a save, so "re-reads your vault" is true of the whole screen', () => {
    expect(code).toMatch(/onSaved=\{\(names\) => \{ void loadSecrets\(\);/);
  });
});

describe('a failed read never masquerades as an empty vault', () => {
  it('records WHY the list could not be read', () => {
    expect(code).toMatch(/setListError\(/);
    expect(code).toMatch(/metasError/);
  });

  it('keeps the two states as different sentences', () => {
    expect(panel).toContain('No credentials saved yet. Add your first one below.');
    expect(panel).toMatch(/could not read the list/i);
    // The empty-state is now a branch on the error, not an unconditional claim.
    expect(code).toMatch(/metasError \? \(/);
  });

  it('does NOT blank the list it already had when a refresh fails', () => {
    // The catch block sets the error and nothing else — an empty `setSecrets([])` there would turn a
    // transient network failure into "you have nothing saved" on a screen that was correct a second ago.
    const body = code.slice(code.indexOf('const loadSecrets'), code.indexOf('useEffect(() => { void loadSecrets'));
    expect(body).toContain('setListError(');
    expect(body).not.toMatch(/catch[\s\S]*setSecrets\(/);
  });
});

describe('the Firestore rule matches the documents that actually exist', () => {
  it('no longer guards a per-user subtree the server never writes', () => {
    // The server writes flat auto-id documents, so `{userId}` in that path bound to a random id and
    // `isOwner` could never be true — a rule that reads as protection and behaves as a silent denial.
    expect(rulesCode).not.toMatch(/match \/user_secrets\/\{userId\}\/\{document=\*\*\}/);
  });

  it('is explicitly server-only', () => {
    expect(rulesCode).toMatch(/match \/user_secrets\/\{document=\*\*\} \{\s*\n\s*allow read, write: if false;/);
  });
});
