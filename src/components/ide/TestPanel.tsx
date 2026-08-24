import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CheckCircle2, Clock, Play, Plus, AlertCircle, RefreshCcw, ChevronDown, ChevronRight, Trash2, X } from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';
import { cn } from '../../lib/utils';
import { resolveAppSource, hasAnalysableApp, appSourceGuidance } from '../../lib/workspaceSource';
import { recordRun, isFlaky, loadHistory, serializeHistory, type TestRunHistory, FLAKY_STORAGE_KEY } from '../../lib/flakyTests';

interface TestPanelProps {
  generatedCode?: string;
  files: Record<string, string>;
}

interface TestCase {
  id: string;
  name: string;
  code: string;
  status: 'pending' | 'running' | 'pass' | 'fail' | 'skip';
  output?: string;
  duration?: number;
}

const DEFAULT_TESTS: Omit<TestCase, 'status'>[] = [
  {
    id: 'page-loads',
    name: 'Page loads successfully',
    code: `if (!document.body || document.body.innerHTML.trim() === '') throw new Error('Body is empty'); return true;`,
  },
  {
    id: 'no-script-errors',
    name: 'No script errors on load',
    code: `return !window.__testErrors || window.__testErrors.length === 0;`,
  },
  {
    id: 'has-title',
    name: 'Page has a title',
    code: `if (!document.title || document.title.trim() === '') throw new Error('document.title is empty'); return true;`,
  },
  {
    id: 'mobile-viewport',
    name: 'Mobile viewport ready',
    code: `const meta = document.querySelector('meta[name="viewport"]'); if (!meta) throw new Error('No viewport meta tag found'); return true;`,
  },
  {
    id: 'interactive-elements',
    name: 'Interactive elements present',
    code: `const els = document.querySelectorAll('button, input, a, select, textarea'); if (els.length === 0) throw new Error('No interactive elements found'); return els.length;`,
  },
];

const TEST_TEMPLATES = [
  { name: 'Button exists', code: `const btn = document.querySelector('button'); if (!btn) throw new Error('No button found'); return true;` },
  { name: 'Form exists', code: `const form = document.querySelector('form'); if (!form) throw new Error('No form found'); return true;` },
  { name: 'Image exists', code: `const img = document.querySelector('img'); if (!img) throw new Error('No image found'); return true;` },
  { name: 'Heading exists', code: `const h = document.querySelector('h1,h2,h3'); if (!h) throw new Error('No heading found'); return true;` },
];

function makeInitialTests(): TestCase[] {
  return DEFAULT_TESTS.map(t => ({ ...t, status: 'pending' as const }));
}

function buildIframeSrc(appHtml: string, tests: TestCase[]): string {
  const runner = `
<script>
(function() {
  window.__testErrors = [];
  window.addEventListener('error', function(e) {
    window.__testErrors.push(e.message || String(e));
  });

  var tests = ${JSON.stringify(tests.map(t => ({ id: t.id, name: t.name, code: t.code })))};

  function runTest(t) {
    var start = Date.now();
    try {
      var fn = new Function(t.code);
      var result = fn.call(window);
      var duration = Date.now() - start;
      return { id: t.id, status: 'pass', output: String(result !== undefined ? result : 'true'), duration: duration };
    } catch(e) {
      var duration = Date.now() - start;
      return { id: t.id, status: 'fail', output: e.message || String(e), duration: duration };
    }
  }

  function runAll() {
    tests.forEach(function(t) {
      var result = runTest(t);
      window.parent.postMessage({ type: 'TEST_RESULT', payload: result }, '*');
    });
    window.parent.postMessage({ type: 'TESTS_DONE' }, '*');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runAll);
  } else {
    setTimeout(runAll, 50);
  }
})();
</script>`;

  if (appHtml.includes('</body>')) {
    return appHtml.replace('</body>', runner + '</body>');
  }
  return appHtml + runner;
}

const StatusIcon: React.FC<{ status: TestCase['status'] }> = ({ status }) => {
  if (status === 'pass') return <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />;
  if (status === 'fail') return <X className="w-4 h-4 text-red-400 shrink-0" />;
  if (status === 'running') return <TirangaLoader className="w-4 h-4 shrink-0" />;
  if (status === 'skip') return <AlertCircle className="w-4 h-4 text-gray-500 shrink-0" />;
  return <Clock className="w-4 h-4 text-gray-500 shrink-0" />;
};

