/**
 * Tests for src/lib/appUtils.ts — pure utility functions extracted from App.tsx.
 */
import { describe, it, expect } from 'vitest';
import {
  detectFrameworkFromFiles,
  detectAppType,
  isClassicVanillaWeb,
  buildLanguageRule,
  classifyError,
} from '../src/lib/appUtils';

// ─── detectFrameworkFromFiles ────────────────────────────────────────────────

describe('detectFrameworkFromFiles', () => {
  it('returns "Static HTML Site" for empty file map', () => {
    expect(detectFrameworkFromFiles({})).toBe('Static HTML Site');
  });

  it('returns "Vanilla JS / Static HTML" when no package.json but index.html present', () => {
    expect(detectFrameworkFromFiles({ 'index.html': '<html/>' })).toBe('Vanilla JS / Static HTML');
  });

  it('returns "Static HTML Site" when no package.json and no index.html', () => {
    expect(detectFrameworkFromFiles({ 'README.md': '# hi' })).toBe('Static HTML Site');
  });

  it('detects Next.js from deps', () => {
    const pkg = JSON.stringify({ dependencies: { next: '^14.0.0', react: '^18' } });
    expect(detectFrameworkFromFiles({ 'package.json': pkg })).toBe('Next.js Framework');
  });

  it('detects Vue.js from vue dep', () => {
    const pkg = JSON.stringify({ dependencies: { vue: '^3.0.0' } });
    expect(detectFrameworkFromFiles({ 'package.json': pkg })).toBe('Vue.js App');
  });

  it('detects React + Vite SPA when both react and vite are deps', () => {
    const pkg = JSON.stringify({ dependencies: { react: '^18', vite: '^5' } });
    expect(detectFrameworkFromFiles({ 'package.json': pkg })).toBe('React + Vite SPA');
  });

  it('detects Express backend', () => {
    const pkg = JSON.stringify({ dependencies: { express: '^4' } });
    expect(detectFrameworkFromFiles({ 'package.json': pkg })).toBe('Node.js Express backend');
  });

  it('detects plain React SPA (no vite)', () => {
    const pkg = JSON.stringify({ dependencies: { react: '^18' } });
    expect(detectFrameworkFromFiles({ 'package.json': pkg })).toBe('React SPA');
  });

  it('returns "Node.js Application" when package.json has no known dep', () => {
    const pkg = JSON.stringify({ dependencies: { lodash: '^4' } });
    expect(detectFrameworkFromFiles({ 'package.json': pkg })).toBe('Node.js Application');
  });

  it('falls back to string matching when JSON.parse fails — detects next', () => {
    expect(detectFrameworkFromFiles({ 'package.json': '{ "next": "^14" INVALID }' })).toBe('Next.js Framework');
  });

  it('falls back to string matching when JSON.parse fails — detects vue', () => {
    expect(detectFrameworkFromFiles({ 'package.json': '{ "vue": "^3" INVALID }' })).toBe('Vue.js App');
  });

  it('falls back to "Static HTML Site" when JSON.parse fails and no known string', () => {
    expect(detectFrameworkFromFiles({ 'package.json': 'INVALID JSON' })).toBe('Static HTML Site');
  });
});

// ─── detectAppType ───────────────────────────────────────────────────────────

describe('detectAppType', () => {
  it('returns "react" for a .tsx file', () => {
    expect(detectAppType({ 'src/App.tsx': 'export default function App() {}' })).toBe('react');
  });

  it('returns "react" for a .jsx file', () => {
    expect(detectAppType({ 'index.jsx': 'export default () => null' })).toBe('react');
  });

  it('returns "react" when package.json declares react dep', () => {
    const pkg = JSON.stringify({ dependencies: { react: '^18' } });
    expect(detectAppType({ 'package.json': pkg })).toBe('react');
  });

  it('returns "vue" for a .vue file', () => {
    expect(detectAppType({ 'App.vue': '<template/>' })).toBe('vue');
  });

  it('returns "vue" when package.json declares vue dep', () => {
    const pkg = JSON.stringify({ dependencies: { vue: '^3' } });
    expect(detectAppType({ 'package.json': pkg })).toBe('vue');
  });

  it('returns "react" when index.html references a module entry with .tsx src', () => {
    const html = '<script type="module" src="/src/main.tsx"></script>';
    expect(detectAppType({ 'index.html': html })).toBe('react');
  });

  it('returns "react" for a .js file with ES module import statements', () => {
    expect(detectAppType({ 'app.js': 'import { foo } from "./foo";\n' })).toBe('react');
  });

  it('returns "static" for a plain HTML + CSS file set', () => {
    expect(detectAppType({ 'index.html': '<html/>', 'style.css': 'body{}' })).toBe('static');
  });
});

