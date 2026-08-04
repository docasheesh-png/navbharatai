import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildScreenshotPrompt } from '../src/server/routes/screenshotToPrompt';

/**
 * Screenshot→Code real path (admin autopsy 2026-07-21): the tool POSTed to a non-existent
 * /api/generate-from-image and masked failure with a hardcoded FALLBACK_CODE page. These tests lock
 * the real vision-prompt builder and that the deception is gone.
 */

describe('buildScreenshotPrompt', () => {
  it('produces a real build-spec instruction reflecting style/framework/js', () => {
    const p = buildScreenshotPrompt('Tailwind CSS', 'React JSX', true);
    expect(p).toMatch(/BUILD SPECIFICATION/);
    expect(p).toContain('Tailwind CSS');
    expect(p).toContain('React JSX');
    expect(p).toMatch(/interactive behaviour/);
    expect(p).toMatch(/Output ONLY the build instructions/);
  });
  it('has sensible defaults and a static-only note when js is off', () => {
    const p = buildScreenshotPrompt();
    expect(p).toContain('Tailwind CSS');
    expect(p).toMatch(/plain HTML/);
    expect(buildScreenshotPrompt(undefined, undefined, false)).toMatch(/Static layout is enough/);
  });
});

describe('Screenshot→Code — deception removed, route wired', () => {
  const read = (rel: string) => readFileSync(join(__dirname, rel), 'utf8');

  it('the client no longer calls the dead endpoint nor ships FALLBACK_CODE', () => {
    const src = read('../src/components/ide/ScreenshotToCode.tsx');
    expect(src).not.toContain('/api/generate-from-image');
    expect(src).not.toMatch(/const FALLBACK_CODE =/);
    expect(src).toContain('/api/screenshot/to-prompt');
    expect(src).toContain('onBuildViaV5');
  });

  it('the real route is registered on the server', () => {
    expect(read('../src/server/routes/screenshotToPrompt.ts')).toContain("app.post('/api/screenshot/to-prompt'");
    expect(read('../server.ts')).toContain('registerScreenshotToPromptRoutes(app)');
  });
});
