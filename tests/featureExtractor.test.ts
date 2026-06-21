import { describe, it, expect } from 'vitest';
import { FeatureExtractor } from '../src/server/AppMakerLab/intelligence/FeatureExtractor';

describe('FeatureExtractor.extract', () => {
  const extractor = new FeatureExtractor();

  it('returns empty array for unrecognized text', () => {
    expect(extractor.extract('build a simple app')).toEqual([]);
  });

  it('detects "auth" from "login" keyword', () => {
    expect(extractor.extract('build an app with login')).toContain('auth');
  });

  it('detects "billing" from "payment" keyword', () => {
    expect(extractor.extract('add payment processing')).toContain('billing');
  });

  it('detects "inventory" from "stock" keyword', () => {
    expect(extractor.extract('manage stock levels')).toContain('inventory');
  });

  it('detects "analytics" from "charts" keyword', () => {
    expect(extractor.extract('show charts and graphs')).toContain('analytics');
  });

  it('detects "messaging" from "chat" keyword', () => {
    expect(extractor.extract('real-time chat feature')).toContain('messaging');
  });

  it('detects multiple features at once', () => {
    const features = extractor.extract('app with login and payment and charts');
    expect(features).toContain('auth');
    expect(features).toContain('billing');
    expect(features).toContain('analytics');
  });

  it('is case-insensitive', () => {
    expect(extractor.extract('BUILD WITH LOGIN')).toContain('auth');
  });
});
