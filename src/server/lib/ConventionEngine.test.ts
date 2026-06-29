import { describe, it, expect } from 'vitest';
import {
  detectCase, toCase, checkFileName, checkIdentifier, classifyImport, orderImports, analyzeConventions,
} from './ConventionEngine';

describe('ConventionEngine (P-CGE.3)', () => {
  describe('detectCase', () => {
    it('classifies the common cases', () => {
      expect(detectCase('UserProfile')).toBe('PascalCase');
      expect(detectCase('getUser')).toBe('camelCase');
      expect(detectCase('user')).toBe('camelCase');
      expect(detectCase('MAX_RETRIES')).toBe('SCREAMING_SNAKE');
      expect(detectCase('user_profile')).toBe('snake_case');
      expect(detectCase('user-profile')).toBe('kebab-case');
    });
  });

  describe('toCase', () => {
    it('converts between cases from any source casing', () => {
      expect(toCase('user_profile', 'PascalCase')).toBe('UserProfile');
      expect(toCase('UserProfile', 'camelCase')).toBe('userProfile');
      expect(toCase('getUserName', 'SCREAMING_SNAKE')).toBe('GET_USER_NAME');
      expect(toCase('MyComponent', 'kebab-case')).toBe('my-component');
    });
  });

  describe('checkFileName', () => {
    it('expects PascalCase for components (.tsx)', () => {
      expect(checkFileName('src/components/userCard.tsx')).toMatchObject({ ok: false, suggestion: 'src/components/UserCard.tsx' });
      expect(checkFileName('src/components/UserCard.tsx').ok).toBe(true);
    });
    it('expects camelCase for services/hooks (.ts)', () => {
      expect(checkFileName('src/lib/UserService.ts')).toMatchObject({ ok: false, suggestion: 'src/lib/userService.ts' });
      expect(checkFileName('src/lib/userService.ts').ok).toBe(true);
    });
    it('leaves index and dotted files alone', () => {
      expect(checkFileName('src/lib/index.ts').ok).toBe(true);
      expect(checkFileName('src/lib/Foo.test.ts').ok).toBe(true);
      expect(checkFileName('vite.config.ts').ok).toBe(true);
    });
  });

  describe('checkIdentifier', () => {
    it('enforces the convention per kind', () => {
      expect(checkIdentifier('GetUser', 'function')).toMatchObject({ ok: false, suggestion: 'getUser' });
      expect(checkIdentifier('maxRetries', 'constant')).toMatchObject({ ok: false, suggestion: 'MAX_RETRIES' });
      expect(checkIdentifier('userCard', 'component')).toMatchObject({ ok: false, suggestion: 'UserCard' });
      expect(checkIdentifier('getUser', 'function').ok).toBe(true);
    });
  });

  describe('classifyImport + orderImports', () => {
    it('classifies sources into ordering groups', () => {
      expect(classifyImport('node:fs')).toBe('builtin');
      expect(classifyImport('path')).toBe('builtin');
      expect(classifyImport('react')).toBe('external');
      expect(classifyImport('@/lib/foo')).toBe('internal');
      expect(classifyImport('./local')).toBe('relative');
    });
    it('reorders imports: builtin → external → internal → relative, alphabetised', () => {
      const out = orderImports([
        "import { z } from './zed';",
        "import express from 'express';",
        "import fs from 'fs';",
        "import { foo } from '@/lib/foo';",
        "import axios from 'axios';",
      ]);
      const nonBlank = out.filter((l) => l !== '');
      expect(nonBlank[0]).toContain("'fs'");          // builtin first
      expect(nonBlank[1]).toContain("'axios'");        // external, alphabetised before express
      expect(nonBlank[2]).toContain("'express'");
      expect(nonBlank[3]).toContain("'@/lib/foo'");    // internal
      expect(nonBlank[4]).toContain("'./zed'");        // relative last
    });
  });

  describe('analyzeConventions', () => {
    it('aggregates violations across files, identifiers and imports', () => {
      const r = analyzeConventions({
        files: ['src/components/userCard.tsx', 'src/components/Good.tsx'],
        identifiers: [{ name: 'GetX', kind: 'function' }, { name: 'okName', kind: 'variable' }],
        imports: ["import b from './b';", "import a from 'react';"],
      });
      expect(r.files.filter((f) => !f.ok).length).toBe(1);
      expect(r.identifiers.filter((i) => !i.ok).length).toBe(1);
      expect(r.importOrder?.changed).toBe(true);
      expect(r.violationCount).toBe(3);
    });
    it('HONESTY: all-conforming input reports zero violations and no suggestions', () => {
      const r = analyzeConventions({
        files: ['src/components/UserCard.tsx', 'src/lib/userService.ts'],
        identifiers: [{ name: 'getUser', kind: 'function' }, { name: 'MAX', kind: 'constant' }],
        imports: ["import react from 'react';"],
      });
      expect(r.violationCount).toBe(0);
      expect(r.files.every((f) => f.suggestion === null)).toBe(true);
      expect(r.importOrder?.changed).toBe(false);
    });
  });
});
