import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActionGroupRow } from './ActivityTimelineRow';
import { buildChatBlocks } from './activityTimeline';
import type { ActivityEntry } from './agentV3Types';

const tool = (id: string, ts: number, text: string, extra: Partial<ActivityEntry> = {}): ActivityEntry =>
  ({ id, ts, kind: 'tool', text, ...extra });
const file = (id: string, ts: number, text: string): ActivityEntry => ({ id, ts, kind: 'file', text, ok: true });

function actionsBlock(activity: ActivityEntry[], diffs: Record<string, string> = {}) {
  const blocks = buildChatBlocks<{ role: 'user' | 'agent'; text: string; ts: number }>([], activity, diffs);
  const b = blocks[0];
  if (!b || b.kind !== 'actions') throw new Error('expected an actions block');
  return b;
}

describe('ActionGroupRow — Claude-style collapsed action row (real render)', () => {
  it('renders the summary + real diff stats in a collapsed row', () => {
    const block = actionsBlock(
      [file('f1', 1, 'edited src/App.tsx')],
      { 'src/App.tsx': '+++ b/x\n+a\n+b\n-c\n' },
    );
    const html = renderToStaticMarkup(<ActionGroupRow block={block} />);
    expect(html).toContain('Edited App.tsx');
    expect(html).toContain('+2');
    expect(html).toContain('-1');
    expect(html).toContain('<button'); // a real button, not a div-with-onClick (the iOS lesson)
  });

  it('shows the live progress note + spinner while the group is active', () => {
    const blocks = buildChatBlocks(
      [{ role: 'agent' as const, ts: 20, text: '✓ src/App.tsx (12/33)' }],
      [tool('t1', 10, 'writing src/App.tsx', { active: true })],
      {},
    );
    const b = blocks[0];
    if (b.kind !== 'actions') throw new Error('expected actions');
    const html = renderToStaticMarkup(<ActionGroupRow block={b} />);
    expect(html).toContain('12/33 files');
    expect(html).toContain('<canvas'); // the live spinner is now the freeze-proof TirangaLoader (a canvas)
  });

  it('a failed group renders with the failure accent', () => {
    const html = renderToStaticMarkup(<ActionGroupRow block={actionsBlock([tool('c1', 1, 'running: npm test', { ok: false })])} />);
    expect(html).toContain('border-red-500/30');
  });

  it('NEVER auto-opens the diff (admin 2026-07-23) — the patch body stays collapsed behind "View changes"', () => {
    // A small (1-file) change used to auto-open the inline diff; now it must stay collapsed until the user
    // taps "View changes". The +/- stats stay in the button; only the patch BODY is hidden by default.
    const block = actionsBlock(
      [file('f1', 1, 'edited src/App.tsx')],
      { 'src/App.tsx': '+++ b/x\n+ZZUNIQUEDIFFMARKER\n-old\n' },
    );
    const html = renderToStaticMarkup(<ActionGroupRow block={block} />);
    expect(html).toContain('View'); // the collapsed "View changes" button (not "Hide")
    expect(html).toContain('changes');
    expect(html).not.toContain('ZZUNIQUEDIFFMARKER'); // the patch body is NOT rendered by default
  });
});

// ── PER-FILE NARRATION (admin 2026-08-10) ─────────────────────────────────────────────────────────
// "user ko ek ek file dikhe narration ke sath" — the row already showed the file NAME; these lock the
// one thing it was missing, plus the two ways it could go wrong: a WRONG label, or a label that
// silently disappears the code the user came to read.
describe('per-file narration', () => {
  // The detail rows render only while the group is ACTIVE (a live build auto-expands, admin
  // 2026-07-12) — which is exactly when this label matters, so that is what these render.
  const liveFile = (id: string, path: string) =>
    actionsBlock([{ id, ts: 1, kind: 'tool', text: `writing ${path}`, active: true } as ActivityEntry]);

  it('says what a file IS, next to its name', () => {
    const html = renderToStaticMarkup(
      <ActionGroupRow block={liveFile('f1', 'src/components/LoginForm.tsx')} />,
    );
    expect(html).toContain('LoginForm.tsx');
    expect(html).toContain('a part of a screen');
  });

  it('speaks the language the SERVER resolved for the build', () => {
    const html = renderToStaticMarkup(
      <ActionGroupRow block={liveFile('f2', 'pages/api/orders.ts')} lang="hi" />,
    );
    expect(html).toContain('एक API एंडपॉइंट');
  });

  it('shows no label when the path does not confidently say what it is', () => {
    // A missing label is honest. A guessed one on a file the user cannot read is not.
    const html = renderToStaticMarkup(<ActionGroupRow block={liveFile('f3', 'weirdfile')} />);
    expect(html).toContain('weirdfile');
    expect(html).not.toContain('·  ');
  });

  it('never replaces the filename — the user still sees the real path', () => {
    const html = renderToStaticMarkup(
      <ActionGroupRow block={liveFile('f4', 'src/api/checkout.ts')} />,
    );
    expect(html).toContain('src/api/checkout.ts');
  });
});
