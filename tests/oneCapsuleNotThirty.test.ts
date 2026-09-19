/**
 * ONE CAPSULE, NOT THIRTY — an empty NavBharatAI Pro chat opens clean.
 *
 * Admin, 2026-09-19, with a screenshot of the empty Pro chat: *"in sab ko ek button ke andar band
 * karo… jab user navbharatai pro open kare to bas 'Say hi, or describe an app to build…' dikhe,
 * niche 'OR START FROM A TEMPLATE' par 'template' word ek capsule jaisa hi, is par click karne ke
 * baad sare capsule (jo abhi dikh rhe hai, woh dikhe.) isse navbharatai pro ki screen clean dikhegi
 * user confuse nahi hoga!!"*
 *
 * ## The cure for a wall is not a shorter wall
 *
 * This picker has been shortened once already. On 2026-09-12 thirty-odd chips filling eight or nine
 * lines were cut to about twelve plus a "More templates (N)" expander, and the reasoning recorded
 * then was exactly right: a wall reads as something to scroll past rather than a list to choose
 * from. It was still a wall. A first screen carrying twelve starters, an ⚡ Unlock-with-Pro row and
 * — for anyone who had saved some — a Your-templates row above both, is a menu handed to someone who
 * has not said they want one. So the list goes behind a door, and the door is one chip wide.
 *
 * ## What this test is really guarding
 *
 * Not the collapse — that is three lines. It guards the PROMISE the collapse is only acceptable
 * under: **not one template was removed, and none moved anywhere else.** A "clean screen" bought by
 * quietly dropping the locked Pro row, or the saved templates, or the inner expander, would be a
 * different change wearing this one's justification. Each of those is asserted to be inside the
 * capsule, by name.
 *
 * 🖼️ And one thing is asserted to be OUTSIDE it. "Screenshot → App" is not a template; it is a
 * second way into the build flow. Filing it under "Templates" would put a wrong label on a door
 * nobody would open looking for it — so it stays on the clean screen beside the capsule.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { partitionStarters, pickerSections } from '../src/components/agentv3/starterTemplates';

const root = join(__dirname, '..');
const panel = readFileSync(join(root, 'src/components/agentv3/AgentV3Panel.tsx'), 'utf8');

/**
 * The picker's render, bounded by its own markup rather than by a character count — the drift this
 * file's sibling (`starterTilesAreTextButtons.test.ts`) was bitten by twice.
 */
function pickerBlock(): string {
  const from = panel.indexOf('Or start from a template');
  expect(from, 'the picker heading moved').toBeGreaterThan(-1);
  const to = panel.indexOf('Screenshot → App', from);
  expect(to, 'the screenshot button moved out of the picker').toBeGreaterThan(from);
  return panel.slice(from, to);
}

/** Everything the capsule reveals: between `{templatesOpen && (` and the `)}` that closes it. */
function revealedBlock(): string {
  const block = pickerBlock();
  const from = block.indexOf('{templatesOpen && (');
  expect(from, 'nothing is gated on templatesOpen').toBeGreaterThan(-1);
  return block.slice(from);
}

describe('the screen an empty chat opens with', () => {
  it('has a Templates capsule, closed by default', () => {
    expect(panel).toMatch(/const \[templatesOpen, setTemplatesOpen\] = useState\(false\)/);
    const block = pickerBlock();
    expect(block).toContain('aria-expanded={templatesOpen}');
    expect(block).toContain('setTemplatesOpen((v) => !v)');
    expect(block).toMatch(/>\s*Templates\s*</);
  });

  it('the capsule says it opens HERE, with a chevron', () => {
    // "Templates" alone reads like a link to another page — the same objection the "More templates
    // (N)" expander's own comment records. The chevron is what makes it a disclosure.
    const block = pickerBlock();
    const at = block.indexOf('aria-expanded={templatesOpen}');
    const button = block.slice(at, at + 700);
    expect(button).toContain('<ChevronDown');
    expect(button).toContain('rotate-180');
    expect(button).toContain('rounded-full');   // a capsule, matching the chips it opens
  });

  it('it opens CLOSED every time — an open picker is never inherited by the next chat', () => {
    // The panel is not remounted between chats, so `useState(false)` alone would leave a picker
    // opened in one conversation still open on the next empty one. "Har baar saaf" is the ask.
    expect(panel).toMatch(/if \(!coldStartVisible\) \{ setTemplatesOpen\(false\); setStartersExpanded\(false\); \}/);
  });
});

describe('🔒 nothing was taken away — the capsule holds everything that used to be on show', () => {
  it('the starter chips are inside it', () => {
    expect(revealedBlock()).toContain('starterShown.map');
  });

  it('the inner "More templates (N)" expander is inside it, unchanged', () => {
    const revealed = revealedBlock();
    expect(revealed).toContain('More templates (');
    expect(revealed).toContain('Show fewer templates');
    expect(revealed).toContain('setStartersExpanded((v) => !v)');
  });

  it('the ⚡ Unlock with Pro row is inside it', () => {
    // The free→paid carrot. Dropping it to shorten the screen would be a pricing change disguised
    // as a layout one.
    const revealed = revealedBlock();
    expect(revealed).toContain('Unlock with Pro');
    expect(revealed).toContain('starterLocked.map');
  });

  it('the user’s OWN saved templates are inside it, and still first', () => {
    const revealed = revealedBlock();
    expect(revealed).toContain('Your templates');
    expect(revealed).toContain('pagedSavedTpls.visible.map');
    expect(revealed.indexOf('Your templates')).toBeLessThan(revealed.indexOf('starterShown.map'));
  });

  it('and saved templates are no longer rendered outside the capsule', () => {
    // They used to be their own top-level block above the picker. Left there, a user with five saved
    // templates would still meet a full screen and the change would have achieved nothing for them.
    expect(panel).not.toContain("{chatMode === 'build' && savedTpls.length > 0 && (");
  });

  it('every tappable starter is still reachable — the split hides nothing permanently', () => {
    // The guarantee the render depends on, asserted at the source rather than inferred from the JSX.
    for (const unlocked of [true, false]) {
      const { tappable } = partitionStarters(unlocked);
      const { initial, more } = pickerSections(tappable);
      expect(initial.concat(more).map((t) => t.id).sort()).toEqual(tappable.map((t) => t.id).sort());
    }
  });
});

describe('Screenshot → App stays outside, deliberately', () => {
  it('is not gated on templatesOpen', () => {
    const at = panel.indexOf('openScreenshotGallery}');
    expect(at).toBeGreaterThan(-1);
    // Its render sits after the `)}` that closes the revealed block, so the whole gated region ends
    // before it starts.
    const gateEnd = panel.indexOf('{templatesOpen && (');
    const revealed = panel.slice(gateEnd, at);
    expect(revealed).toContain('</div>');
    expect(panel.slice(at - 1200, at)).not.toContain('{templatesOpen && (');
  });
});

describe('every AI still gives the right directions', () => {
  it('the knowledge base names the capsule instead of claiming the buttons are on show', () => {
    // Directions to buttons that are no longer visible are worse than none: the user hunts, finds
    // nothing, and concludes the templates were removed — which is the one thing this change did not
    // do. Same rule as the sidebar door removed a day earlier.
    const kb = readFileSync(join(root, 'src/server/AppContext/AppKnowledgeBase.ts'), 'utf8');
    expect(kb).not.toContain('one-tap starter templates appear under the message box as small round buttons');
    expect(kb).toContain('Templates" CAPSULE');
    expect(kb).toContain('tap the "Templates" capsule');
  });
});
