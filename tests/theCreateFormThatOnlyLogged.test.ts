// Autopsy BR1959 (2026-11-09). The school app's App.tsx routed /students/new, /teachers/new, /courses/new …
// to forms whose `onSubmit` only did `console.log('Create student:', student); // In a real app, this would
// call the API`, and its logout only logged. The authenticity scan reported ONE empty handler for the whole
// file: it stopped at the first, and it did not recognise `}}` — the close of a handler written inline as a
// JSX attribute — as the end of a body. These hold the scan's two halves.

import { describe, it, expect } from 'vitest';
import { scanAuthenticity } from '../src/server/AgentV3/AuthenticityAnalysis';

// The captured head of BR1959's App.tsx, from the logout handler through the first create/edit routes.
const APP = `const App: React.FC = () => {
  const handleLogout = () => {
    // In a real app, this would clear auth tokens and redirect to login
    console.log('Logging out...');
  };

  return (
    <Router>
      <Routes>
        <Route path="/students/new" element={
          <ProtectedRoute allowedRoles={['admin']}>
            <StudentForm 
              onSubmit={(student) => {
                console.log('Create student:', student);
                // In a real app, this would call the API
              }}
              onCancel={() => window.history.back()}
            />
          </ProtectedRoute>
        } />
        <Route path="/students/:id/edit" element={
          <ProtectedRoute allowedRoles={['admin']}>
            <StudentForm 
              onSubmit={(student) => {
                console.log('Update student:', student);
                // In a real app, this would call the API
              }}
              onCancel={() => window.history.back()}
            />
          </ProtectedRoute>
        } />
        <Route path="/teachers/new" element={<TeacherForm onSubmit={(t) => {
          console.log('Create teacher:', t);
        }} />} />
      </Routes>
    </Router>
  );
};
`;

const empties = (file: string, content: string) => scanAuthenticity(file, content).filter((i) => i.kind === 'empty-handler');

describe('every handler that only logs is found', () => {
  it('BR1959: the logout AND each inline create/edit submit are reported, each at its own line', () => {
    const found = empties('src/App.tsx', APP);
    expect(found.map((f) => f.snippet)).toEqual([
      "console.log('Logging out...');",
      "console.log('Create student:', student);",
      "console.log('Update student:', student);",
      "console.log('Create teacher:', t);",
    ]);
    expect(new Set(found.map((f) => f.line)).size).toBe(4);
    expect(found.every((f) => f.severity === 'medium')).toBe(true);
  });

  it('every closing form of an inline handler counts: }}  }}>  }} />  }} />} />  },', () => {
    for (const close of ['}}', '}}>', '}} />', '}} />} />', '},', '});']) {
      const src = `<Form onSubmit={(x) => {\n  console.log('Save', x);\n${close}\n`;
      expect(empties('src/F.tsx', src).length, close).toBe(1);
    }
  });

  it('a handler that does real work, and a guard whose body only logs, are still not flagged', () => {
    const real = `<Form onSubmit={(s) => {\n  console.log('Create', s);\n  createStudent(s);\n}}\n/>\n`;
    expect(empties('src/F.tsx', real)).toEqual([]);
    const guard = `function f(x: number) {\n  if (x > 1) {\n    console.log('big');\n  }\n  return x;\n}\n`;
    expect(empties('src/g.ts', guard)).toEqual([]);
  });
});
