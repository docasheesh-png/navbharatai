import { describe, it, expect } from 'vitest';
import { notificationMatchesUser, normalizeTarget } from '../src/server/lib/AdminNotificationStore';

describe('notificationMatchesUser — who receives a notification', () => {
  it('an "all" broadcast reaches every user', () => {
    expect(notificationMatchesUser({ target: { type: 'all' } }, 'u1', 'a@b.com')).toBe(true);
    expect(notificationMatchesUser({ target: { type: 'all' } }, null, null)).toBe(true);
  });

  it('a user-targeted notification matches by uid', () => {
    expect(notificationMatchesUser({ target: { type: 'user', userId: 'u1' } }, 'u1', 'x@y.com')).toBe(true);
    expect(notificationMatchesUser({ target: { type: 'user', userId: 'u1' } }, 'u2', 'x@y.com')).toBe(false);
  });

  it('a user-targeted notification matches by email, case-insensitively', () => {
    expect(notificationMatchesUser({ target: { type: 'user', email: 'Admin@Test.com' } }, 'u9', 'admin@test.com')).toBe(true);
    expect(notificationMatchesUser({ target: { type: 'user', email: 'a@b.com' } }, 'u9', 'other@b.com')).toBe(false);
  });

  it('a user target with neither uid nor email reaches nobody', () => {
    expect(notificationMatchesUser({ target: { type: 'user' } }, 'u1', 'a@b.com')).toBe(false);
  });
});

describe('normalizeTarget — admin input → clean target', () => {
  it('defaults to an all-broadcast', () => {
    expect(normalizeTarget({})).toEqual({ type: 'all' });
    expect(normalizeTarget({ target: 'all' })).toEqual({ type: 'all' });
    expect(normalizeTarget({ target: '' })).toEqual({ type: 'all' });
  });

  it('a specific-user send carries the email', () => {
    expect(normalizeTarget({ target: 'user', email: 'user@x.com' })).toEqual({ type: 'user', userId: null, email: 'user@x.com' });
  });

  it('an email typed directly into the target field is honoured', () => {
    expect(normalizeTarget({ target: 'someone@x.com' })).toEqual({ type: 'user', userId: null, email: 'someone@x.com' });
  });

  it('carries a userId when provided', () => {
    expect(normalizeTarget({ target: 'user', userId: 'u1' })).toEqual({ type: 'user', userId: 'u1', email: null });
  });
});
