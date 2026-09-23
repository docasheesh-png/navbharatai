/**
 * "Image badal jane ka dar" — the admin's own words, 2026-09-21, and the specification for this
 * whole change: somebody uploads their photograph, asks for one thing to change, and must get THEIR
 * photograph back with that one thing changed.
 *
 * Several asks landed together and they are one feature: image→image (3), free chat's
 * image+text→image done properly (4), and a crop/resize control with +/0/− (5).
 *
 * ⚠️ SEVERAL OF THESE ARE SOURCE-LEVEL, and deliberately: `tsc` and `vitest` cannot see that an
 * art-direction layer is being applied to an edit, that a text-to-image rung is allowed to answer an
 * edit request, or that a picker no longer renders its crop control. Every one of those fails
 * silently by returning a picture.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  PRESERVE_DIRECTIVE, REIMAGINE_DIRECTIVE,
  buildEditInstruction, editIntentFor, looksLikeImageEdit,
} from '../src/lib/imageEdit';
import {
  IDENTITY_VIEW, MAX_ZOOM, MIN_ZOOM, ZOOM_STEP, clampView, coverScale, dragToFrame, drawRect,
  isIdentityView, zoomBy,
} from '../src/lib/imageCrop';
import { PRESET_PIXELS, pixelsForSize, CUSTOM_SIZE_ID } from '../src/lib/imageSize';
import { IMAGE_SIZE_PIXELS, isValidImageGenRequest } from '../src/server/lib/imageGen';
import { checkEditable } from '../src/server/lib/imageEditRun';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
/** Comments carry the reasoning, including the wording being corrected — never assert against them. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ROUTE = 'src/server/routes/imageGen.ts';
const CHAT = 'src/server/routes/chat.ts';
const FREE = 'src/components/ide/AIImageGenerator.tsx';

/**
 * Free chat's edit branch, sliced out of the file.
 *
 * ⚠️ The end anchor is the CALL `runVisionChain(visionAttachments`, never the bare name: that
 * appears in the import at the top of the file, so a bare anchor slices backwards and yields an
 * empty string — which every `toContain` then fails on, and every `not.toContain` passes on. A guard
 * that passes on an empty slice is the worst kind.
 */
function editBranch(body: string): string {
  const start = body.indexOf('looksLikeImageEdit(message)');
  const end = body.indexOf('runVisionChain(visionAttachments', start);
  const slice = body.slice(start, end);
  expect(slice.length, 'the edit branch could not be sliced — the anchors have moved').toBeGreaterThan(400);
  return slice;
}

// A 1×1 PNG — a real data URL, so `parseDataUrl` is exercised rather than mocked.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('🔒 what the model is told', () => {
  it('a directed edit carries the user’s words AND the promise about everything else', () => {
    const out = buildEditInstruction('make the awning blue');
    expect(out).toContain('make the awning blue');
    expect(out).toContain(PRESERVE_DIRECTIVE);
  });

  it('a picture with no words is a re-render, not an empty instruction', () => {
    expect(editIntentFor('')).toBe('reimagine');
    expect(editIntentFor('   ')).toBe('reimagine');
    expect(buildEditInstruction('')).toBe(REIMAGINE_DIRECTIVE);
  });

  it('the promise names the things a re-roll destroys', () => {
    // Each of these is a way "the same picture" comes back as a different one, and the wording is
    // the FREE tier's only fidelity control — its editing rung has no strength dial at all.
    for (const kept of ['same subject', 'identity', 'same pose', 'same framing', 'same background']) {
      expect(PRESERVE_DIRECTIVE.toLowerCase()).toContain(kept);
    }
  });
});

