import { describe, it, expect } from 'vitest';
import {
  detectDatabase,
  detectStyling,
  detectLanguage,
  summarizePattern,
  inferPreferences,
  mergePreferences,
  topPreferences,
  preferenceContext,
  MIN_BUILDS_FOR_CONTEXT,
} from '../src/server/AgentV3/UserPreferenceStore';

/** P-AI.5 — preference learning (pure core). */

const pkg = (deps: Record<string, string>) => JSON.stringify({ dependencies: deps });

describe('UserPreferenceStore — detectDatabase', () => {
  it('detects firestore from firebase dependency', () => {
    expect(detectDatabase({ 'package.json': pkg({ firebase: '^10' }) })).toBe('firestore');
  });
  it('detects supabase, prisma, mongodb', () => {
    expect(detectDatabase({ 'package.json': pkg({ '@supabase/supabase-js': '^2' }) })).toBe('supabase');
    expect(detectDatabase({ 'package.json': pkg({ '@prisma/client': '^5' }) })).toBe('prisma');
    expect(detectDatabase({ 'package.json': pkg({ mongoose: '^8' }) })).toBe('mongodb');
  });
  it('falls back to a code import when no deps map', () => {
    expect(detectDatabase({ 'src/db.ts': "import { initializeApp } from 'firebase/app'" })).toBe('firestore');
  });
  it('returns null when nothing recognizable', () => {
    expect(detectDatabase({ 'src/App.tsx': 'export default function App(){return null}' })).toBeNull();
  });
});

describe('UserPreferenceStore — detectStyling', () => {
  it('detects tailwind from dependency and from config file', () => {
    expect(detectStyling({ 'package.json': pkg({ tailwindcss: '^3' }) })).toBe('tailwind');
    expect(detectStyling({ 'tailwind.config.js': 'module.exports={}' })).toBe('tailwind');
  });
  it('detects styled-components, mui, css-modules', () => {
    expect(detectStyling({ 'package.json': pkg({ 'styled-components': '^6' }) })).toBe('styled-components');
    expect(detectStyling({ 'package.json': pkg({ '@mui/material': '^5' }) })).toBe('mui');
    expect(detectStyling({ 'src/Button.module.css': '.b{}' })).toBe('css-modules');
  });
});

describe('UserPreferenceStore — detectLanguage', () => {
  it('typescript from tsconfig / .tsx', () => {
    expect(detectLanguage({ 'tsconfig.json': '{}' })).toBe('typescript');
    expect(detectLanguage({ 'src/App.tsx': '' })).toBe('typescript');
  });
  it('javascript from .jsx', () => {
    expect(detectLanguage({ 'src/App.jsx': '' })).toBe('javascript');
  });
  it('null when neither', () => {
    expect(detectLanguage({ 'README.md': '# hi' })).toBeNull();
  });
});

describe('UserPreferenceStore — summarizePattern', () => {
  it('maps prompts to app-type labels', () => {
    expect(summarizePattern('Build an online store with a cart and checkout')).toBe('e-commerce');
    expect(summarizePattern('an admin dashboard with analytics')).toBe('dashboard');
    expect(summarizePattern('a todo app')).toBe('todo/productivity');
  });
  it('null on empty / unrecognized', () => {
    expect(summarizePattern('')).toBeNull();
    expect(summarizePattern('zzzz qqqq')).toBeNull();
  });
});

describe('UserPreferenceStore — inferPreferences', () => {
  it('combines framework + files + prompt', () => {
    const obs = inferPreferences({
      framework: 'vite-react',
      files: { 'package.json': pkg({ firebase: '^10', tailwindcss: '^3' }), 'src/App.tsx': '' },
      prompt: 'a CRM for contacts and deals',
    });
    expect(obs).toEqual({
      framework: 'vite-react',
      database: 'firestore',
      styling: 'tailwind',
      language: 'typescript',
      pattern: 'CRM',
    });
  });
  it('blank framework → null', () => {
    expect(inferPreferences({ framework: '  ', files: {} }).framework).toBeNull();
  });
});

describe('UserPreferenceStore — mergePreferences', () => {
  it('tallies repeated choices and increments totalBuilds', () => {
    const o = { framework: 'vite-react', database: 'firestore', styling: 'tailwind', language: 'typescript' as const, pattern: 'dashboard' };
    let s = mergePreferences(null, o, '2026-06-29T00:00:00Z');
    s = mergePreferences(s, o, '2026-06-29T01:00:00Z');
    expect(s.totalBuilds).toBe(2);
    expect(s.frameworks['vite-react']).toBe(2);
    expect(s.databases['firestore']).toBe(2);
    expect(s.recentPatterns).toEqual(['dashboard']); // de-duped
  });
  it('keeps most-recent-first, de-duplicated, capped at 5 patterns', () => {
    let s = mergePreferences(null, { framework: null, database: null, styling: null, language: null, pattern: 'a' }, 't');
    for (const p of ['b', 'c', 'd', 'e', 'f']) {
      s = mergePreferences(s, { framework: null, database: null, styling: null, language: null, pattern: p }, 't');
    }
    expect(s.recentPatterns).toEqual(['f', 'e', 'd', 'c', 'b']);
  });
  it('does not mutate the input record', () => {
    const s1 = mergePreferences(null, { framework: 'nextjs', database: null, styling: null, language: null, pattern: null }, 't');
    const snapshot = JSON.parse(JSON.stringify(s1));
    mergePreferences(s1, { framework: 'vue', database: null, styling: null, language: null, pattern: null }, 't');
    expect(s1).toEqual(snapshot);
  });
});

describe('UserPreferenceStore — topPreferences', () => {
  it('returns the modal choice per dimension', () => {
    let s = mergePreferences(null, { framework: 'vite-react', database: 'firestore', styling: null, language: null, pattern: null }, 't');
    s = mergePreferences(s, { framework: 'vite-react', database: 'supabase', styling: null, language: null, pattern: null }, 't');
    s = mergePreferences(s, { framework: 'nextjs', database: 'firestore', styling: null, language: null, pattern: null }, 't');
    const top = topPreferences(s);
    expect(top.framework).toBe('vite-react'); // 2 vs 1
    expect(top.database).toBe('firestore'); // 2 vs 1
    expect(top.totalBuilds).toBe(3);
  });
  it('null dimensions when empty', () => {
    expect(topPreferences(null).framework).toBeNull();
  });
});

describe('UserPreferenceStore — preferenceContext', () => {
  it('empty until MIN_BUILDS_FOR_CONTEXT builds', () => {
    const o = { framework: 'vite-react', database: 'firestore', styling: 'tailwind', language: 'typescript' as const, pattern: 'dashboard' };
    let s = mergePreferences(null, o, 't');
    expect(MIN_BUILDS_FOR_CONTEXT).toBeGreaterThanOrEqual(2);
    expect(preferenceContext(s)).toBe(''); // only 1 build
    s = mergePreferences(s, o, 't');
    const ctx = preferenceContext(s);
    expect(ctx).toContain('Preferred framework: vite-react');
    expect(ctx).toContain('Preferred database/persistence: firestore');
    expect(ctx).toContain('Preferred styling: tailwind');
    expect(ctx).toContain('Recently built: dashboard');
    // advisory, not a mandate
    expect(ctx.toLowerCase()).toContain('defaults');
  });
  it('empty string for null / no data', () => {
    expect(preferenceContext(null)).toBe('');
  });
});
