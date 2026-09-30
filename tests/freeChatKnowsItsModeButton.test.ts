/**
 * NavBharatAI FREE and its Mode button (admin 2026-09-30):
 *   "navbharatai photo nahi banata hai = sahi hai, banana bhi nahi hai! … navbharatai free ko pata hi
 *    nahi photo kaha banegi! … navbharatai free ko mode aur uske andar jo hai, sabke bare me batao!!"
 *
 * The free chat must (1) not make pictures itself, (2) send a picture request to
 * Mode → Image Generator AI, and (3) know everything the Mode sheet really lists.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  freeChatModeGuide, modeExperts, FREE_IMAGE_REQUEST_DIRECTIVE, IMAGE_STUDIO_MODE_NAME,
} from '../src/server/lib/freeChatModeGuide';
import { newModeEntries, IMAGE_MODE_NAME } from '../src/components/chat/modePicker';
import { isMedicalProfessionalId } from '../src/lib/playCompliance';
import { imageGenGuidance } from '../src/server/lib/imageIntent';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('the guide describes the Mode sheet the user actually sees', () => {
  const guide = freeChatModeGuide();

  it('names the picture studio exactly as the Mode sheet does', () => {
    expect(IMAGE_STUDIO_MODE_NAME).toBe(IMAGE_MODE_NAME);
    expect(guide).toContain(`**${IMAGE_MODE_NAME}**`);
    expect(guide).toMatch(/THE place where pictures are made/);
  });

  it('lists EVERY row of the Mode sheet\'s "New chat" group — nothing the user can tap is missing', () => {
    const rows = newModeEntries({ hideMedical: false });
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) expect(guide, `missing "${row.name}"`).toContain(row.name);
  });

  it('promises no expert the Mode sheet does not show', () => {
    const shown = new Set(newModeEntries({ hideMedical: false }).map((r) => r.name));
    for (const e of modeExperts()) expect(shown.has(e.name), `"${e.name}" is not in the Mode sheet`).toBe(true);
  });

  it('says which experts the phone app hides, from the same rule the phone app uses', () => {
    const hiddenOnPhone = newModeEntries({ hideMedical: false })
      .filter((r) => r.kind === 'professional' && isMedicalProfessionalId(r.id))
      .map((r) => r.name);
    expect(hiddenOnPhone.length).toBeGreaterThan(0);
    const line = guide.split('\n').find((l) => l.includes('phone app does not show them')) ?? '';
    for (const name of hiddenOnPhone) expect(line).toContain(name);
  });

  it('knows Pro is not in Mode, and never names a provider (white-label)', () => {
    expect(guide).toMatch(/NavBharatAI Pro .* is NOT in Mode/);
    const lower = `${guide} ${FREE_IMAGE_REQUEST_DIRECTIVE}`.toLowerCase();
    for (const vendor of ['pollinations', 'gemini', 'grok', 'glm', 'kimi', 'claude', 'openai', 'flux']) {
      expect(lower).not.toContain(vendor);
    }
  });
});

describe('the free chat route', () => {
  const chat = read('src/server/routes/chat.ts');

  it('carries the Mode guide in the free system prompt every turn', () => {
    expect(chat).toMatch(/systemPrompt = buildFreeSystemPrompt\([^)]*\)\);\s*\/\/[^\n]*\n[^\n]*\n\s*systemPrompt = `\$\{systemPrompt\}\\n\\n\$\{freeChatModeGuide\(\)\}`;/);
  });

  it('does not make a picture — the inline generator is gone', () => {
    expect(chat).not.toContain('fetchPollinationsImage(');
    expect(chat).not.toContain('Ye rahi aapki image');
  });

  it('a free picture request reaches the model with the directive that points to Mode', () => {
    expect(chat).toContain('if (imgIntent.wants && isFree) {');
    expect(chat).toContain('systemPrompt = `${systemPrompt}\\n\\n${FREE_IMAGE_REQUEST_DIRECTIVE}`;');
    expect(FREE_IMAGE_REQUEST_DIRECTIVE).toContain(`**Mode** (below this chat) → **${IMAGE_MODE_NAME}**`);
  });

  it('the fixed guidance (Professionals, Pro, the photo-edit replies) leads with the Mode route', () => {
    const g = imageGenGuidance();
    expect(g.indexOf(`Mode → ${IMAGE_MODE_NAME}`)).toBeGreaterThan(-1);
    expect(g.indexOf(`Mode → ${IMAGE_MODE_NAME}`)).toBeLessThan(g.indexOf('Home → Other AI → AI Image Gen'));
  });
});

describe('the phone never answers the free chat with a canned "Pro only" line', () => {
  const engine = read('src/hooks/useChatEngine.ts');

  it('the "Building applications is only available for NavBharatAI-Pro" refusal is gone', () => {
    expect(engine).not.toContain('text: "⚠️ Building applications is only available');
    expect(engine).toContain("if (currentAgent !== 'navbharatai' && !user) {");
  });

  it('a GitHub question is a whole word, never "digital" or "report"', () => {
    const src = engine.match(/const githubTriggers = (\/.*\/i);/)?.[1] ?? '';
    // eslint-disable-next-line no-new-func
    const re = new Function(`return ${src};`)() as RegExp;
    expect(re.test('connect my github repo')).toBe(true);
    expect(re.test('git push kaise kare')).toBe(true);
    expect(re.test('digital marketing kaise kare')).toBe(false);
    expect(re.test('project report likho')).toBe(false);
    expect(re.test('push notification kya hai')).toBe(false);
  });
});
