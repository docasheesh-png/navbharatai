import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_ABOUT, aboutContent } from '../src/content/about';
import { renderAboutPage } from '../src/server/lib/marketingPages';
// Native navigation is irrelevant to rendering the shared About panel; no native bridge is loaded.
vi.mock('../src/lib/legalLinks', () => ({ openLegalLink: () => false }));
import { AboutPanel } from '../src/components/panels/AboutPanel';

const introduction = 'NavBharatAI is an Indian artificial intelligence platform operated by NAVBHARATAI PRIVATE LIMITED, a company incorporated under the Companies Act, 2013.';
const vision = 'Founded with a vision to make advanced AI technology accessible, practical, and affordable, NavBharatAI brings powerful AI capabilities together in one platform.';
const exactCompany = [
  'Legal Name: NAVBHARATAI PRIVATE LIMITED',
  'Brand: NavBharatAI',
  'Incorporated: 18 November 2026',
  'CIN: U62010UP2026PTC254952',
  'Registered Office: Ektanagar, Budaun City, Budaun – 243601, Uttar Pradesh, India',
  'Country: India',
];
const text = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');
const panel = (about = aboutContent()) => renderToStaticMarkup(createElement(AboutPanel, { isAdmin: false, about, onOverrideChange: () => undefined }));

describe('owner-supplied corporate About copy, 18 November 2026', () => {
  it('keeps the supplied introduction and mission intact', () => {
    expect(DEFAULT_ABOUT.headline).toBe('About NavBharatAI');
    expect(DEFAULT_ABOUT.tagline).toBe('Empowering Ideas with Artificial Intelligence');
    expect(DEFAULT_ABOUT.description).toBe(`${introduction}\n\n${vision}`);
    expect(DEFAULT_ABOUT.visionHeading).toBe('Our Mission');
    expect(DEFAULT_ABOUT.vision).toBe('To empower individuals, students, professionals, developers, startups, and businesses through accessible and innovative artificial intelligence.');
    expect(DEFAULT_ABOUT.contactIntroduction).toBe('For assistance, business inquiries, or grievances, please contact our official support team through the contact details provided on our website.');
    expect(DEFAULT_ABOUT.copyright).toBe('© 2026 NAVBHARATAI PRIVATE LIMITED. All rights reserved.');
  });

  it('renders all supplied facts, services and contact copy on both public website and app panel', () => {
    for (const html of [renderAboutPage('https://navbharatai.com'), panel()]) {
      const visible = text(html);
      for (const paragraph of [introduction, vision, ...exactCompany, ...DEFAULT_ABOUT.whatWeBuild, DEFAULT_ABOUT.vision,
        DEFAULT_ABOUT.tagline, DEFAULT_ABOUT.contactIntroduction!, DEFAULT_ABOUT.copyright!]) {
        expect(visible).toContain(paragraph);
      }
      for (const heading of ['What We Offer', 'Our Mission', 'Company Information', 'Contact & Support']) expect(visible).toContain(heading);
      expect(html).toContain('mailto:info@navbharatai.com');
      expect(html).toContain('/privacy');
      expect(html).toContain('/terms');
      expect(html).toContain('/grievance');
    }
  });

  it('keeps company facts outside legacy editable overrides', () => {
    const withOldEdits = aboutContent({ headline: 'My old headline', description: 'My old description', team: 'Founder', vision: 'Legacy vision' });
    expect(withOldEdits.indiaFirst).toEqual(exactCompany);
    expect(text(panel(withOldEdits))).toContain('CIN: U62010UP2026PTC254952');
    expect(text(renderAboutPage('https://navbharatai.com', { description: 'Old' }))).toContain('CIN: U62010UP2026PTC254952');
  });

  it('keeps old server responses renderable while clients and server roll out independently', () => {
    const { copyright: _copyright, contactIntroduction: _contactIntroduction, ...legacy } = DEFAULT_ABOUT;
    expect(text(panel(legacy))).toContain('Company Information');
  });

  it('retains narrow-screen wrapping and never displays public edit controls', () => {
    const html = panel();
    expect(html).toContain('grid-cols-1');
    expect(html).toContain('break-words');
    expect(html).not.toContain('Admin edit mode');
    expect(html).not.toContain('title="Headline"');
  });
});
