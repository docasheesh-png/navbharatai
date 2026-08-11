/**
 * `/status` and `/api/health` are PUBLIC — no token, no gate, anyone can open them.
 *
 * Two things were wrong there, both found while clearing the audit's leftover "unused locals" list —
 * an unused HTML-escape helper sitting next to an HTML renderer turned out to be the thread worth
 * pulling.
 *
 *   1. **The public page named the AI vendors.** The health check rendered
 *      `4 enabled (gemini, anthropic, grok, vertex)`, so a visitor learned exactly which providers
 *      NavBharatAI runs on. The White-Label Law says a user never encounters a vendor name and that
 *      provider identity is admin-only.
 *   2. **The page built HTML by string concatenation into `innerHTML`**, from values that arrive at
 *      RUNTIME from `/api/health`. Not exploitable as shipped — every value is server-authored today —
 *      but a check `detail` is precisely where a dependency's own error text gets echoed one day, and
 *      the escape helper written for this had never been wired (and could not have worked: the data
 *      arrives after the page is served).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { renderStatusPageHtml } from '../src/server/lib/HealthReport';

const VENDOR = /\b(gemini|anthropic|grok|vertex|claude|sonnet|opus|haiku|glm|kimi|moonshot|openai|deepseek|bedrock|xai)\b/i;

describe('the public status page names no vendor', () => {
  it('the rendered page carries no provider name', () => {
    expect(VENDOR.test(renderStatusPageHtml())).toBe(false);
  });

  it('the public health check reports a COUNT, not a list of engines', () => {
    const src = readFileSync('src/server/routes/health.ts', 'utf8');
    // The count is the honest, useful part — it says whether the engine can serve requests at all.
    expect(src).toContain('of ${entries.length} available');
    expect(src).toContain("name: 'AI engines'");
  });

  it('no vendor name is interpolated into any public health response', () => {
    const src = readFileSync('src/server/routes/health.ts', 'utf8')
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*)/.test(l))   // the comments describe the old bug on purpose
      .join('\n');
    expect(VENDOR.test(src)).toBe(false);
  });

  it('the ADMIN still gets the full provider map — this hides it from visitors, not from ops', () => {
    const admin = readFileSync('src/server/routes/admin.ts', 'utf8');
    expect(admin).toContain('providerEnabled');
  });
});

describe('the status page cannot be turned into a DOM-XSS by a check detail', () => {
  const page = renderStatusPageHtml();

  it('builds its rows with textContent, never innerHTML', () => {
    // Strip comments first — they mention innerHTML deliberately, to explain why it is gone.
    const code = page.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(code).not.toContain('innerHTML');
    expect(code).toContain('textContent');
    expect(code).toContain('createElement');
  });

  it('clears a container with textContent rather than an HTML assignment', () => {
    expect(page).toContain("metaBox.textContent=''");
    expect(page).toContain("checksBox.textContent=''");
  });

  it('sanitises the one value that becomes a CLASS NAME', () => {
    // `status` is interpolated into a class attribute, where textContent cannot protect it.
    expect(page).toContain("String(c.status||'').replace(/[^a-z]/g,'')");
  });

  it('no longer carries the escape helper that was never wired', () => {
    const mod = readFileSync('src/server/lib/HealthReport.ts', 'utf8');
    expect(mod).not.toMatch(/^const esc = /m);
  });

  it('still renders the page it is supposed to render', () => {
    // The hardening must not have emptied the page.
    expect(page).toContain('NavBharatAI Status');
    expect(page).toContain('/api/health');
    expect(page).toContain('Auto-refreshes every 15s');
  });
});
