// failedbr #1341 (2026-11-20): a pasted "Windows 10 - My Computer Project" page with a calculator was briefed as "keep its
// 2 button(s)/tab(s), 2 field(s) and 0 colour(s)". Its 16 keys were digits and punctuation (no letter, no symbol), the one
// handler kept read "+ (calcPress()", and its colours were plain hex, never `--custom-properties`.
import { describe, expect, it } from 'vitest';
import { pastedAppFacts } from '../src/server/lib/pastedSource';
import { pastedAppBrief } from '../src/server/AgentV3/pastedAppBrief';

const keys = ['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', '.'].map((k) => `<button onclick="calcPress('${k}')">${k}</button>`).join('\n');
const PAGE = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Windows 10 - My Computer Project</title>
<style>
body { background: #f0f0f0; }
.window { border: 1px solid #999; }
.title { border-bottom: 1px solid #ddd; background: #e5e5e5; }
</style></head>
<body>
<button onclick="openWin('notepad')">Create New Text File</button>
<div class="calc"><input id="calcDisplay" readonly>
${keys}
<button onclick="calcEqual()">=</button>
<button onclick="calcPress('+')">+</button>
<button onclick="document.getElementById('calcDisplay').value=''" style="grid-column:span 4;background:#e81123;color:white">Clear</button>
</div>
<textarea placeholder="Type anything here..."></textarea>
<input placeholder="Type here to search">
</body></html>`;

describe('a pasted calculator keeps its keys and its colours (failedbr #1341)', () => {
  it('reads all 16 keys as one control, and the named buttons beside it', () => {
    const f = pastedAppFacts(PAGE);
    expect(f.controls[0]).toBe('keys 7 8 9 / 4 5 6 * 1 2 3 - 0 . = + (16 keys)');
    expect(f.controls).toContain('Create New Text File');
    expect(f.controls).toContain('Clear');
    expect(f.controls.join(' ')).not.toMatch(/calcPress\($/m);
  });
  it('reads plain colours when the page declares no custom properties', () => {
    const values = pastedAppFacts(PAGE).colours.map((c) => c.value);
    expect(values).toEqual(expect.arrayContaining(['#e81123', '#f0f0f0', '#999', '#ddd', '#e5e5e5']));
    expect(pastedAppBrief(PAGE)).toMatch(/Keep its colours as the app's palette: .*#e81123/);
  });
  it('a lone symbol button is still named by its handler, read to its own closing quote', () => {
    const f = pastedAppFacts('<!DOCTYPE html>\n<html>\n<head><title>Drive</title></head>\n<body>\n<button onclick="move(\'left\')">⬅️</button>\n<button onclick="move(\'right\')">➡️</button>\n</body>\n</html>');
    expect(f.controls).toEqual(["⬅️ (move('left'))", "➡️ (move('right'))"]);
  });
  it('custom properties still win when the page has them', () => {
    const f = pastedAppFacts('<!DOCTYPE html>\n<html>\n<head>\n<style>:root{--brand:#1144aa} body{background:#fff}</style>\n</head>\n<body>\n<button>Save</button>\n</body>\n</html>');
    expect(f.colours).toEqual([{ name: '--brand', value: '#1144aa' }]);
  });
});
