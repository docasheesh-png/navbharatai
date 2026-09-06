import { describe, it, expect, afterEach } from 'vitest';
import { redactPreviewUrls, redactSecrets, redactEventForUser } from '../src/server/AgentV3/SecretRedactor';
import { previewUrlPattern } from '../src/server/AgentV3/PreviewDomain';

/**
 * A live preview URL names a running, BILLED E2B sandbox — if a model quotes it in its own reply,
 * a user can copy-paste that link to anyone, who then gets free, unmetered access to a machine
 * NavBharatAI pays for by the minute (admin 2026-09-03: "isse user yeh link copy paste kar ke
 * dosto ko bhi bhej deta hai, mera kharcha badta hai"). This is the backstop that ensures such a
 * URL never survives into the text a person actually reads, regardless of which tool call or
 * model narration produced it.
 */
describe('redactPreviewUrls', () => {
  const rawUrl = 'https://5173-i7pn8o56v8v8wudwkikdf.e2b.app';

  afterEach(() => {
    delete process.env.E2B_PREVIEW_DOMAIN;
  });

  it('masks a raw e2b.app preview URL', () => {
    const masked = redactPreviewUrls(`🌐 **Live preview:** ${rawUrl}`);
    expect(masked).not.toContain('e2b.app');
    expect(masked).not.toContain('i7pn8o56v8v8wudwkikdf');
    expect(masked).toContain('Preview panel');
  });

  it('masks a preview URL with a path and port', () => {
    const masked = redactPreviewUrls('open it: https://3000-abc123def456.e2b.app/dashboard?tab=1');
    expect(masked).not.toContain('e2b.app');
  });

  it('masks a preview URL under a configured custom E2B_PREVIEW_DOMAIN', () => {
    process.env.E2B_PREVIEW_DOMAIN = 'mitrify.xyz';
    const masked = redactPreviewUrls('https://5173-abc123def456.mitrify.xyz');
    expect(masked).not.toContain('mitrify.xyz');
  });

  it('still masks the raw e2b.app host even when a custom domain is configured', () => {
    process.env.E2B_PREVIEW_DOMAIN = 'mitrify.xyz';
    const masked = redactPreviewUrls('https://5173-abc123def456.e2b.app');
    expect(masked).not.toContain('e2b.app');
  });

  it('leaves a permanent published-app URL untouched (it costs nothing per visitor and is meant to be shared)', () => {
    const s = 'Deployed to a permanent public URL: https://myapp--prod.web.app (12 files).';
    expect(redactPreviewUrls(s)).toBe(s);
  });

  it('leaves ordinary NavBharatAI URLs untouched', () => {
    const s = 'See https://navbharatai.com/privacy for details.';
    expect(redactPreviewUrls(s)).toBe(s);
  });

  it('leaves non-preview text unchanged', () => {
    const s = 'const total = 42; // just code';
    expect(redactPreviewUrls(s)).toBe(s);
  });

  it('is idempotent', () => {
    const once = redactPreviewUrls(`Live preview: ${rawUrl}`);
    expect(redactPreviewUrls(once)).toBe(once);
  });

  it('never throws on non-string input (matches redactSecrets/redactPII: coerces null/undefined to empty)', () => {
    expect(redactPreviewUrls(null)).toBe('');
    expect(redactPreviewUrls(undefined)).toBe('');
  });
});

describe('redactSecrets is NOT widened by the preview-URL guard', () => {
  // redactSecrets also runs over bash stdout/stderr and admin-only diagnostics (DiagnosticsStore.ts),
  // where the real sandbox URL is exactly what an admin debugging a build needs to see. Only the
  // dedicated redactPreviewUrls (wired into redactEventForUser, the client-facing choke point) may
  // strip it — this test locks that scoping decision so a future edit can't quietly widen it.
  it('leaves a preview URL untouched', () => {
    const s = 'server listening — preview at https://5173-abc123def456.e2b.app';
    expect(redactSecrets(s)).toBe(s);
  });
});

describe('redactEventForUser masks a preview URL in text/summary but not structural fields', () => {
  const rawUrl = 'https://5173-abc123def456.e2b.app';

  it('masks the preview URL inside a narration event\'s text field', () => {
    const event = { type: 'narration', agent: 'architect', text: `✅ Done! 🌐 **Live preview:** ${rawUrl}`, ts: 1 };
    const out = redactEventForUser(event) as typeof event;
    expect(out.text).not.toContain('e2b.app');
    expect(out.text).toContain('Preview panel');
  });

  it('masks the preview URL inside a result event\'s summary field', () => {
    const event = { type: 'result', summary: `Live preview published at ${rawUrl}`, ts: 1 };
    const out = redactEventForUser(event) as typeof event;
    expect(out.summary).not.toContain('e2b.app');
  });

  it('leaves the preview event\'s own structural `url` field untouched (the client\'s health-check logic reads it)', () => {
    const event = { type: 'preview', url: rawUrl, ts: 1 };
    const out = redactEventForUser(event) as typeof event;
    expect(out.url).toBe(rawUrl);
  });

  it('is a no-op when there is nothing to mask', () => {
    const event = { type: 'narration', agent: 'architect', text: 'Building the login page now.', ts: 1 };
    expect(redactEventForUser(event)).toEqual(event);
  });
});

describe('previewUrlPattern (PreviewDomain.ts)', () => {
  it('matches the exact {port}-{sandboxId}.e2b.app shape', () => {
    expect('https://5173-abc123.e2b.app').toMatch(previewUrlPattern());
  });

  it('does not match a bare e2b.app host with no port-sandbox prefix', () => {
    expect('https://e2b.app/docs').not.toMatch(previewUrlPattern());
  });

  it('returns a fresh RegExp each call (no shared lastIndex state across calls)', () => {
    const a = previewUrlPattern();
    const b = previewUrlPattern();
    expect(a).not.toBe(b);
  });
});
