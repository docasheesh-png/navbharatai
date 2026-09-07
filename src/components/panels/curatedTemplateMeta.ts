// Gallery metadata for the "Project Blueprints" curated templates (TemplatesPanel).
//
// WHY THIS FILE EXISTS (rule-2 fix): every blueprint card used to render the SAME hardcoded line —
// "Pre-configured scaffolding for modern responsive web applications." — so a GST-invoice card and a
// portfolio card read identically. A card that does not describe its own template is a small dishonesty
// and a real cold-start cost (the user cannot tell the blueprints apart). This module gives every
// template a SPECIFIC one-line description plus a category, so the gallery can describe each card
// truthfully and offer a category filter.
//
// Kept as PURE DATA (no React, no `motion`) and separate from the component so it is unit-testable in the
// node test environment, and so the giant prompt array in TemplatesPanel.tsx stays untouched — the
// description/category are looked up by id, never by editing each prompt entry.

export type TemplateCategory = 'Business' | 'Commerce' | 'India-First' | 'Productivity' | 'Personal';

/** The order categories appear as filter tabs in the gallery. */
export const CATEGORY_ORDER: TemplateCategory[] = ['Business', 'Commerce', 'India-First', 'Productivity', 'Personal'];

export interface TemplateMeta {
  category: TemplateCategory;
  /** A line SPECIFIC to this template — shown on its gallery card. Never a shared placeholder. */
  description: string;
}

/** Per-template gallery metadata, keyed by the `id` of each entry in CURATED_TEMPLATES. */
export const TEMPLATE_META: Record<string, TemplateMeta> = {
  intro: { category: 'Personal', description: 'Say hello and let NavBharatAI show you what it can build for you.' },
  analytics: { category: 'Business', description: 'A real-time KPI dashboard — revenue, growth and churn in interactive charts.' },
  calc: { category: 'Productivity', description: 'A high-precision scientific calculator with a working engine and a history list.' },
  clock: { category: 'Personal', description: 'A luxury analog watch synced to device time, with smooth, accurate hands.' },
  rn_app: { category: 'Personal', description: 'A mobile-first app with tab navigation and offline support — ready to wrap as an APK.' },
  portfolio: { category: 'Personal', description: 'A polished portfolio: animated hero, projects gallery, skills and a contact form.' },
  ecommerce: { category: 'Commerce', description: 'A modern product-listing page with a cart, live totals and add-to-cart.' },
  dashboard: { category: 'Business', description: 'A professional admin dashboard: sidebar, KPI cards, an activity table and a chart.' },
  upi_payment: { category: 'India-First', description: 'A complete UPI checkout with Razorpay, amount presets and a GST breakdown.' },
  hindi_app: { category: 'India-First', description: 'A bilingual Hindi/English job board with an instant toggle and Devanagari fonts.' },
  gst_invoice: { category: 'India-First', description: 'A GST-compliant invoice generator with CGST/SGST/IGST logic and GSTIN validation.' },
  startup_tracker: { category: 'India-First', description: "Track an Indian startup's registration journey — checklist, calendar and costs." },
};

/** The old shared placeholder — exported so a test can assert it never appears as a real description again. */
export const LEGACY_GENERIC_DESCRIPTION = 'Pre-configured scaffolding for modern responsive web applications.';

/**
 * The gallery metadata for a template id. Falls back to a safe, generic-but-honest line for any id that
 * has no entry yet (a new template shows a plain description rather than crashing or borrowing another
 * card's line) — but every shipped template carries its own specific description above.
 */
export function templateMeta(id: string): TemplateMeta {
  return TEMPLATE_META[id] ?? { category: 'Productivity', description: 'A ready-to-build starter blueprint.' };
}
