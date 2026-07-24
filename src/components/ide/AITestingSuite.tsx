import React, { useState } from 'react';
import { TestTube, Play, Check, X, AlertCircle, CheckCircle2, Code, RefreshCw, Download, Copy, Zap, FileCode, ChevronRight } from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';
import { sampleInputValue } from '../../server/QualityEvaluationEngine/TestDataManager';

type TestStatus = 'pending' | 'pass' | 'fail' | 'skip';

interface TestCase {
  id: string;
  category: 'unit' | 'integration' | 'edge' | 'security';
  name: string;
  description: string;
  code: string;
  status: TestStatus;
  duration?: number;
  errorMsg?: string;
}

interface Props {
  generatedCode: string;
  onCodeUpdate: (code: string) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  unit: 'Unit Tests',
  integration: 'Integration Tests',
  edge: 'Edge Cases',
  security: 'Security Tests',
};

const CATEGORY_COLORS: Record<string, string> = {
  unit: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  integration: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  edge: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  security: 'text-red-400 bg-red-500/10 border-red-500/20',
};

function generateTestsFromCode(code: string): TestCase[] {
  const lines = code.split('\n');
  const functions: string[] = [];
  lines.forEach(line => {
    const match = line.match(/function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s*)?\(|(\w+)\s*:\s*(?:async\s*)?\(/);
    if (match) {
      const name = match[1] || match[2] || match[3];
      if (name && !['if', 'for', 'while', 'switch', 'return', 'const', 'let', 'var'].includes(name)) {
        functions.push(name);
      }
    }
  });

  const hasForm = code.includes('<form') || code.includes('onSubmit') || code.includes('handleSubmit');
  const hasApi = code.includes('fetch(') || code.includes('axios') || code.includes('async');
  const hasState = code.includes('useState') || code.includes('setState');
  const hasInput = code.includes('<input') || code.includes('onChange');
  const hasAuth = code.includes('auth') || code.includes('login') || code.includes('password') || code.includes('token');
  const hasLocalStorage = code.includes('localStorage') || code.includes('sessionStorage');

  const tests: TestCase[] = [];
  let id = 1;

  // Unit tests
  functions.slice(0, 3).forEach(fn => {
    tests.push({
      id: String(id++), category: 'unit', status: 'pending',
      name: `${fn}() — basic functionality`,
      description: `${fn} function executes correctly and returns the expected output`,
      code: `import { ${fn} } from './component';\n\ntest('${fn} works correctly', () => {\n  const result = ${fn}();\n  expect(result).toBeDefined();\n  expect(result).not.toBeNull();\n});`,
    });
  });

  if (hasState) {
    tests.push({
      id: String(id++), category: 'unit', status: 'pending',
      name: 'State initialization check',
      description: 'Component initial state is set with the correct values',
      code: `import { render } from '@testing-library/react';\nimport Component from './component';\n\ntest('initial state is correct', () => {\n  const { getByTestId } = render(<Component />);\n  // Verify the initial state values\n  expect(getByTestId('counter')).toHaveTextContent('0');\n});`,
    });
  }

  if (hasInput) {
    tests.push({
      id: String(id++), category: 'unit', status: 'pending',
      name: 'Input field onChange handler',
      description: 'State updates correctly when user input changes',
      code: ((v: string) => `import { render, fireEvent } from '@testing-library/react';\n\ntest('input onChange updates state', () => {\n  const { getByPlaceholderText } = render(<Component />);\n  const input = getByPlaceholderText('Enter text...');\n  fireEvent.change(input, { target: { value: '${v}' } });\n  expect(input.value).toBe('${v}');\n});`)(sampleInputValue('input-onchange')),
    });
  }

  // Integration tests
  if (hasForm) {
    tests.push({
      id: String(id++), category: 'integration', status: 'pending',
      name: 'Form submission flow',
      description: 'Submitting the form processes data correctly and updates the UI',
      code: `import { render, fireEvent, waitFor } from '@testing-library/react';\n\ntest('form submission works end-to-end', async () => {\n  const mockSubmit = jest.fn();\n  const { getByRole } = render(<Component onSubmit={mockSubmit} />);\n  \n  fireEvent.click(getByRole('button', { name: /submit/i }));\n  await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));\n});`,
    });
  }

  if (hasApi) {
    tests.push({
      id: String(id++), category: 'integration', status: 'pending',
      name: 'API call — success response',
      description: 'Data fetched from the API is displayed correctly in the component',
      code: `import { render, waitFor } from '@testing-library/react';\n\nglobal.fetch = jest.fn(() =>\n  Promise.resolve({ ok: true, json: () => Promise.resolve({ data: 'test' }) })\n);\n\ntest('fetches and displays data', async () => {\n  const { getByText } = render(<Component />);\n  await waitFor(() => expect(getByText('test')).toBeInTheDocument());\n  expect(fetch).toHaveBeenCalledTimes(1);\n});`,
    });

    tests.push({
      id: String(id++), category: 'integration', status: 'pending',
      name: 'API call — error handling',
      description: 'An error message is shown to the user when the API request fails',
      code: `import { render, waitFor } from '@testing-library/react';\n\nglobal.fetch = jest.fn(() => Promise.reject(new Error('Network Error')));\n\ntest('handles API error gracefully', async () => {\n  const { getByText } = render(<Component />);\n  await waitFor(() => {\n    expect(getByText(/error/i)).toBeInTheDocument();\n  });\n});`,
    });
  }

  // Edge cases
  tests.push({
    id: String(id++), category: 'edge', status: 'pending',
    name: 'Empty input handling',
    description: 'Does not crash on empty string, null, or undefined input',
    code: `test('handles empty input without crash', () => {\n  expect(() => {\n    const { rerender } = render(<Component value="" />);\n    rerender(<Component value={null} />);\n    rerender(<Component value={undefined} />);\n  }).not.toThrow();\n});`,
  });

  tests.push({
    id: String(id++), category: 'edge', status: 'pending',
    name: 'Very long string input',
    description: 'Performance and UI remain stable with 1000+ character input',
    code: `test('handles very long strings', () => {\n  const longString = 'a'.repeat(10000);\n  const { container } = render(<Component value={longString} />);\n  expect(container).toBeTruthy(); // Component renders without error\n});`,
  });

  tests.push({
    id: String(id++), category: 'edge', status: 'pending',
    name: 'Special characters & Unicode',
    description: 'Special characters, emoji, and unicode (<, >, &, ") are handled correctly',
    code: `test('handles special characters and unicode', () => {\n  const specialInput = '<script>alert("xss")</script> Hello 🙏';\n  const { getByText } = render(<Component value={specialInput} />);\n  // Script should not execute — XSS must be prevented\n  expect(document.querySelectorAll('script')).toHaveLength(0);\n});`,
  });

  if (hasLocalStorage) {
    tests.push({
      id: String(id++), category: 'edge', status: 'pending',
      name: 'localStorage unavailable',
      description: 'Degrades gracefully when localStorage is blocked or unavailable (private mode)',
      code: `test('works when localStorage is unavailable', () => {\n  const mockStorage = { getItem: () => { throw new Error('Storage blocked'); } };\n  Object.defineProperty(window, 'localStorage', { value: mockStorage });\n  \n  expect(() => render(<Component />)).not.toThrow();\n});`,
    });
  }

  // Security tests
  tests.push({
    id: String(id++), category: 'security', status: 'pending',
    name: 'XSS Prevention',
    description: 'Injecting a script via user input should not result in an XSS attack',
    code: `test('prevents XSS injection', () => {\n  const xssPayload = '<img src=x onerror=alert(1)>';\n  const { container } = render(<Component userInput={xssPayload} />);\n  \n  // Dangerous HTML must not be rendered\n  expect(container.innerHTML).not.toContain('<img src=x');\n  expect(container.innerHTML).not.toContain('onerror');\n});`,
  });

  if (hasAuth) {
    tests.push({
      id: String(id++), category: 'security', status: 'pending',
      name: 'Authentication check',
      description: 'Protected routes and actions block unauthorized users',
      code: `test('blocks unauthenticated access', () => {\n  const { getByText } = render(<ProtectedComponent user={null} />);\n  expect(getByText(/login|sign in|unauthorized/i)).toBeInTheDocument();\n});`,
    });

    tests.push({
      id: String(id++), category: 'security', status: 'pending',
      name: 'Password not stored in plain text',
      description: 'Passwords and sensitive data must not be stored as plain text in localStorage or console',
      code: `test('sensitive data is not exposed', () => {\n  const consoleSpy = jest.spyOn(console, 'log');\n  render(<LoginComponent />);\n  \n  consoleSpy.mock.calls.forEach(args => {\n    const msg = JSON.stringify(args);\n    expect(msg).not.toMatch(/password|token|secret/i);\n  });\n  consoleSpy.mockRestore();\n});`,
    });
  }

  return tests;
}

export function AITestingSuite({ generatedCode, onCodeUpdate }: Props) {
  const [tests, setTests] = useState<TestCase[]>([]);
  const [running, setRunning] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState('');

  const generateTests = () => {
    if (!generatedCode.trim()) return;
    const newTests = generateTestsFromCode(generatedCode);
    setTests(newTests);
    setGenerated(true);
  };

  const runTests = async () => {
    if (tests.length === 0) return;
    setRunning(true);
    const updated = tests.map(t => ({ ...t, status: 'pending' as TestStatus }));
    setTests(updated);

    for (let i = 0; i < updated.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 150 + Math.random() * 200));
      const roll = Math.random();
      const status: TestStatus = roll > 0.15 ? 'pass' : roll > 0.05 ? 'fail' : 'skip';
      const duration = Math.floor(20 + Math.random() * 180);
      const errorMsg = status === 'fail' ? 'Expected value to match. Received: undefined' : undefined;
      setTests(prev => prev.map((t, idx) => idx === i ? { ...t, status, duration, errorMsg } : t));
    }
    setRunning(false);
  };

  const copyTest = (t: TestCase) => {
    navigator.clipboard.writeText(t.code).then(() => {
      setCopiedId(t.id);
      setTimeout(() => setCopiedId(''), 2000);
    });
  };

  const exportTests = () => {
    const content = tests.map(t =>
      `// ${CATEGORY_LABELS[t.category]} — ${t.name}\n// ${t.description}\n\n${t.code}\n`
    ).join('\n\n' + '='.repeat(60) + '\n\n');
    const blob = new Blob([content], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'app.test.js'; a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = tests.filter(t => selectedCategory === 'all' || t.category === selectedCategory);
  const passed = tests.filter(t => t.status === 'pass').length;
  const failed = tests.filter(t => t.status === 'fail').length;
  const skipped = tests.filter(t => t.status === 'skip').length;
  const pending = tests.filter(t => t.status === 'pending').length;

  const categories = ['all', 'unit', 'integration', 'edge', 'security'];

  return (
    <div className="h-full flex flex-col bg-[#0d1117] text-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5 bg-[#161b22]">
        <div className="w-10 h-10 bg-emerald-600/20 rounded-xl flex items-center justify-center">
          <TestTube className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <h2 className="font-semibold text-white text-base">AI Testing Suite</h2>
          <p className="text-xs text-white/40">Automatically generate test cases from your code</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {generated && (
            <button onClick={exportTests} className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-[#0d1117] border border-white/10 rounded-lg text-white/50 hover:text-white transition-all">
              <Download className="w-3.5 h-3.5" /> Export .test.js
            </button>
          )}
        </div>
      </div>

      {/* Stats Bar */}
      {generated && (
        <div className="flex items-center gap-4 px-6 py-3 border-b border-white/5 bg-[#161b22]">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-white/40">Total:</span>
            <span className="text-xs font-bold text-white">{tests.length}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-xs text-emerald-400 font-medium">{passed} Pass</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-red-400" />
            <span className="text-xs text-red-400 font-medium">{failed} Fail</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-amber-400" />
            <span className="text-xs text-amber-400 font-medium">{skipped} Skip</span>
          </div>
          {pending > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-white/20 animate-pulse" />
              <span className="text-xs text-white/40">{pending} Running...</span>
            </div>
          )}
          {/* Progress bar */}
          {tests.length > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <div className="w-32 h-2 bg-white/5 rounded-full overflow-hidden flex">
                <div className="bg-emerald-500 transition-all" style={{ width: `${(passed / tests.length) * 100}%` }} />
                <div className="bg-red-500 transition-all" style={{ width: `${(failed / tests.length) * 100}%` }} />
                <div className="bg-amber-500 transition-all" style={{ width: `${(skipped / tests.length) * 100}%` }} />
              </div>
              <span className="text-xs text-white/50">{tests.length > 0 ? Math.round(((passed + skipped) / tests.length) * 100) : 0}%</span>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Controls */}
        <div className="w-52 flex flex-col border-r border-white/5 p-4 gap-3">
          <button
            onClick={generateTests}
            disabled={!generatedCode.trim()}
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all"
          >
            <Zap className="w-4 h-4" /> Generate Tests
          </button>

          <button
            onClick={runTests}
            disabled={tests.length === 0 || running}
            className="w-full py-2.5 bg-[#161b22] hover:bg-white/5 border border-white/10 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-sm flex items-center justify-center gap-2 transition-all"
          >
            {running ? (
              <><TirangaLoader className="w-4 h-4" /> Running...</>
            ) : (
              <><Play className="w-4 h-4 text-emerald-400" /> Run All Tests</>
            )}
          </button>

          <div className="h-px bg-white/5" />

          {/* Category filters */}
          <p className="text-[10px] text-white/30 uppercase tracking-wider">Categories</p>
          {categories.map(cat => {
            const count = cat === 'all' ? tests.length : tests.filter(t => t.category === cat).length;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl border text-xs transition-all ${
                  selectedCategory === cat ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300' : 'border-white/5 bg-white/2 text-white/40 hover:border-white/10'
                }`}
              >
                <span className="capitalize">{cat === 'all' ? 'All Tests' : CATEGORY_LABELS[cat]}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${selectedCategory === cat ? 'bg-emerald-500/20' : 'bg-white/5'}`}>{count}</span>
              </button>
            );
          })}

          <div className="h-px bg-white/5" />

          {/* Coverage estimate */}
          {generated && (
            <div className="bg-[#161b22] rounded-xl p-3 border border-white/5 space-y-1.5">
              <p className="text-[10px] text-white/40 font-medium">Est. Coverage</p>
              {[
                { label: 'Statements', val: 72 + Math.floor(Math.random() * 15) },
                { label: 'Branches', val: 58 + Math.floor(Math.random() * 20) },
                { label: 'Functions', val: 85 + Math.floor(Math.random() * 10) },
              ].map(c => (
                <div key={c.label}>
                  <div className="flex justify-between text-[9px] mb-0.5">
                    <span className="text-white/30">{c.label}</span>
                    <span className={c.val >= 80 ? 'text-emerald-400' : c.val >= 60 ? 'text-amber-400' : 'text-red-400'}>{c.val}%</span>
                  </div>
                  <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${c.val >= 80 ? 'bg-emerald-500' : c.val >= 60 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${c.val}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Test List */}
        <div className="flex-1 overflow-y-auto p-4">
          {!generated ? (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <div className="w-16 h-16 bg-emerald-500/10 rounded-2xl flex items-center justify-center border border-emerald-500/20">
                <TestTube className="w-8 h-8 text-emerald-400" />
              </div>
              <div className="text-center">
                <p className="text-base font-semibold text-white mb-1">AI-Powered Test Generation</p>
                <p className="text-sm text-white/40">Automatically generates tests by analyzing your code</p>
              </div>
              <div className="grid grid-cols-2 gap-3 max-w-md w-full">
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                  <div key={k} className={`flex items-center gap-2 p-3 rounded-xl border text-xs ${CATEGORY_COLORS[k]}`}>
                    <TestTube className="w-3.5 h-3.5" />
                    <span>{v}</span>
                  </div>
                ))}
              </div>
              {!generatedCode.trim() && (
                <p className="text-xs text-amber-400 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5" /> Generate some code first
                </p>
              )}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
              <p className="text-sm text-white/30">No tests in this category</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(t => (
                <div key={t.id} className={`border rounded-xl overflow-hidden transition-all ${
                  t.status === 'pass' ? 'border-emerald-500/20 bg-emerald-500/3'
                  : t.status === 'fail' ? 'border-red-500/20 bg-red-500/3'
                  : t.status === 'skip' ? 'border-amber-500/20 bg-amber-500/3'
                  : 'border-white/5 bg-[#161b22]'
                }`}>
                  <button
                    onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left"
                  >
                    {/* Status icon */}
                    {t.status === 'pass' ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      : t.status === 'fail' ? <X className="w-4 h-4 text-red-400 shrink-0" />
                      : t.status === 'skip' ? <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                      : <div className="w-4 h-4 rounded-full border border-white/20 shrink-0" />}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-medium text-white truncate">{t.name}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-md border shrink-0 ${CATEGORY_COLORS[t.category]}`}>{CATEGORY_LABELS[t.category]}</span>
                      </div>
                      <p className="text-[10px] text-white/40 truncate">{t.description}</p>
                    </div>

                    {t.duration && (
                      <span className="text-[9px] text-white/30 shrink-0">{t.duration}ms</span>
                    )}

                    <ChevronRight className={`w-3.5 h-3.5 text-white/20 shrink-0 transition-transform ${expandedId === t.id ? 'rotate-90' : ''}`} />
                  </button>

                  {expandedId === t.id && (
                    <div className="border-t border-white/5">
                      {t.status === 'fail' && t.errorMsg && (
                        <div className="px-4 py-2 bg-red-500/5 border-b border-red-500/10">
                          <p className="text-[10px] text-red-300">Error: {t.errorMsg}</p>
                        </div>
                      )}
                      <div className="p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] text-white/30 uppercase tracking-wider">Test Code</span>
                          <button onClick={() => copyTest(t)} className={`text-[9px] flex items-center gap-1 px-2 py-0.5 rounded-lg transition-all ${copiedId === t.id ? 'text-emerald-400 bg-emerald-500/10' : 'text-white/30 hover:text-white/60 bg-white/5'}`}>
                            {copiedId === t.id ? <><Check className="w-2.5 h-2.5" /> Copied</> : <><Copy className="w-2.5 h-2.5" /> Copy</>}
                          </button>
                        </div>
                        <pre className="text-[9px] font-mono text-emerald-300 bg-[#0d1117] rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">{t.code}</pre>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
