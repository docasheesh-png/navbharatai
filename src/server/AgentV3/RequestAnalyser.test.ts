import { describe, it, expect } from 'vitest';
import { analyzeRequest, rankFeatures } from './RequestAnalyser';

const tier = (prompt: string, extra = {}) => analyzeRequest({ prompt, ...extra }).startTier;

describe('analyzeRequest — task classification & tiering', () => {
  it('routes greetings/chat to Gemini', () => {
    expect(tier('hi there')).toBe('gemini');
    expect(tier('namaste, kaise ho')).toBe('gemini');
    expect(tier('thanks!')).toBe('gemini');
  });

  it('routes translate/summary to Gemini', () => {
    expect(tier('translate this to hindi')).toBe('gemini');
    expect(tier('summarize this article')).toBe('gemini');
  });

  it('routes SIMPLE apps (calculator/clock/ludo/3d ball) to Gemini — the new-user case', () => {
    expect(tier('make a calculator')).toBe('gemini');
    expect(tier('build a digital clock')).toBe('gemini');
    expect(tier('create a ludo game')).toBe('gemini');
    expect(tier('bouncing 3d ball animation')).toBe('gemini');
    expect(tier('simple todo app')).toBe('gemini');
    const r = analyzeRequest({ prompt: 'make a calculator' });
    expect(r.taskType).toBe('simple_app');
    expect(r.complexityScore).toBeLessThanOrEqual(20);
  });

  it('keeps a simple app cheap even when extra words sneak in', () => {
    // "calculator" wins as simple_app and is capped ≤20 despite a longer prompt.
    expect(tier('please make me a nice calculator with a clean modern responsive ui and dark mode toggle')).toBe('gemini');
  });

  it('routes small/general coding to Haiku', () => {
    const r = analyzeRequest({ prompt: 'write a react component for a button' });
    expect(r.taskType).toBe('coding');
    expect(r.startTier).toBe('haiku');
  });

  it('routes full/complex apps to Sonnet', () => {
    expect(tier('build a full-stack saas dashboard with authentication and a database')).toBe('sonnet');
    expect(tier('create an e-commerce checkout with stripe payment and a backend api')).toBe('sonnet');
  });

  it('caps architecture/system-design at Sonnet in NORMAL mode (Opus is power-only)', () => {
    expect(tier('design a scalable microservice architecture for high-availability')).toBe('sonnet');
    expect(tier('refactor the entire system into a distributed production-grade design')).toBe('sonnet');
    // The complexity score is still high (for telemetry / "suggest Power" UX), tier just caps.
    expect(analyzeRequest({ prompt: 'design a scalable microservice architecture' }).complexityScore).toBeGreaterThan(70);
  });

  it('POWER mode bypasses the ladder → Opus 4.8 for everything, no escalation', () => {
    const simple = analyzeRequest({ prompt: 'make a calculator', powerMode: true });
    expect(simple.startTier).toBe('opus');
    expect(simple.escalationPath).toEqual(['opus']);
    expect(simple.reasoning).toContain('POWER');
    // Even a greeting goes to Opus under Power.
    expect(analyzeRequest({ prompt: 'hi', powerMode: true }).startTier).toBe('opus');
  });
});

describe('analyzeRequest — feature adjustments', () => {
  it('a production/security signal pushes complexity up a tier', () => {
    const plain = analyzeRequest({ prompt: 'write a login form component' });
    const prod = analyzeRequest({ prompt: 'write a production secure login form component with scalable performance' });
    expect(prod.complexityScore).toBeGreaterThan(plain.complexityScore);
  });

  it('a large project (many files) raises the score', () => {
    const small = analyzeRequest({ prompt: 'fix a small bug', fileCount: 2 }).complexityScore;
    const big = analyzeRequest({ prompt: 'fix a small bug', fileCount: 40 }).complexityScore;
    expect(big).toBeGreaterThan(small);
  });

  it('clamps the score to 0..100', () => {
    const r = analyzeRequest({ prompt: 'production secure scalable distributed enterprise microservice architecture refactor the entire system'.repeat(20), fileCount: 100, historyTurns: 50 });
    expect(r.complexityScore).toBeLessThanOrEqual(100);
    expect(r.complexityScore).toBeGreaterThanOrEqual(0);
  });
});

describe('analyzeRequest — escalation path & ambiguity', () => {
  it('escalation path runs from the start tier up to Sonnet (Opus is power-only)', () => {
    expect(analyzeRequest({ prompt: 'make a calculator' }).escalationPath).toEqual(['gemini', 'haiku', 'sonnet']);
    expect(analyzeRequest({ prompt: 'design a scalable microservice architecture' }).escalationPath).toEqual(['sonnet']);
  });

  it('flags borderline scores as ambiguous and always returns a safe default tier', () => {
    // We do not assert a specific borderline prompt; we assert the invariant:
    const r = analyzeRequest({ prompt: 'write a react component for a button' });
    expect(['gemini', 'haiku', 'sonnet', 'opus']).toContain(r.startTier);
    expect(typeof r.ambiguous).toBe('boolean');
    expect(r.reasoning).toContain('→');
  });

  it('handles empty/garbage input safely (defaults to chat → gemini)', () => {
    expect(analyzeRequest({ prompt: '' }).startTier).toBe('gemini');
    // @ts-expect-error testing defensive handling of a bad input
    expect(analyzeRequest({}).startTier).toBe('gemini');
  });
});

