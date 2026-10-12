/**
 * AUTOPSY 9c612cdb (2026-10-12) — Q-949. "Build a app where I can just similar to youtube … paste link … the
 * video adds in the app … stream the videos with no adds". Two report lines described the limits of a word
 * list as facts about the user's request:
 *
 *   COMPLEXITY_ROUTING: "the scorer recognised nothing in this request, and it names no features and no
 *     large system" — the request named three things in prose; what the counter measures is a LIST.
 *   FEATURE_COVERAGE: "all 1 requested feature(s) are visibly present (Add / create)" — the check has nine
 *     fixed probes, the request triggered one, and playback / streaming / "no ads" are in none of them.
 *
 * 🔒 THE CLASS: a checker's summary worded from its first case instead of from the unit its code measures.
 * The cure is to GENERATE the sentence from the measuring vocabulary (MIN_STATED_FEATURES / MIN_RUN_ITEMS,
 * probeableFeatures()) and forbid the over-claiming forms in source.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decideComplexity, needsSecondOpinion, statesAScope, MIN_STATED_FEATURES } from '../src/server/AgentV3/complexityRouting';
import { MIN_RUN_ITEMS } from '../src/server/AgentV3/enumeratedFeatures';
import { checkFeaturePresence, featurePresenceSummary, probeableFeatures } from '../src/server/AgentV3/FeaturePresence';

/** The report's prompt, word for word (typos included). */
const PROMPT = 'Build a app where I can just similar to youtube where where there is an option for paste link and when user pasts the link then the video adds in the app and again shoss the option.. for add link ... There we could also stream the videos with no adds';

/** Shaped like the report's capture: one input, two buttons, an empty-state line (inputs=1 buttons=2). */
const LIBRARY_DOM = '<html><body><div id="root"><main><h1>My Video Library</h1>'
  + '<form><input type="url" placeholder="Paste a YouTube or Vimeo link" aria-label="Video link" />'
  + '<button type="submit">Add video</button></form><button type="button">Clear library</button>'
  + '<p>No videos yet — paste a link to add your first one.</p></main></div></body></html>';

const env = {} as NodeJS.ProcessEnv;

describe('FEATURE_COVERAGE says which controls it judged, never "all"', () => {
  it('the report-shaped capture: the line names what was probed and the whole probe vocabulary', () => {
    const r = checkFeaturePresence(PROMPT, LIBRARY_DOM);
    expect(r.present).toEqual(['Add / create']);
    const line = featurePresenceSummary(r);
    expect(line).not.toMatch(/\ball \d+ requested feature/);
    expect(line).toContain('the 1 requested control(s) judged here are visibly present');
    for (const { label } of probeableFeatures()) expect(line).toContain(label);
    expect(line).toContain('the rest of the request was not judged');
  });

  it('a sign-in page names what it hid instead of calling the one probe it could see "all"', () => {
    const SIGN_IN = '<html><body><div id="root"><main><h1>Welcome back</h1><form>'
      + '<label for="e">Email</label><input id="e" type="email" />'
      + '<label for="p">Password</label><input id="p" type="password" />'
      + '<button type="submit">Sign in</button><button type="button">Create account</button>'
      + '</form></main></div></body></html>';
    const r = checkFeaturePresence('build a notes app with login, search and delete notes', SIGN_IN);
    expect(r.present).toEqual(['Login / authentication']);
    expect(r.notJudged).toEqual(expect.arrayContaining(['Search', 'Delete / remove']));
    const line = featurePresenceSummary(r);
    expect(line).not.toMatch(/\ball \d+ requested feature/);
    expect(line).toMatch(/not judged \(behind a sign-in page\): .*Search/);
    expect(line).toMatch(/not judged \(behind a sign-in page\): .*Delete \/ remove/);
  });

  it('the MISSING line is unchanged — its text is the repair prompt\'s evidence', () => {
    const r = checkFeaturePresence('add and delete tasks', '<input/><button>Add</button>');
    const line = featurePresenceSummary(r);
    expect(line).toBe(`Feature coverage: ${r.missing.length} requested feature(s) have NO visible control in the running app — ${r.missing.join(', ')}. Present: ${r.present.join(', ')}.`);
    expect(r.missing).toContain('Delete / remove');
  });
});

describe('COMPLEXITY_ROUTING says what the sizer counted, never "names no features"', () => {
  for (const p of [PROMPT, 'build a gurudwara langar seva app with tags, search', 'build a gurudwara langar seva app:\n- tags']) {
    it(`the measured unit, for: ${p.slice(0, 48)}…`, async () => {
      // Routing is pinned: these state no readable scope and buy no second opinion.
      expect(statesAScope(p)).toBe(false);
      expect(needsSecondOpinion(15, p)).toBe(false);
      const d = await decideComplexity({ prompt: p, score: 15 }, async () => 'complex', { env });
      expect(d.source).toBe('deterministic');
      expect(d.reason).not.toContain('names no features');
      // A comma and a single bullet both reached this line, so the sentence may not claim there were none.
      expect(d.reason).not.toMatch(/no comma|no bullet/);
      expect(d.reason).toContain(`fewer than ${MIN_STATED_FEATURES} listed features`);
      expect(d.reason).toContain(`a run of ${MIN_RUN_ITEMS} or more short items`);
      expect(d.reason).toContain('features described in a sentence are not counted');
    });
  }
});

describe('🔒 source guard — no summary in these checkers may claim more than it measured', () => {
  const files = ['complexityRouting.ts', 'FeaturePresence.ts', 'RequirementCoverage.ts'];
  for (const f of files) {
    it(f, () => {
      const src = readFileSync(join(__dirname, '../src/server/AgentV3', f), 'utf8');
      expect(src).not.toContain('names no features');
      expect(src).not.toMatch(/all \$\{[^}]+\} requested feature/);
    });
  }
});
