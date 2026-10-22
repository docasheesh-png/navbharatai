import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { UserBuiltApps } from './UserBuiltApps';

describe('the apps a user built, on their profile', () => {
  it('renders its heading and an honest loading line before the read lands (never "no apps")', () => {
    const html = renderToStaticMarkup(<UserBuiltApps uid={'u'.repeat(28)} headers={{ 'x-admin-token': 't' }} />);
    expect(html).toContain('Apps built by this user');
    expect(html).toContain('Loading apps');
    expect(html).not.toContain('has not built any apps');
  });
  it('is mounted in the account sheet, and shares ONE preview with the Apps page', () => {
    const dash = readFileSync('src/components/AdminDashboard.tsx', 'utf8');
    expect(dash).toContain('<UserBuiltApps uid={account.uid} headers={headers} />');
    expect(readFileSync('src/components/admin/BuiltAppsPanel.tsx', 'utf8')).toContain('useAppPreview(headers)');
    expect(readFileSync('src/components/admin/UserBuiltApps.tsx', 'utf8')).toContain('useAppPreview(headers)');
  });
  it('a failed or unsearchable read is said, not shown as an empty list', () => {
    const src = readFileSync('src/components/admin/UserBuiltApps.tsx', 'utf8');
    expect(src).toMatch(/d\.ok === false/);
    expect(src).toContain("d.mode !== 'owner'");
  });
});
