/**
 * AUTOPSY db07e0af (2026-10-12) — the whole prompt was "Banao". A todo app nobody described was built in 8.3
 * minutes and billed ₹96.93, although autopsy d6d664e6 ("Bnao", 2026-09-17) had already settled it: when it is not
 * clear what to make, ASK — "mai samjha nahi, puri baat batao".
 *
 * The guard did not fire because it asked "is the workspace empty?" by counting files, and the workspace held
 * our own 11-file starter (the Files tab had opened the chat five minutes earlier and saved it). The class
 * autopsy e9b25b08 named for the edit/build decision — our starter read as the user's project — never hunted
 * to this gate. And its sibling: an earlier "hi" counted as "the conversation says what to build".
 */
import { describe, it, expect } from 'vitest';
import { shouldAskWhatToBuild, assessBuildInput } from '../src/server/AgentV3/buildableInput';
import { holdsOnlyOurStarter, starterTemplates } from '../src/server/AgentV3/starterFragment';
import { TemplateRegistry } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/TemplateRegistry';

const base = { namesNothing: true, editIntent: false, workspaceHoldsOnlyOurStarter: true, earlierTurns: [] as string[], importing: false, attachments: 0 };

describe('the reported turn', () => {
  it('"Banao" names nothing to build', () => {
    expect(assessBuildInput('Banao')).toMatchObject({ buildable: false, reason: 'no-object' });
  });

  it('🔒 a workspace holding only our own vite-react starter (the 11 files the report shows) holds nothing of theirs', () => {
    const starter = new TemplateRegistry().getProvider('vite-react').getFiles([]);
    expect(Object.keys(starter).length).toBe(11);
    expect(holdsOnlyOurStarter(starter)).toBe(true);
    expect(starterTemplates().length).toBeGreaterThan(1);
  });

  it('🔒 so "Banao" on that workspace, with nothing said before, is ASKED about — not built', () => {
    expect(shouldAskWhatToBuild(base)).toBe(true);
  });
});

describe('it still asks only when nothing can say what to build', () => {
  it('the user’s own app is here — a short order means "carry on"', () => {
    expect(shouldAskWhatToBuild({ ...base, workspaceHoldsOnlyOurStarter: false })).toBe(false);
  });
  it('an edit of the app that is here', () => {
    expect(shouldAskWhatToBuild({ ...base, editIntent: true })).toBe(false);
  });
  it('an attachment or an import carries the content', () => {
    expect(shouldAskWhatToBuild({ ...base, attachments: 1 })).toBe(false);
    expect(shouldAskWhatToBuild({ ...base, importing: true })).toBe(false);
  });
  it('an earlier message that names the app', () => {
    expect(shouldAskWhatToBuild({ ...base, earlierTurns: ['ek kirana shop billing app with GST'] })).toBe(false);
  });
  it('a message that names something is never asked about', () => {
    expect(shouldAskWhatToBuild({ ...base, namesNothing: false })).toBe(false);
  });
  it('🔒 the sibling: an earlier "hi" or another bare order says nothing, so it still asks', () => {
    expect(shouldAskWhatToBuild({ ...base, earlierTurns: ['hi'] })).toBe(true);
    expect(shouldAskWhatToBuild({ ...base, earlierTurns: ['hello', 'Banao'] })).toBe(true);
  });
});
