import { describe, it, expect } from 'vitest';
import { STARTER_TEMPLATES, partitionStarters } from '../src/components/agentv3/starterTemplates';
import { GOLDEN_SCAFFOLDS, goldenScaffoldFiles, goldenScaffoldForPrompt } from '../src/server/AgentV3/goldenScaffolds/registry';

/**
 * The India-first starters are the one part of this library a competitor does not carry, so what makes
 * them Indian is the thing worth pinning. Every assertion below is a property that could be "simplified"
 * away by a later edit with nothing else failing — a GST bill that prints one tax line instead of the
 * CGST/SGST split is still a working app, and still useless to the shop it was built for.
 */
const INDIA_IDS = ['gst-bill', 'exam-prep', 'society', 'coaching'] as const;

const appSourceFor = (id: string): string => {
  const scaffold = GOLDEN_SCAFFOLDS.find((g) => g.id === id);
  expect(scaffold, id + ' has no golden scaffold').toBeTruthy();
  return goldenScaffoldFiles(scaffold!)['src/App.tsx'];
};

describe('India-first starters — the moat is present and reaches the free tier', () => {
  it('all four exist as chips AND as scaffolds', () => {
    for (const id of INDIA_IDS) {
      expect(STARTER_TEMPLATES.map((t) => t.id), id).toContain(id);
      expect(GOLDEN_SCAFFOLDS.map((g) => g.id), id).toContain(id);
    }
  });

  it('a FREE user can actually build at least two of them — the moat is not all behind a lock', () => {
    // The whole reason the GST biller and the mock test were built as single-screen localStorage apps.
    // If a later change promotes them to pro "for quality", a free user never sees the India-first
    // difference at all, and nothing else in the suite would notice.
    const { tappable } = partitionStarters(false);
    const freeIndia = tappable.filter((t) => (INDIA_IDS as readonly string[]).includes(t.id));
    expect(freeIndia.map((t) => t.id).sort()).toEqual(['exam-prep', 'gst-bill']);
  });

  it('tapping each chip starts from its own scaffold, never a from-scratch build', () => {
    for (const id of INDIA_IDS) {
      const chip = STARTER_TEMPLATES.find((t) => t.id === id)!;
      expect(goldenScaffoldForPrompt(chip.prompt)?.id, id).toBe(id);
    }
  });
});

describe('the GST biller is actually GST-compliant, not a generic invoice', () => {
  const app = appSourceFor('gst-bill');

  it('splits the tax into CGST and SGST rather than printing one GST line', () => {
    expect(app).toContain('CGST');
    expect(app).toContain('SGST');
  });

  it('carries the real Indian slab set, with the slab on the ITEM', () => {
    // A single app-wide rate is the usual shortcut and it is wrong: rice and a cold drink are not taxed
    // at the same rate, so the slab has to live on the item.
    for (const slab of ['0', '5', '12', '18', '28']) expect(app, slab).toContain(slab);
    expect(app).toMatch(/gst:\s*\d+/);
  });

  it('prices in rupees and formats them the Indian way', () => {
    expect(app).toContain('₹');
    expect(app).toContain('en-IN');
  });

  it('never double-bills: completing a bill advances the bill number', () => {
    expect(app).toMatch(/setBillNo\(billNo \+ 1\)/);
  });
});

describe('the mock test behaves like a real competitive exam paper', () => {
  const app = appSourceFor('exam-prep');

  it('applies negative marking, which is what makes a practice score meaningful', () => {
    expect(app).toMatch(/NEGATIVE\s*=\s*0\.25/);
    expect(app).toMatch(/correct - wrong \* NEGATIVE/);
  });

  it('is sectioned and timed for the whole paper, not one question at a time', () => {
    for (const section of ['General Knowledge', 'Reasoning', 'Quantitative Aptitude', 'English']) {
      expect(app, section).toContain(section);
    }
    expect(app).toMatch(/DURATION_SEC/);
  });

  it('has a question palette and mark-for-review, so a candidate can move around the paper', () => {
    expect(app).toContain('Palette');
    expect(app).toContain('Mark for review');
  });

  it('clears its interval — a timer left running after submission keeps waking the tab', () => {
    expect(app).toContain('clearInterval');
  });
});

describe('the two pro India apps bill a whole month in one action', () => {
  // Billing flat-by-flat or student-by-student is the friction that makes a treasurer go back to paper,
  // and billing twice is the bug that loses their trust. Both are properties of the code, so both are
  // pinned here.
  it('the society app raises the month for every flat and skips anyone already billed', () => {
    const app = appSourceFor('society');
    expect(app).toMatch(/Raise \{month\} bill/);
    expect(app).toMatch(/if \(dues\.items\.some\(\(d\) => d\.flatId === f\.id && d\.month === month\)\) continue;/);
  });

  it('the coaching app bills each student at their OWN batch rate', () => {
    const app = appSourceFor('coaching');
    expect(app).toMatch(/Raise \{month\} fees/);
    expect(app).toMatch(/if \(fees\.items\.some\(\(f\) => f\.studentId === s\.id && f\.month === month\)\) continue;/);
    // The fee comes from the student's batch, so two batches at different rates bill correctly.
    expect(app).toMatch(/amount: b \? b\.fee : 0/);
  });

  it('both price in rupees through the shared helper rather than a hardcoded symbol', () => {
    for (const id of ['society', 'coaching']) {
      const app = appSourceFor(id);
      expect(app, id).toMatch(/inr\(/);
      expect(app, id).toMatch(/from '\.\/lib\/store'/);
    }
  });
});
