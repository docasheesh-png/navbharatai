import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { StoreReviewAccess } from './StoreReviewAccess';

const render = (loading: boolean, isAdmin: boolean, problem: string | null) => renderToStaticMarkup(
  <StoreReviewAccess loading={loading} isAdmin={isAdmin} problem={problem} onRetry={() => undefined} onAdminLogin={() => undefined} />,
);
describe('review access is visible without granting authority', () => {
  it('shows pending status instead of an empty review body', () => {
    expect(render(true, false, null)).toContain('Checking your App Mart admin access');
  });
  it('explains a refused session and offers recovery', () => {
    const html = render(false, false, null);
    expect(html).toContain('does not have App Mart moderation access');
    expect(html).toContain('Retry access check');
    expect(html).toContain('Open Admin Panel');
  });
  it('shows transport/server errors even if a previous session was an admin', () => {
    expect(render(false, true, 'Could not verify access')).toContain('Could not verify access');
  });
  it('does not obstruct verified moderation', () => {
    expect(render(false, true, null)).toBe('');
  });
  it('keeps review content server-authorized and wires an independent access state', () => {
    const source = readFileSync('src/components/ide/NavAppStore.tsx', 'utf8');
    expect(source).toContain('<StoreReviewAccess loading={statusLoading}');
    expect(source).toContain("tab === 'review' && status?.isAdmin && reviewSection === null");
    expect(source).toContain('request !== statusRequestRef.current');
    expect(source).toContain('signal: controller.signal');
    expect(source).toContain("tab === 'review' && !statusLoading && status?.isAdmin");
    expect(source.match(/generation === statusRequestRef.current/g)).toHaveLength(3);
    expect(source).toContain('Retry access and lists');
    expect(source).toContain('!pendingRes.ok || !approvedRes.ok');
    expect(source).toContain('!reqRes.ok || !liveRes.ok');
    expect(source).toContain('setStatusProblem(\'Could not verify store access.');
  });
});
