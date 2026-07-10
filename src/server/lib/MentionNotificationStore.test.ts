import { describe, it, expect } from 'vitest';
import { buildMentionNotification, deliverMentions, MAX_NOTIF_TEXT } from './MentionNotificationStore';
import type { MentionMember } from './MentionRouter';

// T1-mention-inbox: the pure delivery logic (resolution → per-recipient notifications). No Firestore.

const members: MentionMember[] = [
  { uid: 'u-alice', email: 'alice@x.com', status: 'active' },
  { uid: 'u-bob', email: 'bob@x.com', status: 'active' },
  { uid: 'u-carol', email: 'carol@x.com', status: 'invited' }, // not active
];

describe('buildMentionNotification', () => {
  it('builds a valid unread notification, truncating the excerpt', () => {
    const n = buildMentionNotification({ id: 'n1', uid: 'u-alice', text: 'x'.repeat(MAX_NOTIF_TEXT + 50), fromEmail: 'bob@x.com', teamId: 't1', now: 5 });
    expect(n).not.toBeNull();
    expect(n!.read).toBe(false);
    expect(n!.kind).toBe('mention');
    expect(n!.text.length).toBe(MAX_NOTIF_TEXT);
    expect(n!.createdAt).toBe(5);
  });

  it('returns null without a recipient or team', () => {
    expect(buildMentionNotification({ id: 'n1', uid: '', text: 'hi', fromEmail: 'b', teamId: 't1', now: 1 })).toBeNull();
    expect(buildMentionNotification({ id: 'n1', uid: 'u', text: 'hi', fromEmail: 'b', teamId: '', now: 1 })).toBeNull();
  });
});

describe('deliverMentions', () => {
  const opts = (fromUid: string) => ({ fromUid, fromEmail: 'me@x.com', teamId: 't1', now: 10, idFor: (i: number) => `n${i}` });

  it('creates one notification per DISTINCT active mentioned member', () => {
    const ns = deliverMentions('hey @alice and @bob please look', members, opts('u-me'));
    expect(ns.map((n) => n.uid).sort()).toEqual(['u-alice', 'u-bob']);
    expect(ns.every((n) => n.text.includes('@alice'))).toBe(true);
    expect(ns.map((n) => n.id)).toEqual(['n0', 'n1']); // stable ids
  });

  it('does NOT notify the sender for tagging themselves', () => {
    const ns = deliverMentions('note to @alice from @bob', members, opts('u-bob'));
    expect(ns.map((n) => n.uid)).toEqual(['u-alice']); // bob (the sender) excluded
  });

  it('ignores mentions of non-active or unknown members', () => {
    const ns = deliverMentions('@carol @nobody @alice', members, opts('u-me'));
    expect(ns.map((n) => n.uid)).toEqual(['u-alice']); // carol invited, nobody unknown
  });

  it('returns [] when there are no mentions', () => {
    expect(deliverMentions('just a plain message', members, opts('u-me'))).toEqual([]);
  });
});
