import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { choosePreviewSource, modeForSource, previewSourceLabel, previewSourceTitle, previewToolsFor } from '../src/components/agentv3/previewSource';

/**
 * ONE PREVIEW PANE (admin 2026-09-11: "user ko live e2b nahi, bas e2b ka copy … 2 preview wala system
 * khatam karo"). The pane shows the best free source by itself; the paid live server is only ever an
 * explicit ask. The rule is pure and lives in one place, so the surface cannot say six different
 * things about what it is showing.
 */

const COPY = 'https://navbharatai--sn-ws-abc.web.app';

describe('choosePreviewSource — the rule', () => {
  it('auto + idle + a current copy ⇒ the real build (snapshot)', () => {
    expect(choosePreviewSource({ choice: 'auto', buildPhase: 'idle', snapshotUrl: COPY })).toBe('snapshot');
  });

  it('auto + no copy ⇒ the instant render', () => {
    expect(choosePreviewSource({ choice: 'auto', buildPhase: 'idle', snapshotUrl: '' })).toBe('inbrowser');
    expect(choosePreviewSource({ choice: 'auto', buildPhase: 'idle', snapshotUrl: null })).toBe('inbrowser');
    expect(choosePreviewSource({ choice: 'auto', buildPhase: undefined, snapshotUrl: undefined })).toBe('inbrowser');
  });

  it('🔒 a build in flight never shows the copy — it is of the PREVIOUS build', () => {
    expect(choosePreviewSource({ choice: 'auto', buildPhase: 'generating', snapshotUrl: COPY })).toBe('inbrowser');
    expect(choosePreviewSource({ choice: 'auto', buildPhase: 'settling', snapshotUrl: COPY })).toBe('inbrowser');
  });

  it('🔒 the live server is never chosen on the user’s behalf', () => {
    expect(choosePreviewSource({ choice: 'auto', buildPhase: 'idle', snapshotUrl: '' })).not.toBe('live');
    expect(choosePreviewSource({ choice: 'auto', buildPhase: 'generating', snapshotUrl: '' })).not.toBe('live');
  });

  it('an explicit choice wins over everything, in both directions', () => {
    expect(choosePreviewSource({ choice: 'live', buildPhase: 'idle', snapshotUrl: COPY })).toBe('live');
    expect(choosePreviewSource({ choice: 'live', buildPhase: 'generating', snapshotUrl: '' })).toBe('live');
    // 'inbrowser' exists for the Visual Editor, which can only edit the bundler's own document.
    expect(choosePreviewSource({ choice: 'inbrowser', buildPhase: 'idle', snapshotUrl: COPY })).toBe('inbrowser');
  });

  it('only an http(s) url counts as a copy', () => {
    expect(choosePreviewSource({ choice: 'auto', buildPhase: 'idle', snapshotUrl: 'javascript:alert(1)' })).toBe('inbrowser');
    expect(choosePreviewSource({ choice: 'auto', buildPhase: 'idle', snapshotUrl: 'sn-ws-abc' })).toBe('inbrowser');
  });

  it('survives garbage', () => {
    expect(choosePreviewSource(undefined as never)).toBe('inbrowser');
    expect(choosePreviewSource({} as never)).toBe('inbrowser');
  });
});

describe('modeForSource — the copy rides the in-browser frame', () => {
  it('maps three sources onto the two frames the surface owns', () => {
    expect(modeForSource('snapshot')).toBe('inbrowser');
    expect(modeForSource('inbrowser')).toBe('inbrowser');
    expect(modeForSource('live')).toBe('live');
  });
});

describe('labels — what the user is looking at, without a vendor, a machine, or jargon', () => {
  it('names each source', () => {
    expect(previewSourceLabel('snapshot')).toBe('Your app · last build');
    expect(previewSourceLabel('inbrowser')).toBe('Instant preview');
    expect(previewSourceLabel('inbrowser', 'react')).toBe('Instant preview (react)');
    expect(previewSourceLabel('live')).toBe('Live server');
  });

  it('the live title says PAID; the free ones say free; none names a provider', () => {
    expect(previewSourceTitle('live')).toMatch(/PAID/);
    expect(previewSourceTitle('snapshot')).toMatch(/Free/);
    expect(previewSourceTitle('inbrowser')).toMatch(/free/);
    for (const s of ['snapshot', 'inbrowser', 'live'] as const) {
      expect(previewSourceTitle(s)).not.toMatch(/e2b|firebase|vercel|claude|gemini|glm|kimi/i);
      expect(previewSourceLabel(s)).not.toMatch(/e2b|firebase|snapshot/i);
    }
  });
});

