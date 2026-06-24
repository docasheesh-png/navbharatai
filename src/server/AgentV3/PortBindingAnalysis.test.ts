import { describe, it, expect } from 'vitest';
import { scanPortBinding, portBindingSummary } from './PortBindingAnalysis';

describe('scanPortBinding', () => {
  it('flags a hardcoded listen port as medium', () => {
    const issues = scanPortBinding('server.ts', 'app.listen(3000, () => console.log("up"));');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'medium', file: 'server.ts', line: 1, port: '3000' });
  });

  it('handles spacing and various ports', () => {
    expect(scanPortBinding('a.js', 'server.listen( 8080 )')[0].port).toBe('8080');
    expect(scanPortBinding('a.js', 'http.createServer(h).listen(80)')[0].port).toBe('80');
    expect(scanPortBinding('a.js', 'app.listen(5173)')[0].port).toBe('5173');
  });

  it('does NOT flag a port read from process.env.PORT (the correct pattern)', () => {
    expect(scanPortBinding('server.ts', 'app.listen(process.env.PORT || 3000)')).toEqual([]);
    expect(scanPortBinding('server.ts', 'const port = Number(process.env.PORT) || 8080; app.listen(port)')).toEqual([]);
  });

  it('does NOT flag listen(port) with a variable argument', () => {
    expect(scanPortBinding('server.ts', 'const PORT = 3000;\napp.listen(PORT)')).toEqual([
      // line 1 is `const PORT = 3000;` — that is an assignment, not a `.listen(` call.
    ]);
  });

  it('does NOT flag import.meta.env-based ports', () => {
    expect(scanPortBinding('s.ts', 'server.listen(import.meta.env.PORT || 4000)')).toEqual([]);
  });

  it('ignores comment lines', () => {
    expect(scanPortBinding('s.ts', '// app.listen(3000) old default')).toEqual([]);
    expect(scanPortBinding('s.ts', ' * server.listen(8080)')).toEqual([]);
  });

  it('ignores non-code files and empty content', () => {
    expect(scanPortBinding('README.md', 'app.listen(3000)')).toEqual([]);
    expect(scanPortBinding('s.ts', '')).toEqual([]);
  });

  it('does not confuse addEventListener for a port bind', () => {
    expect(scanPortBinding('s.ts', 'window.addEventListener("resize", fn)')).toEqual([]);
  });

  it('reports the line number for a deeper listen call', () => {
    const src = 'import express from "express";\nconst app = express();\napp.listen(8000);';
    const issues = scanPortBinding('s.ts', src);
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toBe(3);
  });
});

describe('portBindingSummary', () => {
  it('reports the clean line when there are no issues', () => {
    expect(portBindingSummary([])).toBe('Server port: ✓ no hardcoded listen port.');
  });

  it('lists the hardcoded port with the env-var fix', () => {
    const out = portBindingSummary(scanPortBinding('server.ts', 'app.listen(3000)'));
    expect(out).toContain('1 hardcoded listen port(s)');
    expect(out).toContain('server.ts:1');
    expect(out).toContain('process.env.PORT || 3000');
  });
});
