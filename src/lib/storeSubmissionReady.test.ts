import { describe, it, expect } from 'vitest';
import {
  storeSubmissionProblems, isStoreSubmissionReady, storeSubmissionBlockedReason,
  MIN_DESCRIPTION, type StoreSubmissionForm,
} from './storeSubmissionReady';

const complete: StoreSubmissionForm = {
  appName: 'calculator',
  shortDescription: 'simple calculation',
  description: 'A simple calculator app that adds, subtracts, multiplies and divides.',
  developerName: 'dr asheesh',
  developerEmail: 'aashishcpmt09@gmail.com',
  acceptedTerms: true,
};

describe('THE EXACT FORM THE ADMIN REPORTED AS BROKEN', () => {
  // Reproduced field-for-field from the screenshot. The form LOOKS complete — every box has text and
  // the consent is ticked — and the button was dead with no reason given anywhere on screen.
  const reported: StoreSubmissionForm = {
    appName: 'calculator',
    shortDescription: 'simple calculation',
    description: 'navbharatai product',        // 19 chars, needs 30
    developerName: 'dr asheesh',
    developerEmail: 'aashishcpmt09',           // a username, not an email
    acceptedTerms: true,
  };

  it('is genuinely not submittable — the validation was right', () => {
    expect(isStoreSubmissionReady(reported)).toBe(false);
  });

  it('names BOTH real problems, so the user is not left guessing', () => {
    const fields = storeSubmissionProblems(reported).map((p) => p.field);
    expect(fields).toEqual(['description', 'developerEmail']);
  });

  it('says how much more description is needed, not just "too short"', () => {
    const msg = storeSubmissionProblems(reported).find((p) => p.field === 'description')!.message;
    expect(msg).toContain(String(MIN_DESCRIPTION));
    expect(msg).toContain('11 more');   // 30 − 19
  });

  it('explains the email in the terms of the mistake actually made', () => {
    // "Invalid email" tells somebody who typed their username nothing. Naming the @ and the domain does.
    const msg = storeSubmissionProblems(reported).find((p) => p.field === 'developerEmail')!.message;
    expect(msg).toMatch(/@/);
    expect(msg).toMatch(/domain/i);
  });

  it('surfaces one specific next step under the button, with a count of what follows', () => {
    const reason = storeSubmissionBlockedReason(reported);
    expect(reason).toContain('full description');
    expect(reason).toContain('1 more to fix');
  });
});

describe('a complete form is ready and silent', () => {
  it('has no problems and no blocked reason', () => {
    expect(isStoreSubmissionReady(complete)).toBe(true);
    expect(storeSubmissionProblems(complete)).toEqual([]);
    expect(storeSubmissionBlockedReason(complete)).toBe('');
  });
});

describe('each rule, on its own', () => {
  const missing = (over: Partial<StoreSubmissionForm>) =>
    storeSubmissionProblems({ ...complete, ...over }).map((p) => p.field);

  it('catches every field the server would reject', () => {
    expect(missing({ appName: 'a' })).toEqual(['appName']);
    expect(missing({ shortDescription: 'short' })).toEqual(['shortDescription']);
    expect(missing({ description: 'too short' })).toEqual(['description']);
    expect(missing({ developerName: 'x' })).toEqual(['developerName']);
    expect(missing({ acceptedTerms: false })).toEqual(['acceptedTerms']);
  });

  it('rejects the email shapes people actually type', () => {
    for (const bad of ['aashishcpmt09', 'a@b', 'a@b.c', 'no at sign.com', '@nouser.com', 'spaces in@mail.com', '']) {
      expect(missing({ developerEmail: bad }), bad).toEqual(['developerEmail']);
    }
  });

  it('accepts ordinary real addresses', () => {
    for (const ok of ['a@b.co', 'dr.asheesh+store@gmail.com', 'x_y@sub.domain.in']) {
      expect(missing({ developerEmail: ok }), ok).toEqual([]);
    }
  });

  it('does not count whitespace as content', () => {
    // A form of spaces looks filled in and is not. This is the same class as the reported bug.
    expect(missing({ description: ' '.repeat(50) })).toEqual(['description']);
    expect(missing({ appName: '   ' })).toEqual(['appName']);
  });

  it('reports problems in form order, so the user is sent to the first one', () => {
    const all = storeSubmissionProblems({
      appName: '', shortDescription: '', description: '', developerName: '', developerEmail: '', acceptedTerms: false,
    }).map((p) => p.field);
    expect(all).toEqual(['appName', 'shortDescription', 'description', 'developerName', 'developerEmail', 'acceptedTerms']);
  });

  it('never throws on a junk form', () => {
    expect(() => storeSubmissionProblems({} as StoreSubmissionForm)).not.toThrow();
    expect(isStoreSubmissionReady({} as StoreSubmissionForm)).toBe(false);
  });
});
