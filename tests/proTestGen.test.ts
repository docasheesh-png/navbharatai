import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateTests } from '../src/server/pro/ProTestGen';

const mockCallModel = vi.fn();

afterEach(() => { mockCallModel.mockReset(); });

describe('generateTests', () => {
  it('returns empty for a non-TSX/JSX project', async () => {
    const files = {
      'index.html': '<h1>Hello</h1>',
      'style.css': 'body { margin: 0; }',
    };
    const result = await generateTests(files, mockCallModel);
    expect(result).toEqual({});
    expect(mockCallModel).not.toHaveBeenCalled();
  });

  const LONG_APP = `import { useState } from 'react';\nexport default function App() {\n  const [count, setCount] = useState(0);\n  return (<div><h1>App</h1><button onClick={() => setCount(c => c+1)}>{count}</button></div>);\n}`;
  const LONG_BTN = `import { useState } from 'react';\nexport function Button({ label }: { label: string }) {\n  const [active, setActive] = useState(false);\n  return <button className={active?'active':''} onClick={()=>setActive(a=>!a)}>{label}</button>;\n}`;

  it('generates a test file for src/App.tsx and returns it keyed by test path', async () => {
    mockCallModel.mockResolvedValue(
      `import { render, screen } from '@testing-library/react';\n` +
      `import App from './App';\n` +
      `it('renders', () => { render(<App/>); });\n`,
    );
    const files = {
      'src/App.tsx': LONG_APP,
      'package.json': JSON.stringify({ dependencies: { react: '^18' } }),
    };
    const result = await generateTests(files, mockCallModel);
    expect(result['src/App.test.tsx']).toBeDefined();
    expect(result['src/App.test.tsx']).toContain('render');
  });

  it('strips markdown fences from AI output', async () => {
    mockCallModel.mockResolvedValue(
      '```typescript\nimport { render } from "@testing-library/react";\n' +
      'it("ok", () => render(<App/>));\n```',
    );
    const files = { 'src/App.tsx': LONG_APP };
    const result = await generateTests(files, mockCallModel);
    expect(result['src/App.test.tsx']).not.toContain('```');
    expect(result['src/App.test.tsx']).toContain('render');
  });

  it('skips generation when a test file already exists', async () => {
    const files = {
      'src/App.tsx': LONG_APP,
      'src/App.test.tsx': `it('already there', () => {});`,
    };
    const result = await generateTests(files, mockCallModel);
    expect(result).toEqual({});
    expect(mockCallModel).not.toHaveBeenCalled();
  });

  it('returns empty when AI returns a very short response', async () => {
    mockCallModel.mockResolvedValue('ok');
    const files = { 'src/App.jsx': LONG_APP };
    const result = await generateTests(files, mockCallModel);
    expect(result).toEqual({});
  });

  it('falls back gracefully when callModel throws', async () => {
    mockCallModel.mockRejectedValue(new Error('AI unavailable'));
    const files = { 'src/App.tsx': LONG_APP };
    const result = await generateTests(files, mockCallModel);
    expect(result).toEqual({});
  });

  it('prefers App.tsx over other component files', async () => {
    mockCallModel.mockResolvedValue(
      `import { render } from '@testing-library/react';\nit('renders', () => render(<App/>));\n`,
    );
    const files = {
      'src/App.tsx': LONG_APP,
      'src/components/Button.tsx': LONG_BTN,
    };
    const result = await generateTests(files, mockCallModel);
    expect(Object.keys(result)).toHaveLength(1);
    expect(result['src/App.test.tsx']).toBeDefined();
  });
});
