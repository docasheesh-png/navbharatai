import { describe, it, expect } from 'vitest';
import { generateNewsletterIntegration, isNewsletterProvider } from './NewsletterGenerator';

describe('generateNewsletterIntegration — Mailchimp', () => {
  const c = generateNewsletterIntegration('mailchimp');

  it('emits a server-only subscribe() that derives the data-center from the key', () => {
    const server = c.files['server/lib/newsletter.ts'];
    expect(server).toContain('export async function subscribe(email: string, name?: string)');
    expect(server).toContain("KEY?.split('-')[1]"); // data-center derived from the API key suffix
    expect(server).toContain('.api.mailchimp.com/3.0/lists/');
    expect(server).toContain("status: 'subscribed'");
    expect(server).toContain('MAILCHIMP_LIST_ID');
    expect(c.files['src/lib/newsletter.ts']).toBeUndefined(); // server-side, no client file
  });

  it('needs no npm dependency, declares key+list + blank .env.example + points to generate_email', () => {
    expect(c.dependency).toBeUndefined();
    expect(c.envKeys).toEqual(['MAILCHIMP_API_KEY', 'MAILCHIMP_LIST_ID']);
    expect(c.files['.env.example']).toBe('MAILCHIMP_API_KEY=\nMAILCHIMP_LIST_ID=\n');
    expect(c.instructions).toContain('never stores');
    expect(c.instructions).toContain('generate_email'); // distinct from transactional email
  });
});

describe('generateNewsletterIntegration — Brevo', () => {
  const c = generateNewsletterIntegration('brevo');

  it('emits a subscribe() that adds a contact to a list with updateEnabled', () => {
    const server = c.files['server/lib/newsletter.ts'];
    expect(server).toContain('https://api.brevo.com/v3/contacts');
    expect(server).toContain("'api-key': KEY");
    expect(server).toContain('listIds: [LIST_ID]');
    expect(server).toContain('updateEnabled: true');
    expect(c.envKeys).toEqual(['BREVO_API_KEY', 'BREVO_LIST_ID']);
    expect(c.dependency).toBeUndefined();
  });
});

describe('.env.example safety + provider guard', () => {
  it('.env.example carries NO real secret values (blank RHS only) for both providers', () => {
    for (const p of ['mailchimp', 'brevo'] as const) {
      const env = generateNewsletterIntegration(p).files['.env.example'];
      for (const line of env.split('\n').filter(Boolean)) expect(line).toMatch(/=$/);
    }
  });

  it('isNewsletterProvider accepts the two supported providers, rejects everything else', () => {
    expect(isNewsletterProvider('mailchimp')).toBe(true);
    expect(isNewsletterProvider('brevo')).toBe(true);
    expect(isNewsletterProvider('convertkit')).toBe(false);
    expect(isNewsletterProvider(undefined)).toBe(false);
  });
});
