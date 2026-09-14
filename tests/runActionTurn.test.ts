/**
 * "Run it" — build 7bc15e40, 2026-09-13, a real user (not the admin).
 *
 * The whole prompt was **"Run it"** on a 33-file project. The engine read package.json, started the
 * dev server, published a live preview and took a screenshot. It wrote no files, because running an
 * app does not write one. The platform then told that user:
 *
 *     "The build produced no files. Please try again — you have not been charged."
 *     "✨ Your app needs our strongest engine to finish cleanly. Add credits…"
 *
 * Their app was up on the preview at that moment. We reported a success as a failure and asked for
 * money to fix it.
 *
 * THE DANGEROUS DIRECTION IS THE OTHER ONE, so most of this file is about what must STILL fail:
 * a "build me an app" that wrote nothing, and a turn that never ran anything, are failures and stay
 * failures. The excuse needs two pieces of POSITIVE evidence, never the absence of something.
 */
import { describe, it, expect } from 'vitest';
import { asksToRunNotChange, emptyTurnWasLegitimate } from '../src/server/AgentV3/runActionTurn';

const ran = {
  isEditMode: true,
  existingProjectFiles: 33,
  userAskedToBuildAnApp: false,
  prompt: 'Run it',
  appWasRunAndShown: true,
};

describe('asksToRunNotChange — the request, when it only ever asks to run or look', () => {
  it('THE REPORTED PROMPT', () => {
    expect(asksToRunNotChange('Run it')).toBe(true);
  });

  it('the ordinary ways people say it', () => {
    for (const p of [
      'run it', 'Run it.', 'run', 'rerun it', 'please run it', 'just run it',
      'start it', 'start the server', 'restart it', 'launch it',
      'show me the preview', 'open the preview', 'preview',
      'is it working?', 'does it work', 'is the app running?',
    ]) expect(asksToRunNotChange(p), p).toBe(true);
  });

  it('Hinglish, because that is what this product’s users type', () => {
    for (const p of ['chalao', 'chala do', 'isko chalao', 'app chalu karo'])
      expect(asksToRunNotChange(p), p).toBe(true);
  });

  it('🔒 A CHANGE VERB VETOES IT, however the sentence begins', () => {
    // "run it and add a login page" is a build request with a run bolted on the front. A turn that
    // wrote nothing has NOT done it, and must not be excused.
    for (const p of [
      'run it and add a login page',
      'run it then fix the header',
      'start the server and install tailwind',
      'chalao aur ek button add karo',
    ]) expect(asksToRunNotChange(p), p).toBe(false);
  });

  it('a run word buried in PROSE ABOUT the app is not an order to start it', () => {
    for (const p of [
      'the app should run a report every night',
      'make it run faster',
      'why does it not run',
    ]) expect(asksToRunNotChange(p), p).toBe(false);
  });

  it('an ordinary edit request is never a run action', () => {
    for (const p of [
      'make the button blue',
      'add dark mode',
      'the login page is broken',
      'ek billing app banao',
    ]) expect(asksToRunNotChange(p), p).toBe(false);
  });

  it('a long message is not a bare run order, whatever it opens with', () => {
    expect(asksToRunNotChange(`run it ${'x'.repeat(200)}`)).toBe(false);
  });

  it('junk input never throws and never excuses anything', () => {
    for (const p of ['', '   ', null as never, undefined as never])
      expect(asksToRunNotChange(p)).toBe(false);
  });
});

describe('emptyTurnWasLegitimate — both pieces of evidence, or nothing', () => {
  it('THE REPORTED BUILD: run request + the app really came up ⇒ writing nothing was correct', () => {
    expect(emptyTurnWasLegitimate(ran)).toBe(true);
  });

  it('🔒 "build me an app" that wrote nothing is STILL a failure', () => {
    // The 5b4f9b63 protection: a build request reclassified as an edit by a non-empty workspace has
    // still produced nothing, whatever the turn was called.
    expect(emptyTurnWasLegitimate({ ...ran, userAskedToBuildAnApp: true })).toBe(false);
  });

  it('🔒 THE EVIDENCE HALF: the word "run" alone excuses nothing', () => {
    // A turn that claimed to run the app but never brought it up is exactly the failure this must
    // never start hiding.
    expect(emptyTurnWasLegitimate({ ...ran, appWasRunAndShown: false })).toBe(false);
  });

  it('🔒 an ordinary edit that wrote nothing is STILL a failure, even with a live preview', () => {
    expect(emptyTurnWasLegitimate({ ...ran, prompt: 'make the button blue' })).toBe(false);
  });

  it('a fresh build is never excused — there is no existing app to run', () => {
    expect(emptyTurnWasLegitimate({ ...ran, isEditMode: false })).toBe(false);
    expect(emptyTurnWasLegitimate({ ...ran, existingProjectFiles: 0 })).toBe(false);
  });

  it('never throws on a malformed fact bag', () => {
    expect(emptyTurnWasLegitimate(null as never)).toBe(false);
  });
});
