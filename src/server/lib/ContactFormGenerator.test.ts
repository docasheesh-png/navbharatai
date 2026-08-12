import { describe, it, expect, afterAll } from 'vitest';

import { generateContactFormIntegration, CONTACTFORM_SERVICE_SOURCE } from './ContactFormGenerator';
import { emitModule } from '../../../tests/helpers/emitModule';

describe('generateContactFormIntegration (wiring)', () => {
  it('emits the contact service, routes and README', () => {
    const out = generateContactFormIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/contact/contactService.ts');
    expect(paths).toContain('server/contact/routes.ts');
    expect(paths).toContain('server/contact/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/contact/routes.ts']).toContain('export const contactRouter');
    expect(out.files['server/contact/routes.ts']).toContain('honeypot');
  });
});

// Materialize + execute the emitted domain logic — the validation + honeypot + status rules are real business
// rules, verified against the actual emitted code.
describe('emitted ContactService — validated capture + honeypot spam + status lifecycle (real logic)', () => {
  const emitted = emitModule('contact', CONTACTFORM_SERVICE_SOURCE);
  afterAll(emitted.cleanup);

  type ContactStatus = 'new' | 'read' | 'archived' | 'spam';
  interface ContactMessage { id: string; name: string; email: string; subject: string; message: string; status: ContactStatus; createdAt: string }
  interface Service {
    submit(input: { name: string; email: string; message: string; subject?: string; honeypot?: string }, now?: Date): { accepted: boolean; message: ContactMessage };
    get(id: string): ContactMessage | undefined;
    setStatus(id: string, to: ContactStatus, now?: Date): ContactMessage;
    remove(id: string): boolean;
    list(status?: ContactStatus): ContactMessage[];
    unreadCount(): number;
  }
  interface Emitted { ContactService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ emitted.href)) as unknown as Emitted;
  }

  it('accepts a clean submission as new and validates required fields + email', async () => {
    const { ContactService } = await load();
    const svc = new ContactService();
    const r = svc.submit({ name: 'Asha', email: 'asha@example.com', message: 'Hello there' });
    expect(r.accepted).toBe(true);
    expect(r.message.status).toBe('new');
    expect(svc.unreadCount()).toBe(1);
    expect(() => svc.submit({ name: '', email: 'a@b.com', message: 'x' })).toThrow(/name is required/);
    expect(() => svc.submit({ name: 'A', email: 'not-an-email', message: 'x' })).toThrow(/valid email/);
    expect(() => svc.submit({ name: 'A', email: 'a@b.com', message: '' })).toThrow(/message is required/);
  });

  it('THE INVARIANT: a filled honeypot marks the submission spam (not accepted, hidden from the inbox)', async () => {
    const { ContactService } = await load();
    const svc = new ContactService();
    const bot = svc.submit({ name: 'Bot', email: 'bot@spam.com', message: 'buy now', honeypot: 'gotcha' });
    expect(bot.accepted).toBe(false);        // not accepted
    expect(bot.message.status).toBe('spam');
    svc.submit({ name: 'Real', email: 'real@example.com', message: 'genuine question' });
    // the real inbox hides spam by default
    expect(svc.list().map((m) => m.name)).toEqual(['Real']);
    expect(svc.unreadCount()).toBe(1);        // the spam one is not "new"
    // but it can be listed explicitly
    expect(svc.list('spam').map((m) => m.name)).toEqual(['Bot']);
  });

  it('advances the status lifecycle and rejects illegal transitions', async () => {
    const { ContactService } = await load();
    const svc = new ContactService();
    const { message } = svc.submit({ name: 'A', email: 'a@b.com', message: 'hi' });
    expect(svc.setStatus(message.id, 'read').status).toBe('read');
    expect(svc.unreadCount()).toBe(0); // no longer new
    expect(svc.setStatus(message.id, 'archived').status).toBe('archived');
    expect(() => svc.setStatus(message.id, 'spam')).toThrow(/illegal transition/); // archived can't go straight to spam
    expect(svc.setStatus(message.id, 'read').status).toBe('read'); // archived -> read is allowed
    expect(() => svc.setStatus('nope', 'read')).toThrow(/message not found/);
  });

  it('list filters by status (newest first) and remove works', async () => {
    const { ContactService } = await load();
    const svc = new ContactService();
    const a = svc.submit({ name: 'One', email: 'a@b.com', message: 'first' }, new Date('2026-01-01T00:00:00Z'));
    svc.submit({ name: 'Two', email: 'c@d.com', message: 'second' }, new Date('2026-02-01T00:00:00Z'));
    expect(svc.list().map((m) => m.name)).toEqual(['Two', 'One']); // newest first
    expect(svc.list('new').length).toBe(2);
    expect(svc.remove(a.message.id)).toBe(true);
    expect(svc.remove(a.message.id)).toBe(false);
    expect(svc.list().map((m) => m.name)).toEqual(['Two']);
  });
});