// ─── isClassicVanillaWeb ─────────────────────────────────────────────────────

describe('isClassicVanillaWeb', () => {
  it('returns true for a pure .js + .css file set', () => {
    expect(isClassicVanillaWeb({ 'app.js': 'alert(1)', 'style.css': 'body{}' })).toBe(true);
  });

  it('returns true for .mjs files', () => {
    expect(isClassicVanillaWeb({ 'main.mjs': 'export const x = 1;' })).toBe(true);
  });

  it('returns false when index.html is present (not classic vanilla)', () => {
    expect(isClassicVanillaWeb({ 'index.html': '<html/>', 'app.js': 'alert(1)' })).toBe(false);
  });

  it('returns false for empty file map', () => {
    expect(isClassicVanillaWeb({})).toBe(false);
  });

  it('returns false when only .json and no .js files', () => {
    expect(isClassicVanillaWeb({ 'data.json': '{}' })).toBe(false);
  });

  it('ignores node_modules entries', () => {
    expect(isClassicVanillaWeb({ 'node_modules/foo/index.js': 'x', 'app.js': 'y' })).toBe(true);
  });
});

// ─── buildLanguageRule ───────────────────────────────────────────────────────

describe('buildLanguageRule', () => {
  it('includes hindi conversation rule when lang is "hindi"', () => {
    const rule = buildLanguageRule('hindi');
    expect(rule).toContain('Always reply in Hindi');
  });

  it('includes hinglish conversation rule when lang is "hinglish"', () => {
    const rule = buildLanguageRule('hinglish');
    expect(rule).toContain('Always reply in Hinglish');
  });

  it('includes english conversation rule when lang is "english"', () => {
    const rule = buildLanguageRule('english');
    expect(rule).toContain('Always reply in English');
  });

  it('defaults to auto-match rule when lang is null', () => {
    const rule = buildLanguageRule(null);
    expect(rule).toContain('Automatically match');
  });

  it('defaults to auto-match rule when lang is "auto"', () => {
    const rule = buildLanguageRule('auto');
    expect(rule).toContain('Automatically match');
  });

  it('always includes the CODE LANGUAGE section regardless of lang', () => {
    for (const lang of ['hindi', 'english', 'hinglish', null] as const) {
      expect(buildLanguageRule(lang)).toContain('CODE LANGUAGE (ABSOLUTE RULE');
    }
  });

  it('falls back to auto for unknown lang value', () => {
    const rule = buildLanguageRule('unknown-lang');
    expect(rule).toContain('Automatically match');
  });
});

// ─── classifyError ────────────────────────────────────────────────────────────

describe('classifyError', () => {
  it('returns AUTH for 401 in message', () => {
    expect(classifyError('Request failed with status 401')).toBe('AUTH');
  });

  it('returns AUTH for 403 in message', () => {
    expect(classifyError('403 Forbidden')).toBe('AUTH');
  });

  it('returns AUTH for api_key_invalid with 400', () => {
    expect(classifyError('400 api_key_invalid')).toBe('AUTH');
  });

  it('returns AUTH when message contains "auth"', () => {
    expect(classifyError('Authentication failed')).toBe('AUTH');
  });

  it('returns AUTH when message contains "key"', () => {
    expect(classifyError('Invalid API key provided')).toBe('AUTH');
  });

  it('returns QUOTA for 429', () => {
    expect(classifyError('429 Too Many Requests')).toBe('QUOTA');
  });

  it('returns QUOTA for "quota" keyword', () => {
    expect(classifyError('You have exceeded your quota')).toBe('QUOTA');
  });

  it('returns QUOTA for "billing" keyword', () => {
    expect(classifyError('Billing account suspended')).toBe('QUOTA');
  });

  it('returns NETWORK for "fetch" keyword', () => {
    expect(classifyError('fetch failed: network error')).toBe('NETWORK');
  });

  it('returns NETWORK for "connect" keyword', () => {
    expect(classifyError('Failed to connect to server')).toBe('NETWORK');
  });

  it('returns UNKNOWN for unrecognised error', () => {
    expect(classifyError('SyntaxError: unexpected token')).toBe('UNKNOWN');
  });

  it('handles Error instance', () => {
    expect(classifyError(new Error('401 unauthorized'))).toBe('AUTH');
  });

  it('handles object with message property', () => {
    expect(classifyError({ message: '429 rate limit' })).toBe('QUOTA');
  });

  it('returns UNKNOWN for empty string', () => {
    expect(classifyError('')).toBe('UNKNOWN');
  });
});
