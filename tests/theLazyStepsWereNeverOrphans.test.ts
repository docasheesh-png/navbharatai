// Autopsy a5b661c8 (2026-09-30) — "Build a 3d automatic and human approval app for plan, design and
// posting a collection and transfer revenue to bank account. I am making advt on social media".
//
// The app worked (rendered, typechecked, its own tests passed). Three of the platform's own readings
// of it were false, and each one is a finding a later pass acts on:
//   • "6 component(s) created but never used" — every step was LAZY-loaded, and the project graph never
//     read `import('./steps/PlanStep')`. The reviewer called it a false positive in its own words.
//   • a HUMAN CHARACTER spec (1.75 m, a part list, a humanoid builder) handed to the builder, because
//     "human" matched in "human approval".
//   • domain = SOCIAL, off "advt on social media" — a campaign workflow told to consider a realtime
//     feed, notifications and moderation.

import { describe, it, expect } from 'vitest';
import { WorkspaceMemory, extractFacts } from '../src/server/AgentV3/WorkspaceMemory';
import { findOrphanComponents } from '../src/server/AgentV3/ArchitectureAnalysis';
import { heroObjectIds, withoutNonObjectSenses } from '../src/server/lib/heroObjectSpec';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';

const PROMPT = 'Bulid a 3d automatic and human approvalapp for plan, design and posting an collection and transfer revenue to bank account. I am making advt on social media';

const APP = `import { Suspense, lazy } from 'react';
import { StudioShell } from './components/StudioShell';
const PlanStep = lazy(() => import('./steps/PlanStep').then((m) => ({ default: m.PlanStep })));
const DesignStep = lazy(() => import("./steps/DesignStep").then((m) => ({ default: m.DesignStep })));
export default function App() { return <StudioShell><Suspense fallback={null}><PlanStep /><DesignStep /></Suspense></StudioShell>; }
`;

function graphOf(files: Record<string, string>) {
  const mem = new WorkspaceMemory();
  for (const [p, c] of Object.entries(files)) mem.indexFile(p, c);
  return mem.graph();
}

describe('a lazy-loaded screen is imported', () => {
  it('the report\'s own App.tsx makes its steps reachable', () => {
    expect(extractFacts('src/App.tsx', APP).imports).toEqual(expect.arrayContaining(['./steps/PlanStep', './steps/DesignStep']));
    const orphans = findOrphanComponents(graphOf({
      'src/App.tsx': APP,
      'src/components/StudioShell.tsx': 'export function StudioShell({ children }: { children: any }) { return <main>{children}</main>; }',
      'src/steps/PlanStep.tsx': 'export function PlanStep() { return <section>Plan</section>; }',
      'src/steps/DesignStep.tsx': 'export function DesignStep() { return <section>Design</section>; }',
      'src/steps/Unused.tsx': 'export function Unused() { return <p>never shown</p>; }',
    }));
    expect(orphans).toEqual(['src/steps/Unused.tsx (Unused)']); // a genuinely unused one is still reported
  });

  it('a re-exported component is reachable through its barrel', () => {
    const orphans = findOrphanComponents(graphOf({
      'src/App.tsx': "import { Card } from './ui';\nexport default function App() { return <Card />; }",
      'src/ui/index.ts': "export { Card } from './Card';\nexport * from './Badge';",
      'src/ui/Card.tsx': 'export function Card() { return <div />; }',
      'src/ui/Badge.tsx': 'export function Badge() { return <span />; }',
    }));
    expect(orphans).toEqual([]);
  });

  it('a URL import is neither a file nor a package, and a commented-out import is not an import', () => {
    const f = extractFacts('src/App.tsx', "const m = await import('https://cdn.example.com/x.js');\n// import('./Ghost')\nexport const a = 1;");
    expect(f.imports).toEqual([]);
    expect(f.dependencies).toEqual([]);
  });
});

describe('a word that names an object is not always the object', () => {
  it('"human approval" is a person who approves, not a character to model', () => {
    expect(heroObjectIds(PROMPT)).not.toContain('human');
    expect(withoutNonObjectSenses('human approval app')).not.toMatch(/human/);
  });

  it('a landing page\'s hero section, a character limit and a music player are not characters', () => {
    expect(heroObjectIds('a 3d landing page with a hero section')).not.toContain('human');
    expect(heroObjectIds('3d text editor with a character limit')).not.toContain('human');
    expect(heroObjectIds('a 3d music player')).not.toContain('human');
  });

  it('a real character still is one', () => {
    expect(heroObjectIds('a 3d running game where the player dodges cars')).toContain('human');
    expect(heroObjectIds('3d game with a human hero fighting robots')).toContain('human');
  });
});

describe('posting TO social media is marketing, not a social network', () => {
  it('the report\'s prompt is not social', () => {
    expect(analyzeRequirementGaps(PROMPT).domain).not.toBe('social');
  });

  it('the marketing forms are stripped; a real social app keeps its domain', () => {
    expect(analyzeRequirementGaps('a scheduler for social media posts with a content calendar').domain).not.toBe('social');
    expect(analyzeRequirementGaps('build a social media app where friends follow each other and like posts').domain).toBe('social');
  });
});
