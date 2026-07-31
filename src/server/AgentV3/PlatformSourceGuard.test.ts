import { describe, it, expect } from 'vitest';
import { looksLikePlatformSource, PLATFORM_SOURCE_REFUSAL } from './PlatformSourceGuard';

// Contamination autopsy 2026-07-31: a workspace held NavBharatAI's OWN 2576-file platform source, so
// "make this app" spent 31 min trying to boot our server. This guard detects that up front so the engine
// refuses honestly instead of grinding to the 30-min wall — false-positive-proof (needs ≥2 internal paths).

describe('looksLikePlatformSource — detect the platform-source contamination', () => {
  it('DETECTS the real case (≥2 internal signature paths)', () => {
    const paths = [
      'package.json', 'src/main.tsx',
      'src/server/routes/agentv3.ts',
      'src/server/AgentV3/BuildDiagnostics.ts',
      'src/server/AgentV3/AgentRunner.ts',
      'NAVBHARATAI_PRO_V3_DESIGN.md',
    ];
    expect(looksLikePlatformSource(paths)).toBe(true);
  });

  it('DETECTS with exactly the minimum 2 signature paths', () => {
    expect(looksLikePlatformSource(['src/server/routes/agentv3.ts', 'NAVBHARATAI_PRO_V3_DESIGN.md'])).toBe(true);
  });

  it('tolerates leading ./ and / on paths', () => {
    expect(looksLikePlatformSource(['./src/server/AgentV3/AgentRunner.ts', '/NAVBHARATAI_PRO_V3_DESIGN.md'])).toBe(true);
  });

  it('does NOT fire on a single incidental match (a user app with one similar path)', () => {
    expect(looksLikePlatformSource(['src/server/routes/agentv3.ts', 'src/App.tsx', 'package.json'])).toBe(false);
  });

  it('does NOT fire on a normal full-stack user app with a src/server folder', () => {
    const app = [
      'package.json', 'index.html', 'src/App.tsx', 'src/main.tsx',
      'src/server/index.ts', 'src/server/routes/users.ts', 'src/server/db.ts',
      'src/pages/Dashboard.tsx', 'src/components/Header.tsx',
    ];
    expect(looksLikePlatformSource(app)).toBe(false);
  });

  it('does NOT fire on an empty / missing list', () => {
    expect(looksLikePlatformSource([])).toBe(false);
    expect(looksLikePlatformSource(undefined)).toBe(false);
    expect(looksLikePlatformSource(null)).toBe(false);
  });

  it('exposes an honest user-facing refusal message (no vendor/model leakage)', () => {
    expect(PLATFORM_SOURCE_REFUSAL).toMatch(/NavBharatAI/);
    expect(PLATFORM_SOURCE_REFUSAL).toMatch(/fresh workspace/i);
    expect(PLATFORM_SOURCE_REFUSAL).not.toMatch(/GLM|Kimi|Claude|Sonnet|Opus/);
  });
});
