import { describe, it, expect } from 'vitest';
import {
  TEMPLATE_META,
  CATEGORY_ORDER,
  LEGACY_GENERIC_DESCRIPTION,
  templateMeta,
  type TemplateCategory,
} from './curatedTemplateMeta';

// The ids shipped in CURATED_TEMPLATES (TemplatesPanel.tsx). Kept here as the coverage contract so a new
// blueprint added without gallery metadata fails this test instead of silently showing the fallback line.
const CURATED_IDS = [
  'intro', 'analytics', 'calc', 'clock', 'rn_app', 'portfolio', 'ecommerce', 'dashboard',
  'upi_payment', 'hindi_app', 'gst_invoice', 'startup_tracker',
];

describe('curated template gallery metadata', () => {
  it('every shipped blueprint has its own metadata entry', () => {
    for (const id of CURATED_IDS) {
      expect(TEMPLATE_META[id], `missing gallery metadata for "${id}"`).toBeDefined();
    }
    expect(Object.keys(TEMPLATE_META).sort()).toEqual([...CURATED_IDS].sort());
  });

  it('every description is specific — non-empty and NEVER the old shared placeholder (rule-2 fix)', () => {
    for (const [id, meta] of Object.entries(TEMPLATE_META)) {
      expect(meta.description.trim().length, `empty description for "${id}"`).toBeGreaterThan(10);
      expect(meta.description).not.toBe(LEGACY_GENERIC_DESCRIPTION);
    }
  });

  it('no two cards read identically — every description is unique', () => {
    const descriptions = Object.values(TEMPLATE_META).map((m) => m.description);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it('every category is a known one', () => {
    for (const [id, meta] of Object.entries(TEMPLATE_META)) {
      expect(CATEGORY_ORDER, `unknown category for "${id}"`).toContain(meta.category);
    }
  });

  it('CATEGORY_ORDER has no duplicates', () => {
    expect(new Set(CATEGORY_ORDER).size).toBe(CATEGORY_ORDER.length);
  });

  it('templateMeta falls back safely for an unknown id (no crash, not the old placeholder)', () => {
    const fallback = templateMeta('this-id-does-not-exist');
    expect(fallback.description).not.toBe(LEGACY_GENERIC_DESCRIPTION);
    expect(fallback.description.trim().length).toBeGreaterThan(0);
    expect(CATEGORY_ORDER).toContain(fallback.category as TemplateCategory);
  });

  it('templateMeta returns the real entry for a known id', () => {
    expect(templateMeta('gst_invoice').category).toBe('India-First');
    expect(templateMeta('gst_invoice').description).toContain('GST');
  });
});
