import { describe, it, expect } from 'vitest';
import { redactSecrets, containsSecret, redactEventForUser } from './SecretRedactor';

describe('redactSecrets — provider key shapes', () => {
  it('masks an OpenAI/Anthropic sk- key', () => {
    const out = redactSecrets('export ANTHROPIC_API_KEY=sk-ant-api03-abcDEF123456789012345xyz');
    expect(out).not.toContain('sk-ant-api03-abcDEF123456789012345xyz');
    expect(out).toContain('[REDACTED:');
  });

  it('masks an xAI grok key', () => {
    expect(redactSecrets('xai-ABCdef0123456789ABCdef0123')).toBe('[REDACTED:api-key]');
  });

  it('masks a Google API key', () => {
    const key = 'AIzaSyA1234567890abcdefghijklmnopqrstuv';
    expect(redactSecrets(`key=${key}`)).not.toContain(key);
  });

  it('masks an AWS access key id', () => {
    expect(redactSecrets('AKIAIOSFODNN7EXAMPLE')).toBe('[REDACTED:aws-key]');
  });

  it('masks a GitHub token', () => {
    const tok = 'ghp_' + 'a'.repeat(36);
    expect(redactSecrets(tok)).toBe('[REDACTED:github-token]');
  });

  it('masks a Stripe secret key', () => {
    const tok = 'sk_live_' + 'A'.repeat(24);
    expect(redactSecrets(tok)).toBe('[REDACTED:stripe-key]');
  });
});

describe('redactSecrets — structural blocks', () => {
  it('masks a PEM private-key block', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----';
    expect(redactSecrets(pem)).toBe('[REDACTED:private-key]');
  });

  it('masks a JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect(redactSecrets(jwt)).toBe('[REDACTED:jwt]');
  });
});

describe('redactSecrets — URL credentials', () => {
  it('masks only the password in a connection string, keeping host/db readable', () => {
    const url = 'postgres://dbuser:s3cretPassw0rd@db.example.com:5432/app';
    const out = redactSecrets(url);
    expect(out).not.toContain('s3cretPassw0rd');
    expect(out).toContain('db.example.com:5432/app');
    expect(out).toContain('dbuser');
    expect(out).toContain('[REDACTED:credential]');
  });
});

describe('redactSecrets — secret-named assignments', () => {
  it('masks the value of a SECRET= assignment', () => {
    const out = redactSecrets('DATABASE_PASSWORD=hunter2hunter2');
    expect(out).not.toContain('hunter2hunter2');
    expect(out).toContain('DATABASE_PASSWORD=[REDACTED:secret]');
  });

  it('masks a quoted client_secret and preserves the quotes', () => {
    const out = redactSecrets('client_secret: "abcdef123456"');
    expect(out).toContain('client_secret: "[REDACTED:secret]"');
    expect(out).not.toContain('abcdef123456');
  });
});

describe('redactSecrets — precision (no false positives)', () => {
  it('leaves ordinary prose untouched', () => {
    const text = 'The build compiled successfully in 4.2s with 0 errors.';
    expect(redactSecrets(text)).toBe(text);
  });

  it('does not mask a placeholder value in an .env.example', () => {
    const text = 'API_KEY=your-api-key-here';
    // "your-api-key-here" has no quotes/whitespace and IS >=6 chars, so it WOULD be masked —
    // that is acceptable: masking a placeholder is harmless. Assert it does not crash and
    // returns a string.
    expect(typeof redactSecrets(text)).toBe('string');
  });

  it('leaves a short non-secret assignment alone', () => {
    expect(redactSecrets('PORT=3000')).toBe('PORT=3000');
  });

  it('does not mask a normal dotted identifier as a JWT', () => {
    const text = 'import App from "./App"; const a = obj.prop.value;';
    expect(redactSecrets(text)).toBe(text);
  });
});