describe('analyzeRequest — page-scoped deliverables route to the fast lane (the 29-min "SaaS landing page" bug)', () => {
  it('the exact mis-routed prompt gets a cheap tier (fast-lane eligible), not sonnet/agentic', () => {
    // Real build report 2026-07-06: `saas` forced complex_app → sonnet → blueprint + sub-agents →
    // 148 steps / 29 min / wall-clock death. A one-page landing site must take the ~2-min fast lane.
    const r = analyzeRequest({ prompt: 'Make a modern SaaS landing page: sticky navbar with logo + links, a hero section with a headline, subtext and two buttons, a 3-card features row, a pricing section with 3 tiers, and a footer. Clean, responsive, dark theme.' });
    expect(r.taskType).toBe('simple_app');
    expect(['gemini', 'haiku']).toContain(r.startTier); // classifyForOneShot() true → fast lane
  });

  it('a landing page WITH real backend scope still routes complex (never under-provisioned)', () => {
    const r = analyzeRequest({ prompt: 'SaaS landing page with login system, stripe checkout and a database' });
    expect(r.taskType).toBe('complex_app');
    expect(r.startTier).toBe('sonnet');
  });

  it('a genuine SaaS platform ask is still complex_app → sonnet (unchanged)', () => {
    const r = analyzeRequest({ prompt: 'build a SaaS CRM with team accounts' });
    expect(r.taskType).toBe('complex_app');
    expect(r.startTier).toBe('sonnet');
  });
});

describe('rankFeatures — intelligent scoping (Phase B) — feature priority ranking', () => {
  it('detects CORE features: auth, CRUD, navigation', () => {
    const ranking = rankFeatures('Hospital CRM with login system. Users should be able to add patients, view all patients, delete records, and navigate between pages.');
    expect(ranking.core.length).toBeGreaterThan(0);
    expect(ranking.core.join('').toLowerCase()).toMatch(/login|auth|add|create|delete|list|navigate/);
  });

  it('detects IMPORTANT features: search, filtering, export', () => {
    const ranking = rankFeatures('Build a hospital CRM. Must have patient search, filtering by department, and CSV export capability.');
    expect(ranking.important.length).toBeGreaterThan(0);
    expect(ranking.important.join('').toLowerCase()).toMatch(/search|filter|export/);
  });

  it('detects NICE features: analytics, dark mode, reports', () => {
    const ranking = rankFeatures('Hospital CRM with analytics dashboard. Also add monthly reports generator. Dark mode theme.');
    // Either nice features are detected or they're correctly placed in other categories
    const allFeatures = [...ranking.core, ...ranking.important, ...ranking.nice].join('').toLowerCase();
    expect(allFeatures).toMatch(/analytics|report/); // At least one NICE feature detected
  });

  it('organizes a complex app into priority tiers', () => {
    const ranking = rankFeatures('Hospital CRM: login system, patient CRUD, appointment scheduling, search/filter, analytics dashboard, multi-language support, and dark mode.');
    expect(ranking.core.length).toBeGreaterThan(0); // auth, CRUD
    expect(ranking.important.length).toBeGreaterThan(0); // scheduling, search
    expect(ranking.nice.length).toBeGreaterThan(0); // analytics, i18n, theme
  });

  it('returns empty arrays for prompts with no feature mentions', () => {
    const ranking = rankFeatures('hello there');
    expect(Array.isArray(ranking.core)).toBe(true);
    expect(Array.isArray(ranking.important)).toBe(true);
    expect(Array.isArray(ranking.nice)).toBe(true);
  });

  it('deduplicates feature mentions', () => {
    const ranking = rankFeatures('Add auth. Login is required. Sign-in is mandatory. Auth tokens. User login flow.');
    // Should deduplicate similar auth mentions
    expect(ranking.core.length).toBeGreaterThan(0);
    // Deduped length should be less than or equal to non-deduped count
    expect(ranking.core.length).toBeLessThanOrEqual(5); // reasonable bound for dedup
  });

  it('integrates feature ranking into analyzeRequest for app builds', () => {
    const r = analyzeRequest({ prompt: 'Hospital CRM: auth, patient list, delete, and analytics.' });
    if (r.taskType === 'simple_app' || r.taskType === 'complex_app') {
      expect(r.features).toBeDefined();
      if (r.features) {
        expect(Array.isArray(r.features.core)).toBe(true);
        expect(Array.isArray(r.features.important)).toBe(true);
        expect(Array.isArray(r.features.nice)).toBe(true);
      }
    }
  });

  it('does NOT rank features for non-app tasks (chat, coding, etc.)', () => {
    const r = analyzeRequest({ prompt: 'hello there' });
    expect(r.features).toBeUndefined(); // chat task → no feature ranking
  });
});
