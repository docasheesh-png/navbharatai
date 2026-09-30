/**
 * The free image generator, admin 2026-09-30:
 *   "jab bhi koi face bane to woh bhi chinis face banta hai … jab bhi koi human image banayi jaye to
 *    default indian face hi banna chahiye (100% indian) jab tak specific bola na jaye kisi aur face
 *    ke bare me" — and — "abhi maine prompt diya 'indian face' to image bani hi nahi".
 *
 * Two defects, two halves of this file:
 *   1. Our brief never said who the person is, so the engine drew its own default face.
 *   2. Since the browser fetches the free picture itself, a picture the engine did not deliver was a
 *      dead end: the ladder that used to follow a free-provider failure never ran.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';
import {
  depictsPeople, namesOtherOrigin, wantsIndianPeopleDefault, INDIAN_PEOPLE_DIRECTION,
} from '../src/server/lib/imagePeople';
import { craftImagePrompt, withInlineNegative } from '../src/server/lib/imagePromptCraft';
import { scanPollinationsPrompt } from '../src/server/lib/pollinationsGuard';
import { freeFailureVerified, signImageTicket } from '../src/server/lib/imageTicket';
import { isAllowedImageHost } from '../src/lib/imageDelivery';
import { pollinationsImageUrl, MAX_PROMPT_CHARS } from '../src/server/lib/imageGen';
import { imageLinkLoads, serverFallbackReason } from '../src/lib/clientImageFetch';

process.env.VITEST = 'true';

vi.mock('../src/server/lib/costlyAiAccess', () => ({
  requireAccountForCostlyAi: async () => ({ ok: true, uid: 'u1', email: 'u1@example.com' }),
}));
vi.mock('../src/server/tools/toolGate', () => ({
  gateToolAction: async () => ({ allow: true, uid: 'u1', countsAgainstFree: false, isFreeListed: true }),
  burnToolAction: () => undefined,
}));

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. EVERY PERSON IS INDIAN UNLESS THE USER NAMED SOMEBODY ELSE
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('a person in the brief is Indian by default', () => {
  it.each([
    'indian face', 'Indian face', 'a boy', 'girl portrait', 'a doctor with a stethoscope', 'family having dinner',
    'selfie at the beach', 'ladka cricket khel raha hai', 'ek ladki school ja rahi hai', 'एक लड़की किताब पढ़ रही है',
    'smiling woman in a saree', 'farmer in a field', 'a human face close-up', 'bride and groom at a wedding',
  ])('"%s" puts a person in the picture', (p) => {
    expect(depictsPeople(p)).toBe(true);
    expect(wantsIndianPeopleDefault(p)).toBe(true);
  });

  it.each([
    'coffee shop logo', 'cat face', "a dog's face", 'face wash bottle product photo', 'sunset over the mountains',
    'media player app icon', 'service worker diagram', 'best seller badge', 'clock face with roman numerals',
    'a bowl of biryani', '',
  ])('"%s" has no person, so nothing is added', (p) => {
    expect(depictsPeople(p)).toBe(false);
    expect(wantsIndianPeopleDefault(p)).toBe(false);
  });

  it.each([
    'a Japanese chef', 'an African dancer', 'white woman reading', 'a diverse team of people', 'Chinese girl',
    'European tourist taking a photo', 'blonde girl', 'spiderman on a building', 'a robot waving', 'asian man',
  ])('"%s" names somebody else, and the user\'s words win', (p) => {
    expect(namesOtherOrigin(p)).toBe(true);
    expect(wantsIndianPeopleDefault(p)).toBe(false);
  });

  it.each([
    'south asian man', 'a girl in a black dress', 'portrait of a man on a white background', 'indian bride',
  ])('"%s" is not another origin (colours, South Asian and Indian are not)', (p) => {
    expect(namesOtherOrigin(p)).toBe(false);
    expect(wantsIndianPeopleDefault(p)).toBe(true);
  });

  it('is said straight after the subject, before any art direction, where the engine weighs it most', () => {
    const c = craftImagePrompt({ prompt: 'Photograph — a boy flying a kite', style: 'photo', type: 'Photograph', size: 'square' });
    expect(c.indianPeople).toBe(true);
    const at = c.prompt.indexOf(INDIAN_PEOPLE_DIRECTION);
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(c.prompt.indexOf('Style:'));
    expect(c.prompt.startsWith('Photograph — a boy flying a kite')).toBe(true);
  });

  it('reaches the exact brief of the report — "indian face" — and the word scan still passes it', () => {
    const c = craftImagePrompt({ prompt: 'Photograph — indian face', style: 'photo', type: 'Photograph', size: 'square' });
    expect(c.prompt).toContain(INDIAN_PEOPLE_DIRECTION);
    expect(scanPollinationsPrompt(withInlineNegative(c)).ok).toBe(true);
  });

  it('is not added when the user named another origin, or when nobody is in the picture', () => {
    expect(craftImagePrompt({ prompt: 'a Japanese chef cooking ramen', style: 'photo' }).indianPeople).toBe(false);
    expect(craftImagePrompt({ prompt: 'coffee shop', type: 'Modern app logo' }).prompt).not.toContain(INDIAN_PEOPLE_DIRECTION);
  });

  it('leaves a UI screenshot and a background alone — there "student" names a domain, not a person', () => {
    expect(craftImagePrompt({ prompt: 'student management dashboard', type: 'UI screenshot' }).indianPeople).toBe(false);
    expect(craftImagePrompt({ prompt: 'soft pattern for a teacher app', type: 'Background' }).indianPeople).toBe(false);
  });

  it('never changes an EDIT of the user\'s own photo — the edit path does not go through the craft layer', () => {
    expect(read('src/server/lib/imageEditRun.ts')).not.toContain('imagePeople');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2. NO IMAGE IS NOT A DEAD END
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('the server honours "the browser got nothing" only for a link it signed, for this prompt', () => {
  const secret = 'test-secret';
  const now = 1_000_000;
  const prompt = "Photograph — indian face. It's a boy (smiling) & friends!";
  const url = pollinationsImageUrl(prompt, 'square', { __IMAGE_SEED: '7' } as NodeJS.ProcessEnv);
  const exp = now + 60_000;
  const ticket = signImageTicket(url, exp, secret);

  it('accepts the exact link it minted, for the same prompt (the URL round-trips)', () => {
    expect(freeFailureVerified({ url, ticket, exp }, prompt, MAX_PROMPT_CHARS, secret, now, isAllowedImageHost)).toBe(true);
  });
  it('refuses a ticket from a different prompt', () => {
    expect(freeFailureVerified({ url, ticket, exp }, 'a cat', MAX_PROMPT_CHARS, secret, now, isAllowedImageHost)).toBe(false);
  });
  it('refuses an expired, forged or foreign link', () => {
    expect(freeFailureVerified({ url, ticket, exp }, prompt, MAX_PROMPT_CHARS, secret, exp + 1, isAllowedImageHost)).toBe(false);
    expect(freeFailureVerified({ url, ticket: 'f'.repeat(48), exp }, prompt, MAX_PROMPT_CHARS, secret, now, isAllowedImageHost)).toBe(false);
    const evil = url.replace('image.pollinations.ai', 'image.pollinations.ai.evil.com');
    expect(freeFailureVerified({ url: evil, ticket: signImageTicket(evil, exp, secret), exp }, prompt, MAX_PROMPT_CHARS, secret, now, isAllowedImageHost)).toBe(false);
    expect(freeFailureVerified(null, prompt, MAX_PROMPT_CHARS, secret, now, isAllowedImageHost)).toBe(false);
  });
});

describe('the browser decides when to hand the picture to the server', () => {
  it('asks the server when the engine answered with an error, or the retry budget ran out', () => {
    expect(serverFallbackReason({ error: 'x', reason: 'HTTP 400' }, null)).toBe('HTTP 400');
    expect(serverFallbackReason({ error: 'x', reason: 'retry budget spent' }, null)).toBe('retry budget spent');
    expect(serverFallbackReason({ error: 'x' }, null)).toBe('no picture');
  });
  it('asks the server when a link it could not read ALSO never loaded as a picture', () => {
    expect(serverFallbackReason({ needsRelay: true }, false)).toBe('link did not load');
  });
  it('keeps today\'s behaviour when the picture is here, the link loaded, the page could not tell, or the user cancelled', () => {
    expect(serverFallbackReason({ dataUrl: 'data:image/png;base64,AA' }, null)).toBeNull();
    expect(serverFallbackReason({ needsRelay: true }, true)).toBeNull();
    expect(serverFallbackReason({ needsRelay: true }, null)).toBeNull();
    expect(serverFallbackReason({ error: 'Cancelled.' }, null)).toBeNull();
  });
  it('a page with no Image element answers "could not tell", never a failure', async () => {
    expect(typeof (globalThis as { Image?: unknown }).Image).toBe('undefined');
    await expect(imageLinkLoads('https://image.pollinations.ai/prompt/x')).resolves.toBeNull();
  });
  it('the generator screen wires it: it probes the link, and re-sends the SAME request with the signed link', () => {
    const src = read('src/components/ide/AIImageGenerator.tsx');
    expect(src).toContain('imageLinkLoads(ticket.url)');
    expect(src).toContain('serverFallbackReason(got, linkLoaded)');
    expect(src).toMatch(/\.\.\.requestBody,\s*freeFailed:/);
  });
});

describe('the real route: a verified failure runs the server ladder instead of handing back the same link', () => {
  const saved = { ...process.env };
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    for (const k of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GROK_API_KEY', 'XAI_API_KEY', 'IMAGE_GEN_POLLINATIONS', 'IMAGE_GEN_CLIENT_FETCH']) {
      delete process.env[k];
    }
    process.env.SECRET_ENCRYPTION_KEY = 'route-secret';
    fetchSpy = vi.fn(async () => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...saved };
  });

  async function generate(body: Record<string, unknown>) {
    const { registerImageGenRoutes } = await import('../src/server/routes/imageGen');
    const routes = captureRoutes(registerImageGenRoutes);
    const res = mockRes();
    await routes.get('POST /api/image/generate')!(mockReq({ body }), res);
    return res;
  }

  const body = { prompt: 'Photograph — indian face', style: 'photo', size: 'square', type: 'Photograph' };

  it('first answer: a signed link, whose brief carries the Indian default, fetched by nobody yet', async () => {
    const res = await generate(body);
    expect(res.body.mode).toBe('client-fetch');
    expect(decodeURIComponent(new URL(res.body.url).pathname)).toContain(INDIAN_PEOPLE_DIRECTION);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('after the browser reports the link came to nothing, the server fetches it and returns the bytes', async () => {
    const first = await generate(body);
    const second = await generate({
      ...body,
      freeFailed: { url: first.body.url, ticket: first.body.ticket, exp: first.body.exp, reason: 'HTTP 400' },
    });
    expect(second.statusCode).toBe(200);
    expect(second.body.mode).toBeUndefined();
    expect(String(second.body.image)).toMatch(/^data:image\/png;base64,/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('when the server\'s own try fails too, Free mode says the free servers are busy and points at Paid, never a link again', async () => {
    fetchSpy.mockImplementation(async () => new Response('no', { status: 500 }));
    const first = await generate(body);
    const second = await generate({ ...body, freeFailed: { url: first.body.url, ticket: first.body.ticket, exp: first.body.exp } });
    // 2026-09-30 (admin: "free server are too busy try on paid service"): Free mode has no paid
    // engine behind it, so the answer names Paid mode instead of trying one.
    expect(second.statusCode).toBe(503);
    expect(second.body.code).toBe('free_busy');
    expect(second.body.url).toBeUndefined();
    expect(String(second.body.error)).toMatch(/free image servers are too busy/i);
  });

  it('refuses a claim for a link it did not sign, or for a different brief', async () => {
    const first = await generate(body);
    const forged = await generate({ ...body, freeFailed: { url: first.body.url, ticket: 'f'.repeat(48), exp: first.body.exp } });
    expect(forged.statusCode).toBe(403);
    const other = await generate({ ...body, prompt: 'Photograph — a cat', freeFailed: { url: first.body.url, ticket: first.body.ticket, exp: first.body.exp } });
    expect(other.statusCode).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
