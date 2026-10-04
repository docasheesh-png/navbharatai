import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppMemoryView } from './AppMemoryCard';

describe('AppMemoryView — what your app does', () => {
  it('renders nothing until the server says there is memory', () => {
    expect(renderToStaticMarkup(<AppMemoryView data={null} />)).toBe('');
    expect(renderToStaticMarkup(<AppMemoryView data={{ available: false }} />)).toBe('');
    expect(renderToStaticMarkup(<AppMemoryView data={{ available: true, requirements: [], openIssues: [], changes: [] }} />)).toBe('');
  });

  it('shows features with their status, open problems, and a change that lost something', () => {
    const html = renderToStaticMarkup(
      <AppMemoryView data={{
        available: true,
        requirements: [{ id: 'REQ-001', label: 'Add / create', status: 'working' }, { id: 'REQ-002', label: 'Delete / remove', status: 'missing' }],
        openIssues: [{ id: 'ISS-001', severity: 'error', message: 'TypeError in Cart', fixing: true }],
        openIssueCount: 1,
        changes: [{ id: 'CHG-0002', ts: 0, summary: 'make the header blue', kind: 'Small visual change', outcome: 'Done, some checks open', lost: 1 }],
      }} />,
    );
    expect(html).toContain('What your app does');
    expect(html).toContain('1/2 seen working · 1 open');
    expect(html).toContain('Missing since the last change');
    expect(html).toContain('being worked on');
    expect(html).toContain('This change lost 1 feature that used to work.');
  });
});