describe('🙋 an attached picture still means "read this", unless it clearly does not', () => {
  const EDITS = [
    'remove the background',
    'make the shirt red',
    'change the sky to sunset',
    'add a border around it',
    'erase the number plate',
    'background hata do',
    'isme shirt ka colour badal do',
    'logo laga do upar',
    'इसका बैकग्राउंड हटा दो',
    'photo theek karo',
  ];
  const QUESTIONS = [
    'what is this?',
    'what does this sign say',
    'read the text in this picture',
    'describe this image',
    'how many people are in this photo',
    'yeh kya hai',
    'isme kya likha hai',
    'kitne log hain',
    'इसमें क्या लिखा है',
    'explain this chart',
    'Please describe and analyze this image.',
  ];

  it('a clear instruction to change the picture is an edit', () => {
    for (const m of EDITS) expect(looksLikeImageEdit(m), m).toBe(true);
  });

  it('🔴 a question is answered, never acted on — the veto wins', () => {
    // Asymmetric on purpose: describing when they wanted an edit costs one more message; editing
    // when they wanted an answer replaces the picture they were asking about.
    for (const m of QUESTIONS) expect(looksLikeImageEdit(m), m).toBe(false);
  });

  it('a message carrying both is answered, because the answer is the reversible one', () => {
    expect(looksLikeImageEdit('what is this? remove the background')).toBe(false);
    expect(looksLikeImageEdit('remove the background')).toBe(true);
  });

  it('nothing at all is not an edit', () => {
    expect(looksLikeImageEdit('')).toBe(false);
    expect(looksLikeImageEdit('   ')).toBe(false);
    expect(looksLikeImageEdit('x'.repeat(3000))).toBe(false);
  });
});

describe('🔒 the free route treats an edit as an edit', () => {
  const src = read(ROUTE);
  const body = code(src);

  it('the request schema DECLARES the picture, or vobject would silently drop it', () => {
    // The same trap the custom size hit: a key the schema does not declare vanishes between the
    // client and the generator, and the attach button becomes a no-op with nothing failing.
    expect(body.split('initImage: vstring(').length - 1).toBeGreaterThanOrEqual(1);
  });

  it('🔴 the art-direction layer never reaches an edit', () => {
    // `craftImagePrompt` adds composition, framing and margin rules — every one an instruction to
    // RE-COMPOSE the photograph the user asked us to keep. The edit branch returns before `prompt`
    // (the crafted string) is ever used, by calling the shared runner with the user's own words.
    expect(body).toContain('runImageEdit(rawInit, editWords');
    expect(body).not.toContain('craftImagePrompt({ prompt: buildEditInstruction');
  });

  it('🔴 the free provider and the text-to-image rung are BOTH skipped for an edit', () => {
    // Pollinations cannot receive a picture that lives only in this request; the xAI endpoint is
    // text-to-image only. Either one answering would return a brand-new picture — a
    // successful-looking response that is exactly the failure being fixed.
    expect(body).toContain('pollinationsEnabled() && !editing');
    expect(body).toContain('geminiImageConfigured() && !editing');
    expect(body).toContain('editing ? null : grokImageKey()');
  });

  it('the edit is metered as the PAID rung it is', () => {
    // ⚠️ There are TWO `if (editing)` blocks — the up-front validation and this one. Anchor on the
    // call and walk back, or this asserts against the wrong branch and passes for the wrong reason.
    const at = body.indexOf('runImageEdit(rawInit');
    const branch = body.slice(body.lastIndexOf('if (editing) {', at), at + 200);
    expect(branch).toContain('allowPaidRung()');
    expect(branch.indexOf('allowPaidRung()')).toBeLessThan(branch.indexOf('runImageEdit'));
  });

  it('a picture with no words is a valid request; words with no picture are still required', () => {
    expect(isValidImageGenRequest({ initImage: PNG })).toBe(true);
    expect(isValidImageGenRequest({ prompt: 'a tiger' })).toBe(true);
    expect(isValidImageGenRequest({})).toBe(false);
    expect(isValidImageGenRequest({ prompt: '   ' })).toBe(false);
    expect(isValidImageGenRequest({ initImage: 42 })).toBe(false);
  });

  it('an unreadable or oversized picture is refused before any provider is called', () => {
    const bad = checkEditable('not a data url');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.outcome.badInput).toBeTruthy();
    const huge = checkEditable(`data:image/png;base64,${'A'.repeat(12 * 1024 * 1024)}`);
    expect(huge.ok).toBe(false);
    if (!huge.ok) expect(huge.outcome.badInput).toBeTruthy();
  });
});

