/**
 * Multi-element select — several elements restyled in ONE pass.
 *
 * The failure this suite exists to prevent is not a crash. It is the SILENT one: the obvious way to
 * build multi-select is to call the single-edit route once per selected element, which for two elements
 * in the same file is a lost update — whichever request saves last wins, the other change disappears,
 * and both return 200. Selecting two elements in one component is the normal case here, so that bug
 * would have shipped as "multi-select works".
 *
 * The second silent failure is ORDER: patching top-down moves the positions that the later edits point
 * at, so edit #2 lands on the wrong element or nothing at all. Both are locked below.
 */

import { describe, it, expect } from 'vitest';
import { applyVisualStyleEdits } from '../src/server/AgentV3/VisualEditPatcher';

const FILE = 'src/App.tsx';

const src = `export default function App() {
  return (
    <div>
      <h1>Title</h1>
      <p>Body</p>
      <span>Footer</span>
    </div>
  );
}
`;

/** Column of the given tag's `<` on its line, 1-indexed — what the preview reports. */
function posOf(source: string, tag: string): { line: number; column: number } {
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const col = lines[i].indexOf(`<${tag}`);
    if (col >= 0) return { line: i + 1, column: col + 1 };
  }
  throw new Error(`no <${tag}> in source`);
}

describe('applyVisualStyleEdits', () => {
  it('🔒 applies EVERY selected element in one pass — the lost update that N requests would cause', () => {
    // With one request per element these three would race on the same file and at most one would
    // survive. Here all three must be present in a single resulting source.
    return applyVisualStyleEdits({
      filePath: FILE,
      source: src,
      edits: [
        { ...posOf(src, 'h1'), styleUpdates: { color: 'red' } },
        { ...posOf(src, 'p'), styleUpdates: { color: 'red' } },
        { ...posOf(src, 'span'), styleUpdates: { color: 'red' } },
      ],
    }).then((r) => {
      expect(r.ok).toBe(true);
      expect(r.applied).toBe(3);
      expect(r.failures).toEqual([]);
      expect((r.newSource!.match(/color: 'red'/g) || []).length).toBe(3);
      // Each one landed on its OWN element, not three times on one.
      expect(r.newSource).toMatch(/<h1 style=\{\{ color: 'red' \}\}>/);
      expect(r.newSource).toMatch(/<p style=\{\{ color: 'red' \}\}>/);
      expect(r.newSource).toMatch(/<span style=\{\{ color: 'red' \}\}>/);
    });
  });

  it('🔒 is order-independent — the caller may pass edits in any order', async () => {
    // Bottom-up is applied internally; if it were not, passing top-down would mis-target the later
    // edits once the first one lengthened its line.
    const topDown = await applyVisualStyleEdits({
      filePath: FILE,
      source: src,
      edits: [
        { ...posOf(src, 'h1'), styleUpdates: { fontSize: '20px' } },
        { ...posOf(src, 'span'), styleUpdates: { fontSize: '20px' } },
      ],
    });
    const bottomUp = await applyVisualStyleEdits({
      filePath: FILE,
      source: src,
      edits: [
        { ...posOf(src, 'span'), styleUpdates: { fontSize: '20px' } },
        { ...posOf(src, 'h1'), styleUpdates: { fontSize: '20px' } },
      ],
    });
    expect(topDown.ok).toBe(true);
    expect(topDown.applied).toBe(2);
    expect(topDown.newSource).toBe(bottomUp.newSource);
  });

  it('applies different styles to different elements in the same pass', async () => {
    const r = await applyVisualStyleEdits({
      filePath: FILE,
      source: src,
      edits: [
        { ...posOf(src, 'h1'), styleUpdates: { color: 'blue' } },
        { ...posOf(src, 'p'), styleUpdates: { fontWeight: 'bold' } },
      ],
    });
    expect(r.newSource).toMatch(/<h1 style=\{\{ color: 'blue' \}\}>/);
    expect(r.newSource).toMatch(/<p style=\{\{ fontWeight: 'bold' \}\}>/);
  });

  it('merges onto an element that already has a style, without losing its existing keys', async () => {
    const withStyle = `export default () => (
  <div>
    <h1 style={{ color: 'red', margin: '4px' }}>Title</h1>
    <p>Body</p>
  </div>
);
`;
    const r = await applyVisualStyleEdits({
      filePath: FILE,
      source: withStyle,
      edits: [
        { ...posOf(withStyle, 'h1'), styleUpdates: { color: 'green' } },
        { ...posOf(withStyle, 'p'), styleUpdates: { color: 'green' } },
      ],
    });
    expect(r.applied).toBe(2);
    expect(r.newSource).toContain("margin: '4px'");   // untouched key survives
    expect(r.newSource).toContain("color: 'green'");
    expect(r.newSource).not.toContain("color: 'red'");
  });

  it('patches the same element once when it is selected twice', async () => {
    const p = posOf(src, 'h1');
    const r = await applyVisualStyleEdits({
      filePath: FILE,
      source: src,
      edits: [{ ...p, styleUpdates: { color: 'red' } }, { ...p, styleUpdates: { color: 'red' } }],
    });
    expect(r.applied).toBe(1);
    expect((r.newSource!.match(/color: 'red'/g) || []).length).toBe(1);
  });
});

describe('🔒 partial success is reported, never hidden', () => {
  const mixed = `export default ({ s }) => (
  <div>
    <h1 style={s}>Dynamic</h1>
    <p>Plain</p>
  </div>
);
`;

  it('applies the ones it can and NAMES the one it could not', async () => {
    // A dynamic `style={s}` legitimately refuses — the same refusal a single edit gives. What must not
    // happen is the batch reporting success for all three, or failing all three because of one.
    const r = await applyVisualStyleEdits({
      filePath: FILE,
      source: mixed,
      edits: [
        { ...posOf(mixed, 'h1'), styleUpdates: { color: 'red' } },
        { ...posOf(mixed, 'p'), styleUpdates: { color: 'red' } },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.applied).toBe(1);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].line).toBe(posOf(mixed, 'h1').line);
    expect(r.failures[0].error).toMatch(/dynamic|not a simple object/i);
    expect(r.newSource).toContain('style={s}');       // the refused element is untouched
    expect(r.newSource).toMatch(/<p style=\{\{ color: 'red' \}\}>/);
  });

  it('reports failure when NOTHING could be applied', async () => {
    const r = await applyVisualStyleEdits({
      filePath: FILE,
      source: mixed,
      edits: [{ ...posOf(mixed, 'h1'), styleUpdates: { color: 'red' } }],
    });
    expect(r.ok).toBe(false);
    expect(r.applied).toBe(0);
    expect(r.error).toBeTruthy();
    expect(r.newSource).toBeUndefined();   // nothing to save — the caller must not write a file
  });

  it('rejects an empty batch instead of saving an unchanged file', async () => {
    const r = await applyVisualStyleEdits({ filePath: FILE, source: src, edits: [] });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('No edits provided.');
  });

  it('keeps the single-edit safety rules — an unsafe value is refused inside a batch too', async () => {
    const r = await applyVisualStyleEdits({
      filePath: FILE,
      source: src,
      edits: [{ ...posOf(src, 'h1'), styleUpdates: { color: "red'; alert(1); //" } }],
    });
    expect(r.ok).toBe(false);
    expect(r.failures[0].error).toMatch(/unsafe/i);
  });
});
