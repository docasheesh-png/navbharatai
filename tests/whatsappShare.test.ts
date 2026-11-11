import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  WHATSAPP_SHARE_LABEL,
  publicShareUrl,
  whatsappShareHref,
  whatsappShareMessage,
} from '../src/lib/whatsappShare';

const APP = 'https://navbharatai.com/store/app/abc';
const APK = 'https://downloads.example.com/kirana.apk';

describe('WhatsApp share link', () => {
  it('opens wa.me with the Hindi message and the app URL encoded once', () => {
    const href = whatsappShareHref({ appUrl: APP, appName: 'Kirana Billing' });
    expect(href.startsWith('https://wa.me/?text=')).toBe(true);
    const text = decodeURIComponent(href.slice('https://wa.me/?text='.length));
    expect(text).toContain(APP);
    expect(text).toContain('Kirana Billing');
    expect(text).toContain('NavBharatAI');
    expect(text).toMatch(/[\u0900-\u097F]/);
    expect(href).not.toContain('%2520');
    expect(WHATSAPP_SHARE_LABEL).toMatch(/[\u0900-\u097F]/);
  });

  it('adds a public APK link when one exists, and only then', () => {
    const withApk = whatsappShareMessage({ appUrl: APP, appName: 'Shop', apkUrl: APK });
    expect(withApk).toContain(APK);
    expect(withApk).toContain(APP);
    const without = whatsappShareMessage({ appUrl: APP, appName: 'Shop' });
    expect(without).not.toContain('Android APK');
  });

  it('never puts an auth ticket or an /api/ download in the message', () => {
    const ticket = 'https://navbharatai.com/api/nav-store/download/abc?exp=1&sig=deadbeef';
    expect(publicShareUrl(ticket)).toBe('');
    expect(publicShareUrl('https://navbharatai.com/api/mobile-ship/download?artifactId=9')).toBe('');
    expect(publicShareUrl('http://insecure.example/app')).toBe('');
    const text = whatsappShareMessage({ appName: 'Milk book', appUrl: ticket, apkUrl: ticket });
    expect(text).not.toContain('sig=');
    expect(text).not.toContain('/api/');
    expect(text).toContain('अटैच');
  });

  it('refuses to build a link when there is no name and no public URL', () => {
    expect(whatsappShareHref({ appUrl: 'not a url' })).toBe('');
    expect(whatsappShareHref({})).toBe('');
  });
});

describe('the button is on the share and download surfaces', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

  it('the publish celebration, the live-site row, App Mart and the APK download all use the one link', () => {
    for (const file of [
      'src/components/agentv3/PublishCelebration.tsx',
      'src/components/agentv3/AgentV3Panel.tsx',
      'src/components/ide/NavAppStore.tsx',
      'src/components/ide/StoreBuildPanel.tsx',
      'src/components/ide/MyBuiltApps.tsx',
    ]) {
      expect(src(file), file).toContain('WhatsAppShareLink');
    }
    // The play overlay stays without a share button — that removal was deliberate.
    expect(src('src/components/ide/WebAppPlayer.tsx')).not.toContain('WhatsAppShareLink');
  });
});
