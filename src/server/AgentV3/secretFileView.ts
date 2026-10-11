// A model that can read the vault can paste it into chat, a commit, or a diagnostic.
// Secret files are shown masked. The sandbox file itself is never rewritten by a read.

import { isSecretEnvPath } from '../lib/workspacePath';
import { redactSecrets } from './SecretRedactor';

export const SECRET_MASK = '•••• (hidden)';

const SECRET_FILE_NAME = /^\.npmrc$|serviceaccount.*\.json$|-firebase-adminsdk-.*\.json$|^credentials\.json$|\.pem$|\.key$|^id_(rsa|ed25519)/i;
const SENSITIVE_KEY = /(SECRET|TOKEN|KEY|PASS|PRIVATE|CREDENTIAL|AUTH|DSN|DATABASE_URL)/i;

export function isSecretFilePath(p: string): boolean {
  if (isSecretEnvPath(p)) return true;
  const base = String(p ?? '').split('/').pop() ?? '';
  return SECRET_FILE_NAME.test(base);
}

/**
 * Mask a secret file for the model. Env files keep comments, blanks, and values that are
 * neither vault keys nor secret-shaped. Other credential files become a byte-count stub.
 */
export function maskSecretFile(path: string, content: string, vaultKeyNames: Set<string>): string {
  const base = String(path ?? '').split('/').pop() ?? '';
  if (/^\.npmrc$/i.test(base)) return redactSecrets(content);
  if (!isSecretEnvPath(path)) {
    return `[credential file — contents hidden, ${Buffer.byteLength(content, 'utf8')} bytes]`;
  }
  const masked = content.split('\n').map((line) => {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) return line;
    const m = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!m) return line;
    const [, prefix, key, rawVal] = m;
    const quoted = /^(['"])(.*)\1\s*$/.exec(rawVal);
    const value = quoted ? quoted[2] : rawVal.trim();
    if (value === '') return line;
    const safe = !vaultKeyNames.has(key) && !SENSITIVE_KEY.test(key) && redactSecrets(value) === value;
    if (safe) return line;
    return `${prefix}${key}=${SECRET_MASK}`;
  });
  return `${masked.join('\n')}\n# values hidden by NavBharatAI — use request_secrets to change a secret`;
}

export function secretPlaceholderWriteMessage(path: string): string {
  return `You are writing the hidden placeholder back into ${path}; that would erase real values. Use request_secrets or write only the keys you are adding.`;
}
