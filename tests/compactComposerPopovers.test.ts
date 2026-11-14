import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { attachMenuPosition } from '../src/lib/attachMenuPosition';

describe('content-sized composer popup geometry', () => {
  for (const width of [320, 393, 1280]) for (const height of [390, 852]) {
    it(`fits ${width}x${height} and leaves the composer clear`, () => {
      const anchor = { top: height - 140, bottom: height - 24, left: width - 70 };
      const viewport = { top: 0, left: 0, width, height };
      for (const contentHeight of [120, 250, 2000]) {
        const p = attachMenuPosition(anchor, viewport, contentHeight, 240);
        expect(p.width).toBe(240);
        expect(p.left).toBeGreaterThanOrEqual(8);
        expect(p.left + p.width).toBeLessThanOrEqual(width - 8);
        expect(p.top).toBeGreaterThanOrEqual(8);
        expect(p.top + Math.min(contentHeight, p.maxHeight)).toBeLessThanOrEqual(anchor.top - 8);
        expect(p).not.toHaveProperty('height');
        expect(p).not.toHaveProperty('bottom');
      }
    });
  }
  it('clamps within an offset visual viewport after keyboard and zoom', () => {
    const p = attachMenuPosition({ top: 310, bottom: 420, left: 250 },
      { top: 100, left: 40, width: 260, height: 340 }, 1000);
    expect(p.width).toBe(244);
    expect(p.left).toBe(48);
    expect(p.top).toBe(108);
    expect(p.maxHeight).toBe(194);
  });
  it('has compact defaults and permits the smaller mode chooser', () => {
    const anchor = { top: 600, bottom: 700, left: 12 };
    const viewport = { top: 0, left: 0, width: 393, height: 852 };
    expect(attachMenuPosition(anchor, viewport, 150).width).toBe(300);
    expect(attachMenuPosition(anchor, viewport, 150, 240).width).toBe(240);
  });
  it('does not let global composer CSS stretch measured attachment portals', () => {
    const css = readFileSync('src/components/chat/composer.css', 'utf8');
    expect(css).not.toMatch(/\[data-attach-menu\]\s*\{[^}]*!important/s);
    expect(css).not.toContain('--nb-mode-height');
  });
  it('routes both Pro choosers through one measured portal, without changing actions', () => {
    const panel = readFileSync('src/components/agentv3/AgentV3Panel.tsx', 'utf8');
    expect(panel.match(/<ComposerPopover /g)).toHaveLength(2);
    expect(panel).toContain('setChatMode(m)');
    expect(panel).toContain('setPowerLevel(opt.key)');
    expect(panel).toContain('aria-expanded={modeMenuOpen}');
    expect(panel).toContain('aria-expanded={settingsOpen}');
  });
});
