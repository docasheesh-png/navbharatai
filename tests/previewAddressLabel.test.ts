import { describe, it, expect } from 'vitest';
import { previewAddressLabel, previewPortOf } from '../src/components/agentv3/previewAddress';
import { consoleRowFixable, appendConsoleEntry, filterConsoleEntries, normalizeConsoleLevel, consoleErrorCount, CONSOLE_BUFFER_MAX } from '../src/components/agentv3/previewConsole';

describe('previewAddressLabel — the toolbar may never print the machine', () => {
  // THE INVARIANT THIS FILE EXISTS FOR. Everything else here is detail; if this loosens, the
  // preview is handing out a billable address again and nothing else would fail to say so.
  const HOSTS = [
    'https://3000-ix4k2m9qq1abcdef.e2b.app',
    'https://5173-abc123def456.e2b.app/dashboard?x=1',
    'http://8080-zz99.e2b.app:8080/',
    'https://3000-abc.mitrify.xyz/deep/path',
  ];
  it.each(HOSTS)('never leaks the host or the vendor for %s', (url) => {
    const label = previewAddressLabel(url);
    expect(label).not.toMatch(/e2b/i);
    expect(label).not.toMatch(/mitrify/i);
    expect(label).not.toContain('http');
    expect(label).not.toContain('.app');
    // and the sandbox id itself, which is the part that actually addresses a machine
    expect(label).not.toMatch(/ix4k2m9qq1abcdef|abc123def456|zz99/);
  });

  it('keeps the port, which names a process and not a machine', () => {
    expect(previewAddressLabel('https://3000-abcdef.e2b.app')).toBe('Live server · port 3000');
    expect(previewAddressLabel('https://5173-abcdef.e2b.app/x')).toBe('Live server · port 5173');
  });

  it('falls back to a usable label rather than blank, for every junk input', () => {
    expect(previewAddressLabel('')).toBe('Live server');
    expect(previewAddressLabel(null)).toBe('Live server');
    expect(previewAddressLabel(undefined)).toBe('Live server');
    expect(previewAddressLabel('not a url at all')).toBe('Live server');
    expect(previewAddressLabel('   ')).toBe('Live server');
  });

  it('reads an explicit port when the host does not encode one', () => {
    expect(previewPortOf('http://localhost:4173/')).toBe('4173');
    expect(previewPortOf('https://example.com/')).toBe('');
  });

  it('reads the port out of an unparseable string too', () => {
    expect(previewPortOf('//3000-abc.e2b.app')).toBe('3000');
  });
});

describe('consoleRowFixable — a warning that is really a bug gets the button', () => {
  it('offers a fix for every error', () => {
    expect(consoleRowFixable('error', 'TypeError: x is not a function')).toBe(true);
    expect(consoleRowFixable('error', '')).toBe(true);
  });

  it('offers a fix for React warnings that are real defects', () => {
    expect(consoleRowFixable('warn', 'Warning: Each child in a list should have a unique "key" prop.')).toBe(true);
    expect(consoleRowFixable('warn', 'Warning: validateDOMNesting(...): <div> cannot appear as a descendant of <p>.')).toBe(true);
    expect(consoleRowFixable('warn', 'A component is changing a controlled input to be uncontrolled.')).toBe(true);
    expect(consoleRowFixable('warn', 'React Hook useEffect has a missing dependency: "id".')).toBe(true);
    expect(consoleRowFixable('warn', 'componentWillMount is deprecated and will be removed.')).toBe(true);
  });

  it('does NOT offer a paid AI repair beside the app’s ordinary logging', () => {
    expect(consoleRowFixable('warn', 'cache miss for user 42')).toBe(false);
    expect(consoleRowFixable('warn', 'retrying in 2s')).toBe(false);
    expect(consoleRowFixable('warn', '')).toBe(false);
    expect(consoleRowFixable('log', 'Warning: this looks like a warning but is a log')).toBe(false);
    expect(consoleRowFixable('info', 'anything')).toBe(false);
  });
});

describe('appendConsoleEntry — a render loop must not evict everything else', () => {
  it('collapses an immediate repeat into a count instead of a new row', () => {
    const a = { level: 'warn' as const, text: 'same', at: 1 };
    const out = appendConsoleEntry(appendConsoleEntry([], a), { ...a, at: 2 });
    expect(out).toHaveLength(1);
    expect(out[0].repeats).toBe(2);
    expect(out[0].at).toBe(2);
  });

  it('keeps a DIFFERENT message that arrives between repeats', () => {
    let rows = appendConsoleEntry([], { level: 'warn', text: 'loop', at: 1 });
    rows = appendConsoleEntry(rows, { level: 'error', text: 'the one that matters', at: 2 });
    rows = appendConsoleEntry(rows, { level: 'warn', text: 'loop', at: 3 });
    expect(rows.map((r) => r.text)).toEqual(['loop', 'the one that matters', 'loop']);
  });

  it('caps the buffer', () => {
    let rows: ReturnType<typeof appendConsoleEntry> = [];
    for (let i = 0; i < CONSOLE_BUFFER_MAX + 40; i++) rows = appendConsoleEntry(rows, { level: 'log', text: `row ${i}`, at: i });
    expect(rows).toHaveLength(CONSOLE_BUFFER_MAX);
    expect(rows[rows.length - 1].text).toBe(`row ${CONSOLE_BUFFER_MAX + 39}`);
  });

  it('counts only errors for the badge', () => {
    const rows = [
      { level: 'error' as const, text: 'a', at: 1 },
      { level: 'warn' as const, text: 'b', at: 2 },
      { level: 'error' as const, text: 'c', at: 3 },
    ];
    expect(consoleErrorCount(rows)).toBe(2);
  });
});

describe('filterConsoleEntries', () => {
  const rows = [
    { level: 'log' as const, text: 'starting up', at: 1 },
    { level: 'warn' as const, text: 'Warning: unique "key" prop', at: 2 },
    { level: 'error' as const, text: 'TypeError: boom', at: 3 },
  ];
  it('problems spans errors and warnings', () => {
    expect(filterConsoleEntries(rows, 'problems', '').map((r) => r.level)).toEqual(['warn', 'error']);
  });
  it('filters by level and by needle together', () => {
    expect(filterConsoleEntries(rows, 'all', 'boom')).toHaveLength(1);
    expect(filterConsoleEntries(rows, 'error', 'key')).toHaveLength(0);
    expect(filterConsoleEntries(rows, 'all', 'KEY')).toHaveLength(1);
  });
  it('normalises unknown levels to log', () => {
    expect(normalizeConsoleLevel('debug')).toBe('log');
    expect(normalizeConsoleLevel(undefined)).toBe('log');
    expect(normalizeConsoleLevel('error')).toBe('error');
  });
});
