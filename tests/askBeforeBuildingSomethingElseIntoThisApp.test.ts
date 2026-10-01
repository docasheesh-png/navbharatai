// ADMIN 2026-09-30, on autopsy 1389f0d5 ("Generate a pdf on genesis 4 …" built INTO a calculator):
// "puch lo user se!" — when a build order names a whole new thing that has nothing to do with the app
// already here, the turn ASKS (add it to this app, or make a new app) instead of building either way.
// The test is narrow on purpose: an ordinary edit is the commonest turn there is and must never meet a
// question. Locked here:
//   1. the two real cases ask; ordinary edits, related orders and orders pointing at "this app" do not;
//   2. when we cannot tell (no listing, nothing named) we do not ask — the old behaviour exactly;
//   3. the route answers in chat with the question, never builds, never caches it, never falls through.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unrelatedToExistingApp, unrelatedRequestSteer, unrelatedRequestFallback } from '../src/server/AgentV3/unrelatedRequest';

const CALCULATOR = ['src/App.tsx', 'src/main.tsx', 'src/calculator.css', 'src/components/Keypad.tsx', 'src/components/Display.tsx', 'src/types.ts', 'package.json'];
const CALENDAR = ['src/App.tsx', 'src/pages/CalendarPage.tsx', 'src/components/DayCell.tsx', 'src/components/AddEventModal.tsx', 'src/components/Header.tsx', 'src/store/eventStore.ts', 'src/utils/dateUtils.ts', 'src/types.ts'];
const ask = (prompt: string, paths: string[] | null, earlier: string[] = []) =>
  unrelatedToExistingApp({ prompt, paths, earlierBuildRequests: earlier }, {}).ask;

describe('1 · it asks only about a whole new thing that shares nothing with this app', () => {
  it('🔴 the report: a Genesis-4 PDF on a calculator', () => {
    expect(ask('Generate a pdf on genesis 4 with added images with this photo type uploaded', CALCULATOR, ['Make a calculator app'])).toBe(true);
  });
  it('🔴 a different app on a calendar', () => {
    expect(ask('ek todo app bnao', CALENDAR, ['Calendar wala app bnao'])).toBe(true);
    expect(ask('Make a racing game', CALENDAR)).toBe(true);
  });
  it('🔒 an edit is never asked about', () => {
    expect(ask('Install button do', CALENDAR)).toBe(false);
    expect(ask('dark mode add karo', CALENDAR)).toBe(false);
    expect(ask('Continue from where you left off and finish/fix the build so the app works end-to-end.', CALENDAR)).toBe(false);
  });
  it('🔒 PRECISION LOCK — ordinary changes to the app that is here never meet a question', () => {
    const edits = [
      'Make it look like a professional website', 'make it mobile friendly app', 'isko ek proper app bana do',
      'Convert it into a PWA app', 'App ko PWA bana do', 'website jaisa design karo', 'Add a store page for products',
      'Ek dashboard page add karo', 'Make the app faster', 'Publish the website', 'App me login system add karo',
      'Make a pdf export of events', 'Add pdf download of the month', 'Make this an installable app',
      'android app bana do', 'iska apk bana do', 'create a game mode', 'Make it a game', 'App ko Hindi me kar do',
      'Website bana do', 'Make a blog section', 'Create a landing page for this calendar',
    ];
    const asked = edits.filter((p) => ask(p, CALENDAR, ['Calendar wala app bnao']));
    expect(asked).toEqual([]);
  });
  it('a genuinely different product is still asked about', () => {
    expect(ask('Build an e-commerce website for my shop', CALENDAR)).toBe(true);
    expect(ask('Mujhe ek quiz game chahiye', CALENDAR)).toBe(true);
  });
  it('🔒 an order about the same app, or pointing at it, is not asked about', () => {
    expect(ask('Calendar wala app bnao', CALENDAR)).toBe(false);
    expect(ask('Event reminder app banao', CALENDAR)).toBe(false);
    expect(ask('add a login page to this app', CALENDAR)).toBe(false);
    expect(ask('isme ek reminder app jaisa feature add karo', CALENDAR)).toBe(false);
    expect(ask('add it to this app', CALCULATOR)).toBe(false);
    expect(ask('isi app mein jodo', CALCULATOR)).toBe(false);
  });
  it('🔒 when we cannot tell, we do not ask', () => {
    expect(ask('Build a todo app', null)).toBe(false);
    expect(ask('Build a todo app', ['src/App.tsx', 'src/main.tsx'])).toBe(false); // only our scaffold
    expect(ask('ek app bnao', CALENDAR)).toBe(false); // nothing named
  });
  it('the kill switch', () => {
    expect(unrelatedToExistingApp({ prompt: 'ek todo app bnao', paths: CALENDAR, earlierBuildRequests: [] }, { AGENTV3_ASK_UNRELATED: 'off' }).ask).toBe(false);
  });
});

describe('2 · what the user is asked', () => {
  it('both choices, and how to take each — the new app in its own chat, keeping this one', () => {
    const s = unrelatedRequestSteer('Keypad, Display', false);
    expect(s).toMatch(/Do NOT build anything/);
    expect(s).toMatch(/add it to this app/);
    expect(s).toMatch(/New chat/);
    expect(s).toMatch(/user's own language/);
    expect(unrelatedRequestSteer('', true)).toMatch(/attach it again/);
    expect(unrelatedRequestFallback('Keypad')).toMatch(/add it to this app[\s\S]*New chat/);
  });
});

describe('3 · the route', () => {
  const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
  it('🔴 an unrelated order becomes the question, before the order is turned into an edit', () => {
    const i = route.indexOf('const askUnrelated = unrelated?.ask === true;');
    expect(i).toBeGreaterThan(0);
    const after = route.slice(i, i + 800);
    expect(after).toMatch(/if \(askUnrelated\) \{[\s\S]*intent = 'chat';[\s\S]*\} else if \(intent === 'new_build' && userAppExists/);
  });
  it('the chat reply carries the steer, is never cached, and never falls through to a build', () => {
    expect(route).toContain("(askUnrelated ? unrelatedRequestSteer(unrelated?.existingHint ?? '', rawAttachments.length > 0) : '')");
    expect(route).toMatch(/!askUnrelated && [^;]*chatCacheEnabled\(\);/);
    expect(route).toContain('if (askUnrelated) return null;');
    expect(route).toContain("unrelatedRequestFallback(unrelated?.existingHint ?? '')");
  });
});
