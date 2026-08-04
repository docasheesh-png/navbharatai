import { describe, it, expect } from 'vitest';
import { wireOrphanPages } from './orphanPageWiring';

const ROUTER = `import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import DashboardPage from './pages/DashboardPage';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
      </Routes>
    </Layout>
  );
}
`;

function base(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'src/App.tsx': ROUTER,
    'src/components/Layout.tsx': 'export default function Layout(p){return p.children;}',
    'src/pages/DashboardPage.tsx': 'export default function DashboardPage(){return null;}',
    ...extra,
  };
}

describe('wireOrphanPages — the build 6f87751d defect (pages created but never routed)', () => {
  it('wires each orphaned page into <Routes> with an import + a <Route>', () => {
    const files = base({
      'src/pages/AnalyticsPage.tsx': 'export default function AnalyticsPage(){return null;}',
      'src/pages/ApiKeysPage.tsx': 'export default function ApiKeysPage(){return null;}',
      'src/pages/AuditLogPage.tsx': 'export default function AuditLogPage(){return null;}',
    });
    const r = wireOrphanPages(files);
    expect(r.wired.length).toBe(3);
    const app = r.files['src/App.tsx'];
    // imports added
    expect(app).toMatch(/import AnalyticsPage from '\.\/pages\/AnalyticsPage';/);
    expect(app).toMatch(/import ApiKeysPage from '\.\/pages\/ApiKeysPage';/);
    // routes added with sensible kebab paths
    expect(app).toMatch(/<Route path="\/analytics" element=\{<AnalyticsPage \/>\} \/>/);
    expect(app).toMatch(/<Route path="\/api-keys" element=\{<ApiKeysPage \/>\} \/>/);
    expect(app).toMatch(/<Route path="\/audit-log" element=\{<AuditLogPage \/>\} \/>/);
    // the pre-existing route is untouched
    expect(app).toMatch(/<Route path="\/" element=\{<DashboardPage \/>\} \/>/);
  });

  it('makes the orphan disappear (the page file is now imported → readiness no longer flags it)', () => {
    const files = base({ 'src/pages/AnalyticsPage.tsx': 'export default function AnalyticsPage(){return null;}' });
    const r = wireOrphanPages(files);
    // second pass over the healed files finds nothing left to wire (imported now)
    const second = wireOrphanPages(r.files);
    expect(second.wired).toEqual([]);
  });

  it('is idempotent — running it again changes nothing', () => {
    const files = base({ 'src/pages/SettingsPage.tsx': 'export default function SettingsPage(){return null;}' });
    const once = wireOrphanPages(files);
    const twice = wireOrphanPages(once.files);
    expect(twice.files['src/App.tsx']).toBe(once.files['src/App.tsx']);
  });

  it('supports a NAMED export (import { X })', () => {
    const files = base({ 'src/pages/BillingPage.tsx': 'export function BillingPage(){return null;}' });
    const r = wireOrphanPages(files);
    expect(r.files['src/App.tsx']).toMatch(/import \{ BillingPage \} from '\.\/pages\/BillingPage';/);
  });

  it('never collides with an existing route path', () => {
    // a page whose derived path "/" would collide with the existing index route
    const files = base({ 'src/pages/HomePage.tsx': 'export default function HomePage(){return null;}' });
    // Home → /home (not /), so no collision here; assert it did not overwrite "/"
    const r = wireOrphanPages(files);
    const app = r.files['src/App.tsx'];
    expect(app).toMatch(/<Route path="\/home" element=\{<HomePage \/>\} \/>/);
    expect((app.match(/path="\/"/g) || []).length).toBe(1); // the original index route still unique
  });
});

describe('wireOrphanPages — SAFE: never touches a working / ambiguous app (no-op)', () => {
  it('no-op when there is no <Routes> (not a react-router app)', () => {
    const files = {
      'src/App.tsx': 'export default function App(){return <div>hi</div>;}',
      'src/pages/AnalyticsPage.tsx': 'export default function AnalyticsPage(){return null;}',
    };
    expect(wireOrphanPages(files).wired).toEqual([]);
    expect(wireOrphanPages(files).files['src/App.tsx']).toBe(files['src/App.tsx']);
  });

  it('no-op when the router is ambiguous (two files contain <Routes>)', () => {
    const files = base({
      'src/Other.tsx': `import { Routes, Route } from 'react-router-dom';\n<Routes></Routes>`,
      'src/pages/AnalyticsPage.tsx': 'export default function AnalyticsPage(){return null;}',
    });
    expect(wireOrphanPages(files).wired).toEqual([]);
  });

  it('does NOT wire a page that is already imported/used', () => {
    const files = base(); // DashboardPage is imported + routed already
    expect(wireOrphanPages(files).wired).toEqual([]);
  });

  it('does not treat a shared non-page component as a page', () => {
    const files = base({ 'src/components/Button.tsx': 'export function Button(){return null;}' });
    // Button is a component but not a page and not imported — must NOT be wired as a route
    expect(wireOrphanPages(files).wired).toEqual([]);
  });
});
