// Pro undo / pehle wala → in-chat version picker (one-tap restore), never Other → Versioning.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { HOW_TO_GO_BACK } from '../src/components/agentv3/versionHelp';
import { wantsVersionUndo } from '../src/lib/versionUndoIntent';

const ROOT = path.resolve(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'src/components/agentv3/AgentV3Panel.tsx'), 'utf8');
const card = fs.readFileSync(path.join(ROOT, 'src/components/agentv3/VersionUndoCard.tsx'), 'utf8');
const timeline = fs.readFileSync(path.join(ROOT, 'src/components/versions/VersionTimeline.tsx'), 'utf8');

describe('Pro chat undo → version picker → restore only after one tap', () => {
  it('panel detects undo intent and opens VersionUndoCard (does not auto-restore)', () => {
    expect(panel).toContain('wantsVersionUndo(msgText)');
    expect(panel).toContain('setVersionUndoOpen(true)');
    expect(panel).toContain('<VersionUndoCard');
    expect(panel).not.toMatch(/wantsVersionUndo\(msgText\)[\s\S]{0,400}restore-version/);
  });

  it('picker reuses VersionTimeline with oneTapRestore (no second Are-you-sure)', () => {
    expect(card).toContain('oneTapRestore');
    expect(card).toContain('VersionTimeline');
    expect(timeline).toContain('oneTapRestore');
    expect(timeline).toMatch(/if \(oneTapRestore\) void restore\(v\)/);
  });

  it('copy never directs the user to Other → Versioning for this flow', () => {
    expect(card.toLowerCase()).not.toMatch(/other ai\s*→|time machine path/);
    expect(HOW_TO_GO_BACK).toMatch(/say undo|pehle wala|wapas/i);
    expect(HOW_TO_GO_BACK).toMatch(/one tap/i);
  });

  it('intent → picker path is covered for the owner phrases', () => {
    expect(wantsVersionUndo('pehle wala')).toBe(true);
    expect(wantsVersionUndo('wapas kar do')).toBe(true);
    expect(wantsVersionUndo('undo last build')).toBe(true);
  });
});
