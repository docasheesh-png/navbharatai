/**
 * failedbr #684 (queue Q-3212): "Create a ppt on any randomly product" was built as a web app with a "Download
 * .pptx" button for 29 minutes, and the user got no deck. NavBharatAI cannot write a .pptx yet, so the honest
 * answer is the deck written in the chat — never a build, never a fake file.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shouldAnswerPresentationRequest, PRESENTATION_REQUEST_STEER, presentationRequestFallback } from '../src/server/AgentV3/presentationRequest';

const asks = (prompt: string) => shouldAnswerPresentationRequest({ prompt, env: {} });

describe('a deck request is answered, not built', () => {
  it.each([
    'Create a ppt on any randomly product',
    'make a presentation on climate change for my class',
    'Global warming par ek ppt bana do',
    'मेरे लिए डिजिटल इंडिया पर प्रेजेंटेशन बनाओ',
    'prepare 10 slides on the solar system',
  ])('%s', (p) => expect(asks(p)).toBe(true));

  it.each([
    'Build a presentation maker app where users design slides',
    'make a website to show my ppt slides',
    'how to make a good ppt',
    'Build a quiz app for my class',
    'add a slides section to my app',
  ])('🔒 left to the builder / chat as before: %s', (p) => expect(asks(p)).toBe(false));

  it('never claims a file: the steer and the fallback both say a .pptx is not available yet', () => {
    expect(PRESENTATION_REQUEST_STEER).toMatch(/cannot create a downloadable \.pptx/);
    expect(PRESENTATION_REQUEST_STEER).toMatch(/never offer a download/);
    expect(presentationRequestFallback()).toMatch(/not available yet/);
    expect(asks.length).toBe(1);
    expect(shouldAnswerPresentationRequest({ prompt: 'Create a ppt on India', env: { AGENTV3_PRESENTATION_ANSWER: 'off' } })).toBe(false);
  });

  it('a picture still takes its own steer and fallback through the shared lane', async () => {
    const { deliverableSteer, deliverableFallback, shouldAnswerDeliverableRequest } = await import('../src/server/AgentV3/presentationRequest');
    const { PICTURE_REQUEST_STEER, pictureRequestFallback } = await import('../src/server/AgentV3/pictureRequest');
    expect(deliverableSteer('Create a ppt on India')).toBe(PRESENTATION_REQUEST_STEER);
    expect(deliverableSteer('Create full image of a sunset')).toBe(PICTURE_REQUEST_STEER);
    expect(deliverableFallback('Create full image of a sunset')).toBe(pictureRequestFallback());
    // A deck is a deck even when the user has an app; a picture defers to the app as before.
    expect(shouldAnswerDeliverableRequest({ prompt: 'Create a ppt on India', userAppExists: true, env: {} })).toBe(true);
  });

  it('wired: the route answers pictures and decks on one chat lane, with their steer and fallback, never a build', () => {
    const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain('!answerSpreadsheet && (readerPicture || shouldAnswerDeliverableRequest({');
    expect(route).toContain("+ (answerPictureRequest ? deliverableSteer(prompt) : '')");
    expect(route).toContain("? deliverableFallback(prompt)");
    expect(route).toContain('if (answerProjectElsewhere || answerPictureRequest) return null;');
  });
});
