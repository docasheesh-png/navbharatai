/**
 * A LEGAL RISK WRITTEN ONLY IN A DOCUMENT IS A RISK NOBODY CAN ACT ON (admin 2026-09-09).
 *
 * Two runtime services run on free tiers their own terms reserve for NON-COMMERCIAL use, while
 * NavBharatAI charges money — so the exposure is live today, not at some future scale. Both had been
 * sitting as open items in CLAUDE.md and PROGRESS.md for weeks, where the admin (who does not read
 * source) could never see them.
 *
 * The rules below are the ones that make this a feature rather than prose in a .ts file: the register
 * reads the SAME switch the source obeys, "off" is never presented as a fix, and no credential value
 * can leak through it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import {
  LICENCE_EXPOSURES,
  liveWeatherSourceEnabled,
  exposureState,
  licenceExposures,
  activeExposureCount,
  licenceExposureHeadline,
} from './licenceExposure';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('the weather switch — one definition, obeyed by the source AND reported by the panel', () => {
  it('is ON by default and off only on the explicit word', () => {
    expect(liveWeatherSourceEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(liveWeatherSourceEnabled({ LIVE_WEATHER_SOURCE: 'off' } as never)).toBe(false);
    expect(liveWeatherSourceEnabled({ LIVE_WEATHER_SOURCE: ' OFF ' } as never)).toBe(false);
    expect(liveWeatherSourceEnabled({ LIVE_WEATHER_SOURCE: 'on' } as never)).toBe(true);
    expect(liveWeatherSourceEnabled({ LIVE_WEATHER_SOURCE: 'false' } as never)).toBe(true); // not "off"
  });

  it('🔒 the SOURCE reads this exact function — a panel that kept its own opinion would be a false assurance', () => {
    // This is the whole design. If the dispatcher stopped importing it, the card could report "off"
    // while the calls kept going out — worse than no card at all, because it would be believed.
    const src = read('../server/lib/liveDataSources.ts');
    expect(src).toContain("import { liveWeatherSourceEnabled } from '../../lib/licenceExposure'");
    expect(src).toContain('liveWeatherSourceEnabled(env)');
    // …and switching it off must remove BOTH Open-Meteo callers, not just the obvious one.
    expect(src).toContain('? [weatherBlock, aqiBlock, currencyBlock, pincodeBlock]');
    expect(src).toContain(': [currencyBlock, pincodeBlock]');
  });

  it('the sources that are NOT restricted keep working when it is off', () => {
    const src = read('../server/lib/liveDataSources.ts');
    const off = src.slice(src.indexOf(': [currencyBlock, pincodeBlock]'));
    expect(off).toContain('currencyBlock');
    expect(off).toContain('pincodeBlock');
  });
});

describe('exposureState — what is actually running right now', () => {
  const vt = LICENCE_EXPOSURES.find((e) => e.id === 'virustotal')!;
  const om = LICENCE_EXPOSURES.find((e) => e.id === 'open-meteo')!;

  it('a key-gated source is active only when its key is present', () => {
    expect(exposureState(vt, { VIRUSTOTAL_API_KEY: 'k' } as never)).toBe('active');
    expect(exposureState(vt, {} as never)).toBe('not-configured');
    expect(exposureState(vt, { VIRUSTOTAL_API_KEY: '   ' } as never)).toBe('not-configured');
  });

  it('🔒 a source needing NO key is active by default — the reason this one went unnoticed', () => {
    // Every other restricted integration announces itself by having a key to set. This one does not,
    // so "nobody configured it" is not available as a defence.
    expect(exposureState(om, {} as never)).toBe('active');
    expect(exposureState(om, { LIVE_WEATHER_SOURCE: 'off' } as never)).toBe('switched-off');
  });

  it('switched-off beats everything — an off source is not in use, whatever its key says', () => {
    const keyed = { ...om, requires: 'SOME_KEY' };
    expect(exposureState(keyed, { SOME_KEY: 'x', LIVE_WEATHER_SOURCE: 'off' } as never)).toBe('switched-off');
  });
});

describe('the register as a whole', () => {
  it('counts only what is running', () => {
    expect(activeExposureCount({ VIRUSTOTAL_API_KEY: 'k' } as never)).toBe(2); // both live
    expect(activeExposureCount({} as never)).toBe(1);                          // weather only
    expect(activeExposureCount({ LIVE_WEATHER_SOURCE: 'off' } as never)).toBe(0);
  });

  it('every row carries the four things an admin needs to decide', () => {
    for (const row of licenceExposures({} as never)) {
      expect(row.name, row.id).toBeTruthy();
      expect(row.restriction, row.id).toBeTruthy();
      expect(row.powers, row.id).toBeTruthy();
      expect(row.honestFix, row.id).toBeTruthy();
      expect(row.whenOff, row.id).toBeTruthy();
      expect(['active', 'switched-off', 'not-configured']).toContain(row.state);
    }
  });

  it('🔒 every row says the real fix is a PURCHASE — "off" must never read as solved', () => {
    // The failure this prevents is subtle and permanent: an admin who switches something off and
    // believes the exposure is closed will never buy the plan, and the risk returns the day someone
    // switches it back on.
    for (const row of LICENCE_EXPOSURES) {
      expect(row.honestFix.toLowerCase(), row.id).toMatch(/buy|plan|commercial/);
      expect(row.honestFix.toLowerCase(), row.id).toContain('cannot be fixed in code');
    }
  });

  it('🔒 no row can leak a secret — it names env KEYS, never values', () => {
    const blob = JSON.stringify(LICENCE_EXPOSURES);
    expect(blob).toContain('VIRUSTOTAL_API_KEY'); // the NAME is fine and necessary
    // A value would have to arrive through `requires`/`killSwitch`, which are read from the env by
    // `exposureState` and never copied into a row.
    for (const row of licenceExposures({ VIRUSTOTAL_API_KEY: 'super-secret-value' } as never)) {
      expect(JSON.stringify(row)).not.toContain('super-secret-value');
    }
  });

  it('the headline is honest in BOTH directions', () => {
    const running = licenceExposureHeadline({ VIRUSTOTAL_API_KEY: 'k' } as never);
    expect(running).toMatch(/2 of 2/);
    expect(running.toLowerCase()).toContain('pause, not a fix');
    // Zero running is "not currently exposed", never "solved" — one env change reverses it.
    const none = licenceExposureHeadline({ LIVE_WEATHER_SOURCE: 'off' } as never);
    expect(none.toLowerCase()).toContain('none of the');
    expect(none.toLowerCase()).not.toMatch(/\bsolved\b|\bsafe\b|\bfixed\b/);
  });
});

describe('the admin surface is wired, admin-only, and read-only', () => {
  const route = read('../server/routes/admin.ts');
  const panel = read('../components/AdminDashboard.tsx');

  it('the route exists behind the admin token and returns the register', () => {
    expect(route).toContain("app.get('/api/admin/licence-exposure', verifyAdminToken");
    expect(route).toContain('licenceExposures()');
    expect(route).toContain('licenceExposureHeadline()');
  });

  it('the panel fetches it when the Security tab opens, and renders the honest fix', () => {
    expect(panel).toContain("fetch('/api/admin/licence-exposure'");
    expect(panel).toContain('fetchLicenceExposure()');
    expect(panel).toContain('The real fix:');
    expect(panel).toContain('If switched off:');
  });

  it('🔒 there is NO write path — a licence decision is not a button', () => {
    // Turning a source off is a Cloud Run change the admin makes deliberately. A one-click toggle here
    // would let a mis-tap stop App Store publishing for every user with no audit trail.
    const at = panel.indexOf('Licence exposure');
    const card = panel.slice(at, at + 3500);
    expect(card).not.toMatch(/onClick=\{[^}]*licence/i);
    expect(route).not.toContain("app.post('/api/admin/licence-exposure'");
  });
});
