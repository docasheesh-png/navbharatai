// Autopsy cf09c03c (2026-10-04): "Etake aro improve korar jonno ekta valo prompt likhe dao" (romanised
// Bengali: "write a good prompt to improve this further") was read as an EDIT at HIGH because of "improve",
// replaced our starter's App.tsx with a page showing a prompt, and was charged ₹6.34. The turn before it,
// "Create a image generated promt", was read as a PICTURE request. Both asked for text.
import { describe, expect, it } from 'vitest';
import { classifyIntentWithConfidence, asksForWrittenText } from '../src/server/AgentV3/IntentClassifier';
import { detectImageIntent, asksForPromptText } from '../src/server/lib/imageIntent';
import { isPictureRequest } from '../src/server/AgentV3/pictureRequest';
import { summarizeProject, isProjectSummaryNarration } from '../src/server/AgentV3/ProjectSummary';
import { leanReviewAnswersInOneCall, reviewerInstruction } from '../src/server/AgentV3/ReviewerAgent';

const REAL = 'Etake aro improve korar jonno ekta valo prompt likhe dao';
const REAL_BEFORE = 'Create a image generated promt';

const verdict = (m: string) => classifyIntentWithConfidence(m);

describe('§1 a request for written text is answered, not built — edit verbs included', () => {
  it('the real message is chat, so the reader decides (LOW)', () => {
    expect(verdict(REAL)).toMatchObject({ intent: 'chat', confidence: 'low', signal: 'content-request' });
  });

  it('the turn before it, and the new-build siblings, are chat too', () => {
    for (const m of [REAL_BEFORE, 'ek accha prompt likh do', 'make a better prompt for midjourney', 'create a prompt for a logo']) {
      expect(verdict(m).intent, m).toBe('chat');
    }
  });

  it('CLASS: every edit verb with "write a better prompt" is an order for text', () => {
    for (const v of ['improve', 'rewrite', 'correct', 'change', 'update', 'edit', 'modify', 'tweak', 'fix']) {
      const m = `${v} it and write a better prompt`;
      expect(asksForWrittenText(m), m).toBe(true);
      expect(verdict(m).intent, m).toBe('chat');
    }
  });

  it('text that may be an app label keeps its edit intent and loses only the lock', () => {
    expect(verdict('change the caption to Welcome')).toMatchObject({ intent: 'edit_existing', confidence: 'low' });
    expect(verdict('improve this essay')).toMatchObject({ intent: 'edit_existing', confidence: 'low' });
  });

  it('PRECISION: app work stays app work', () => {
    expect(verdict('improve the app')).toMatchObject({ intent: 'edit_existing', confidence: 'high' });
    expect(verdict('fix the login page')).toMatchObject({ intent: 'edit_existing', confidence: 'high' });
    expect(verdict('build a prompt generator app').intent).toBe('new_build');
    expect(verdict('add a confirmation prompt before delete').intent).not.toBe('chat');
    expect(verdict('update the install prompt button').intent).not.toBe('chat');
    expect(verdict('rewrite the about page text').intent).toBe('edit_existing');
  });
});

describe('§2 a prompt is text, not a picture', () => {
  it('a request to WRITE a prompt is not a picture request', () => {
    for (const m of [REAL_BEFORE, 'write a prompt for image generation', 'make an image prompt for a lion', 'image banane ke liye prompt likh do']) {
      expect(asksForPromptText(m), m).toBe(true);
      expect(detectImageIntent(m).wants, m).toBe(false);
      expect(isPictureRequest(m), m).toBe(false);
    }
  });

  it('a prompt the user GIVES is still a picture request', () => {
    for (const m of ['create an image with this prompt: a red fort at dusk', 'generate a picture from my prompt', 'create an image of a sunset']) {
      expect(asksForPromptText(m), m).toBe(false);
      expect(detectImageIntent(m).wants, m).toBe(true);
    }
  });
});

describe('§3 "I changed N files" counts what this turn authored', () => {
  const graph = { files: ['src/App.tsx'], symbols: [], components: ['App'], routes: [], imports: {}, dependencies: [] } as never;

  it('an edit that wrote 2 files says 2, whatever our passes added', () => {
    const text = summarizeProject(graph, REAL, { editMode: true, changedFiles: 2, changedPaths: ['src/App.tsx', 'src/index.css'], platformAdded: 8 });
    expect(text.split('\n')[0]).toBe('✅ Done — I changed 2 files in your project (src/App.tsx, src/index.css). Overview:');
  });

  it('nothing authored but launch files added is not "no files were changed"', () => {
    const text = summarizeProject(graph, REAL, { editMode: true, changedFiles: 0, changedPaths: [], platformAdded: 4 });
    const first = text.split('\n')[0];
    expect(first).toContain('none of your files were changed');
    expect(first).toContain('4 launch files');
    expect(isProjectSummaryNarration(text)).toBe(true);
  });
});

describe('§4 a stylesheet too large to inline does not give the lean review its tools back', () => {
  it('only a stylesheet omitted ⇒ one call, no tools', () => {
    expect(leanReviewAnswersInOneCall({ files: [{ path: 'src/App.tsx', content: 'x' }], omitted: ['src/index.css'] })).toBe(true);
  });

  it('any other omitted file, or nothing inlined, keeps the tools', () => {
    expect(leanReviewAnswersInOneCall({ files: [{ path: 'src/App.tsx', content: 'x' }], omitted: ['src/Big.tsx'] })).toBe(false);
    expect(leanReviewAnswersInOneCall({ files: [], omitted: ['src/index.css'] })).toBe(false);
  });

  it('the instruction says there are no tools, instead of "read one"', () => {
    const text = reviewerInstruction({
      userRequest: REAL, fileTree: ['src/App.tsx', 'src/index.css'], fileSample: [], changedFiles: ['src/App.tsx', 'src/index.css'],
      mode: 'suggest', inlineFiles: { files: [{ path: 'src/App.tsx', content: 'export default 1' }], omitted: ['src/index.css'] },
    } as never);
    expect(text).toContain('You have no tools in this review');
    expect(text).not.toContain('read one only if a finding depends on it');
  });
});