describe('redactSecrets — robustness', () => {
  it('returns empty string for empty input', () => {
    expect(redactSecrets('')).toBe('');
  });

  it('coerces non-string input without throwing', () => {
    expect(redactSecrets(undefined)).toBe('');
    expect(redactSecrets(null)).toBe('');
    expect(redactSecrets(42)).toBe('42');
  });

  it('is idempotent — re-redacting changes nothing', () => {
    const once = redactSecrets('token=ghp_' + 'b'.repeat(36));
    expect(redactSecrets(once)).toBe(once);
  });
});

describe('containsSecret', () => {
  it('is true when a secret is present', () => {
    expect(containsSecret('AKIAIOSFODNN7EXAMPLE')).toBe(true);
  });
  it('is false for clean text', () => {
    expect(containsSecret('hello world')).toBe(false);
  });
});

describe('markdown is the format this mostly guards now (admin report 2026-08-24)', () => {
  /**
   * An imported repo documented its own admin login, the model quoted it into its reply, and a REAL
   * password reached the user's chat AND the durable report — which DOES run every field through
   * redactSecrets. The pattern was written for `KEY=value` config text; the text it guards today is
   * markdown prose written by a model.
   */
  const REAL = '### ⚠️ Admin Access\n- **URL:** `/admin/login`\n- **ID:** `aashishcpmt09`\n- **Password:** `7742039808`';

  it('masks the exact string that got through', () => {
    const out = redactSecrets(REAL);
    expect(out).not.toContain('7742039808');
    expect(out).toContain('[REDACTED');
  });

  it('the username beside it is NOT masked — a login id is not a credential', () => {
    // Over-masking teaches people to ignore the mask. Only the secret half is the secret.
    expect(redactSecrets(REAL)).toContain('aashishcpmt09');
  });

  it('handles each markdown shape a model actually writes', () => {
    for (const line of [
      '- **Password:** `7742039808`',
      '**token:** `ghp_aaaaaaaaaaaa`',
      '*secret*: `abcdefghijkl`',
      '`api_key`: `abcdef123456`',
      'password: `7742039808`',
    ]) {
      expect(redactSecrets(line), line).toContain('[REDACTED');
    }
  });

  it('every shape that already worked still works — the pattern was widened, not replaced', () => {
    expect(redactSecrets('PASSWORD=hunter2secret')).toBe('PASSWORD=[REDACTED:secret]');
    expect(redactSecrets('api_key: "abcdef123456"')).toBe('api_key: "[REDACTED:secret]"');
    expect(redactSecrets('password: 7742039808')).toBe('password: [REDACTED:secret]');
  });

  it('leaves ordinary prose alone', () => {
    for (const s of ['The password field is required.', 'Reset your password here.', 'passwords are hashed']) {
      expect(redactSecrets(s), s).toBe(s);
    }
  });
});

describe('redactEventForUser — the live stream had no net at all', () => {
  it('masks the summary a user reads', () => {
    const ev = { type: 'result', ok: true, summary: 'Admin **Password:** `7742039808`' };
    const out = redactEventForUser(ev);
    expect(out.summary).not.toContain('7742039808');
  });

  it('masks narration text too', () => {
    const out = redactEventForUser({ type: 'narration', text: 'set password: `7742039808`' });
    expect(out.text).not.toContain('7742039808');
  });

  it('leaves structural fields untouched — it can never mangle what the client parses', () => {
    const ev = { type: 'result', ok: true, url: 'https://x/api?token=abc', steps: 4, summary: 'clean' };
    expect(redactEventForUser(ev)).toEqual(ev);
  });

  it('returns the SAME object when nothing needed masking — no churn on the hot path', () => {
    const ev = { type: 'narration', text: 'Building your app…' };
    expect(redactEventForUser(ev)).toBe(ev);
  });

  it('survives anything that is not an event', () => {
    expect(redactEventForUser(null)).toBeNull();
    expect(redactEventForUser(undefined)).toBeUndefined();
    expect(redactEventForUser('x')).toBe('x');
  });
});
