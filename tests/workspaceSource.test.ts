import { describe, it, expect } from 'vitest';
import {
  isPlaceholderHtml, filesHaveRealContent, resolveAppSource, hasAnalysableApp, appSourceGuidance,
} from '../src/lib/workspaceSource';

/**
 * Developer Tools shared source resolver (admin autopsy 2026-07-21): the tools used to run against
 * the "Waiting for magic…" placeholder. These tests lock the placeholder detection + source
 * resolution so a tool can never again silently analyse the placeholder as if it were the app.
 */

const PLACEHOLDER = '<!DOCTYPE html><html><body><div><h2>Waiting for magic...</h2><p>Ask Navbharat to build something!</p></div></body></html>';

describe('isPlaceholderHtml', () => {
  it('treats empty and the Waiting-for-magic placeholder as "no app"', () => {
    expect(isPlaceholderHtml('')).toBe(true);
    expect(isPlaceholderHtml('   ')).toBe(true);
    expect(isPlaceholderHtml(undefined)).toBe(true);
    expect(isPlaceholderHtml(PLACEHOLDER)).toBe(true);
  });
  it('treats real HTML as a real app', () => {
    expect(isPlaceholderHtml('<html><body><h1>My Todo App</h1></body></html>')).toBe(false);
  });
});

describe('filesHaveRealContent', () => {
  it('is false for empty / blank-index maps and true for real content', () => {
    expect(filesHaveRealContent(undefined)).toBe(false);
    expect(filesHaveRealContent({})).toBe(false);
    expect(filesHaveRealContent({ 'index.html': '' })).toBe(false);
    expect(filesHaveRealContent({ 'index.html': '   ' })).toBe(false);
    expect(filesHaveRealContent({ '__pending__x.tsx': 'code' })).toBe(false);
    expect(filesHaveRealContent({ 'src/App.tsx': 'export default () => <div/>;' })).toBe(true);
  });
});

describe('resolveAppSource', () => {
  it('prefers a real bundled preview', () => {
    const r = resolveAppSource('<html><body>real</body></html>', { 'index.html': '' });
    expect(r).toEqual({ html: '<html><body>real</body></html>', kind: 'preview' });
  });
  it('falls back to the workspace index.html when the preview is the placeholder', () => {
    const r = resolveAppSource(PLACEHOLDER, { 'index.html': '<html><body>from files</body></html>' });
    expect(r.kind).toBe('files');
    expect(r.html).toContain('from files');
  });
  it('reports "unbundled" when real files exist but no runnable HTML', () => {
    const r = resolveAppSource(PLACEHOLDER, { 'src/App.tsx': 'export default () => <div/>;' });
    expect(r).toEqual({ html: '', kind: 'unbundled' });
  });
  it('reports "none" when nothing is built', () => {
    expect(resolveAppSource(PLACEHOLDER, {})).toEqual({ html: '', kind: 'none' });
    expect(resolveAppSource('', undefined)).toEqual({ html: '', kind: 'none' });
  });
});

describe('hasAnalysableApp / appSourceGuidance', () => {
  it('only preview/files are analysable', () => {
    expect(hasAnalysableApp({ html: 'x', kind: 'preview' })).toBe(true);
    expect(hasAnalysableApp({ html: 'x', kind: 'files' })).toBe(true);
    expect(hasAnalysableApp({ html: '', kind: 'unbundled' })).toBe(false);
    expect(hasAnalysableApp({ html: '', kind: 'none' })).toBe(false);
  });
  it('gives honest, actionable guidance for the non-analysable kinds', () => {
    expect(appSourceGuidance('unbundled')).toMatch(/Preview/);
    expect(appSourceGuidance('none')).toMatch(/Build an app/);
    expect(appSourceGuidance('preview')).toBe('');
  });
});
