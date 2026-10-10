import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The StatusBar plugin object, not the SplashScreen block that already uses #0d1117. */
function statusBarBlock(cfg: string): string {
  const start = cfg.search(/StatusBar:\s*\{/);
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  const open = cfg.indexOf('{', start);
  for (let i = open; i < cfg.length; i++) {
    if (cfg[i] === '{') depth++;
    else if (cfg[i] === '}') {
      depth--;
      if (depth === 0) return cfg.slice(start, i + 1);
    }
  }
  throw new Error('StatusBar block is unterminated');
}

describe('UI-8 / D-7 android release hardening', () => {
  it('the status bar launches on the dark boot colour with light icons, and minify stays off', () => {
    const cfg = readFileSync('capacitor.config.ts', 'utf8');
    const bar = statusBarBlock(cfg);
    // Inside the StatusBar object — SplashScreen already has this colour, so a file-wide search is not enough.
    expect(bar).toContain("backgroundColor: '#0d1117'");
    expect(bar).toMatch(/style:\s*'DARK'/);
    expect(bar).not.toMatch(/style:\s*'dark'/);
    expect(bar).not.toContain('#ffffff');

    const gradle = readFileSync('android/app/build.gradle', 'utf8');
    const release = gradle.slice(gradle.indexOf('buildTypes'), gradle.indexOf('buildTypes') + 800);
    expect(release).toMatch(/minifyEnabled\s+false/);
    expect(release).not.toMatch(/minifyEnabled\s+true/);
    expect(gradle).not.toMatch(/shrinkResources\s+true/);
    // D-7 is not YES: minify stays off, and ProGuard keep rules are intentionally absent until the owner sets D-7.
  });
});
