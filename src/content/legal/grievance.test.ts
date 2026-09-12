// The grievance page's one job is to be TRUE. These tests pin the two ways it could quietly stop
// being true: an invented officer, and a page that promises something the platform cannot do.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  grievanceDoc, grievanceOfficerFrom, officerIsNamed, GRIEVANCE_FALLBACK_EMAIL, GRIEVANCE_PATH,
  ACK_HOURS, RESOLVE_DAYS, URGENT_REMOVAL_HOURS, OFFICER_MISSING_WARNING,
} from './grievance';

describe('🔒 a Grievance Officer is never invented', () => {
  it('an unset name stays empty — the law wants a real person, not a plausible one', () => {
    expect(grievanceOfficerFrom(null).name).toBe('');
    expect(grievanceOfficerFrom({}).name).toBe('');
    expect(grievanceOfficerFrom({ name: '   ' }).name).toBe('');
    expect(grievanceOfficerFrom({ name: 42 }).name).toBe('');
  });

  it('the unconfigured page names the ROLE and says the name is being appointed', () => {
    const body = grievanceDoc(grievanceOfficerFrom(null));
    expect(body).toContain('Grievance Officer, NavBharatAI');
    expect(body.toLowerCase()).toContain('being appointed');
    // And it still gives a working address — a page with no way to complain is the worse failure.
    expect(body).toContain(GRIEVANCE_FALLBACK_EMAIL);
  });

  it('a configured officer is named, and the "being appointed" note disappears', () => {
    const body = grievanceDoc(grievanceOfficerFrom({ name: 'A. Sharma', email: 'g@navbharatai.com' }));
    expect(body).toContain('A. Sharma');
    expect(body).toContain('g@navbharatai.com');
    expect(body.toLowerCase()).not.toContain('being appointed');
  });

  it('the source file contains no person-shaped default anywhere', () => {
    // The whole risk this file carries is a placeholder name surviving into production. There is
    // exactly one name-shaped string allowed in here: none.
    const src = readFileSync(join(__dirname, 'grievance.ts'), 'utf8');
    for (const placeholder of ['John Doe', 'Your Name', 'Officer Name', 'TBD', 'XXXX', 'Full Name']) {
      expect(src).not.toContain(placeholder);
    }
  });

  it('a malformed email falls back to the published address instead of printing junk', () => {
    for (const bad of ['not-an-email', '', '  ', 'a@b', 42, null]) {
      expect(grievanceOfficerFrom({ email: bad }).email).toBe(GRIEVANCE_FALLBACK_EMAIL);
    }
    expect(grievanceOfficerFrom({ email: ' g@navbharatai.com ' }).email).toBe('g@navbharatai.com');
  });

  it('officerIsNamed is what the admin warning keys on', () => {
    expect(officerIsNamed(grievanceOfficerFrom(null))).toBe(false);
    expect(officerIsNamed(grievanceOfficerFrom({ name: 'A. Sharma' }))).toBe(true);
    expect(officerIsNamed(null)).toBe(false);
  });

  it('the admin warning names the consequence and the exact key to set', () => {
    // "Not configured" gets ignored; "the law requires this and we are not meeting it" does not.
    expect(OFFICER_MISSING_WARNING).toContain('GRIEVANCE_OFFICER_NAME');
    expect(OFFICER_MISSING_WARNING).toContain('IT Rules');
    expect(OFFICER_MISSING_WARNING).toContain(GRIEVANCE_FALLBACK_EMAIL);
  });
});

describe('the page states the timelines the Rules actually set', () => {
  const body = grievanceDoc(grievanceOfficerFrom({ name: 'A. Sharma' }));
  /**
   * Markdown wraps at the source's line width, so a phrase can legitimately straddle a newline.
   * Asserting against the raw string would make a REWRAP break a test about CONTENT — a false
   * failure that teaches people to loosen the assertion. Normalise whitespace, keep the claim.
   */
  const flat = body.replace(/\s+/g, ' ');

  it('24-hour acknowledgement, 15-day resolution, 24-hour urgent removal, 36-hour court order', () => {
    expect(ACK_HOURS).toBe(24);
    expect(RESOLVE_DAYS).toBe(15);
    expect(URGENT_REMOVAL_HOURS).toBe(24);
    expect(body).toContain(`${ACK_HOURS} hours`);
    expect(body).toContain(`${RESOLVE_DAYS} days`);
    expect(body).toContain('36 hours');
  });

  it('promises the 180-day record the Rules require for investigation', () => {
    expect(body).toContain('180 days');
  });

  it('states the zero-tolerance CSAM path, including that it does not wait for a complaint', () => {
    expect(body).toContain('67B');
    expect(body).toContain('POCSO');
    expect(body.toLowerCase()).toContain('zero tolerance');
  });

  it('gives the reader a route past us — the Board and the Appellate Committee', () => {
    expect(flat).toContain('Data Protection Board of India');
    expect(flat).toContain('Grievance Appellate Committee');
  });

  it('🔒 claims no obligation we do not actually carry', () => {
    // We are far below the "significant social media intermediary" threshold, and claiming that
    // status would be a statement to a regulator that our systems do not back.
    expect(flat).toContain('significant social media intermediary');
    expect(flat.toLowerCase()).toContain('below the user threshold');
  });

  it('points at the two documents a complainant will need next', () => {
    expect(body).toContain('/terms');
    expect(body).toContain('/privacy');
  });
});

describe('wiring — a complaint route nobody can find is not a complaint route', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

  it('the canonical path is published and registered as a public URL', () => {
    expect(GRIEVANCE_PATH).toBe('/grievance');
    expect(read('server/lib/legalPaths.ts')).toContain("'/grievance': 'legal_grievance'");
  });

  it('the Privacy Policy and the Terms both link to it', () => {
    expect(read('content/legal/privacyPolicy.ts')).toContain('(/grievance)');
    expect(read('content/legal/termsOfService.ts')).toContain('(/grievance)');
  });

  it('the public route builds the CONFIGURED document, not the registry fallback', () => {
    // The registry copy names no person on purpose; serving it publicly would mean the page a
    // regulator reads is permanently the unconfigured one.
    const route = read('server/routes/legal.ts');
    expect(route).toContain('grievanceDoc(grievanceOfficer())');
  });

  it('the officer reaches the in-app page too, so one page cannot say two things', () => {
    expect(read('server/routes/health.ts')).toContain('grievance: grievanceOfficerFrom');
    expect(read('components/panels/LegalDocPage.tsx')).toContain("docId === 'legal_grievance'");
  });

  it('the admin is told, on the Monitor, while it is unfinished', () => {
    expect(read('server/routes/admin.ts')).toContain('grievanceOfficerNamed');
    expect(read('components/admin/MonitorPanels.tsx')).toContain('Grievance Officer not named');
  });
});
