import { describe, it, expect } from 'vitest';
import { generateEmailIntegration, isEmailProvider } from './EmailGenerator';

describe('generateEmailIntegration', () => {
  it('resend: a real sendEmail helper using the Resend SDK + env keys + dependency', () => {
    const c = generateEmailIntegration('resend');
    const helper = c.files['src/lib/email.ts'];
    expect(helper).toContain("import { Resend } from 'resend'");
    expect(helper).toContain('export async function sendEmail');
    expect(helper).toContain('resend.emails.send');
    expect(helper).toContain('EMAIL_FROM');
    expect(c.envKeys).toEqual(['RESEND_API_KEY', 'EMAIL_FROM']);
    expect(c.dependency).toEqual({ name: 'resend', version: '^4' });
  });

  it('sendgrid: a real sendEmail helper using @sendgrid/mail', () => {
    const c = generateEmailIntegration('sendgrid');
    expect(c.files['src/lib/email.ts']).toContain("import sgMail from '@sendgrid/mail'");
    expect(c.files['src/lib/email.ts']).toContain('sgMail.send');
    expect(c.envKeys).toEqual(['SENDGRID_API_KEY', 'EMAIL_FROM']);
    expect(c.dependency.name).toBe('@sendgrid/mail');
  });

  it('every provider blanks its secret values in .env.example (never a baked-in key)', () => {
    for (const p of ['resend', 'sendgrid'] as const) {
      const cfg = generateEmailIntegration(p);
      for (const k of cfg.envKeys) expect(cfg.files['.env.example']).toContain(`${k}=\n`);
    }
  });

  it('the generated helper has no TODO/stub placeholders and throws on a missing sender', () => {
    for (const p of ['resend', 'sendgrid'] as const) {
      const helper = generateEmailIntegration(p).files['src/lib/email.ts'];
      expect(helper).not.toMatch(/TODO|FIXME|not implemented|your-code-here/i);
      expect(helper).toContain('EMAIL_FROM is not set'); // honest guard, not a silent no-op
    }
  });

  it('isEmailProvider guards + unknown provider throws', () => {
    expect(isEmailProvider('resend')).toBe(true);
    expect(isEmailProvider('sendgrid')).toBe(true);
    for (const v of ['mailgun', '', null, 3]) expect(isEmailProvider(v)).toBe(false);
    // @ts-expect-error invalid
    expect(() => generateEmailIntegration('mailgun')).toThrow();
  });
});
