/**
 * Autopsy e3135b7b (2026-10-14) — the Quran reader. Q-1061.
 *
 * The build seeded the `quran` golden scaffold — a `simple`-tier template, which IS the finished app, written and
 * tested, on disk before the first model call — and then ran the mega-app roadmap planner over the same prompt and
 * narrated its roadmap to the user as what their app would be. The roadmap gate read exactly one of the two things
 * that can already own a build (Software Project Mode, closed 2026-09-30) and never asked about the other.
 *
 * THE CLASS: a rule enforced at one of two call sites is not enforced (the Q-1024 class). Hunting the sibling was
 * what made this fix correct rather than cosmetic — the three affected chips split across BOTH planners:
 *   quran, wedding-rsvp → the mega-app roadmap        panchang → the PROJECT planner
 * Fixing only the reported gate would have left the identical defect live under the other one.
 *
 * AND THE PRECISION MATTERS AS MUCH AS THE FIX. 14 scaffolded chips reach a planner; 11 are `pro`, whose scaffold is
 * only a compile-proven architecture the builder extends. Standing all 14 down would have shipped a bare architecture
 * as a user's finished app — a worse defect than the one being fixed. Only `simple` stands a planner down.
 *
 * The census is the lock: it recomputes BOTH gates over the whole starter registry, so a new chip, a new scaffold or
 * a loosened scope rule fails it rather than quietly re-opening the class.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  roadmapStandsDown, roadmapStandsDownForProjectMode, roadmapStandDownMessage, projectModeDiagnosis,
} from '../src/server/AgentV3/ProjectPlan';
import { scopeVerdict } from '../src/server/lib/appScopeAnalyzer';
import { goldenScaffoldForPrompt, templateIsTheFinishedApp } from '../src/server/AgentV3/goldenScaffolds/registry';
import { STARTER_TEMPLATES } from '../src/components/agentv3/starterTemplates';

const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');

describe('the tier is the distinction', () => {
  it('a simple scaffold is the finished app; a pro scaffold is an architecture', () => {
    expect(templateIsTheFinishedApp({ tier: 'simple' })).toBe(true);
    expect(templateIsTheFinishedApp({ tier: 'pro' })).toBe(false);
    expect(templateIsTheFinishedApp(null)).toBe(false);
    expect(templateIsTheFinishedApp(undefined)).toBe(false);
  });

  it('the registry still has both tiers — if `pro` disappears, this fix has become a blanket rule', () => {
    const tiers = new Set(STARTER_TEMPLATES.map((t) => goldenScaffoldForPrompt(t.prompt)?.tier).filter(Boolean));
    expect([...tiers].sort()).toEqual(['pro', 'simple']);
  });
});

describe('the roadmap stands down for a finished template', () => {
  it('a finished template owns the build, so the roadmap does not run', () => {
    expect(roadmapStandsDown({ projectModeOn: false, planFirst: false, megaProject: true, templateIsTheApp: true })).toBe('finished-template');
    // It is the honest reason even when project mode is on, because then NOTHING plans this build.
    expect(roadmapStandsDown({ projectModeOn: true, planFirst: false, megaProject: true, templateIsTheApp: true })).toBe('finished-template');
  });

  it('a pro template plans exactly as before — the architecture still needs extending', () => {
    expect(roadmapStandsDown({ projectModeOn: false, planFirst: false, megaProject: true, templateIsTheApp: false })).toBeNull();
    expect(roadmapStandsDown({ projectModeOn: true, planFirst: false, megaProject: true, templateIsTheApp: false })).toBe('project-mode');
  });

  it('nothing else changes: no template and no project mode and the roadmap runs as before', () => {
    expect(roadmapStandsDown({ projectModeOn: false, planFirst: false, megaProject: true, templateIsTheApp: false })).toBeNull();
    expect(roadmapStandsDown({ projectModeOn: true, planFirst: false, megaProject: false, templateIsTheApp: false })).toBeNull();
  });

  it('a plan-first turn is left alone by BOTH halves — the user asked for a plan', () => {
    expect(roadmapStandsDown({ projectModeOn: true, planFirst: true, megaProject: true, templateIsTheApp: true })).toBeNull();
    expect(roadmapStandsDown({ projectModeOn: false, planFirst: true, megaProject: false, templateIsTheApp: true })).toBeNull();
  });

  it('the project-mode half is the one function, not a second copy of its rule', () => {
    for (const projectModeOn of [true, false]) {
      for (const planFirst of [true, false]) {
        for (const megaProject of [true, false]) {
          const owns = roadmapStandsDownForProjectMode({ projectModeOn, planFirst, megaProject });
          expect(roadmapStandsDown({ projectModeOn, planFirst, megaProject, templateIsTheApp: false }) === 'project-mode').toBe(owns);
        }
      }
    }
  });

  it('each reason says which thing already owns the build, and says it without a vendor name', () => {
    const t = roadmapStandDownMessage('finished-template');
    expect(t).toMatch(/tested template/i);
    expect(t).toMatch(/verify and polish/i);
    expect(t).not.toBe(roadmapStandDownMessage('project-mode'));
    for (const r of ['project-mode', 'finished-template'] as const) {
      expect(roadmapStandDownMessage(r)).not.toMatch(/claude|anthropic|kimi|glm|grok|gemini|opus|sonnet|haiku/i);
    }
  });
});

describe('the project planner — the sibling gate — stands down for the same fact', () => {
  const on = { flagRaw: 'on', identity: { userId: 'u1' }, isNewBuild: true, isEditMode: false };

  it('it reports the finished template as the reason, not a size verdict', () => {
    const d = projectModeDiagnosis({ ...on, templateIsTheApp: true, prompt: 'x '.repeat(400), scope: { large: true, signals: [] } });
    expect(d.skipReason).toBe('template-is-the-app');
    expect(d.message).toMatch(/finished app/i);
    expect(d.detail).toMatch(/verifies and polishes/i);
  });

  it('a pro template is still decomposed, so its reason is whatever it was before', () => {
    const d = projectModeDiagnosis({ ...on, templateIsTheApp: false, prompt: 'make me a to-do list', scope: { large: false, signals: [] } });
    expect(d.skipReason).not.toBe('template-is-the-app');
  });

  it('the reasons the user themselves caused still win — a plan-first turn is still reported as pre-empted', () => {
    const d = projectModeDiagnosis({ ...on, templateIsTheApp: true, preEmptedBy: 'plan-first' });
    expect(d.skipReason).toBe('pre-empted');
  });
});

describe('the census: no scaffolded starter chip whose template IS the app reaches either planner', () => {
  const scaffolded = STARTER_TEMPLATES.map((t) => ({ t, g: goldenScaffoldForPrompt(t.prompt) })).filter((x) => !!x.g);

  it('the registry still seeds a template for every chip (if this shrinks, the census shrank silently)', () => {
    expect(scaffolded.length).toBe(STARTER_TEMPLATES.length);
    expect(scaffolded.length).toBeGreaterThanOrEqual(41);
  });

  it('neither planner runs over a finished template — and the pro chips still plan', () => {
    const planned: string[] = [];
    const proStillPlanned: string[] = [];
    for (const { t, g } of scaffolded) {
      const v = scopeVerdict(t.prompt, { complex: false });
      const isApp = templateIsTheFinishedApp(g);
      // The route's two conditions, verbatim.
      const standDown = roadmapStandsDown({ projectModeOn: v.projectMode, planFirst: false, megaProject: v.projectMode, templateIsTheApp: isApp });
      const roadmapRuns = v.scope.decision === 'analyze' && !v.dispute && !standDown;
      const projectRuns = v.projectMode && !isApp;
      if (isApp && (roadmapRuns || projectRuns)) planned.push(`${t.id} -> ${roadmapRuns ? 'roadmap' : 'project planner'}`);
      if (!isApp && (roadmapRuns || projectRuns)) proStillPlanned.push(t.id);
    }
    expect(planned).toEqual([]);
    // The 11 pro chips that legitimately reach a planner must STILL reach one: this fix is precise, not blanket.
    expect(proStillPlanned.length).toBeGreaterThanOrEqual(11);
    for (const id of ['store', 'social-feed', 'community', 'notes', 'society', 'school-erp', 'lms', 'saas-dashboard', 'courier', 'ngo', 'kundali']) {
      expect(proStillPlanned, `${id} is a pro architecture and must still be planned`).toContain(id);
    }
  });

  it('the three the autopsy measured are still read as LARGE — the fix stops the planner, it does not hide the fact', () => {
    const large = scaffolded.filter((x) => scopeVerdict(x.t.prompt, { complex: false }).large).map((x) => x.t.id);
    for (const id of ['quran', 'wedding-rsvp', 'panchang']) {
      expect(large, `${id} should still be read as large`).toContain(id);
    }
    // And they split across the two gates — the reason the sibling hunt mattered.
    expect(scopeVerdict(STARTER_TEMPLATES.find((t) => t.id === 'panchang')!.prompt, { complex: false }).projectMode).toBe(true);
    expect(scopeVerdict(STARTER_TEMPLATES.find((t) => t.id === 'quran')!.prompt, { complex: false }).projectMode).toBe(false);
  });

  it('the stand-down is the template, not the chip: with no scaffold the Quran prompt still reaches the planner', () => {
    const q = STARTER_TEMPLATES.find((t) => t.id === 'quran')!;
    const v = scopeVerdict(q.prompt, { complex: false });
    expect(v.scope.decision).toBe('analyze');
    expect(v.dispute).toBeNull(); // no famous app is named, so scopeDispute can never fire for a chip
    expect(roadmapStandsDown({ projectModeOn: false, planFirst: false, megaProject: v.projectMode, templateIsTheApp: false })).toBeNull();
  });
});

describe('the route reads the one predicate at both gates', () => {
  it('there is no second, private copy of the stand-down rule', () => {
    expect(route).toContain('roadmapStandsDown({');
    expect(route).not.toContain('roadmapStandsDownForProjectMode');
    expect((route.match(/roadmapStandsDown\(\{/g) ?? []).length).toBe(1);
    // The tier comparison lives in the registry, never inline in the route (one rule, one home).
    expect(route).not.toMatch(/tier === 'simple'/);
    expect((route.match(/templateIsTheFinishedApp\(seededScaffold\)/g) ?? []).length).toBe(3);
  });

  it('each gate is handed the REAL scaffold, not a literal', () => {
    // 🔴 THIS IS SCOPED TO THE CALL EXPRESSION ON PURPOSE. Written first as a whole-file
    // `expect(route).toContain('scaffoldWillSeed,')`, it PASSED while the gate was reverted to a hardcoded
    // `false` — the ETA call supplies that same substring hundreds of lines away. A guard must pin its
    // property, not a punctuation mark something else in the file happens to contain (the same class as
    // `aModuleIsNotTheWholeApp`'s review gate and `tscErrorCause`'s repair call).
    const open = route.indexOf('roadmapStandsDown({');
    expect(open).toBeGreaterThan(0);
    const call = route.slice(open, route.indexOf('});', open) + 3);
    expect(call).toMatch(/templateIsTheApp: templateIsTheFinishedApp\(seededScaffold\),/);
    expect(call).toMatch(/\bplanFirst,/);
    expect(call).toMatch(/megaProject: appScope\.projectMode,/);
    // The project planner's own gate reads it too, and reads it negated.
    expect(route).toMatch(/appScope\.projectMode && !templateIsTheFinishedApp\(seededScaffold\)\) \{/);
  });
});
