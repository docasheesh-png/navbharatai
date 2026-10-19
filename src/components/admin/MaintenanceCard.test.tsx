import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MaintenanceCard } from './MaintenanceCard';
describe('Maintenance card', () => {
  it('shows an unknown status until loaded and cannot toggle an unread setting', () => {
    const html = renderToStaticMarkup(<MaintenanceCard adminToken="test" />);
    expect(html).toContain('Maintenance');
    expect(html).toContain('Checking status');
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).not.toContain('OFF — AI service running');
    expect(html).toContain('Calls already sent may still have a cost');
  });
});