describe('🔒 free chat changes the picture, or says why it cannot', () => {
  const body = code(read(CHAT));

  it('the edit branch runs BEFORE the describe path', () => {
    const edit = body.indexOf('looksLikeImageEdit(message)');
    const vision = body.indexOf('runVisionChain(visionAttachments');
    expect(edit).toBeGreaterThan(-1);
    expect(edit).toBeLessThan(vision);
  });

  it('🔴 it is metered — free chat had never had a paid rung before this', () => {
    const branch = editBranch(body);
    expect(branch).toContain('requireAccountForCostlyAi');
    expect(branch).toContain("gateToolAction(account.uid, account.email, 'image')");
    expect(branch).toContain("burnToolAction(gate.uid, 'image')");
    // The burn happens on DELIVERY. A failed edit costs the user nothing — the same "working result
    // or free" law a build obeys.
    expect(branch.indexOf('out.image')).toBeLessThan(branch.indexOf("burnToolAction(gate.uid, 'image')"));
  });

  it('it never silently falls back to describing the picture instead', () => {
    // The user asked for a change; a reply that quietly describes the photo answers a question they
    // did not ask and hides that nothing happened.
    const branch = editBranch(body);
    expect(branch).not.toContain('runVisionChain');
    expect(branch).toContain('imageGenGuidance()');
  });

  it('it uses the SHARED runner, never its own copy of the edit rule', () => {
    const branch = editBranch(body);
    expect(branch).toContain("import('../lib/imageEditRun')");
    expect(branch).not.toContain('generateContent');
  });
});

describe('🔒 one edit implementation, not two', () => {
  it('only the shared runner talks to an editing model', () => {
    // A second copy would drift invisibly — both copies return pictures. This repo has paid for that
    // class four times (safeRelPath ×4, tagsOnLine ×2, the HTML boot guard ×2, the browser path ×2).
    const runner = code(read('src/server/lib/imageEditRun.ts'));
    expect(runner).toContain('inlineData');
    expect(code(read(CHAT))).not.toContain('inlineData');
    // The generator route still calls generateContent for a FRESH picture, and that is a different
    // job — what it must not do is hand it an attached picture of its own accord.
    expect(code(read(ROUTE))).not.toContain('inlineData');
  });

  it('the preservation brief has exactly one home', () => {
    for (const f of [ROUTE, CHAT, 'src/server/lib/imageEditRun.ts']) {
      expect(code(read(f)), f).not.toContain('This is an edit of the supplied photograph');
    }
  });
});

