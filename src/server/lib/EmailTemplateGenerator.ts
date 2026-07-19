// U-4 (verified recipe modules) — HTML email template builder (dependency-free).
//
// Transactional emails (welcome, verify-your-email, password reset, receipt, order update) are where apps
// quietly look unprofessional: a bare `<div>` email with flexbox renders BROKEN in Outlook and Gmail (email
// clients strip <style>, ignore fl/grid, and need table layout + inline styles), and an unescaped name/amount
// in the body can break the markup. This recipe ships a correct builder: a responsive, table-based, inline-
// styled HTML email (600px, works across clients) with a bulletproof button, plus the matching PLAIN-TEXT
// version (every real email is multipart — text/plain + text/html — or it lands in spam). Every value is
// HTML-escaped. Dependency-free, no env keys. Pairs with the email-send recipe (pass renderEmail().html as the
// html body and .text as the text body). PURE builder; correct and complete — no TODO stubs. Unit-tested.

export interface EmailTemplateConfig {
  files: Record<string, string>;
  instructions: string;
}

const EMAIL_TEMPLATE_SERVER = `export interface EmailOptions {
  /** Shown in the browser/preview tab and as the first line. */
  title: string;
  /** Big heading at the top of the card. */
  heading: string;
  /** Body paragraphs (each becomes its own <p>). Plain text — it is HTML-escaped for you. */
  body: string[];
  /** Optional call-to-action button. */
  button?: { text: string; url: string };
  /** Small print at the bottom (address, unsubscribe note, "you received this because…"). */
  footer?: string;
  /** Hidden preview text shown by the inbox next to the subject. */
  preheader?: string;
}

const escapeHtml = (s: string): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Build a responsive transactional email. Returns BOTH the HTML and a matching plain-text body — send them as
// a multipart message (text/plain + text/html) so it renders everywhere and stays out of spam. Table-based
// with inline styles because email clients (Outlook/Gmail) strip embedded style blocks and do not support
// flex/grid.
export function renderEmail(opts: EmailOptions): { html: string; text: string } {
  const title = escapeHtml(opts.title);
  const heading = escapeHtml(opts.heading);
  const paragraphs = opts.body
    .map((p) => \`<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#333333;">\${escapeHtml(p)}</p>\`)
    .join('');
  const button = opts.button
    ? \`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;"><tr><td style="border-radius:6px;background:#2563eb;">\` +
      \`<a href="\${escapeHtml(opts.button.url)}" style="display:inline-block;padding:12px 24px;font-size:16px;color:#ffffff;text-decoration:none;font-weight:600;">\${escapeHtml(opts.button.text)}</a>\` +
      \`</td></tr></table>\`
    : '';
  const footer = opts.footer
    ? \`<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#999999;">\${escapeHtml(opts.footer)}</p>\`
    : '';
  const preheader = opts.preheader
    ? \`<div style="display:none;max-height:0;overflow:hidden;opacity:0;">\${escapeHtml(opts.preheader)}</div>\`
    : '';

  const html = \`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>\${title}</title></head>\` +
    \`<body style="margin:0;padding:0;background:#f4f4f5;">\${preheader}\` +
    \`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0;"><tr><td align="center">\` +
    \`<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:8px;padding:32px;font-family:Arial,Helvetica,sans-serif;">\` +
    \`<tr><td><h1 style="margin:0 0 16px;font-size:22px;color:#111111;">\${heading}</h1>\${paragraphs}\${button}\${footer}</td></tr>\` +
    \`</table></td></tr></table></body></html>\`;

  const text = [opts.heading, '', ...opts.body, opts.button ? \`\${opts.button.text}: \${opts.button.url}\` : '', opts.footer ? \`\\n\${opts.footer}\` : '']
    .filter((l) => l !== '')
    .join('\\n');

  return { html, text };
}
`;

const INSTRUCTIONS =
  'Email template builder wired at server/lib/emailTemplate.ts (no dependency). Call renderEmail({ title, ' +
  'heading, body: ["line 1", "line 2"], button: { text, url }, footer, preheader }) → { html, text } and send ' +
  'BOTH parts (text/plain + text/html) so the email renders in every client and stays out of spam. The HTML is ' +
  'responsive, table-based with inline styles (Outlook/Gmail-safe), and every value is escaped, so a name or ' +
  'amount with <, > or & can never break the markup. Pass .html + .text straight into the email-send recipe ' +
  '(or your provider). No API key needed.';

export function generateEmailTemplateIntegration(): EmailTemplateConfig {
  return {
    files: { 'server/lib/emailTemplate.ts': EMAIL_TEMPLATE_SERVER },
    instructions: INSTRUCTIONS,
  };
}
