/**
 * NavBharatAI has no Donate option (admin 2026-09-26: "slide menu me donate wala option hai. isko
 * permanently sabhi jagah se root se delete kar do! kabhi bhi traces bachne na paye!!").
 *
 * The option was a whole view, not one button: a sidebar tile, a `menuItems` entry (which also gave it a
 * header chip and a desktop rail row), a `'donation'` view id, a lazily-loaded panel, its editable page
 * content and seed data (including a UPI id), an image-upload handler used by nothing else, a module
 * toggle in Settings, and an entry in the app's knowledge base that told every AI "Sidebar → Donate".
 * All of it is gone, and this suite fails if any of those doors comes back.
 *
 * ⚠️ WHAT THIS DELIBERATELY DOES NOT TOUCH: donations as a thing USERS BUILD or ASK ABOUT. The NGO
 * template and generator (80G receipts), the Volunteering & Social-Impact assistant's "how to donate
 * safely" advice, and the domain knowledge a builder uses for a temple or charity app are about the
 * user's own work, not a way to pay NavBharatAI. So the checks below name NavBharatAI's own surfaces
 * rather than banning a word.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) out.push(...filesUnder(rel));
    else out.push(rel);
  }
  return out;
}

describe('the Donate option is gone for good', () => {
  it('has no panel file', () => {
    expect(existsSync(join(root, 'src/components/panels/DonationPanel.tsx'))).toBe(false);
    const panels = filesUnder('src/components').filter((f) => /donat/i.test(f));
    expect(panels).toEqual([]);
  });

  it('has no view id', () => {
    expect(read('src/types/index.ts')).not.toMatch(/'donation'/);
  });

  it('has no menu entry, tile, route or render branch', () => {
    for (const f of ['src/App.tsx', 'src/components/panels/SidebarNav.tsx', 'src/components/panels/TopNav.tsx']) {
      const code = read(f);
      expect(code, f).not.toMatch(/'donation'/);
      expect(code, f).not.toMatch(/>\s*Donate\s*</);
      expect(code, f).not.toMatch(/label:\s*'Donate'/);
      expect(code, f).not.toMatch(/Donation(Panel|Data)|isDonationEditing|navbharat_donation/);
    }
  });

  it('has no module toggle and no seed content', () => {
    expect(read('src/hooks/useSettings.ts')).not.toMatch(/donation/);
    const content = read('src/config/defaultContent.ts');
    expect(content).not.toMatch(/Donation|upiId|qrUrl/);
  });

  it('tells no AI that a Donate option exists', () => {
    const kb = read('src/server/AppContext/AppKnowledgeBase.ts');
    expect(kb).not.toMatch(/id:\s*'donate'/);
    expect(kb).not.toMatch(/Sidebar\s*→\s*Donate/);
    expect(kb).not.toMatch(/relatedFeatures:[^\n]*'donate'/);
  });

  it('carries the old UPI id nowhere in the app', () => {
    const hits = [...filesUnder('src'), 'server.ts', 'index.html']
      .filter((f) => /\.(tsx?|html|json)$/.test(f))
      .filter((f) => read(f).includes('doc.asheesh@oksbi'));
    expect(hits).toEqual([]);
  });
});
