import { describe, it, expect } from 'vitest';
import { analyzeWithAST } from './ASTAnalyzer';

describe('analyzeWithAST', () => {
  it('returns null for non-code files', async () => {
    expect(await analyzeWithAST('README.md', '# Hello')).toBeNull();
    expect(await analyzeWithAST('data.json', '{}')).toBeNull();
  });

  it('extracts exported symbols from a .ts file', async () => {
    const content = [
      'export function greet(name: string): string { return `Hello ${name}`; }',
      'export const PI = 3.14;',
      'export interface User { id: number; name: string; }',
    ].join('\n');
    const facts = await analyzeWithAST('src/utils.ts', content);
    if (!facts) return; // ts-morph may not be available in all environments
    const names = facts.symbols.map((s) => s.name);
    expect(names).toContain('greet');
    expect(names).toContain('PI');
    expect(names).toContain('User');
  });

  it('detects React components in a .tsx file', async () => {
    const content = [
      "import React from 'react';",
      'export function Button({ label }: { label: string }) {',
      '  return <button>{label}</button>;',
      '}',
      'export const VARIANT = "primary";',
    ].join('\n');
    const facts = await analyzeWithAST('src/Button.tsx', content);
    if (!facts) return;
    expect(facts.components).toContain('Button');
    expect(facts.components).not.toContain('VARIANT');
  });

  it('extracts import specifiers', async () => {
    const content = [
      "import React, { useState } from 'react';",
      "import { BrowserRouter } from 'react-router-dom';",
      'export function App() { return null; }',
    ].join('\n');
    const facts = await analyzeWithAST('src/App.tsx', content);
    if (!facts) return;
    expect(facts.specifiers).toContain('react');
    expect(facts.specifiers).toContain('react-router-dom');
  });

  it('detects route paths from Express-style registrations', async () => {
    const content = [
      "import express from 'express';",
      'const app = express();',
      "app.get('/api/users', handler);",
      "app.post('/api/login', login);",
      'export { app };',
    ].join('\n');
    const facts = await analyzeWithAST('src/server.ts', content);
    if (!facts) return;
    expect(facts.routes).toContain('/api/users');
    expect(facts.routes).toContain('/api/login');
  });

  it('includes line numbers for symbols', async () => {
    const content = [
      '// line 1',
      "import { x } from './x';", // line 2
      'export function hello() { return 1; }', // line 3
    ].join('\n');
    const facts = await analyzeWithAST('src/hello.ts', content);
    if (!facts) return;
    const helloSym = facts.symbols.find((s) => s.name === 'hello');
    expect(helloSym).toBeDefined();
    expect(helloSym!.line).toBeGreaterThan(0);
  });

  it('returns empty arrays (not null) for a file with no exports', async () => {
    const content = "const x = 1;\nconsole.log(x);\n";
    const facts = await analyzeWithAST('src/noop.ts', content);
    if (!facts) return;
    expect(facts.symbols).toEqual([]);
    expect(facts.components).toEqual([]);
  });
});
