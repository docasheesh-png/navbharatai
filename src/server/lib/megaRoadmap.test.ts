import { describe, it, expect } from 'vitest';
import {
  megaRoadmapSystemPrompt,
  megaRoadmapUserPrompt,
  parseMegaRoadmap,
  roadmapGuardrail,
  summarizeRoadmapForDiag,
  MIN_ROADMAP_STEPS,
  MAX_ROADMAP_STEPS,
} from './megaRoadmap';

const goodJson = JSON.stringify({
  userMessage: 'This is a big app, so I will build the working core first — a real preview in a few minutes — then the rest arrives as simple next steps you can tap one at a time.',
  achievableSummary: 'A working photo-sharing app you can use right away.',
  note: null,
  steps: [
    { title: 'Feed + posts', goal: 'See a scrollable feed and open a post', buildPrompt: 'Build a photo feed screen with sample posts, likes, and a post detail view using local mock data.', needsInfra: null },
    { title: 'Upload a photo', goal: 'Pick and post a photo that appears in the feed', buildPrompt: 'Add an upload screen that lets the user pick an image and adds it to the top of the feed (client-side).', needsInfra: null },
    { title: 'Direct messages', goal: 'Chat with another user in real time', buildPrompt: 'Add a direct-messages screen between two users.', needsInfra: 'a real-time messaging server' },
  ],
});

describe('megaRoadmap — prompts', () => {
  it('system prompt is honest, JSON-strict, white-label, and asks for a user-language message', () => {
    const s = megaRoadmapSystemPrompt();
    expect(s).toMatch(/strict JSON/i);
    expect(s).toMatch(/honest/i);
    expect(s).toMatch(/NEVER mention any AI vendor/i);
    expect(s).toMatch(/same[\s\S]*language/i);
    expect(s).toMatch(/userMessage/);
    expect(s).toMatch(/THEIR OWN LANGUAGE/i);
  });
  it('user prompt carries the request, the famous name (as inspiration, not copy), and signals', () => {
    const u = megaRoadmapUserPrompt('make an app like Instagram', 'Instagram', ['asks to clone Instagram']);
    expect(u).toMatch(/make an app like Instagram/);
    expect(u).toMatch(/Instagram/);
    expect(u).toMatch(/ORIGINAL app inspired by it/i);
    expect(u).toMatch(/asks to clone Instagram/);
  });
  it('user prompt is safe with no famous name and truncates a huge request', () => {
    const u = megaRoadmapUserPrompt('x'.repeat(9000), null, []);
    expect(u.length).toBeLessThan(5000);
    expect(u).not.toMatch(/resembles/);
  });
});

describe('megaRoadmap — parsing', () => {
  it('parses clean JSON', () => {
    const p = parseMegaRoadmap(goodJson, 'Instagram');
    expect(p).not.toBeNull();
    expect(p!.steps).toHaveLength(3);
    expect(p!.steps[2].needsInfra).toMatch(/real-time/);
  });
  it('tolerates ```json fences and surrounding prose', () => {
    const wrapped = 'Sure! Here is the roadmap:\n```json\n' + goodJson + '\n```\nHope this helps.';
    const p = parseMegaRoadmap(wrapped, null);
    expect(p).not.toBeNull();
    expect(p!.steps).toHaveLength(3);
  });
  it('returns null on unparseable / non-JSON / missing steps', () => {
    expect(parseMegaRoadmap('no json here', null)).toBeNull();
    expect(parseMegaRoadmap('{ not valid json', null)).toBeNull();
    expect(parseMegaRoadmap(JSON.stringify({ achievableSummary: 'x' }), null)).toBeNull();
  });
  it('never throws on junk', () => {
    expect(() => parseMegaRoadmap('', null)).not.toThrow();
    expect(() => parseMegaRoadmap(null as never, null)).not.toThrow();
  });
});

