/**
 * Applying a brand writes colours and a name. It does not remove the Made with NavBharatAI badge,
 * and it does not charge.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brandKitFiles } from '../src/lib/brandKit';

const input = {
  appName: 'Mitrify',
  tagline: 'Kaam paas mein',
  primaryColor: '#FF6B00',
  secondaryColor: '#138808',
  accentColor: '#ffffff',
  bgColor: '#0a0a0a',
  textColor: '#fafafa',
  fontFamily: 'Poppins',
  borderRadius: '12',
  footerText: 'Bareilly',
};

describe('brand files', () => {
  it('writes the colour and refuses anything that could hide the badge or run a script', () => {
    const kit = brandKitFiles(input);
    expect(kit.ok).toBe(true);
    if (!kit.ok) return;
    expect(kit.files['src/brand.css']).toContain('#ff6b00');
    expect(kit.files['src/brand.ts']).toContain('Mitrify');
    const packed = JSON.stringify(kit.files);
    expect(packed).not.toContain('data-nbai-badge');
    expect(packed).not.toMatch(/<script/i);
    expect(packed).not.toMatch(/display\s*:\s*none/i);
    expect(packed).toContain('does not remove the Made with NavBharatAI badge');
  });

  it('a bad colour writes nothing', () => {
    const kit = brandKitFiles({ ...input, primaryColor: 'red; } body{display:none' });
    expect(kit.ok).toBe(false);
  });

  it('the apply route is registered and does not debit a wallet', () => {
    const route = readFileSync(join(__dirname, '../src/server/routes/brandApply.ts'), 'utf8');
    expect(route).toContain("'/api/agentv3/brand/apply'");
    expect(route).not.toContain('chargeDeliveredHostingAddon');
    expect(route).not.toContain('computeDebitedWallet');
    const ui = readFileSync(join(__dirname, '../src/components/ide/WhitelabelBranding.tsx'), 'utf8');
    expect(ui).toContain('Apply to this app');
    expect(ui).toContain('/api/agentv3/brand/apply');
    const panel = readFileSync(join(__dirname, '../src/components/panels/ViewPanels.tsx'), 'utf8');
    expect(panel).toContain('<WhitelabelBranding workspaceId=');
  });
});
