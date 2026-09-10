import { describe, it, expect } from 'vitest';
import { describePickedElement, pickedElementPrompt } from '../src/components/agentv3/previewPick';

describe('describePickedElement — a sentence a person could check', () => {
  it('names the element the way somebody would say it out loud', () => {
    expect(describePickedElement({ tag: 'BUTTON'.toLowerCase(), text: 'Book now', section: 'Recent Orders', path: '/dashboard' }))
      .toBe('the <button> that says "Book now" under the heading "Recent Orders" on the /dashboard page');
  });

  it('falls back to the id when the element has no words of its own', () => {
    expect(describePickedElement({ tag: 'div', id: 'hero', path: '/' }))
      .toBe('the <div> with id "hero"');
  });

  it('says WHICH one when there are several of the same kind', () => {
    expect(describePickedElement({ tag: 'li', text: 'Milk', position: '(3 of 7)' }))
      .toContain('item 3 of 7 of its kind');
  });

  it('returns nothing when there is nothing identifying to say', () => {
    // Handing the AI "the <div>" and no more is worse than not offering the action: it looks like it
    // worked, and then edits the wrong thing.
    expect(describePickedElement({})).toBe('');
    expect(describePickedElement(null)).toBe('');
    expect(describePickedElement(undefined)).toBe('');
    expect(pickedElementPrompt({ tag: '', text: '', id: '' })).toBe('');
  });

  it('omits the page when the app is on its home page anyway', () => {
    expect(describePickedElement({ tag: 'h1', text: 'Welcome', path: '/' })).not.toContain('page');
  });
});

import { readFileSync } from 'fs';
import { join } from 'path';
import { previewBridgeSource } from '../src/server/AgentV3/previewBridge';

const surface = readFileSync(join(__dirname, '..', 'src/components/agentv3/PreviewSurface.tsx'), 'utf8');

describe('the picker, wired', () => {
  it('swallows the click it is picking, so a form is never submitted by accident', () => {
    const js = previewBridgeSource('live');
    expect(js).toContain('e.preventDefault(); e.stopPropagation();');
    expect(js).toContain('stopImmediatePropagation');
    // Capture phase: the app's own handlers must not have run before we suppress them.
    expect(js).toContain('}, true);');
  });

  it('describes the element by its nearest heading, the way a person would', () => {
    expect(previewBridgeSource('live')).toContain('DOCUMENT_POSITION_FOLLOWING');
  });

  it('disarms itself after one pick, so the app is never left un-clickable', () => {
    expect(previewBridgeSource('live')).toContain('pickMode = false; clearOutline();');
  });

  it('the panel disarms it when the user leaves the Live preview', () => {
    // A control left armed invisibly is worse than no control: the next tap would do nothing and the
    // user would have no way to guess why.
    expect(surface).toContain("if (mode !== 'live' && picking)");
    expect(surface).toContain('__nbaiPickMode: false');
  });

  it('never claims to have picked something it cannot identify', () => {
    expect(surface).toContain('That element has nothing to identify it');
  });
});