describe('megaRoadmap — guardrail (the honest gate)', () => {
  it('accepts a real roadmap and re-numbers steps 1..n', () => {
    const { roadmap } = roadmapGuardrail(parseMegaRoadmap(goodJson, 'Instagram'), 'Instagram');
    expect(roadmap).not.toBeNull();
    expect(roadmap!.steps.map((s) => s.n)).toEqual([1, 2, 3]);
    expect(roadmap!.famousApp).toBe('Instagram');
    expect(roadmap!.userMessage).toMatch(/big app/i); // model-authored user-facing intro carried through
  });

  it('falls back userMessage to achievableSummary when the model omits it (never a hardcoded English default)', () => {
    const noMsg = JSON.stringify({
      achievableSummary: 'Ek chalti-phirti photo app.', note: null,
      steps: [
        { title: 'Feed', goal: 'posts dikhein', buildPrompt: 'Build a photo feed with sample posts.', needsInfra: null },
        { title: 'Upload', goal: 'photo daalein', buildPrompt: 'Add an upload screen that adds to the feed.', needsInfra: null },
      ],
    });
    const { roadmap } = roadmapGuardrail(parseMegaRoadmap(noMsg, null), null);
    expect(roadmap!.userMessage).toBe('Ek chalti-phirti photo app.'); // user's language preserved, no English injected
  });

  it('flags an infra ceiling even when the model did NOT declare needsInfra', () => {
    const sneaky = JSON.stringify({
      achievableSummary: 'A game', note: null,
      steps: [
        { title: 'Core loop', goal: 'move and shoot', buildPrompt: 'Build a single-player shooter core loop on a canvas.', needsInfra: null },
        { title: 'Battle royale', goal: 'play with 100 real players', buildPrompt: 'Add a 100-player multiplayer battle royale mode.', needsInfra: null },
      ],
    });
    const { roadmap } = roadmapGuardrail(parseMegaRoadmap(sneaky, 'PUBG'), 'PUBG');
    expect(roadmap).not.toBeNull();
    expect(roadmap!.steps[1].infraCeiling).toBe(true); // caught by INFRA_RE, not the model
    // and an honest note is synthesised because a ceiling exists and the model gave none
    expect(roadmap!.note).toMatch(/infrastructure/i);
  });

  it('rejects vague / empty build instructions and duplicate steps', () => {
    const junk = JSON.stringify({
      achievableSummary: 'x', note: null,
      steps: [
        { title: 'Real core', goal: 'works', buildPrompt: 'Build a working todo core with add/complete/delete.', needsInfra: null },
        { title: 'More', goal: 'more', buildPrompt: 'etc', needsInfra: null },                 // vague → rejected
        { title: 'Polish', goal: 'polish', buildPrompt: 'polish', needsInfra: null },          // vague title+bp → rejected
        { title: 'Real core', goal: 'again', buildPrompt: 'Build the same core again here.', needsInfra: null }, // dup → rejected
        { title: 'Second real', goal: 'works', buildPrompt: 'Add filtering, sorting, and a counter to the list.', needsInfra: null },
      ],
    });
    const { roadmap, rejected } = roadmapGuardrail(parseMegaRoadmap(junk, null), null);
    expect(roadmap).not.toBeNull();
    expect(roadmap!.steps).toHaveLength(2); // only the 2 real, unique steps survive
    expect(rejected.length).toBeGreaterThanOrEqual(3);
  });

  it('returns null when too few real steps survive (caller builds directly instead)', () => {
    const thin = JSON.stringify({
      achievableSummary: 'x', note: null,
      steps: [
        { title: 'Only one', goal: 'works', buildPrompt: 'Build one real screen with a working form.', needsInfra: null },
        { title: 'Vague', goal: 'x', buildPrompt: '...', needsInfra: null },
      ],
    });
    const { roadmap } = roadmapGuardrail(parseMegaRoadmap(thin, null), null);
    expect(roadmap).toBeNull(); // 1 valid < MIN_ROADMAP_STEPS
    expect(MIN_ROADMAP_STEPS).toBe(2);
  });

  it('caps the roadmap at MAX_ROADMAP_STEPS', () => {
    const many = JSON.stringify({
      achievableSummary: 'x', note: null,
      steps: Array.from({ length: MAX_ROADMAP_STEPS + 3 }, (_, i) => ({
        title: `Step ${i + 1}`, goal: `goal ${i + 1}`, buildPrompt: `Build real feature number ${i + 1} with visible UI.`, needsInfra: null,
      })),
    });
    const { roadmap } = roadmapGuardrail(parseMegaRoadmap(many, null), null);
    expect(roadmap!.steps).toHaveLength(MAX_ROADMAP_STEPS);
    expect(roadmap!.steps[roadmap!.steps.length - 1].n).toBe(MAX_ROADMAP_STEPS);
  });

  it('is null-safe on a null parse', () => {
    expect(roadmapGuardrail(null, null).roadmap).toBeNull();
  });

  it('summarizeRoadmapForDiag is compact and marks infra steps', () => {
    const { roadmap } = roadmapGuardrail(parseMegaRoadmap(goodJson, 'Instagram'), 'Instagram');
    const line = summarizeRoadmapForDiag(roadmap!);
    expect(line).toMatch(/3 checkpoint/);
    expect(line).toMatch(/\[infra\]/);
  });
});
