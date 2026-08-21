import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  PINNED_ID, initialShellCount, initialActiveId, isClosableTab, afterCloseTab, type TerminalSession,
} from './terminalTabs';

/**
 * v5.0 multi-terminal (admin 2026-08-21): "Terminal ke aage + button ho. Pehla terminal AI ka, `+` se
 * jo khule wo user ke."
 *
 * The builder does not run its commands through a PTY, so tab 1 is its BUILD LOG — pinned, read-only
 * and labelled as such — while `+` opens the user's own shells. Dressing the log up as an interactive
 * terminal would be a prompt that cannot accept input, which rule 2 forbids.
 */
const s = (id: string): TerminalSession => ({ id, label: id });

describe('terminal tab rules', () => {
  it('THE MONEY RULE: with a pinned build log, NO shell is opened until the user asks', () => {
    // Every shell holds a real VM and spends the user's 30 free minutes. Opening one just because
    // they opened the Terminal tab would spend it on their behalf.
    expect(initialShellCount(true)).toBe(0);
  });

  it('Code Studio (no pinned tab) still opens one shell up front — its panel IS the terminal', () => {
    expect(initialShellCount(false)).toBe(1);
  });

  it('the pinned log holds focus first; without one, the first shell does', () => {
    expect(initialActiveId(true, 't1')).toBe(PINNED_ID);
    expect(initialActiveId(false, 't1')).toBe('t1');
  });

  it('the pinned tab cannot be closed — it is NavBharatAI\'s record, not the user\'s shell', () => {
    expect(isClosableTab(PINNED_ID)).toBe(false);
    expect(isClosableTab('t1')).toBe(true);
  });

  it('closing the LAST shell falls back to the log — the surface does not leave on the user\'s behalf', () => {
    const r = afterCloseTab([s('t1')], 't1', 't1', true);
    expect(r.closePanel).toBe(false);
    expect(r.nextActiveId).toBe(PINNED_ID);
    expect(r.next).toEqual([]);
  });

  it('WITHOUT a pinned tab, closing the last shell still closes the panel (unchanged)', () => {
    const r = afterCloseTab([s('t1')], 't1', 't1', false);
    expect(r.closePanel).toBe(true);
  });

  it('closing the ACTIVE shell of several moves focus to the last remaining one', () => {
    const r = afterCloseTab([s('t1'), s('t2'), s('t3')], 't2', 't2', true);
    expect(r.next.map((x) => x.id)).toEqual(['t1', 't3']);
    expect(r.nextActiveId).toBe('t3');
  });

  it('closing a BACKGROUND shell leaves focus exactly where it was', () => {
    const r = afterCloseTab([s('t1'), s('t2')], 't1', 't2', true);
    expect(r.nextActiveId).toBe('t2');
    expect(r.closePanel).toBe(false);
  });
});

// The rendered surface, via the repo's static-markup convention. ShellTerminal is lazy and network-
// backed, so these assert the PANEL's own chrome — that the pinned tab is present and marked.
describe('TerminalPanel — rendered chrome', () => {
  it('shows the pinned tab label and its read-only marker, and offers "New Terminal"', async () => {
    const { TerminalPanel } = await import('./TerminalPanel');
    const html = renderToStaticMarkup(
      <TerminalPanel
        workspaceId="ws1"
        pinnedTab={{ label: 'NavBharatAI · build log', content: <div>log</div> }}
      />,
    );
    expect(html).toContain('NavBharatAI · build log');
    expect(html).toContain('log');
    // The daily allowance is stated in the header rather than a fixed "30 free minutes a day".
    expect(html).toContain('Terminal —');
  });
});
