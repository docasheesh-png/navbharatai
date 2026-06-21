import { describe, it, expect } from 'vitest';
import { IntentExtractor } from '../src/server/AppMakerLab/intelligence/IntentExtractor';
import { FeatureExtractor } from '../src/server/AppMakerLab/intelligence/FeatureExtractor';
import { ModuleClassifier } from '../src/server/AppMakerLab/intelligence/ModuleClassifier';

// ── IntentExtractor ──────────────────────────────────────────────────────────

describe('IntentExtractor.extract', () => {
  const ie = new IntentExtractor();

  it('detects healthcare domain from "hospital"', () => {
    const r = ie.extract('Build a hospital management system');
    expect(r.domain).toBe('healthcare');
  });

  it('detects ecommerce domain from "store"', () => {
    const r = ie.extract('Build an online store with cart');
    expect(r.domain).toBe('ecommerce');
  });

  it('detects finance domain from "bank"', () => {
    const r = ie.extract('Build a banking dashboard');
    expect(r.domain).toBe('finance');
  });

  it('returns "general" when no domain keyword matches', () => {
    const r = ie.extract('Build something completely abstract');
    expect(r.domain).toBe('general');
  });

  it('classifies a mobile prompt as mobile-application', () => {
    const r = ie.extract('Build a mobile banking app');
    expect(r.applicationType).toBe('mobile-application');
  });

  it('classifies a non-mobile prompt as web-application', () => {
    const r = ie.extract('Build a CRM dashboard');
    expect(r.applicationType).toBe('web-application');
  });

  it('extracts roles from "for: admin, manager" syntax', () => {
    const r = ie.extract('Create app for: admin, manager');
    expect(r.userRoles).toContain('admin');
    expect(r.userRoles).toContain('manager');
  });

  it('falls back to heuristic role detection from keywords', () => {
    const r = ie.extract('System with customer and admin access');
    expect(r.userRoles).toContain('customer');
    expect(r.userRoles).toContain('admin');
  });

  it('defaults to "doctor" when no role detected and domain is healthcare', () => {
    const r = ie.extract('Build a medical records system');
    expect(r.userRoles).toContain('doctor');
  });

  it('defaults to "user" when no role detected and domain is non-healthcare', () => {
    const r = ie.extract('Build a finance analytics tool');
    expect(r.userRoles).toContain('user');
  });
});

// ── FeatureExtractor ─────────────────────────────────────────────────────────

describe('FeatureExtractor.extract', () => {
  const fe = new FeatureExtractor();

  it('extracts dashboard feature from "dashboard"', () => {
    expect(fe.extract('Build a dashboard with overview')).toContain('dashboard');
  });

  it('extracts auth feature from "login"', () => {
    expect(fe.extract('Add login and signup pages')).toContain('auth');
  });

  it('extracts billing feature from "invoice"', () => {
    expect(fe.extract('Generate invoices for customers')).toContain('billing');
  });

  it('extracts multiple features from a complex prompt', () => {
    const features = fe.extract('Dashboard with auth, billing, inventory and analytics');
    expect(features).toContain('dashboard');
    expect(features).toContain('auth');
    expect(features).toContain('billing');
    expect(features).toContain('inventory');
    expect(features).toContain('analytics');
  });

  it('returns empty array for a prompt with no recognized features', () => {
    expect(fe.extract('Just a plain text page with no forms')).toEqual([]);
  });

  it('extracts messaging feature from "chat"', () => {
    expect(fe.extract('Add real-time chat notifications')).toContain('messaging');
  });
});

// ── ModuleClassifier ─────────────────────────────────────────────────────────

describe('ModuleClassifier.classify', () => {
  const mc = new ModuleClassifier();

  it('always adds a DATABASE module even when no features are given', () => {
    const result = mc.classify([]);
    expect(result['DATABASE']).toBeDefined();
    expect(result['DATABASE'].type).toBe('DATABASE');
  });

  it('maps "auth" to AUTH type with no dependencies', () => {
    const result = mc.classify(['auth']);
    expect(result['auth'].type).toBe('AUTH');
    expect(result['auth'].dependencies).toHaveLength(0);
  });

  it('maps "dashboard" to FRONTEND type with BACKEND dependency', () => {
    const result = mc.classify(['dashboard']);
    expect(result['dashboard'].type).toBe('FRONTEND');
    expect(result['dashboard'].dependencies).toContain('BACKEND');
  });

  it('maps "billing" to BACKEND type with DATABASE dependency', () => {
    const result = mc.classify(['billing']);
    expect(result['billing'].type).toBe('BACKEND');
    expect(result['billing'].dependencies).toContain('DATABASE');
  });

  it('falls back to FRONTEND + BACKEND dep for unknown features', () => {
    const result = mc.classify(['some-unknown-feature']);
    expect(result['some-unknown-feature'].type).toBe('FRONTEND');
    expect(result['some-unknown-feature'].dependencies).toContain('BACKEND');
  });

  it('classifies multiple features in one call', () => {
    const result = mc.classify(['auth', 'billing', 'inventory']);
    expect(result['auth'].type).toBe('AUTH');
    expect(result['billing'].type).toBe('BACKEND');
    expect(result['inventory'].type).toBe('BACKEND');
  });
});
