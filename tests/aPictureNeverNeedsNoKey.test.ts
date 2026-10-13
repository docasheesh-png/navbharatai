// AUTOPSY 303e8a6f (2026-10-12) — the first starter chip, "AI image", still told the user and the builder to
// "use the free image engine that needs no API key", a week after #3528 made every image engine need a key.
//
// The CLASS: a fact about a capability ("AI pictures in a built app need an image API key") was copied as prose
// into many places — a chip prompt, a tool-schema description, generic "AI needs no key" rules, a refusal note,
// a scanner's fix hint, the knowledge base, the docs — with no single source and no census. When the fact
// changed, the copies the change did not touch kept saying the opposite. #3528 fixed three copies; this test
// reads ALL of them, so a new "pictures are free / need no key" anywhere fails CI.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { STARTER_TEMPLATES } from '../src/components/agentv3/starterTemplates';
import { defaultToolCatalog, recipeListing, recipeToolDef } from '../src/server/AgentV3/ToolCatalog';
import { architectSystemPrompt, aiInAppRule, GATEWAY_AI_RULE } from '../src/server/AgentV3/systemPrompt';
import { IMAGE_IN_APP_RULE } from '../src/server/AgentV3/inAppImageGeneration';
import { NO_FAKE_FEATURE_RULE } from '../src/server/AgentV3/noEvalRule';
import { keylessAiNote, postBuildKeyAsks } from '../src/server/AgentV3/secretRequest';
import { browserAiKeyWriteNote, browserAiKeyReportLine, findBrowserAiKeyUse } from '../src/server/AgentV3/browserAiKeyScan';
import { GOLDEN_SCAFFOLDS, goldenScaffoldFiles, goldenScaffoldForPrompt, goldenBuildPrompt, chipPromptForBuild, RETIRED_CHIP_PROMPTS } from '../src/server/AgentV3/goldenScaffolds/registry';
import { generateImageAiIntegration, KEY_GUIDANCE } from '../src/server/lib/ImageAiGenerator';
import { APP_IMAGE_KEY_OPTIONS, APP_KEYS_PLACE } from '../src/server/lib/appImageKeyOptions';
import { IMAGE_KEY_NAMES, imageKeySecretNames, RECOMMENDED_IMAGE_KEY } from '../src/lib/imageKeyNames';
import { APP_KNOWLEDGE_BASE } from '../src/server/AppContext/AppKnowledgeBase';
import { detectAppRequirements, unconfiguredRequirements, appRequirementsNotice, serviceEnvNames } from '../src/server/AgentV3/AppRequirements';
import { recipeFor, recipeVarNames, CREDENTIAL_RECIPES } from '../src/lib/credentialRecipes';

const ROOT = join(__dirname, '..');

