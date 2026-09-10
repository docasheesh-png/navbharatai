import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const panel = read('src/components/agentv3/AgentV3Panel.tsx');
const surface = read('src/components/agentv3/PreviewSurface.tsx');

describe('previewing an older version must not hand out a billable address', () => {
  it('no longer opens the version in a new tab', () => {
    // THE SIBLING THE TOOLBAR FIX MISSED. Removing the address from the Live toolbar closed one leak;
    // this path put the SAME kind of address in the user's own address bar, ready to copy, with a
    // second dev server running behind it. If window.open comes back here, so does the leak.
    const handler = panel.slice(panel.indexOf('const handlePreviewCheckpoint'), panel.indexOf('const handlePreviewCheckpoint') + 1200);
    expect(handler).not.toContain('window.open');
    expect(handler).toContain('setVersionView({ sha, url })');
  });

  it('the panel hands the url to the preview surface instead of to the browser', () => {
    expect(panel).toContain('versionUrl={versionView?.url}');
    expect(panel).toContain('onExitVersion={() => setVersionView(null)}');
  });

  it('the old version takes over the WHOLE surface, above both mode branches', () => {
    // A user looking at last week's build must not also be looking at today's toolbar: its Edit
    // button and its console would act on the CURRENT app while the frame showed an old one.
    // Anchored at a statement START: an `else if (...)` earlier in the file contains the same
    // substring, and matching that instead made this guard compare the wrong two positions.
    const versionBranch = surface.indexOf('\n  if (versionUrl) {');
    const liveBranch = surface.indexOf("\n  if (mode === 'live' && effectiveUrl) {");
    expect(versionBranch).toBeGreaterThan(-1);
    expect(versionBranch).toBeLessThan(liveBranch);
  });

  it('says unmissably that this is not the current app, and offers the way back', () => {
    expect(surface).toContain('older version');
    expect(surface).toContain('Your current app is untouched');
    expect(surface).toContain('Back to my app');
  });

  it('never renders the version url as text', () => {
    const block = surface.slice(surface.indexOf('if (versionUrl) {'), surface.indexOf('if (versionUrl) {') + 2200);
    expect(block).toContain('src={versionUrl}');
    expect(block).not.toContain('>{versionUrl}<');
  });
});
