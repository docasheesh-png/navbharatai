import { describe, it, expect } from 'vitest';
import { parseMentions, resolveMentions, type MentionMember } from './MentionRouter';

describe('parseMentions', () => {
  it('extracts distinct handles', () => {
    expect(parseMentions('hey @alice and @bob, also @alice again')).toEqual(['alice', 'bob']);
  });
  it('handles emails and dotted handles', () => {
    expect(parseMentions('ping @jane.doe and @carol@example.com')).toEqual(['jane.doe', 'carol']);
  });
  it('does not treat an email address in prose as a mention (no leading space/@)', () => {
    // "contact me at foo@bar.com" — the @ is preceded by a word char, so not a mention
    expect(parseMentions('contact me at foo@bar.com')).toEqual([]);
  });
  it('trims trailing punctuation', () => {
    expect(parseMentions('thanks @dave!')).toEqual(['dave']);
  });
  it('returns [] for non-strings/empty', () => {
    expect(parseMentions(undefined)).toEqual([]);
    expect(parseMentions('')).toEqual([]);
  });
});

describe('resolveMentions', () => {
  const members: MentionMember[] = [
    { uid: 'u-alice', email: 'alice@corp.com', status: 'active' },
    { uid: 'u-bob', email: 'bob@corp.com', status: 'active' },
    { uid: 'u-old', email: 'old@corp.com', status: 'removed' },
  ];

  it('resolves handles to active members by email local-part', () => {
    const r = resolveMentions('hi @alice and @bob', members);
    expect(r.mentioned.map((m) => m.uid)).toEqual(['u-alice', 'u-bob']);
    expect(r.unresolved).toEqual([]);
  });

  it('resolves a full-email mention', () => {
    const r = resolveMentions('cc @bob@corp.com', members);
    expect(r.mentioned.map((m) => m.uid)).toEqual(['u-bob']);
  });

  it('lists unresolved handles that match no active member', () => {
    const r = resolveMentions('@alice @nobody', members);
    expect(r.mentioned.map((m) => m.uid)).toEqual(['u-alice']);
    expect(r.unresolved).toEqual(['nobody']);
  });

  it('never resolves to a removed/inactive member', () => {
    const r = resolveMentions('@old please review', members);
    expect(r.mentioned).toEqual([]);
    expect(r.unresolved).toEqual(['old']);
  });

  it('dedupes when a member is mentioned twice', () => {
    const r = resolveMentions('@alice @alice@corp.com', members);
    expect(r.mentioned).toHaveLength(1);
  });

  it('is empty when there are no mentions', () => {
    expect(resolveMentions('no mentions here', members)).toEqual({ mentioned: [], unresolved: [] });
  });
});
