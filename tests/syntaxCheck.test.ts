import { describe, it, expect } from 'vitest';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';
import { checkSyntax } from '../src/server/project/SyntaxCheck';

describe('checkSyntax', () => {
  it('flags malformed JSX (the unclosed-Router / Unterminated JSX failure)', async () => {
    const vfs = VirtualFileSystem.fromRecord({
      'src/main.tsx': "import {createRoot} from 'react-dom/client';\nimport App from './App';\ncreateRoot(document.getElementById('root')!).render(\n  <React.StrictMode>\n    <HashRouter>\n      <App />\n    </React.StrictMode>,\n)",
    });
    const issues = await checkSyntax(vfs);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].file).toBe('src/main.tsx');
    expect(issues[0].severity).toBe('error');
  });

  it('passes clean TSX', async () => {
    const vfs = VirtualFileSystem.fromRecord({
      'src/App.tsx': 'export default function App() {\n  return <h1>Hi</h1>;\n}',
      'src/main.tsx': "import {createRoot} from 'react-dom/client';\nimport App from './App';\ncreateRoot(document.getElementById('root')!).render(<App />)",
      'src/types.ts': 'export interface User { id: string; name: string }',
    });
    expect(await checkSyntax(vfs)).toEqual([]);
  });

  it('ignores non-source files', async () => {
    const vfs = VirtualFileSystem.fromRecord({ 'index.html': '<div', 'data.json': '{}', 'style.css': 'body{' });
    expect(await checkSyntax(vfs)).toEqual([]);
  });
});
