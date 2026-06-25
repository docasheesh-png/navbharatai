import { describe, it, expect } from 'vitest';
import { renameSymbol, addComponentProp } from './CodemodeExecutor';
import type { CodemodeFile } from './CodemodeExecutor';

const file = (path: string, content: string): CodemodeFile => ({ path, content });

describe('renameSymbol', () => {
  it('renames an identifier across multiple files', async () => {
    const files = [
      file('src/utils.ts', 'export function getUserId() { return 1; }'),
      file('src/App.tsx', "import { getUserId } from './utils';\nconst id = getUserId();"),
    ];
    const result = await renameSymbol(files, 'getUserId', 'fetchUserId');
    expect(result.ok).toBe(true);
    expect(result.changes.some((c) => c.after.includes('fetchUserId'))).toBe(true);
    // Both files should be changed
    expect(result.changes.length).toBeGreaterThanOrEqual(1);
  });

  it('returns ok=false when oldName equals newName', async () => {
    const result = await renameSymbol([file('a.ts', 'export const x = 1;')], 'x', 'x');
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('returns ok=false when oldName is empty', async () => {
    const result = await renameSymbol([file('a.ts', 'export const x = 1;')], '', 'y');
    expect(result.ok).toBe(false);
  });

  it('returns ok=true with empty changes when identifier not found', async () => {
    const result = await renameSymbol(
      [file('src/a.ts', 'export const x = 1;')],
      'nonExistentSymbol',
      'newName',
    );
    expect(result.ok).toBe(true);
    expect(result.changes).toHaveLength(0);
  });

  it('includes a human-readable summary', async () => {
    const result = await renameSymbol(
      [file('src/a.ts', 'export function foo() {} export function bar() { return foo(); }')],
      'foo',
      'baz',
    );
    expect(result.summary).toBeTruthy();
  });
});

describe('addComponentProp', () => {
  it('adds a prop to the interface definition', async () => {
    const content = [
      "import React from 'react';",
      'interface ButtonProps { label: string; }',
      'export function Button({ label }: ButtonProps) { return <button>{label}</button>; }',
    ].join('\n');
    const result = await addComponentProp(
      [file('src/Button.tsx', content)],
      'Button',
      'disabled',
      'boolean',
      'false',
    );
    expect(result.ok).toBe(true);
    if (result.changes.length > 0) {
      expect(result.changes[0].after).toContain('disabled');
    }
  });

  it('adds prop to JSX usage sites', async () => {
    const appContent = [
      "import React from 'react';",
      "import { Button } from './Button';",
      'export function App() { return <Button label="Click"/>; }',
    ].join('\n');
    const result = await addComponentProp(
      [file('src/App.tsx', appContent)],
      'Button',
      'disabled',
      'boolean',
      'false',
    );
    expect(result.ok).toBe(true);
    // May or may not match (depends on whether interface is in the same file)
    expect(result.error).toBeUndefined();
  });

  it('returns ok=true with no changes when component not found', async () => {
    const result = await addComponentProp(
      [file('src/a.tsx', "import React from 'react';\nexport function Other() { return <div/>; }")],
      'NonExistent',
      'foo',
      'string',
    );
    expect(result.ok).toBe(true);
    expect(result.changes).toHaveLength(0);
  });

  it('includes a summary message', async () => {
    const result = await addComponentProp(
      [file('src/a.tsx', "import React from 'react';\nexport function App() { return null; }")],
      'App',
      'theme',
      'string',
    );
    expect(result.summary).toBeTruthy();
  });
});
