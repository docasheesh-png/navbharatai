import { describe, it, expect } from 'vitest';
import { ashokChakraSvg, ASHOK_CHAKRA_NAVY } from './ashokChakra';

describe('ashokChakraSvg — the shared preview loading spinner', () => {
  it('renders an authentic chakra: 24 spokes, a rim and a hub, in flag navy by default', () => {
    const svg = ashokChakraSvg();
    expect((svg.match(/<line /g) || []).length).toBe(24);
    expect((svg.match(/<circle /g) || []).length).toBe(2); // rim + hub
    expect(svg).toContain(ASHOK_CHAKRA_NAVY);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
  });
  it('respects a custom size and color', () => {
    const svg = ashokChakraSvg(48, '#4f6ef7');
    expect(svg).toContain('width="48"');
    expect(svg).toContain('#4f6ef7');
    expect(svg).not.toContain(ASHOK_CHAKRA_NAVY);
  });
});
