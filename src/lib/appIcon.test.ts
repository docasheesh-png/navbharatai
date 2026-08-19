import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  fitIconToLimit, STORE_ICON_ATTEMPTS, STORE_ICON_MAX_CHARS, STORE_ICON_PX,
  judgeIcon, isAcceptedImageType, type IconEncodeAttempt,
} from './appIcon';

/** A fake encoder whose output size is a function of the attempt — no canvas, no browser. */
const encoderOfSize = (sizeFor: (a: IconEncodeAttempt) => number) =>
  async (a: IconEncodeAttempt) => `data:${a.mime};base64,${'x'.repeat(Math.max(0, sizeFor(a)))}`;

describe('fitIconToLimit — an AI-made icon must actually fit, not be refused', () => {
  it('takes the first (best-quality) encoding when it already fits', async () => {
    const r = await fitIconToLimit(encoderOfSize(() => 1000));
    expect(r.ok).toBe(true);
    expect(r.dataUrl?.startsWith('data:image/png')).toBe(true);
    expect(r.width).toBe(STORE_ICON_PX);
  });

  it('steps down until it fits — the 1024×1024 PNG out of AI Image Gen is the whole point', async () => {
    // PNG at full size is far over the cap; JPEG at 0.9 fits. Before this, "Paste" answered
    // "too large" every single time, because a generated icon is never small.
    const r = await fitIconToLimit(encoderOfSize((a) => (a.mime === 'image/png' ? 900_000 : 120_000)));
    expect(r.ok).toBe(true);
    expect(r.dataUrl?.startsWith('data:image/jpeg')).toBe(true);
    expect((r.dataUrl || '').length).toBeLessThan(STORE_ICON_MAX_CHARS);
  });

  it('keeps shrinking when quality alone is not enough', async () => {
    const r = await fitIconToLimit(encoderOfSize((a) => (a.px >= 384 ? 900_000 : 50_000)));
    expect(r.ok).toBe(true);
    expect(r.width).toBeLessThan(384);
  });

  it('never returns something over the limit — it fails honestly instead', async () => {
    const r = await fitIconToLimit(encoderOfSize(() => 900_000));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/too detailed|simpler/i);
  });

  it('carries on when ONE encoding is unsupported by the browser', async () => {
    let calls = 0;
    const r = await fitIconToLimit(async (a) => {
      calls++;
      if (a.mime === 'image/png') throw new Error('no png');
      return `data:image/jpeg;base64,${'x'.repeat(1000)}`;
    });
    expect(r.ok).toBe(true);
    expect(calls).toBeGreaterThan(1);
  });

  it('says so plainly when nothing could be encoded at all', async () => {
    const r = await fitIconToLimit(async () => { throw new Error('no canvas'); });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/could not be prepared/i);
  });

  it('the ladder only ever gets smaller/cheaper — a step that grows would be wasted work', () => {
    for (let i = 1; i < STORE_ICON_ATTEMPTS.length; i++) {
      const prev = STORE_ICON_ATTEMPTS[i - 1];
      const cur = STORE_ICON_ATTEMPTS[i];
      const cheaper = cur.px < prev.px
        || (cur.px === prev.px && prev.mime === 'image/png' && cur.mime === 'image/jpeg')
        || (cur.px === prev.px && (cur.quality ?? 1) < (prev.quality ?? 1));
      expect(cheaper).toBe(true);
    }
  });

  it('stays under the server\'s own cap, with room to spare', () => {
    const server = readFileSync(join(process.cwd(), 'src/server/routes/navStore.ts'), 'utf8');
    const declared = /STORE_ICON_MAX_CHARS = (\d[\d_]*)/.exec(server);
    expect(declared).toBeTruthy();
    expect(STORE_ICON_MAX_CHARS).toBeLessThan(Number((declared as RegExpExecArray)[1].replace(/_/g, '')));
  });
});

describe('appIcon — the Play-Store rules the APK path still needs', () => {
  it('refuses a non-square icon rather than cropping someone\'s app icon behind their back', () => {
    expect(judgeIcon(512, 256, 1000).ok).toBe(false);
  });
  it('accepts a small square with an honest warning', () => {
    const r = judgeIcon(256, 256, 1000);
    expect(r.ok).toBe(true);
    expect(r.warning).toContain('512');
  });
  it('knows which image types both browsers and the Android pipeline handle', () => {
    expect(isAcceptedImageType('image/png')).toBe(true);
    expect(isAcceptedImageType('image/gif')).toBe(false);
  });
});

describe('the store publish sheet offers all three ways in', () => {
  const sheet = readFileSync(join(process.cwd(), 'src/components/agentv3/HostingChooser.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('uploads, pastes, and makes — on the shared pipeline, not a second copy of the rules', () => {
    expect(sheet).toContain('readStoreIcon');
    expect(sheet).toContain('readStoreIconFromClipboard');
    expect(sheet).toContain('onMakeIcon');
    // The old inline 200KB refusal is what made a generated icon impossible to use.
    expect(sheet).not.toContain('200_000');
  });

  it('"Make icon" leaves the publish form open — it is a round trip, not a hand-off', () => {
    const panel = readFileSync(join(process.cwd(), 'src/components/agentv3/AgentV3Panel.tsx'), 'utf8');
    const at = panel.indexOf('onMakeIcon={');
    expect(at).toBeGreaterThan(-1);
    const wiring = panel.slice(at, panel.indexOf('onClose=', at)); // this prop only, not its neighbours
    expect(wiring).toContain("view: 'imagegen'");
    // Closing it would discard the name/screenshots the user already typed, so they would come back
    // from AI Image Gen with an icon and nowhere to paste it.
    expect(wiring).not.toContain('setShowHostingChooser(false)');
  });
});
