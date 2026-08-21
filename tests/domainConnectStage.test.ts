import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { connectStage } from '../src/components/agentv3/NbaiDomainConnect';

/**
 * "AB KYA KARNA HAI?" (admin 2026-08-09, after adding the records: "connect karne ka button hi nahi
 * hai?"). Two defects produced that: the status bar + its Check button sat BELOW the records, the
 * automatic-setup block and the registrar picker — three phone-screens down, so the one needed
 * action was invisible; and the message itself was engineering vocabulary ("ownership:
 * OWNERSHIP_PENDING, host: HOST_PENDING") that cannot tell a non-technical user whose move it is.
 */

const st = (o: Partial<{ active: boolean; ownershipState: string; hostState: string; sslState: string }>) => ({
  active: false, ownershipState: 'OWNERSHIP_PENDING', hostState: 'HOST_PENDING', sslState: 'CERT_PENDING', ...o,
});

describe('connectStage — one plain sentence and the one next action', () => {
  it('records not yet visible to DNS: says we are waiting, offers Check, and reassures', () => {
    const s = connectStage(st({}));
    expect(s.action).toBe('check');
    expect(s.headline).toContain('spread across the internet');
    expect(s.note).toContain('nothing is lost');
    expect(s.headline).not.toMatch(/OWNERSHIP|HOST_|CERT_/); // never raw API vocabulary
  });

  it('ownership confirmed, host still pending: says exactly that — progress is visible', () => {
    const s = connectStage(st({ ownershipState: 'OWNERSHIP_ACTIVE' }));
    expect(s.headline).toContain('Ownership confirmed');
    expect(s.action).toBe('check');
  });

  it('host up, certificate pending: names the certificate step honestly', () => {
    const s = connectStage(st({ ownershipState: 'OWNERSHIP_ACTIVE', hostState: 'HOST_ACTIVE' }));
    expect(s.headline).toContain('HTTPS certificate');
    expect(s.action).toBe('check');
  });

  it('active: drops the Check button, and names the ONE remaining user step', () => {
    // ⚠️ The `Live!` this used to assert was the bug (admin screenshot, 2026-08-21). DNS + certificate
    // active is not evidence the domain SHOWS THE APP — the screen printed "Live!" directly above a
    // browser tab showing "Site Not Found" on that same domain. With no serving verdict, "Connected"
    // is the most that can honestly be said, and the note still names the step that fixes it.
    const s = connectStage(st({ active: true, ownershipState: 'OWNERSHIP_ACTIVE', hostState: 'HOST_ACTIVE', sslState: 'CERT_ACTIVE' }));
    expect(s.headline).toContain('Connected');
    expect(s.headline).not.toContain('Live!');
    expect(s.action).toBe('none');
    expect(s.note).toContain('Publish');
  });

  it('…and the word "Live" IS earned once a check actually saw the app serving', () => {
    const s = connectStage(st({
      active: true, ownershipState: 'OWNERSHIP_ACTIVE', hostState: 'HOST_ACTIVE', sslState: 'CERT_ACTIVE',
      serving: { state: 'serving', note: '' },
    } as never));
    expect(s.headline).toContain('Live!');
    expect(s.action).toBe('none');
  });

  it('never claims done from the sub-states alone — only the API\'s own `active` flag does', () => {
    // All three sub-states ACTIVE but active=false (the API has not settled): still not "Live".
    const s = connectStage(st({ ownershipState: 'OWNERSHIP_ACTIVE', hostState: 'HOST_ACTIVE', sslState: 'CERT_ACTIVE' }));
    expect(s.headline).not.toContain('Live!');
  });
});

describe('the page shows state and action FIRST', () => {
  const src = readFileSync(join(__dirname, '..', 'src/components/agentv3/NbaiDomainConnect.tsx'), 'utf8');

  it('the status block sits above the records list, not below the whole page', () => {
    const status = src.indexOf('const stage = connectStage(result)');
    const records = src.indexOf('Add these DNS records at your registrar');
    expect(status).toBeGreaterThan(-1);
    expect(status).toBeLessThan(records);
  });

  it('the primary Check is a real button, and the raw states are demoted to dim detail', () => {
    expect(src).toContain("{checking ? 'Checking…' : 'Check now'}");
    expect(src).toContain('bg-indigo-600 hover:bg-indigo-500'); // prominent, not a faint pill
    expect(src).toContain('ownership: {short(result.ownershipState)}');
    // The old jargon headline must never return.
    expect(src).not.toContain('Pending — add the records, then check.');
  });

  it('both Check buttons call the SAME handler — one implementation of the action', () => {
    expect(src.split('onClick={checkStatus}').length - 1).toBe(2);
  });
});
