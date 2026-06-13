import React, { useState } from 'react';
import { Code, Bug, Shield, Zap, AlertCircle, CheckCircle2, ChevronRight, RefreshCw, Copy, Star, Info, X, Check, Download, Play, Lightbulb } from 'lucide-react';

type Severity = 'critical' | 'warning' | 'info' | 'suggestion';
type Category = 'bugs' | 'performance' | 'security' | 'bestpractice' | 'accessibility';

interface ReviewIssue {
  id: string;
  severity: Severity;
  category: Category;
  title: string;
  description: string;
  lineHint?: string;
  fix?: string;
  fixCode?: string;
}

interface Props {
  generatedCode: string;
  onCodeUpdate: (code: string) => void;
}

const SEV_CONFIG: Record<Severity, { label: string; color: string; bg: string; border: string; icon: any }> = {
  critical: { label: 'Critical', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30', icon: Bug },
  warning: { label: 'Warning', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30', icon: AlertCircle },
  info: { label: 'Info', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30', icon: Info },
  suggestion: { label: 'Suggestion', color: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/30', icon: Lightbulb },
};

const CAT_CONFIG: Record<Category, { label: string; color: string; icon: any }> = {
  bugs: { label: 'Bugs', color: 'text-red-400', icon: Bug },
  performance: { label: 'Performance', color: 'text-amber-400', icon: Zap },
  security: { label: 'Security', color: 'text-rose-400', icon: Shield },
  bestpractice: { label: 'Best Practices', color: 'text-blue-400', icon: Star },
  accessibility: { label: 'Accessibility', color: 'text-emerald-400', icon: CheckCircle2 },
};

function analyzeCode(code: string): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  let id = 1;

  if (!code.trim()) return issues;

  const hasConsoleLog = (code.match(/console\.log/g) || []).length;
  const hasAny = code.includes(': any');
  const hasDangerousHtml = code.includes('dangerouslySetInnerHTML') || code.includes('innerHTML =');
  const hasHardcodedKey = /['"]AIzaSy|['"]sk-|['"]pk_|password\s*=\s*['"][^'"]{4,}/.test(code);
  const hasNoAlt = /<img(?![^>]*alt\s*=)[^>]*>/i.test(code);
  const hasNoKey = /\.map\s*\([^)]*=>\s*[(<]/.test(code) && !code.includes('key=');
  const hasAsync = code.includes('async') || code.includes('await') || code.includes('.then(');
  const hasNoCatch = hasAsync && !code.includes('.catch(') && !code.includes('try {') && !code.includes('try{');
  const hasMagicNumbers = /[^.\d]\b([2-9]\d{2,}|[1-9]\d{3,})\b[^;\s,]/.test(code);
  const hasLargeComponent = code.split('\n').length > 200;
  const hasNoMemo = code.includes('useEffect') && !code.includes('useMemo') && !code.includes('useCallback') && code.length > 1500;
  const hasNestedTernary = (code.match(/\?[^:]+\?/g) || []).length > 2;
  const hasColorHardcoded = /#[0-9a-fA-F]{3,6}/.test(code) && code.includes('style=');
  const hasSyncStorage = /localStorage\.setItem|sessionStorage\.setItem/.test(code) && !code.includes('try');
  const hasTabIndex = code.includes('tabIndex') || code.includes('tabindex');
  const hasAriaLabel = code.includes('aria-label') || code.includes('role=');
  const hasButtonType = /<button[^>]*type=/.test(code);
  const hasPassedPropsDestructure = code.includes('...props') || code.includes('...rest');

  // Bug issues
  if (hasNoCatch) {
    issues.push({
      id: String(id++), severity: 'critical', category: 'bugs',
      title: 'No error handling in async operations',
      description: 'await or .then() is used without try/catch or .catch(). This can cause unhandled promise rejections.',
      lineHint: 'Line with fetch() or async function',
      fix: 'Wrap async calls in try/catch',
      fixCode: `try {\n  const data = await fetchData();\n} catch (error) {\n  console.error('Error:', error);\n  setError(error.message);\n}`,
    });
  }

  if (hasNoKey) {
    issues.push({
      id: String(id++), severity: 'critical', category: 'bugs',
      title: 'Missing key prop in .map()',
      description: 'React list items are missing a unique key prop. This causes render issues and performance problems.',
      lineHint: 'Line with .map()',
      fix: 'Give each list item a unique key',
      fixCode: `items.map((item) => (\n  <div key={item.id}>  {/* Unique key required */}\n    {item.name}\n  </div>\n))`,
    });
  }

  if (hasHardcodedKey) {
    issues.push({
      id: String(id++), severity: 'critical', category: 'security',
      title: 'Hardcoded API key or password detected!',
      description: 'Sensitive credentials are written directly in source code. This is a major security vulnerability — they will be exposed if pushed to GitHub.',
      lineHint: 'Line with API key / password',
      fix: 'Use environment variables',
      fixCode: `// In .env file:\nAPI_KEY=your_actual_key\n\n// In code:\nconst apiKey = process.env.API_KEY;\n// React: process.env.REACT_APP_API_KEY`,
    });
  }

  if (hasDangerousHtml) {
    issues.push({
      id: String(id++), severity: 'critical', category: 'security',
      title: 'dangerouslySetInnerHTML / innerHTML XSS risk',
      description: 'Injecting user input directly into HTML allows XSS (Cross-Site Scripting) attacks.',
      lineHint: 'Line with dangerouslySetInnerHTML or innerHTML',
      fix: 'Use DOMPurify to sanitize HTML',
      fixCode: `import DOMPurify from 'dompurify';\n\n// Safe HTML rendering:\n<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userContent) }} />`,
    });
  }

  // Performance issues
  if (hasNoMemo) {
    issues.push({
      id: String(id++), severity: 'warning', category: 'performance',
      title: 'Optimize expensive computations with useMemo',
      description: 'Component has useEffect and heavy operations but is not using useMemo/useCallback. This can cause unnecessary re-renders.',
      lineHint: 'Line with useEffect or heavy computation',
      fix: 'Use memoization',
      fixCode: `const expensiveValue = useMemo(() => {\n  return heavyComputation(data);\n}, [data]); // recalculates only when data changes\n\nconst handleClick = useCallback(() => {\n  doSomething();\n}, []);`,
    });
  }

  if (hasLargeComponent) {
    issues.push({
      id: String(id++), severity: 'warning', category: 'performance',
      title: 'Component is too large (200+ lines)',
      description: 'Large components cause slow renders and poor maintainability. Split into smaller components.',
      fix: 'Extract feature-specific sub-components',
    });
  }

  if (hasSyncStorage) {
    issues.push({
      id: String(id++), severity: 'warning', category: 'bugs',
      title: 'Missing error handling for localStorage',
      description: 'localStorage throws exceptions in private/incognito mode or when storage is full. The app may crash.',
      fix: 'Wrap in try/catch',
      fixCode: `try {\n  localStorage.setItem(key, JSON.stringify(value));\n} catch (e) {\n  // Storage unavailable — gracefully handle\n  console.warn('Storage unavailable', e);\n}`,
    });
  }

  // Best practices
  if (hasAny) {
    issues.push({
      id: String(id++), severity: 'warning', category: 'bestpractice',
      title: 'TypeScript "any" type overuse',
      description: 'The "any" type removes TypeScript\'s safety guarantees. Define proper types instead.',
      lineHint: 'Lines with ": any"',
      fix: 'Define specific types',
      fixCode: `// Bad:\nconst data: any = fetchData();\n\n// Good:\ninterface User { id: string; name: string; }\nconst data: User = fetchData();`,
    });
  }

  if (hasConsoleLog > 3) {
    issues.push({
      id: String(id++), severity: 'info', category: 'bestpractice',
      title: `${hasConsoleLog} console.log statements in production code`,
      description: 'console.log exposes debug output in production. Use proper logging or remove them.',
      fix: 'Remove or disable console.log in production',
      fixCode: `// Environment check:\nif (process.env.NODE_ENV === 'development') {\n  console.log('Debug:', data);\n}`,
    });
  }

  if (hasNestedTernary) {
    issues.push({
      id: String(id++), severity: 'info', category: 'bestpractice',
      title: 'Deeply nested ternary operators',
      description: 'Multiple nested ternaries reduce code readability. Use if/else or early returns instead.',
      fix: 'Use readable conditional logic',
      fixCode: `// Bad: a ? b ? c : d : e\n\n// Good:\nif (a) {\n  if (b) return c;\n  return d;\n}\nreturn e;`,
    });
  }

  if (hasMagicNumbers) {
    issues.push({
      id: String(id++), severity: 'suggestion', category: 'bestpractice',
      title: 'Magic numbers — use named constants',
      description: 'Unexplained numbers (like 86400, 1000, 500) in code. Named constants improve readability.',
      fix: 'Define descriptive constants',
      fixCode: `// Bad:\nsetTimeout(refresh, 86400000);\n\n// Good:\nconst ONE_DAY_MS = 24 * 60 * 60 * 1000;\nsetTimeout(refresh, ONE_DAY_MS);`,
    });
  }

  if (hasColorHardcoded) {
    issues.push({
      id: String(id++), severity: 'suggestion', category: 'bestpractice',
      title: 'Hardcoded colors — use CSS variables',
      description: 'Hardcoded hex colors in inline styles make theming and dark mode support difficult.',
      fix: 'Use CSS variables or Tailwind',
    });
  }

  if (hasPassedPropsDestructure) {
    issues.push({
      id: String(id++), severity: 'info', category: 'bestpractice',
      title: 'Props spreading (...props) — check type safety',
      description: 'Spreading "...props" or "...rest" can pass unexpected props down. Explicit props are safer.',
    });
  }

  // Accessibility
  if (hasNoAlt) {
    issues.push({
      id: String(id++), severity: 'warning', category: 'accessibility',
      title: 'Missing alt attribute on <img> tags',
      description: 'Alt text is required for screen readers and WCAG 2.1 compliance.',
      lineHint: 'Lines with <img>',
      fix: 'Add alt to all images',
      fixCode: `<img src={logo} alt="Company logo" />\n\n{/* Decorative images use empty alt: */}\n<img src={divider} alt="" role="presentation" />`,
    });
  }

  if (!hasAriaLabel && code.includes('<button')) {
    issues.push({
      id: String(id++), severity: 'info', category: 'accessibility',
      title: 'Icon-only buttons may be missing aria-label',
      description: 'Buttons that contain only icons need aria-label for screen reader accessibility.',
      fix: 'Add accessible button labels',
      fixCode: `<button aria-label="Close dialog" onClick={onClose}>\n  <X className="w-4 h-4" />\n</button>`,
    });
  }

  if (!hasButtonType && code.includes('<button')) {
    issues.push({
      id: String(id++), severity: 'info', category: 'accessibility',
      title: 'Button type attribute missing',
      description: 'Buttons inside forms without type="button" will submit the form unintentionally by default.',
      fix: 'Add explicit type="button"',
      fixCode: `<button type="button" onClick={handleClick}>Click</button>\n<button type="submit">Submit Form</button>`,
    });
  }

  // Positive feedback if no major issues
  if (issues.filter(i => i.severity === 'critical').length === 0) {
    issues.push({
      id: String(id++), severity: 'info', category: 'bestpractice',
      title: '✓ No critical bugs detected',
      description: 'No critical bugs found in the code. Great job! Fix the remaining warnings and suggestions for best quality.',
    });
  }

  return issues;
}

function calcScore(issues: ReviewIssue[]): number {
  let score = 100;
  issues.forEach(i => {
    if (i.severity === 'critical') score -= 20;
    else if (i.severity === 'warning') score -= 8;
    else if (i.severity === 'info') score -= 2;
    else if (i.severity === 'suggestion') score -= 1;
  });
  return Math.max(0, Math.min(100, score));
}

function ScoreRing({ score }: { score: number }) {
  const r = 40;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';
  const label = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Needs Work' : 'Poor';
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={r} fill="none" stroke="#ffffff08" strokeWidth="10" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" strokeDashoffset={circ / 4}
          style={{ transition: 'all 0.6s ease' }} />
        <text x="50" y="46" textAnchor="middle" fill="white" fontSize="20" fontWeight="bold">{score}</text>
        <text x="50" y="60" textAnchor="middle" fill="#ffffff60" fontSize="9">{label}</text>
      </svg>
    </div>
  );
}

export function AICodeReview({ generatedCode, onCodeUpdate }: Props) {
  const [issues, setIssues] = useState<ReviewIssue[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState('');

  const runReview = async () => {
    if (!generatedCode.trim()) return;
    setReviewing(true);
    setReviewed(false);
    setIssues([]);
    await new Promise(r => setTimeout(r, 1200));
    const found = analyzeCode(generatedCode);
    setIssues(found);
    setReviewed(true);
    setReviewing(false);
  };

  const copyFix = (fix: string) => {
    navigator.clipboard.writeText(fix).then(() => {
      setCopiedId(fix.slice(0, 20));
      setTimeout(() => setCopiedId(''), 2000);
    });
  };

  const exportReport = () => {
    const lines = [
      '# AI Code Review Report',
      `Date: ${new Date().toLocaleString('en-IN')}`,
      `Score: ${score}/100`,
      '',
      ...issues.map(i =>
        `## [${SEV_CONFIG[i.severity].label}] ${i.title}\nCategory: ${CAT_CONFIG[i.category].label}\n${i.description}${i.lineHint ? '\nLine: ' + i.lineHint : ''}${i.fix ? '\nFix: ' + i.fix : ''}${i.fixCode ? '\n\n```\n' + i.fixCode + '\n```' : ''}\n`
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'code-review.md'; a.click();
    URL.revokeObjectURL(url);
  };

  const score = issues.length ? calcScore(issues) : 0;
  const categories: { key: string; label: string }[] = [
    { key: 'all', label: 'All' },
    ...Object.entries(CAT_CONFIG).map(([k, v]) => ({ key: k, label: v.label })),
  ];

  const filtered = issues.filter(i => selectedCategory === 'all' || i.category === selectedCategory);

  const counts = {
    critical: issues.filter(i => i.severity === 'critical').length,
    warning: issues.filter(i => i.severity === 'warning').length,
    info: issues.filter(i => i.severity === 'info').length,
    suggestion: issues.filter(i => i.severity === 'suggestion').length,
  };

  return (
    <div className="h-full flex flex-col bg-[#0d1117] text-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5 bg-[#161b22]">
        <div className="w-10 h-10 bg-red-600/20 rounded-xl flex items-center justify-center">
          <Code className="w-5 h-5 text-red-400" />
        </div>
        <div>
          <h2 className="font-semibold text-white text-base">AI Code Review</h2>
          <p className="text-xs text-white/40">Analyze your code — bugs, security, and performance checks</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {reviewed && (
            <button onClick={exportReport} className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-[#0d1117] border border-white/10 rounded-lg text-white/50 hover:text-white transition-all">
              <Download className="w-3.5 h-3.5" /> Export Report
            </button>
          )}
          <button
            onClick={runReview}
            disabled={reviewing || !generatedCode.trim()}
            className="flex items-center gap-1.5 text-sm px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl font-medium transition-all"
          >
            {reviewing ? <><RefreshCw className="w-4 h-4 animate-spin" /> Analyzing...</> : <><Play className="w-4 h-4" /> Review Code</>}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Score + Filters */}
        <div className="w-52 flex flex-col border-r border-white/5 p-4 gap-4">
          {reviewed && (
            <div className="flex flex-col items-center gap-1">
              <ScoreRing score={score} />
              <div className="w-full space-y-1.5 mt-1">
                {(Object.entries(counts) as [Severity, number][]).map(([sev, count]) => {
                  const cfg = SEV_CONFIG[sev];
                  return (
                    <div key={sev} className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border ${cfg.bg} ${cfg.border}`}>
                      <span className={`text-[10px] ${cfg.color}`}>{cfg.label}</span>
                      <span className={`text-xs font-bold ${cfg.color}`}>{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!reviewed && !reviewing && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="w-14 h-14 bg-red-500/10 rounded-2xl flex items-center justify-center border border-red-500/20">
                <Code className="w-7 h-7 text-red-400" />
              </div>
              <p className="text-xs text-white/30">Generate code first, then press the Review button</p>
            </div>
          )}

          {reviewing && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="w-14 h-14 bg-red-500/10 rounded-2xl flex items-center justify-center border border-red-500/20 animate-pulse">
                <RefreshCw className="w-7 h-7 text-red-400 animate-spin" />
              </div>
              <p className="text-xs text-white/40">Analyzing code...</p>
            </div>
          )}

          {reviewed && (
            <>
              <div className="h-px bg-white/5" />
              <p className="text-[10px] text-white/30 uppercase tracking-wider">Filter</p>
              {categories.map(cat => {
                const catIssues = cat.key === 'all' ? issues.length : issues.filter(i => i.category === cat.key).length;
                return (
                  <button
                    key={cat.key}
                    onClick={() => setSelectedCategory(cat.key)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl border text-xs transition-all ${
                      selectedCategory === cat.key ? 'border-red-500/50 bg-red-500/10 text-red-300' : 'border-white/5 bg-white/2 text-white/40 hover:border-white/10'
                    }`}
                  >
                    <span>{cat.label}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/5">{catIssues}</span>
                  </button>
                );
              })}
            </>
          )}
        </div>

        {/* Right: Issues List */}
        <div className="flex-1 overflow-y-auto p-4">
          {!reviewed && !reviewing && (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <div className="grid grid-cols-2 gap-3 max-w-sm w-full">
                {Object.entries(CAT_CONFIG).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2 p-3 rounded-xl border border-white/5 bg-[#161b22]">
                    <v.icon className={`w-4 h-4 ${v.color}`} />
                    <span className="text-xs text-white/50">{v.label}</span>
                  </div>
                ))}
              </div>
              <p className="text-sm text-white/30 text-center max-w-xs">
                AI will scan your code — finding bugs, security holes, and performance issues
              </p>
              {!generatedCode.trim() && (
                <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-4 py-2 rounded-xl">
                  <AlertCircle className="w-3.5 h-3.5" /> Generate code first
                </div>
              )}
            </div>
          )}

          {reviewed && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
              <CheckCircle2 className="w-10 h-10 text-emerald-400" />
              <p className="text-sm text-white/40">No issues in this category</p>
            </div>
          )}

          {reviewed && filtered.length > 0 && (
            <div className="space-y-2">
              {filtered.map(issue => {
                const sevCfg = SEV_CONFIG[issue.severity];
                const catCfg = CAT_CONFIG[issue.category];
                const isExpanded = expandedId === issue.id;
                const SevIcon = sevCfg.icon;
                const CatIcon = catCfg.icon;

                return (
                  <div key={issue.id} className={`border rounded-xl overflow-hidden transition-all ${sevCfg.bg} ${sevCfg.border}`}>
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : issue.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left"
                    >
                      <SevIcon className={`w-4 h-4 ${sevCfg.color} shrink-0`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-medium text-white truncate">{issue.title}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-md border font-medium ${sevCfg.color} ${sevCfg.bg} ${sevCfg.border}`}>{sevCfg.label}</span>
                          <CatIcon className={`w-3 h-3 ${catCfg.color}`} />
                          <span className={`text-[9px] ${catCfg.color}`}>{catCfg.label}</span>
                          {issue.lineHint && (
                            <span className="text-[9px] text-white/30 ml-1">@ {issue.lineHint}</span>
                          )}
                        </div>
                      </div>
                      <ChevronRight className={`w-3.5 h-3.5 text-white/20 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                    </button>

                    {isExpanded && (
                      <div className="border-t border-white/10 px-4 py-3 space-y-3">
                        <p className="text-xs text-white/60">{issue.description}</p>

                        {issue.fix && (
                          <div className="bg-[#0d1117] rounded-xl p-3 border border-white/5">
                            <p className="text-[10px] text-emerald-400 font-medium mb-1.5 flex items-center gap-1">
                              <Check className="w-3 h-3" /> Fix: {issue.fix}
                            </p>
                            {issue.fixCode && (
                              <div className="relative">
                                <pre className="text-[9px] font-mono text-emerald-300 overflow-x-auto whitespace-pre-wrap">{issue.fixCode}</pre>
                                <button
                                  onClick={() => copyFix(issue.fixCode || '')}
                                  className="absolute top-0 right-0 p-1 text-white/30 hover:text-white/60"
                                >
                                  {copiedId === (issue.fixCode || '').slice(0, 20) ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
