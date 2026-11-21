/**
 * failedbr #690 (queue Q-3214): "Build a campus connect website which is provided in the image" arrived with no
 * image. The builder globbed for one, found none, and spent 29 minutes on a generic guess without a word to the user.
 * The design IS the image: with nothing attached, the honest answer is to ask for it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assessBuildInput, pointsAtAnImage, divertsToChat, steerForUnbuildable, MISSING_IMAGE_STEER } from '../src/server/AgentV3/buildableInput';

describe('a request that builds from an image', () => {
  it.each([
    'Build a campus connect website which is provided in the image',
    'make this app exactly like the attached screenshot',
    'Create the landing page as shown in the image',
    'build the dashboard based on the design image',
    'is photo jaisa app bana do',
    'screenshot me diya hai waisa website banao',
    'इस फोटो जैसा ऐप बनाओ',
  ])('%s', (p) => {
    expect(pointsAtAnImage(p)).toBe(true);
    const v = assessBuildInput(p);
    expect(divertsToChat(v)).toBe(true);
  });

  it.each([
    'Build an app that counts people in the image',
    'a photo gallery app with upload',
    'image editor with filters and crop',
    'Build a todo app with due dates',
    'photo me filter lagane wala app banao',
  ])('🔒 an app that works ON images, or no image at all, is untouched: %s', (p) => {
    expect(pointsAtAnImage(p)).toBe(false);
  });

  it('the chat is told to ask — only when nothing is attached', () => {
    expect(steerForUnbuildable('image-missing', 0)).toBe(MISSING_IMAGE_STEER);
    expect(steerForUnbuildable('image-missing', 1)).toBe('');
    expect(steerForUnbuildable('link-only', 0)).toBe('');
    expect(MISSING_IMAGE_STEER).toMatch(/Do not build, do not guess the design/);
  });

  it('wired: the route diverts it to chat (no attachment, import or edit) and steers the reply', () => {
    const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain('divertsToChat(inputCheck) // empty, link-only, or an image it points at that is not attached (Q-3214)');
    expect(route).toContain("+ (inputCheck.buildable ? '' : steerForUnbuildable(inputCheck.reason, rawAttachments.length))");
    const at = route.indexOf('divertsToChat(inputCheck)');
    expect(route.slice(at, at + 900)).toContain('&& rawAttachments.length === 0');
  });
});