/** Every string in a value, recursively, with where it came from. */
function strings(value: unknown, where: string, out: Array<[string, string]> = []): Array<[string, string]> {
  if (typeof value === 'string') out.push([where, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${where}[${i}]`, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) {
    if (k === 'keywords') continue; // search words, not claims
    strings(v, `${where}.${k}`, out);
  }
  return out;
}

const PICTURE = /\b(?:images?|pictures?|photos?|logos?|wallpapers?|avatars?|text-to-image)\b|pollinations/i;
// The claim itself, in every wording the review of 303e8a6f tried: "needs no key", "does not / doesn't need an API
// key", "don't need a key", "no key required", "keys are not needed", "without a key", "keyless", "free image engine".
const KEYLESS_SOURCE = String.raw`\bneeds? no (?:api )?key\b|\b(?:does|do) ?(?:n't|not) (?:need|require) (?:an? |any )?(?:api )?keys?\b|\bno (?:api )?key (?:is )?(?:needed|required)\b|\bkeys? (?:is|are) not (?:needed|required)\b|\bwithout (?:an? )?(?:api )?key\b|\bkeyless\b|\bfree image engine\b|\bno signup\b`;
const KEYLESS = new RegExp(KEYLESS_SOURCE, 'i');
// A clause that NEGATES the claim ("Never say…", "there is no keyless mode", "no longer"). Read with the claim's own
// words taken out, so the "not" inside "does not need a key" can never excuse it (clause-aware negation).
const NEGATED = /\b(?:never|no longer|not|isn't|is not|there is no|removed|corrected|superseded|instead of|until)\b/i;

/** Pollinations named as the page's engine or the default — the keyless default #3528 removed. */
const PAGE_ENGINE = /\bpollinations\b[^\n]*\b(?:from the page|in the page|by default|is the default|default engine)\b|\b(?:default|from the page)\b[^\n]*\bpollinations\b/i;

/** The clauses that claim pictures need no key. A clause is cut at . ; : and line ends. */
function keylessPictureClaims(text: string): string[] {
  return text.split(/[.;:\n]+/)
    .filter((c) => ((PICTURE.test(c) && KEYLESS.test(c)) || PAGE_ENGINE.test(c)) && !NEGATED.test(c.replace(new RegExp(KEYLESS_SOURCE, 'gi'), ' ')))
    .map((c) => c.trim());
}

/** Everything the builder or the user reads about built apps. */
function corpus(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  STARTER_TEMPLATES.forEach((t) => out.push([`chip ${t.id}`, t.prompt]));
  strings(defaultToolCatalog(), 'toolCatalog', out);
  strings(recipeToolDef(), 'recipeToolDef', out);
  out.push(['recipeListing', recipeListing()]);
  out.push(['architectSystemPrompt', architectSystemPrompt()]);
  out.push(['aiInAppRule(gateway on)', aiInAppRule({ APP_AI_GATEWAY: 'on' } as NodeJS.ProcessEnv)]);
  out.push(['aiInAppRule(gateway off)', aiInAppRule({ APP_AI_GATEWAY: 'off' } as NodeJS.ProcessEnv)]);
  out.push(['IMAGE_IN_APP_RULE', IMAGE_IN_APP_RULE], ['NO_FAKE_FEATURE_RULE', NO_FAKE_FEATURE_RULE]);
  out.push(['keylessAiNote', keylessAiNote(['OPENAI_API_KEY'])]);
  for (const g of GOLDEN_SCAFFOLDS) {
    out.push([`goldenBuildPrompt ${g.id}`, goldenBuildPrompt(g, STARTER_TEMPLATES.find((t) => t.id === g.id)?.prompt ?? '')]);
    for (const [path, content] of Object.entries(goldenScaffoldFiles(g))) out.push([`scaffold ${g.id} ${path}`, content]);
  }
  for (const server of [false, true]) out.push([`image recipe server=${server}`, generateImageAiIntegration({ server, react: true }).instructions]);
  // The platform's OWN Image Generator (ai_image_gen) is a different fact — NavBharatAI charges the wallet and the
  // user needs no key there — so it is left out rather than letting this census forbid true sentences about it.
  APP_KNOWLEDGE_BASE.filter((f) => f.id !== 'ai_image_gen').forEach((f) => strings({ name: f.name, path: f.path, description: f.description, howToUse: f.howToUse }, `KB ${f.id}`, out));
  strings(CREDENTIAL_RECIPES, 'credentialRecipes', out);
  return out;
}

describe('1 · nothing a builder or a user reads says AI pictures need no key', () => {
  it('🔒 the census: every chip, tool, rule, note, template, recipe and knowledge-base entry', () => {
    const hits = corpus().flatMap(([where, text]) => keylessPictureClaims(text).map((c) => `${where}: "${c.slice(0, 160)}"`));
    expect(hits).toEqual([]);
  });

  it('the census catches the report\'s own sentence (so it is not a census of nothing)', () => {
    const old = RETIRED_CHIP_PROMPTS['ai-image']![0]!;
    const claims = keylessPictureClaims(old);
    expect(claims).toHaveLength(1);
    expect(claims[0]).toContain('use the free image engine that needs no API key');
    // The ToolCatalog sentence #3528 left one line below the one it fixed.
    expect(keylessPictureClaims('Leave out (false) for an app with no server — Pollinations AI from the page.')).toHaveLength(1);
    // …and every paraphrase of the same bug (the review's reversion set), not only the original words.
    for (const paraphrase of [
      'Use the free image engine, which does not need an API key.',
      'The pictures don\'t need a key.',
      'No key required for the images.',
      'The images are made without an API key.',
      'For the AI pictures, keys are not needed.',
    ]) expect(keylessPictureClaims(paraphrase), paraphrase).toHaveLength(1);
    // A sentence that SAYS the opposite is not a claim.
    expect(keylessPictureClaims('Never say the pictures are free or that no key is needed')).toEqual([]);
    expect(keylessPictureClaims('there is no keyless image engine any more')).toEqual([]);
  });

  it('🔒 every rule that says AI needs no key also says pictures DO need one', () => {
    const generic = /NO KEY NEEDED|needs NO key|keyless route/;
    for (const [where, text] of [
      ['GATEWAY_AI_RULE', GATEWAY_AI_RULE], ['NO_FAKE_FEATURE_RULE', NO_FAKE_FEATURE_RULE], ['keylessAiNote', keylessAiNote(['XAI_API_KEY'])],
    ] as const) {
      expect(generic.test(text), where).toBe(true);
      expect(text, where).toMatch(/PICTURES[^.]*(?:need|are not)/);
    }
  });

  it('the docs mark the old keyless default as corrected, never state it plainly', () => {
    const dir = join(ROOT, 'docs/claude');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.md'))) {
      const text = readFileSync(join(dir, f), 'utf8');
      for (const para of text.split(/\n(?=\s*- |\s*\n)/)) {
        if (!/generate_image_ai|AN APP THAT MAKES PICTURES/.test(para)) continue;
        if (/page calls Pollinations directly|Pollinations default needs nothing/.test(para)) {
          expect(para, f).toMatch(/CORRECTED 2026-10-04/);
        }
      }
    }
  });
});

describe('2 · the chip the report started from', () => {
  const chip = STARTER_TEMPLATES.find((t) => t.id === 'ai-image')!;

  it('says plainly that the pictures need a key and where it goes', () => {
    expect(chip.prompt).toContain('The pictures need an image API key');
    expect(chip.prompt).toContain('Keys & Secrets');
    expect(chip.prompt).not.toMatch(/needs no API key|free image engine/);
  });

  it('🔒 an old phone app still sending the retired text keeps the template, and the builder reads the new text', () => {
    for (const [id, olds] of Object.entries(RETIRED_CHIP_PROMPTS)) {
      const current = STARTER_TEMPLATES.find((t) => t.id === id)!.prompt;
      for (const old of olds) {
        expect(old).not.toBe(current);
        expect(goldenScaffoldForPrompt(old)?.id, id).toBe(id);
        expect(chipPromptForBuild(old)).toBe(current);
      }
    }
    expect(chipPromptForBuild('Build me a cricket score app')).toBe('Build me a cricket score app');
    // Once, where the request enters the build — so the reviewers and repairs read today's words too; the chat
    // history keeps what was typed.
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toContain('let prompt = chipPromptForBuild(typedPrompt);');
    expect(route).toContain("{ role: 'user', content: typedPrompt, ts: buildStartedAt }");
  });

  it('🔒 the template lane carries the recipe\'s key guidance — the builder hears which keys and where', () => {
    const g = GOLDEN_SCAFFOLDS.find((x) => x.id === 'ai-image')!;
    const note = goldenBuildPrompt(g, chip.prompt);
    expect(note).toContain(KEY_GUIDANCE);
    for (const o of APP_IMAGE_KEY_OPTIONS) expect(note).toContain(o.secret);
    expect(note).toContain(APP_KEYS_PLACE);
    // Every scaffold seeding a recipe's files carries that recipe's instructions.
    const recipeFiles = generateImageAiIntegration({ server: false, react: true }).files;
    for (const s of GOLDEN_SCAFFOLDS) {
      const files = goldenScaffoldFiles(s);
      if (files['src/lib/imageAi.ts'] === recipeFiles['src/lib/imageAi.ts']) expect(s.finishNote, s.id).toBe(KEY_GUIDANCE);
    }
  });
});

const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('3 · the end-of-build checklist sees an image app, and asks for ONE key', () => {
  const files = { ...generateImageAiIntegration({ server: false, react: true }).files, 'package.json': '{"dependencies":{"react":"^18.3.1"}}' };

  it('an app built on the recipe needs an image key, and any one saved satisfies it', () => {
    const detected = detectAppRequirements({ files });
    expect(detected.map((r) => r.id)).toContain('app_image_key');
    expect(unconfiguredRequirements(detected, {}).map((r) => r.id)).toEqual(['app_image_key']);
    for (const name of imageKeySecretNames()) expect(unconfiguredRequirements(detected, { [name]: 'x'.repeat(20) }), name).toEqual([]);
  });

  it('the server mode is seen too (it reads its keys through its own settings helper, not process.env)', () => {
    const server = generateImageAiIntegration({ server: true, react: false }).files;
    expect(detectAppRequirements({ files: server }).map((r) => r.id)).toContain('app_image_key');
  });

  it('the notice and the ask card name the recommended key once — never "go and get all five"', () => {
    const missing = unconfiguredRequirements(detectAppRequirements({ files }), {});
    const notice = appRequirementsNotice(missing);
    expect(notice).toContain(`\`${RECOMMENDED_IMAGE_KEY}\``);
    expect(notice).toContain('navbharatai.com');
    expect(notice).not.toContain('OPENAI_API_KEY');
    const asks = postBuildKeyAsks(missing, []);
    expect(asks.map((a) => a.name)).toEqual([RECOMMENDED_IMAGE_KEY]);
    expect(asks[0]!.why).toContain('ONE image API key');
  });

  it('an ordinary app is not told it needs an image key', () => {
    expect(detectAppRequirements({ files: { 'src/App.tsx': 'export default () => <img src="/logo.png" alt="" />', 'package.json': '{}' } }).map((r) => r.id)).not.toContain('app_image_key');
  });

  it('one list of names: the server table, the checklist and the "where to get it" screens agree', () => {
    expect(APP_IMAGE_KEY_OPTIONS.map((o) => o.secret)).toEqual(IMAGE_KEY_NAMES.map((k) => k.secret));
    expect(recipeVarNames('app_image_key')).toEqual(IMAGE_KEY_NAMES.map((k) => k.secret));
    for (const n of recipeVarNames('app_image_key')) expect(serviceEnvNames('app_image_key')).toContain(n);
    expect(recipeFor('app_image_key')?.keyless).toBeNull();
  });
});

describe('4 · a page that calls a picture service is caught, and told the picture route', () => {
  it('a keyless (or key-in-the-page) picture call is named as such', () => {
    const page = "export const url = (p: string) => 'https://gen.pollinations.ai/image/' + encodeURIComponent(p);";
    expect(findBrowserAiKeyUse({ 'src/lib/img.ts': page })[0]?.shape).toBe('image-host');
    const note = browserAiKeyWriteNote('src/lib/img.ts', page);
    expect(note).toContain('generate_image_ai');
    expect(note).toContain('Pictures always need an image API key');
    expect(note).not.toContain('no key anywhere');
    // The report line says what it is — a picture service called from the page — not "a key the page must hold".
    const line = browserAiKeyReportLine(findBrowserAiKeyUse({ 'src/lib/img.ts': page }));
    expect(line).toMatch(/^Browser code calls an AI picture service directly/);
    expect(line).not.toContain('a key the page must hold');
  });

  it('🔒 the one-tap suggestion for a key in the page sends pictures to the picture route', async () => {
    const { buildFindingSuggestions } = await import('../src/server/AgentV3/buildFindingSuggestions');
    const s = buildFindingSuggestions([{ code: 'AI_KEY_IN_BROWSER', severity: 'warning', autoResolved: false, message: 'x' }]);
    const prompt = s.find((x) => x.title === 'Take the AI key out of your app')?.prompt ?? '';
    expect(prompt).toContain('generate_image_ai');
    expect(prompt).toContain('pictures are never keyless');
  });

  it('an images endpoint on a provider host gets the picture fix, a chat endpoint keeps the text fix', () => {
    const pic = "await fetch('https://api.openai.com/v1/images/generations', { method: 'POST' })";
    expect(browserAiKeyWriteNote('src/lib/img.ts', pic)).toContain('generate_image_ai');
    const chat = "await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST' })";
    expect(browserAiKeyWriteNote('src/lib/ai.ts', chat)).toContain('src/lib/ai.ts');
    expect(browserAiKeyReportLine(findBrowserAiKeyUse({ 'src/a.ts': pic }))).toContain('generate_image_ai');
  });

  it('the recipe\'s own browser and server files are clean', () => {
    for (const server of [false, true]) expect(findBrowserAiKeyUse(generateImageAiIntegration({ server, react: true }).files)).toEqual([]);
  });
});
