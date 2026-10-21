import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { normaliseAppId as fromAppId } from '../src/server/lib/appId';
import { normaliseAppId as fromAssembler } from '../src/server/lib/mobileProjectAssembler';

// Autopsy of the 2026-10-16 branding change: the APK builder (client) imported ONE small function from the mobile
// assembler; the assembler gained `appBranding` → `imageProHost` → `pollinationsGuard`, whose lookbehind regex then reached the
// web bundle (`test:bundle`: "Safari before 16.4 throws on these, taking their screen down"). THE CLASS: a client file
// importing a server module for a tiny helper. These modules must never be reachable from client code.
const SERVER_ONLY = /server\/lib\/(mobileProjectAssembler|appBranding|appBrandingScript|imageProHost|pollinationsGuard|mobileShipKit)['"]/;
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? (n === 'server' ? [] : walk(p)) : /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) ? [p] : []; });

describe('the web bundle cannot reach the branding / assembler server chain', () => {
  it('no client file (src/** except src/server) imports those modules', () => {
    const offenders = walk('src').filter((f) => SERVER_ONLY.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
  it('normaliseAppId is one function, reachable from both the client (appId.ts) and the server assembler', () => {
    expect(fromAssembler).toBe(fromAppId);
    expect(fromAppId('com.Shop.Chai', 'x')).toBe('com.Shop.Chai');
    expect(fromAppId('not valid', 'Chai Shop')).toBe('com.navbharat.chaishop');
    expect(fromAppId('com.new.shop', 'x')).not.toContain('.new.');
  });
});
