// Play Console warned that the .aab "contains native code, and you've not uploaded debug symbols"
// (admin 2026-09-29). The fix is one line in the RELEASE build type; this pins it there, since a
// debug-only or misplaced setting would build cleanly and change nothing Play sees.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('the release .aab carries native debug symbols', () => {
  const gradle = readFileSync('android/app/build.gradle', 'utf8');
  it('debugSymbolLevel is set inside buildTypes.release', () => {
    const release = gradle.slice(gradle.indexOf('buildTypes {'));
    const block = release.slice(release.indexOf('release {'), release.indexOf('\n    }\n'));
    expect(block).toMatch(/ndk \{\s*debugSymbolLevel 'SYMBOL_TABLE'\s*\}/);
  });
});