describe('🖼️ the crop frame — what you see is what is sent', () => {
  const FRAME = { w: 1024, h: 768 };
  const IMG = { w: 4000, h: 3000 };

  it('+ and − move exactly one step and stop at the bounds', () => {
    expect(zoomBy(IDENTITY_VIEW, 1).zoom).toBeCloseTo(MIN_ZOOM + ZOOM_STEP, 5);
    expect(zoomBy({ ...IDENTITY_VIEW, zoom: MIN_ZOOM }, -1).zoom).toBe(MIN_ZOOM);
    expect(zoomBy({ ...IDENTITY_VIEW, zoom: MAX_ZOOM }, 1).zoom).toBe(MAX_ZOOM);
  });

  it('⟲ returns to the whole picture, and knows when it is already there', () => {
    expect(isIdentityView(IDENTITY_VIEW)).toBe(true);
    expect(isIdentityView({ zoom: 1.2, offsetX: 0, offsetY: 0 })).toBe(false);
    expect(isIdentityView({ zoom: 1, offsetX: 5, offsetY: 0 })).toBe(false);
  });

  it('🔴 the picture ALWAYS covers the frame — no band down one side, at any zoom or drag', () => {
    // Without the clamp this feature quietly produces a picture with a transparent stripe, which
    // reads as a bug in our engine rather than as a drag that went too far.
    for (const img of [IMG, { w: 300, h: 4000 }, { w: 4000, h: 300 }, { w: 1024, h: 768 }]) {
      for (let z = MIN_ZOOM; z <= MAX_ZOOM; z += ZOOM_STEP) {
        for (const off of [0, 9999, -9999]) {
          const r = drawRect({ zoom: z, offsetX: off, offsetY: off }, img, FRAME);
          expect(r.dx, `${img.w}x${img.h} z=${z}`).toBeLessThanOrEqual(0.0001);
          expect(r.dy).toBeLessThanOrEqual(0.0001);
          expect(r.dx + r.dw).toBeGreaterThanOrEqual(FRAME.w - 0.0001);
          expect(r.dy + r.dh).toBeGreaterThanOrEqual(FRAME.h - 0.0001);
        }
      }
    }
  });

  it('at zoom 1 there is nothing to slide, so a drag cannot move it', () => {
    const v = clampView({ zoom: 1, offsetX: 500, offsetY: -500 }, { w: 1024, h: 768 }, FRAME);
    expect(v.offsetX).toBe(0);
    expect(v.offsetY).toBe(0);
    expect(Object.is(v.offsetY, -0), 'a -0 offset makes two identical views compare unequal').toBe(false);
  });

  it('a junk offset is 0, never NaN painted onto a canvas', () => {
    const v = clampView({ zoom: 2, offsetX: Number.NaN, offsetY: Infinity } as never, IMG, FRAME);
    expect(Number.isFinite(v.offsetX)).toBe(true);
    expect(Number.isFinite(v.offsetY)).toBe(true);
  });

  it('a drag is measured in FRAME pixels, so it feels the same at every size', () => {
    // 40px across a 320px preview of a 1024px frame must move the picture 128 frame-pixels.
    expect(dragToFrame(40, 320, 1024)).toBe(128);
    expect(dragToFrame(40, 0, 1024)).toBe(0);
  });

  it('coverScale fills the frame rather than fitting inside it', () => {
    expect(coverScale({ w: 100, h: 100 }, { w: 200, h: 100 })).toBe(2);
    expect(coverScale({ w: 0, h: 0 }, FRAME)).toBe(1);
  });
});

describe('🔒 the crop control exists on BOTH tiers, and so does the reference picker', () => {
  it('the free generator attaches a picture and sends it', () => {
    const body = code(read(FREE));
    expect(body).toContain('<ReferenceImagePicker');
    expect(body).toContain('initImage: reference.dataUrl');
  });

  it('🔴 an edit sends the user’s words ALONE — never the image type as the instruction', () => {
    // "Modern app logo — make the shirt red" as an edit instruction says "turn this photograph into
    // a logo": the admin's reported fear, written into the prompt by our own UI before any model is
    // involved.
    const body = code(read(FREE));
    expect(body).toContain('if (reference) return prompt.trim();');
  });

  it('the attach control uses the shared crop component', () => {
    expect(code(read('src/components/ide/ReferenceImagePicker.tsx'))).toContain('<ImageCropEditor');
  });

  it('the crop sheet portals to the body, like every other sheet on these screens', () => {
    // A `backdrop-filter` anywhere above a `position: fixed` overlay makes that ancestor its
    // containing block — which is what once trapped a size selector inside a 100px footer.
    expect(code(read('src/components/ide/ImageCropEditor.tsx'))).toContain('createPortal(');
  });

  it('the +, − and ⟲ controls are really there and really labelled', () => {
    const body = code(read('src/components/ide/ImageCropEditor.tsx'));
    expect(body).toContain('Make the picture smaller');
    expect(body).toContain('Make the picture bigger');
    expect(body).toContain('Reset the picture');
  });
});

describe('🔒 one size table, read by the server and by the picker', () => {
  it('the server’s export IS the shared table', () => {
    expect(IMAGE_SIZE_PIXELS).toBe(PRESET_PIXELS);
  });

  it('the client resolver agrees with the server for every preset', () => {
    for (const id of Object.keys(PRESET_PIXELS)) {
      expect(pixelsForSize(id)).toEqual(IMAGE_SIZE_PIXELS[id]);
    }
    expect(pixelsForSize('nonsense')).toEqual(PRESET_PIXELS.square);
    expect(pixelsForSize(CUSTOM_SIZE_ID, 768, 1280)).toEqual({ w: 768, h: 1280 });
  });
});