describe('previewToolsFor — no control over a document it cannot act on', () => {
  it('the saved copy has no bridge: no console, no picker, no in-place editor', () => {
    expect(previewToolsFor('snapshot')).toEqual({ console: false, edit: false, pick: false });
  });
  it('the instant render is the editable one; the live server is the pickable one', () => {
    expect(previewToolsFor('inbrowser')).toEqual({ console: true, edit: true, pick: false });
    expect(previewToolsFor('live')).toEqual({ console: true, edit: false, pick: true });
  });
});

describe('wiring — the surface is driven by the rule, and by nothing else', () => {
  const surface = readFileSync(join(process.cwd(), 'src/components/agentv3/PreviewSurface.tsx'), 'utf8');
  const code = surface.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('one choice state, default auto; source and mode are DERIVED, never stored', () => {
    expect(code).toContain("const [choice, setChoice] = useState<PreviewChoice>('auto');");
    expect(code).toContain("const source = choosePreviewSource({ choice, buildPhase: buildPhase ?? 'idle', snapshotUrl: idleSnapshotUrl });");
    expect(code).toContain('const mode = modeForSource(source);');
    expect(code).not.toContain('setMode(');
    expect(code).not.toMatch(/useState<'live' \| 'inbrowser'>/);
  });

  it('🔒 the two tabs are gone: one on-demand Live server action, and one way back', () => {
    expect(code).not.toContain('>In-browser</button>');
    expect(code).toContain("onClick={() => setChoice('live')}");
    expect(code).toContain("onClick={() => { userPickedInBrowser.current = true; setChoice('auto'); }}");
    // The Paid tag stays on the live action at every width (previewHeaderCompact.test.ts pins the rest).
    const btn = code.slice(code.indexOf("onClick={() => setChoice('live')}"), code.indexOf('</button>', code.indexOf("onClick={() => setChoice('live')}")));
    expect(btn).toContain('LIVE_SERVER_PAID_TAG');
  });

  it('the pane frames the copy FIRST in its chain, keyed for the refresh button', () => {
    const at = code.indexOf("{source === 'snapshot' ? (");
    expect(at).toBeGreaterThan(-1);
    const frame = code.slice(at, at + 900);
    expect(frame).toContain('src={idleSnapshotUrl}');
    expect(frame).toContain('key={snapshotReloadKey}');
    expect(frame).toContain('title="Your app"');
    // The refusal / welcome / loading / error chain follows it — a current copy outranks all of them.
    expect(frame).toContain(') : refusal.refuse ? (');
  });

  it('the label and its explanation come from the rule', () => {
    expect(code).toContain('title={previewSourceTitle(source)}>{previewSourceLabel(source, kind)}</span>');
  });

  it('the bundler’s own caveats and banners show only over the bundler’s render', () => {
    for (const banner of [
      "{source === 'inbrowser' && !refusal.refuse && browserRunnable === false && !hasBackend && browserBlockedReason && (",
      "{source === 'inbrowser' && envVarsUsed.length > 0 && (",
      "{source === 'inbrowser' && !!html && !err && !refusal.refuse && !!fidelityNotice && (",
      "{source === 'inbrowser' && hasBackend && !refusal.refuse && (",
    ]) expect(code).toContain(banner);
  });

  it('Edit on the copy opens the instant render; leaving the editor hands the pane back to the rule', () => {
    expect(code).toContain("if (source === 'snapshot') { setChoice('inbrowser'); return; }");
    expect(code).toContain("if (!next && choice === 'inbrowser') setChoice('auto');");
    expect(code).toContain("useEffect(() => { if (source !== 'inbrowser') setEditMode(false); }, [source]);");
  });

  it('the console button is gated by the tools rule in the in-browser branch', () => {
    expect(code).toContain('{previewToolsFor(source).console && consoleButton}');
  });

  it('the copy is learnt from the in-browser preview response, and un-learnt on an explicit null', () => {
    expect(code).toContain("if (typeof data.snapshotUrl === 'string' && /^https?:\\/\\//i.test(data.snapshotUrl)) {");
    expect(code).toContain('setIdleSnapshotUrl(data.snapshotUrl);');
    expect(code).toContain('} else if (data.snapshotUrl === null) {');
  });

  it('the import boot restores the previous CHOICE, not a frame', () => {
    expect(code).toContain('const previousChoice = choice;');
    expect(code).toContain('if (!ok) setChoice(previousChoice);');
  });
});
