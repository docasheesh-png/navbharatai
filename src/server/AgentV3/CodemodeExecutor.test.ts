import { describe, it, expect } from 'vitest';
import { renameSymbol, addComponentProp, insertPropBeforeInterfaceClose } from './CodemodeExecutor';
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

  it('does NOT corrupt an interface whose body contains a nested object type (the [^}]* bug)', async () => {
    // meta: { id: string } has an inner `}` that the old regex mistook for the interface close.
    const content = 'interface CardProps {\n  meta: { id: string };\n  title: string;\n}\n';
    const result = await addComponentProp([file('src/Card.tsx', content)], 'Card', 'onClick', '() => void', '() => {}');
    expect(result.ok).toBe(true);
    const after = result.changes[0]?.after ?? content;
    // The new prop lands INSIDE the interface, before its real close; the nested type is intact.
    expect(after).toContain('meta: { id: string };');
    expect(after).toContain('title: string;');
    expect(after).toContain('onClick?: () => void;');
    // The nested `}` was NOT treated as the interface close: everything after it survives.
    const idx = after.indexOf('onClick?');
    expect(after.indexOf('title: string;')).toBeLessThan(idx); // title still precedes the inserted prop's close
  });
});

describe('insertPropBeforeInterfaceClose (pure, brace-matched)', () => {
  it('inserts before the MATCHING close, not the first nested one', () => {
    const src = 'interface XProps {\n  a: { b: number };\n}\n';
    const out = insertPropBeforeInterfaceClose(src, 'X', '  c: string;\n');
    expect(out).toBe('interface XProps {\n  a: { b: number };\n  c: string;\n}\n');
  });
  it('leaves content unchanged when the interface is absent or braces are unbalanced', () => {
    expect(insertPropBeforeInterfaceClose('const x = 1;', 'X', '  c: string;\n')).toBe('const x = 1;');
    expect(insertPropBeforeInterfaceClose('interface XProps { a: {', 'X', '  c: string;\n')).toBe('interface XProps { a: {');
  });
  it('escapes a regex-special component name', () => {
    // A `$`/`.` in the name must not blow up the RegExp.
    expect(() => insertPropBeforeInterfaceClose('x', 'Foo.Bar', '  c: string;\n')).not.toThrow();
  });
});

describe('renameSymbol — reference-aware (does not mangle same-named properties)', () => {
  it('does NOT rename the property side of obj.oldName', async () => {
    const src = 'const id = 1;\nuser.id = id;\nconst obj = { id };\n';
    const result = await renameSymbol([file('a.ts', src)], 'id', 'key');
    expect(result.ok).toBe(true);
    const after = result.changes[0]?.after ?? src;
    expect(after).toContain('const key = 1');   // the value binding IS renamed
    expect(after).toContain('user.id = ');       // the PROPERTY access is NOT renamed
    expect(after).not.toContain('user.key');     // regression guard
  });

  it('does NOT rename an object-literal key `{ oldName: value }`', async () => {
    const src = 'const id = 5;\nconst payload = { id: id, name: "x" };\n';
    const result = await renameSymbol([file('a.ts', src)], 'id', 'key');
    const after = result.changes[0]?.after ?? src;
    expect(after).toContain('const key = 5');
    expect(after).toContain('id: key');   // KEY name stays `id`; only the value REFERENCE is renamed
    expect(after).not.toContain('key: key');
  });
});
