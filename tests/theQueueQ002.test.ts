// BUILD_REPORT_QUEUE Q-002 (autopsy 6461025c): three icon-only buttons with no accessible name were
// noted at write time, ignored, and shipped. The end-of-turn hand-back now carries them.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { lintBuiltApp, a11yHandBack } from '../src/server/AgentV3/buildQualityLint';
import { decideStyleResume } from '../src/server/AgentV3/stylePolishResume';

const SHELL = `export function Shell() {
  return (<header><button onClick={() => setOpen(true)}><Menu size={20} /></button>
  <a href="/notifications"><Bell size={18} /></a></header>);
}`;

describe('a screen a screen reader cannot use is handed back before the turn ends', () => {
  it('the build linter names the file and the problem', () => {
    const back = a11yHandBack(lintBuiltApp({ 'src/components/Shell.tsx': SHELL }));
    expect(back).toHaveLength(1);
    expect(back[0].file).toBe('src/components/Shell.tsx');
    expect(back[0].issues.join(' ')).toMatch(/no accessible name/);
  });

  it('a labelled screen hands nothing back', () => {
    const ok = SHELL.replace('<button onClick', '<button aria-label="Open menu" onClick').replace('<a href', '<a aria-label="Notifications" href');
    expect(a11yHandBack(lintBuiltApp({ 'src/components/Shell.tsx': ok }))).toEqual([]);
  });

  it('it alone is enough to resume once, after the app was written, and the message names the file', () => {
    const d = decideStyleResume({ text: 'App ready hai!', missing: [], a11y: [{ file: 'src/components/Shell.tsx', issues: ['2 button/link with no accessible name'] }], resumesUsed: 0, producedFiles: true });
    expect(d.resume).toBe(true);
    expect(d.message).toContain('src/components/Shell.tsx');
    expect(decideStyleResume({ text: 'x', missing: [], a11y: [], resumesUsed: 0, producedFiles: true }).resume).toBe(false);
  });

  it('the runner passes it, and the dispatcher computes it from the same read', () => {
    expect(readFileSync('src/server/AgentV3/AgentRunner.ts', 'utf8')).toContain('a11y: style.a11y,');
    expect(readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8')).toContain('a11y = a11yHandBack(lintBuiltApp(project));');
  });
});
