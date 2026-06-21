import { describe, it, expect } from 'vitest';
import { IntentExtractor } from '../src/server/AppMakerLab/intelligence/IntentExtractor';

describe('IntentExtractor.extract', () => {
  const extractor = new IntentExtractor();

  it('returns web-application for generic prompt', () => {
    const r = extractor.extract('build a todo app');
    expect(r.applicationType).toBe('web-application');
  });

  it('returns mobile-application for "mobile" keyword', () => {
    const r = extractor.extract('build a mobile app');
    expect(r.applicationType).toBe('mobile-application');
  });

  it('detects healthcare domain from "hospital" keyword', () => {
    const r = extractor.extract('hospital management system');
    expect(r.domain).toBe('healthcare');
  });

  it('detects ecommerce domain from "shop" keyword', () => {
    const r = extractor.extract('online shop with cart');
    expect(r.domain).toBe('ecommerce');
  });

  it('detects erp domain from "erp" keyword', () => {
    const r = extractor.extract('build an erp system');
    expect(r.domain).toBe('erp');
  });

  it('returns general domain for unrecognized text', () => {
    const r = extractor.extract('build a simple app');
    expect(r.domain).toBe('general');
  });

  it('returns non-empty userRoles array', () => {
    const r = extractor.extract('app for doctors and patients');
    expect(Array.isArray(r.userRoles)).toBe(true);
    expect(r.userRoles.length).toBeGreaterThan(0);
  });

  it('detects "doctor" role from prompt text', () => {
    const r = extractor.extract('doctor patient scheduling system');
    expect(r.userRoles).toContain('doctor');
  });
});
