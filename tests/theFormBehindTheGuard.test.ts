// Autopsy BR1959 (2026-11-09). The school app wrapped every route's element in its guard:
//   <Route path="/classes/new" element={ <ProtectedRoute allowedRoles={['admin']}> <ClassForm … /> </ProtectedRoute> } />
// `routeFromRouter` only read an element that IS the page, so no file mapped to any route of this app: the
// list pages were found by their file names by luck, and a form file fell back to `/`, where it is not.

import { describe, it, expect } from 'vitest';
import { routeFromRouter, routeForFile } from '../src/server/AgentV3/journeyDerivation';

// The BR1959 router shape, as captured (multi-line guarded elements, an inline submit handler).
const APP = `import ClassForm from './components/ClassForm';
import Classes from './pages/Classes';
import { Settings as SettingsPage } from './pages/Settings';
export default function App() {
  return (
    <Routes>
            <Route path="/classes" element={
              <ProtectedRoute allowedRoles={['admin', 'teacher']}>
                <Classes />
              </ProtectedRoute>
            } />
            <Route path="/classes/new" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <ClassForm 
                  onSubmit={(classSchedule) => {
                    console.log('Create class schedule:', classSchedule);
                  }}
                  onCancel={() => window.history.back()}
                />
              </ProtectedRoute>
            } />
            <Route path="/settings" element={<RequireAuth><Shell title="Settings"><SettingsPage /></Shell></RequireAuth>} />
    </Routes>
  );
}
`;
const FILES: Record<string, string> = {
  'src/App.tsx': APP,
  'src/components/ClassForm.tsx': 'export default function ClassForm() { return <form><input name="name" /></form>; }\n',
  'src/pages/Classes.tsx': 'export default function Classes() { return <div />; }\n',
  'src/pages/Settings.tsx': 'export function Settings() { return <form><input name="theme" /></form>; }\n',
};

describe('a page rendered inside a route guard is that route\'s page', () => {
  it('BR1959: the guarded form maps to /classes/new and the guarded list to /classes — from the router, not the file name', () => {
    expect(routeFromRouter('src/components/ClassForm.tsx', FILES)).toBe('/classes/new');
    expect(routeFromRouter('src/pages/Classes.tsx', FILES)).toBe('/classes');
    expect(routeForFile('src/components/ClassForm.tsx', ['/classes', '/classes/new'], FILES)).toBe('/classes/new');
  });

  it('nested wrappers and an aliased import resolve too', () => {
    expect(routeFromRouter('src/pages/Settings.tsx', FILES)).toBe('/settings');
  });

  it('a component rendered BESIDE the page, or only passed as a prop, is not the route\'s page', () => {
    const files = {
      'src/App.tsx': "import Banner from './Banner';\nimport Home from './Home';\nexport default () => <Routes><Route path=\"/home\" element={<Layout><Home /><Banner /></Layout>} /><Route path=\"/x\" element={<Guard onDenied={() => <Banner />}><Home /></Guard>} /></Routes>;\n",
      'src/Banner.tsx': 'export default () => <p />;\n',
      'src/Home.tsx': 'export default () => <main />;\n',
    };
    expect(routeFromRouter('src/Banner.tsx', files)).toBeNull();
    expect(routeFromRouter('src/Home.tsx', files)).toBe('/home');
  });
});
