/**
 * 34 UNLABELLED FIELDS FAILED THREE GATES, AND THE REPORT CALLED THEM THREE THINGS
 * (autopsy a48d0f9e, 2026-09-19 — "Repair some parts", weak tier, free user).
 *
 * That one build recorded, as if they were unrelated:
 *   • `ACCESSIBILITY` 70/100 — *"34 form field(s) with no label … Worst: src/pages/Marksheets.tsx (12),
 *     src/pages/ReportCards.tsx (11), src/pages/Students.tsx (10)"*
 *   • `JOURNEY_NOT_DERIVED` — *"the forms in this app have no field this check could address honestly"*
 *   • `RELEASE_GATE: YELLOW` — *"no user journey was proven, so whether it actually SAVES anything is
 *     untested"*
 *
 * **They are ONE defect.** `journeyDerivation` addresses a field by `data-testid` | `name` | `id` |
 * `placeholder` | `aria-label`; the accessibility pass counts fields carrying none of them. So the
 * same missing attribute is why a screen reader cannot announce the field AND why the platform cannot
 * prove the app saves anything — and that second one is what holds the release gate at YELLOW for any
 * app with a form.
 *
 * Both halves of the 50/50 law are asserted here:
 *   1. PREVENTION — the builder is told, on EVERY tier, to write addressable fields in the first pass.
 *      🔴 It was told on WEAK ONLY: `weakBuildDisciplineBlock` returns '' for a non-weak build, so a
 *      Normal or Strong build was never asked for a label at all.
 *   2. HONESTY — the report names the FIX, not only the symptom, so the sentence is actionable.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { noJourneyReason } from '../src/server/AgentV3/journeyDerivation';
import { weakBuildDisciplineBlock } from '../src/server/AgentV3/weakBuildDiscipline';

const root = join(__dirname, '..');
const prompt = readFileSync(join(root, 'src/server/AgentV3/systemPrompt.ts'), 'utf8');

/** A page with a form whose one field carries nothing addressable — the real shape from that build. */
const UNADDRESSABLE = {
  'src/pages/Students.tsx': `export default function Students() {
    return (<form onSubmit={save}><input type="text" className="field" /><button>Save</button></form>);
  }`,
};

describe('PREVENTION — the addressability contract reaches every tier', () => {
  it('the architect prompt asks for a name AND a label on every field', () => {
    expect(prompt).toContain('EVERY FORM FIELD IS ADDRESSABLE');
    expect(prompt).toContain('`aria-label`');
    expect(prompt).toContain('Placeholder');
    // The two consequences, both named — the whole point is that it is ONE requirement.
    expect(prompt).toContain('WCAG 1.3.1');
    expect(prompt).toMatch(/really SAVES/);
  });

  it('🔴 it is in the ALWAYS-ON prompt, not the weak-only discipline block', () => {
    // The weak block carries a label rule too and is the reason this gap was invisible: it reads as
    // though the builder is always told. It is not — a non-weak build gets an empty string.
    expect(weakBuildDisciplineBlock(true)).toContain('associated `<label>`');
    expect(weakBuildDisciplineBlock(false)).toBe('');
    // …so the contract that every tier receives has to live here.
    expect(prompt).toContain('EVERY FORM FIELD IS ADDRESSABLE');
  });

  it('it says do it AS the field is written, not as a later pass', () => {
    const at = prompt.indexOf('EVERY FORM FIELD IS ADDRESSABLE');
    const bullet = prompt.slice(at, at + 1200);
    expect(bullet).toMatch(/never as a later pass/);
  });
});

describe('HONESTY — the report names the fix, not only the symptom', () => {
  it('the no-journey reason now carries the remedy', () => {
    const reason = noJourneyReason(UNADDRESSABLE);
    // The symptom it always stated, unchanged — nothing was weakened.
    expect(reason).toContain('no field this check could address honestly');
    // …and the fix, which is what makes the line actionable.
    expect(reason).toContain('`name`');
    expect(reason).toMatch(/really saves what is typed/);
    expect(reason).toContain('the same fix a screen reader needs');
  });

  it('the OTHER two reasons are untouched — this is not a blanket suffix', () => {
    // A chat app with no form at all must not be told to add a `name` to fields it does not have.
    expect(noJourneyReason({ 'src/pages/Chat.tsx': 'export default function Chat(){return <div/>;}' }))
      .not.toContain('`name`');
    expect(noJourneyReason({})).not.toContain('`name`');
  });

  it('the reason stays one sentence a person can read, not a lecture', () => {
    expect(noJourneyReason(UNADDRESSABLE).length).toBeLessThan(420);
  });
});

describe('the two halves agree — the fix the report names is the fix the builder is asked for', () => {
  it('both say a name AND a label, so a build cannot satisfy one and fail the other', () => {
    const reason = noJourneyReason(UNADDRESSABLE);
    for (const half of ['`name`', 'label']) {
      expect(reason, `the report names ${half}`).toContain(half);
      expect(prompt.slice(prompt.indexOf('EVERY FORM FIELD IS ADDRESSABLE')).slice(0, 1200),
        `the prompt asks for ${half}`).toContain(half.replace(/`/g, ''));
    }
  });
});
