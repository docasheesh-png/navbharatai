import { describe, it, expect } from 'vitest';
import {
  auditSummaryClaims, claimCorrection, claimAuditSummary, describedUiLabels,
  MIN_LABELS_FOR_FABRICATION, type MeasuredFacts,
} from './claimAudit';

/**
 * BOTH CONTRADICTIONS CAME OUT OF ONE BUILD (admin transcript + report, 2026-08-12).
 *
 * A wrong verdict is a bug. A fabricated observation is the platform telling the user something that
 * never happened, in the confident voice of a verification — and the user has no way to know which
 * sentence to distrust.
 *
 * The second concern in every test below is the opposite risk: a false accusation of lying is worse
 * than a missed one, so an honest summary must sail through untouched.
 */

const measured = (o: Partial<MeasuredFacts> = {}): MeasuredFacts => ({
  consoleCaptured: true, screenshotTaken: true, previewVerified: true, ...o,
});

describe('a claim of verification is checked against whether it ran', () => {
  it('catches the transcript\'s exact sentence', () => {
    const summary = 'I verified this with a real browser screenshot and confirmed there are no console errors.';
    const c = auditSummaryClaims(summary, measured({ consoleCaptured: false }));
    expect(c.map((x) => x.kind)).toContain('console-clean');
    expect(c[0].measured).toContain('could not be captured');
  });

  it('catches a screenshot claim when no screenshot was taken', () => {
    const c = auditSummaryClaims('The screenshot shows the app rendering.', measured({ screenshotTaken: false }));
    expect(c.map((x) => x.kind)).toContain('screenshot-seen');
  });

  it('catches "the preview is working" when nothing confirmed it', () => {
    const c = auditSummaryClaims('The preview is now working.', measured({ previewVerified: false }));
    expect(c.map((x) => x.kind)).toContain('preview-renders');
  });

  it('says NOTHING when the claim is true — this is the common case', () => {
    const summary = 'I verified this with a real browser screenshot and confirmed there are no console errors. '
      + 'The preview is now working.';
    expect(auditSummaryClaims(summary, measured())).toEqual([]);
  });

  it('MENTIONING errors is not CLAIMING there are none', () => {
    // "I fixed the console errors" must not be read as "there are no console errors".
    const c = auditSummaryClaims('I fixed two console errors in App.tsx.', measured({ consoleCaptured: false }));
    expect(c).toEqual([]);
  });

  it('an empty summary claims nothing', () => {
    expect(auditSummaryClaims('', measured({ consoleCaptured: false }))).toEqual([]);
    expect(auditSummaryClaims(null as never, measured())).toEqual([]);
  });
});

/**
 * THE FABRICATED SCREEN. The model described "Health 100/100, Level 1, XP 0/100 · Location: Forest
 * Path · Inventory · Game Log" — for a home page with four corner buttons. It had described the same
 * screen CORRECTLY earlier in the same build.
 */
describe('a described UI is checked against the app that exists', () => {
  const HOME_PAGE_SOURCE = `
    export default function App() {
      return (<div className="jungle">
        <h1>JUNGLE ADVENTURE</h1>
        <button>Mode</button><button>Settings</button>
        <button>Play</button><button>Cart</button>
      </div>);
    }`;

  const FABRICATED = `The app is running successfully. The screenshot shows the **Jungle Adventure** game:
- **Health**: 100/100
- **Level**: 1
- **XP**: 0/100
- **Inventory**: Empty slots
- **Game Log**: Welcome message`;

  it('catches the fabrication — not one of those words exists in the app', () => {
    const c = auditSummaryClaims(FABRICATED, measured({ sourceText: HOME_PAGE_SOURCE }));
    expect(c.map((x) => x.kind)).toContain('ui-described');
  });

  it('the SAME screen described CORRECTLY is left alone', () => {
    const honest = `Your home page is ready:
- **Mode** button, top left
- **Settings** button, top right
- **Play** button, bottom left
- **Cart** button, bottom right
- **Jungle Adventure** title in the middle`;
    expect(auditSummaryClaims(honest, measured({ sourceText: HOME_PAGE_SOURCE }))).toEqual([]);
  });

  it('ONE label that does not match is a paraphrase, not a fabrication', () => {
    // Precision first: a false accusation of lying is worse than a missed one.
    const mostlyRight = `Done:
- **Mode**, **Settings**, **Play**, **Cart** buttons
- **Jungle Adventure** heading
- **Sparkles** in the background`;
    expect(auditSummaryClaims(mostlyRight, measured({ sourceText: HOME_PAGE_SOURCE }))).toEqual([]);
  });

  it('too FEW labels is never evidence — two could be anything', () => {
    const short = 'Done. **Widget** and **Gizmo** added.';
    expect(auditSummaryClaims(short, measured({ sourceText: HOME_PAGE_SOURCE }))).toEqual([]);
    expect(MIN_LABELS_FOR_FABRICATION).toBeGreaterThanOrEqual(3);
  });

  it('with NO source to compare against, it never accuses', () => {
    expect(auditSummaryClaims(FABRICATED, measured({ sourceText: '' }))).toEqual([]);
    expect(auditSummaryClaims(FABRICATED, measured())).toEqual([]);
  });

  it('the model\'s headings about its own work are not screen labels', () => {
    // "**What was built:**" / "**Root cause:**" describe the reply, not the app.
    const labels = describedUiLabels('**What was built:** stuff\n**Root cause:** the server\n**Play**');
    expect(labels).toEqual(['Play']);
  });

  it('a Hindi label present in the source is recognised', () => {
    const src = 'const label = "जल्द आ रहा है";';
    const summary = '- **जल्द आ रहा है**\n- **Play**\n- **Mode**\n- **Cart**';
    expect(auditSummaryClaims(summary, measured({ sourceText: src + ' Play Mode Cart' }))).toEqual([]);
  });
});

describe('what the user is told', () => {
  it('the correction names which sentence not to trust', () => {
    const c = auditSummaryClaims('There are no console errors.', measured({ consoleCaptured: false }));
    const text = claimCorrection(c);
    expect(text).toContain('Correction from NavBharatAI itself');
    expect(text).toContain('is not supported');
  });

  it('it corrects rather than lectures — no accusation, just the fact', () => {
    const text = claimCorrection(auditSummaryClaims('No console errors.', measured({ consoleCaptured: false })));
    expect(text.toLowerCase()).not.toContain('lie');
    expect(text.toLowerCase()).not.toContain('hallucinat');
  });

  it('a clean audit appends NOTHING — no noise on a truthful summary', () => {
    expect(claimCorrection([])).toBe('');
  });

  it('the admin line counts them', () => {
    const c = auditSummaryClaims('No console errors. The screenshot shows it.', measured({ consoleCaptured: false, screenshotTaken: false }));
    expect(claimAuditSummary(c)).toContain('2 claim(s)');
  });
});

describe('it is wired into the build', () => {
  const routes = require('fs').readFileSync(
    require('path').join(__dirname, '../routes/agentv3.ts'), 'utf8',
  ) as string;

  it('the audit runs against the real measured facts, not defaults', () => {
    expect(routes).toContain('auditSummaryClaims(result.summary');
    expect(routes).toContain('consoleCaptured: runtimeCaptureAvailable');
    expect(routes).toContain("screenshotTaken: buildDiag.toolWasUsed('screenshot')");
  });

  it('the correction reaches the USER\'s summary, not just the admin report', () => {
    // A correction only the admin can see does not help the person reading the wrong sentence.
    expect(routes).toContain('claimCorrection(contradictions)');
    expect(routes).toContain('CLAIM_UNSUPPORTED');
  });
});