export const TestPanel: React.FC<TestPanelProps> = ({ generatedCode, files }) => {
  // Resolve the REAL app to test (admin autopsy 2026-07-21): the retired `generatedCode` sits at the
  // "Waiting for magic…" placeholder in v5.0, so tests used to run against the placeholder. Prefer the
  // bundled preview, else the workspace's index.html; treat the placeholder as "no app yet".
  const appSource = resolveAppSource(generatedCode, files);
  const appHtml = appSource.html;
  const canRun = hasAnalysableApp(appSource);
  const [tests, setTests] = useState<TestCase[]>(makeInitialTests);
  const [running, setRunning] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showAddTest, setShowAddTest] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [iframeSrc, setIframeSrc] = useState<string | null>(null);
  // P-TQA.8 — per-test run history (localStorage) so we can flag flaky tests (pass/fail across runs).
  const [flakyHistory, setFlakyHistory] = useState<TestRunHistory>(() => {
    try { return loadHistory(localStorage.getItem(FLAKY_STORAGE_KEY)); } catch { return {}; }
  });
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const passCount = tests.filter(t => t.status === 'pass').length;
  const failCount = tests.filter(t => t.status === 'fail').length;

  const handleMessage = useCallback((e: MessageEvent) => {
    if (e.data?.type === 'TEST_RESULT') {
      const { id, status, output, duration } = e.data.payload;
      setTests(prev => prev.map(t => t.id === id ? { ...t, status, output, duration } : t));
      // P-TQA.8 — record this run's outcome so a test that alternates pass/fail gets flagged as flaky.
      if (id && (status === 'pass' || status === 'fail')) {
        setFlakyHistory(prev => {
          const next = recordRun(prev, id, status === 'pass');
          try { localStorage.setItem(FLAKY_STORAGE_KEY, serializeHistory(next)); } catch { /* ignore */ }
          return next;
        });
      }
    }
    if (e.data?.type === 'TESTS_DONE') {
      setRunning(false);
      setIframeSrc(null);
    }
  }, []);

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  const runAllTests = () => {
    if (!canRun || !appHtml) return;
    setRunning(true);
    setTests(prev => prev.map(t => ({ ...t, status: 'running', output: undefined, duration: undefined })));
    const src = buildIframeSrc(appHtml, tests);
    setIframeSrc(src);
  };

  const resetTests = () => {
    setTests(prev => prev.map(t => ({ ...t, status: 'pending', output: undefined, duration: undefined })));
    setSelectedId(null);
    setExpanded({});
  };

  const addTest = () => {
    if (!newName.trim() || !newCode.trim()) return;
    const id = `custom-${Date.now()}`;
    setTests(prev => [...prev, { id, name: newName.trim(), code: newCode.trim(), status: 'pending' }]);
    setNewName('');
    setNewCode('');
    setShowAddTest(false);
  };

  const removeTest = (id: string) => {
    setTests(prev => prev.filter(t => t.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const applyTemplate = (tpl: typeof TEST_TEMPLATES[0]) => {
    setNewName(tpl.name);
    setNewCode(tpl.code);
  };

  const toggleExpand = (id: string) => {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
    setSelectedId(id);
  };

  return (
    <div className="flex flex-col h-full bg-[#0d1117] text-gray-200 text-sm overflow-hidden">
      {/* Hidden iframe for running tests */}
      {iframeSrc && (
        <iframe
          ref={iframeRef}
          srcDoc={iframeSrc}
          sandbox="allow-scripts"
          title="test-runner"
          className="hidden w-0 h-0 absolute"
          aria-hidden="true"
        />
      )}

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#30363d] bg-[#161b22] shrink-0">
        <span className="font-semibold text-gray-100 tracking-wide">Tests</span>
        <div className="flex items-center gap-1 ml-1">
          {passCount > 0 && (
            <span className="px-1.5 py-0.5 rounded text-xs bg-green-900/50 text-green-400 font-mono">{passCount} pass</span>
          )}
          {failCount > 0 && (
            <span className="px-1.5 py-0.5 rounded text-xs bg-red-900/50 text-red-400 font-mono">{failCount} fail</span>
          )}
        </div>
        <div className="flex-1" />
        <button
          onClick={resetTests}
          disabled={running}
          title="Reset all tests"
          className="p-1.5 rounded hover:bg-[#30363d] text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-40"
        >
          <RefreshCcw className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setShowAddTest(v => !v)}
          title="Add test"
          className={cn(
            'p-1.5 rounded hover:bg-[#30363d] text-gray-400 hover:text-gray-200 transition-colors',
            showAddTest && 'bg-indigo-900/50 text-indigo-300'
          )}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={runAllTests}
          disabled={running || !canRun}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors',
            canRun && !running
              ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
              : 'bg-[#30363d] text-gray-500 cursor-not-allowed'
          )}
        >
          {running
            ? <TirangaLoader className="w-3 h-3" />
            : <Play className="w-3 h-3" />
          }
          {running ? 'Running…' : 'Run All'}
        </button>
      </div>

      {/* No app warning — honest, actionable guidance (build first / open Preview to bundle). */}
      {!canRun && (
        <div className="flex items-center gap-2 px-3 py-2 bg-yellow-900/20 border-b border-yellow-800/30 text-yellow-400 text-xs shrink-0">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {appSourceGuidance(appSource.kind)}
        </div>
      )}

      {/* Add test panel */}
      {showAddTest && (
        <div className="border-b border-[#30363d] bg-[#161b22] px-3 py-3 shrink-0 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">New Test</span>
            <button onClick={() => setShowAddTest(false)} className="p-0.5 rounded hover:bg-[#30363d] text-gray-500">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {TEST_TEMPLATES.map(tpl => (
              <button
                key={tpl.name}
                onClick={() => applyTemplate(tpl)}
                className="px-2 py-0.5 rounded border border-[#30363d] text-xs text-gray-400 hover:border-indigo-500 hover:text-indigo-300 transition-colors"
              >
                {tpl.name}
              </button>
            ))}
          </div>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Test name…"
            className="w-full bg-[#0d1117] border border-[#30363d] rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
          />
          <textarea
            value={newCode}
            onChange={e => setNewCode(e.target.value)}
            placeholder={"// JS snippet — return truthy to pass, throw to fail\nreturn document.querySelector('.my-class') !== null;"}
            rows={3}
            className="w-full bg-[#0d1117] border border-[#30363d] rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 font-mono resize-none focus:outline-none focus:border-indigo-500"
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowAddTest(false)} className="px-2.5 py-1 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-[#30363d] transition-colors">
              Cancel
            </button>
            <button
              onClick={addTest}
              disabled={!newName.trim() || !newCode.trim()}
              className="px-2.5 py-1 rounded text-xs bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Add Test
            </button>
          </div>
        </div>
      )}

      {/* Test list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {tests.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2">
            <AlertCircle className="w-8 h-8" />
            <span className="text-xs">No tests yet. Add one above.</span>
          </div>
        ) : (
          <ul className="divide-y divide-[#21262d]">
            {tests.map(test => (
              <li key={test.id} className={cn('group', selectedId === test.id && 'bg-[#161b22]')}>
                <div
                  className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[#161b22] transition-colors"
                  onClick={() => toggleExpand(test.id)}
                >
                  <StatusIcon status={test.status} />
                  <span className={cn(
                    'flex-1 truncate',
                    test.status === 'pass' && 'text-green-300',
                    test.status === 'fail' && 'text-red-300',
                    test.status === 'running' && 'text-yellow-300',
                    test.status === 'pending' && 'text-gray-400',
                    test.status === 'skip' && 'text-gray-500',
                  )}>
                    {test.name}
                  </span>
                  {isFlaky(flakyHistory, test.id) && (
                    <span title="Flaky — this test has both passed and failed across recent runs" className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/15 text-yellow-300 border border-yellow-500/30">
                      🟡 flaky
                    </span>
                  )}
                  {test.duration !== undefined && (
                    <span className="text-xs text-gray-600 font-mono shrink-0">{test.duration}ms</span>
                  )}
                  {expanded[test.id]
                    ? <ChevronDown className="w-3.5 h-3.5 text-gray-600 shrink-0" />
                    : <ChevronRight className="w-3.5 h-3.5 text-gray-600 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                  }
                  <button
                    onClick={e => { e.stopPropagation(); removeTest(test.id); }}
                    className="p-0.5 rounded text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                    title="Remove test"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>

                {expanded[test.id] && (
                  <div className="px-4 pb-3 space-y-2">
                    {test.output && (
                      <div className={cn(
                        'rounded px-2 py-1.5 font-mono text-xs whitespace-pre-wrap break-all',
                        test.status === 'pass'
                          ? 'bg-green-900/20 text-green-300 border border-green-800/30'
                          : 'bg-red-900/20 text-red-300 border border-red-800/30'
                      )}>
                        {test.status === 'pass' ? '✓ ' : '✗ '}{test.output}
                      </div>
                    )}
                    <div className="rounded bg-[#0d1117] border border-[#30363d] px-2 py-1.5">
                      <div className="text-xs text-gray-600 mb-1 uppercase tracking-wider font-semibold">Code</div>
                      <code className="font-mono text-xs text-indigo-300 whitespace-pre-wrap break-all">{test.code}</code>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Footer summary */}
      <div className="flex items-center gap-3 px-3 py-2 border-t border-[#30363d] bg-[#161b22] shrink-0 text-xs text-gray-500">
        <span>{tests.length} test{tests.length !== 1 ? 's' : ''}</span>
        {passCount > 0 && <span className="text-green-500">{passCount} passed</span>}
        {failCount > 0 && <span className="text-red-500">{failCount} failed</span>}
        {running && (
          <span className="flex items-center gap-1 text-yellow-400 ml-auto">
            <TirangaLoader className="w-3 h-3" /> Running tests…
          </span>
        )}
      </div>
    </div>
  );
};

export default TestPanel;
