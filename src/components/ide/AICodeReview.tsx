import React, { useState } from 'react';
import { Code, Bug, Shield, Zap, AlertCircle, CheckCircle2, ChevronRight, ChevronDown, RefreshCw, Copy, Star, Info, X, Check, Download, Play, Lightbulb, Github, Box } from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';
import type { ChatSession } from '../../types';

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
  /** The user's NavBharatAI apps (each session carries its real files) — source #1 for Connect App. */
  sessions?: ChatSession[];
  /** GitHub OAuth token (localStorage gh_token, lifted by App) — source #2 for Connect App. */
  githubToken?: string;
}

// ── Connect App: server review result shapes (from POST /api/app-review/review → reviewCode) ──
type ServerSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
type ServerCategory = 'security' | 'quality' | 'performance' | 'tech_debt' | 'accessibility';
interface ServerFinding {
  file: string;
  line?: number;
  severity: ServerSeverity;
  category: ServerCategory;
  description: string;
  fix: string;
}
interface ServerReview {
  findings: ServerFinding[];
  summary: string;
  score: number;
  techDebt: string[];
}
interface GithubRepo { fullName: string; owner: string; name: string; defaultBranch: string; private: boolean; }

// Map the real AI reviewer's findings onto this tool's existing issue UI.
function mapServerFindings(r: ServerReview): ReviewIssue[] {
  const sevMap: Record<ServerSeverity, Severity> = {
    critical: 'critical', high: 'critical', medium: 'warning', low: 'suggestion', info: 'info',
  };
  const catMap: Record<ServerCategory, Category> = {
    security: 'security', quality: 'bestpractice', performance: 'performance', tech_debt: 'bestpractice', accessibility: 'accessibility',
  };
  return (Array.isArray(r.findings) ? r.findings : []).map((f, i) => {
    const desc = typeof f.description === 'string' ? f.description : '';
    return {
      id: String(i + 1),
      severity: sevMap[f.severity] || 'info',
      category: catMap[f.category] || 'bestpractice',
      title: desc.length > 90 ? desc.slice(0, 90) + '…' : (desc || 'Finding'),
      description: desc,
      lineHint: f.line ? `${f.file}:${f.line}` : f.file,
      fix: typeof f.fix === 'string' ? f.fix : undefined,
    };
  });
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
  // M5: expanded secrets scan — catches common key/token patterns
  const hasHardcodedKey = /['"]AIzaSy|['"]sk-[a-zA-Z0-9]{20}|['"]pk_|['"]rk_|['"]whsec_|['"]xoxb-|['"]ghp_|['"]github_pat_|['"]glpat-|['"]AKIA[A-Z0-9]{16}|password\s*=\s*['"][^'"]{4,}|secret\s*[:=]\s*['"][^'"]{8,}|api[_-]?key\s*[:=]\s*['"][^'"]{8,}|Bearer\s+[a-zA-Z0-9._-]{20,}/.test(code);
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

  // D14: additional accessibility checks
  const hasLabelWithoutHtmlFor = /<label(?![^>]*htmlFor\s*=)(?![^>]*for\s*=)[^>]*>/i.test(code) && code.includes('<label');
  if (hasLabelWithoutHtmlFor) {
    issues.push({
      id: String(id++), severity: 'warning', category: 'accessibility',
      title: 'Label missing htmlFor / for attribute',
      description: '<label> elements must be programmatically linked to their input using htmlFor (React) or for (HTML). Screen readers announce the label when the input is focused.',
      fix: 'Link label to input with htmlFor',
      fixCode: `<label htmlFor="email">Email address</label>\n<input id="email" type="email" />`,
    });
  }

  const hasDivOnClick = /<div[^>]*onClick/i.test(code);
  const hasDivRole = /<div[^>]*role\s*=/.test(code);
  if (hasDivOnClick && !hasDivRole) {
    issues.push({
      id: String(id++), severity: 'warning', category: 'accessibility',
      title: 'Clickable <div> without role or keyboard support',
      description: '<div> elements with onClick are not accessible to keyboard or screen-reader users. Use <button> or add role="button" + tabIndex={0} + onKeyDown.',
      fix: 'Use <button> or add ARIA role',
      fixCode: `{/* Preferred: use a button */}\n<button onClick={handleClick}>Click me</button>\n\n{/* Or: make div keyboard-accessible */}\n<div\n  role="button"\n  tabIndex={0}\n  onClick={handleClick}\n  onKeyDown={e => e.key === 'Enter' && handleClick()}\n>Click me</div>`,
    });
  }

  const hasColorOnlyError = /text-red|color:\s*red|color:\s*#[Ee]|className.*error.*text-/.test(code) &&
    !code.includes('aria-invalid') && !code.includes('aria-describedby') && code.includes('error');
  if (hasColorOnlyError) {
    issues.push({
      id: String(id++), severity: 'suggestion', category: 'accessibility',
      title: 'Error state indicated by color only',
      description: 'Using red color alone to indicate an error fails WCAG for users with color blindness. Pair color with aria-invalid and a descriptive message.',
      fix: 'Use aria-invalid + error message text',
      fixCode: `<input\n  aria-invalid={hasError}\n  aria-describedby="email-error"\n/>\n{hasError && (\n  <span id="email-error" className="text-red-400 text-xs">\n    ⚠ Email is required {/* icon + text, not color only */}\n  </span>\n)}`,
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

// D13: map score to letter grade
function scoreToGrade(score: number): { grade: string; color: string; bg: string; border: string } {
  if (score >= 90) return { grade: 'A', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' };
  if (score >= 75) return { grade: 'B', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' };
  if (score >= 60) return { grade: 'C', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30' };
  if (score >= 40) return { grade: 'D', color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30' };
  return { grade: 'F', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' };
}

export function AICodeReview({ generatedCode, onCodeUpdate, sessions, githubToken }: Props) {
  const [issues, setIssues] = useState<ReviewIssue[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState('');
  // D12: dismissed finding IDs
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  // ── Connect App flow ──
  const [connectOpen, setConnectOpen] = useState(false);
  const [source, setSource] = useState<'nbai' | 'github' | null>(null);
  const [selectedKey, setSelectedKey] = useState(''); // NavBharatAI session id OR "owner/repo"
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [connectError, setConnectError] = useState('');
  const [serverScore, setServerScore] = useState<number | null>(null); // real 0-100 from the AI reviewer
  const [serverSummary, setServerSummary] = useState('');
  const [reviewedApp, setReviewedApp] = useState(''); // name of the connected app that was reviewed

  // The user's NavBharatAI apps that actually carry code (source #1).
  const nbaiApps = (sessions || [])
    .filter(s => s.files && Object.keys(s.files).length > 0)
    .map(s => ({ id: s.id, title: s.title || 'Untitled app', files: s.files as Record<string, string> }));

  const resetReviewState = () => {
    setReviewed(false);
    setIssues([]);
    setServerScore(null);
    setServerSummary('');
    setReviewedApp('');
    setSelectedCategory('all');
    setDismissedIds(new Set());
  };

  const selectSource = async (src: 'nbai' | 'github') => {
    setSource(src);
    setSelectedKey('');
    setConnectError('');
    if (src === 'github') {
      if (!githubToken) {
        setConnectError('Connect your GitHub account first: Settings → GitHub.');
        setRepos([]);
        return;
      }
      setReposLoading(true);
      try {
        const r = await fetch('/api/github/repos', { headers: { Authorization: `Bearer ${githubToken}` } });
        if (!r.ok) throw new Error('Could not load your repositories. Please reconnect GitHub.');
        const data = await r.json();
        const list: GithubRepo[] = (Array.isArray(data) ? data : [])
          .filter((x: any) => x && x.full_name && x.owner?.login)
          .map((x: any) => ({ fullName: x.full_name, owner: x.owner.login, name: x.name, defaultBranch: x.default_branch || 'main', private: !!x.private }));
        setRepos(list);
        if (list.length === 0) setConnectError('No repositories found on your GitHub account.');
      } catch (e) {
        setConnectError(e instanceof Error ? e.message : 'Could not load your repositories.');
        setRepos([]);
      } finally {
        setReposLoading(false);
      }
    }
  };

  // The real, connected review: fetch the app's actual source files, then run the real AI reviewer.
  const runConnectedReview = async () => {
    setConnectError('');
    let files: Record<string, string> = {};
    let name = '';

    if (source === 'nbai') {
      const app = nbaiApps.find(a => a.id === selectedKey);
      if (!app) { setConnectError('Select an app to review.'); return; }
      files = app.files;
      name = app.title;
    } else if (source === 'github') {
      const repo = repos.find(r => r.fullName === selectedKey);
      if (!repo) { setConnectError('Select a repository to review.'); return; }
      name = repo.fullName;
      resetReviewState();
      setReviewing(true);
      try {
        const fr = await fetch('/api/github/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${githubToken}` },
          body: JSON.stringify({ owner: repo.owner, repo: repo.name, recursive: true, branch: repo.defaultBranch }),
        });
        const fd = await fr.json().catch(() => null);
        if (!fr.ok || !fd || !fd.files || Object.keys(fd.files).length === 0) {
          throw new Error((fd && fd.error) || 'Could not fetch the repository files.');
        }
        files = fd.files;
      } catch (e) {
        setConnectError(e instanceof Error ? e.message : 'Could not fetch the repository.');
        setReviewing(false);
        return;
      }
    } else {
      setConnectError('Choose a source (NavBharatAI or GitHub) first.');
      return;
    }

    resetReviewState();
    setReviewing(true);
    try {
      const rr = await fetch('/api/app-review/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files }),
      });
      const rd = await rr.json().catch(() => null);
      if (!rr.ok || !rd) {
        throw new Error((rd && rd.error) || 'Code review could not complete. Please try again.');
      }
      setIssues(mapServerFindings(rd as ServerReview));
      setServerScore(typeof rd.score === 'number' ? Math.max(0, Math.min(100, rd.score)) : null);
      setServerSummary(typeof rd.summary === 'string' ? rd.summary : '');
      setReviewedApp(name);
      setReviewed(true);
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : 'Code review could not complete.');
    } finally {
      setReviewing(false);
    }
  };

  const canRunConnected = !!source && !!selectedKey && !reviewing;

  const runReview = async () => {
    if (!generatedCode.trim()) return;
    setReviewing(true);
    resetReviewState();
    await new Promise(r => setTimeout(r, 1200));
    const found = analyzeCode(generatedCode);
    setIssues(found);
    setReviewedApp('');
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
      reviewedApp ? `App: ${reviewedApp}` : '',
      `Date: ${new Date().toLocaleString('en-IN')}`,
      `Score: ${score}/100`,
      serverSummary ? `Summary: ${serverSummary}` : '',
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

  // Prefer the real 0-100 score from the AI reviewer (connected review); fall back to the
  // local heuristic score for the in-editor quick check.
  const score = serverScore != null ? serverScore : (issues.length ? calcScore(issues) : 0);
  const categories: { key: string; label: string }[] = [
    { key: 'all', label: 'All' },
    ...Object.entries(CAT_CONFIG).map(([k, v]) => ({ key: k, label: v.label })),
  ];

  const filtered = issues.filter(i => !dismissedIds.has(i.id) && (selectedCategory === 'all' || i.category === selectedCategory));

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
          <p className="text-xs text-white/40">Connect a NavBharatAI app or GitHub repo for a real AI review — security, quality, performance</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* D13: quality grade badge */}
          {reviewed && (() => { const g = scoreToGrade(score); return (
            <div className={`flex items-center gap-1 px-3 py-1.5 rounded-xl border font-black text-sm ${g.bg} ${g.border} ${g.color}`} title={`Code quality grade: ${g.grade}`}>
              Grade {g.grade}
            </div>
          ); })()}
          {reviewed && (
            <button onClick={exportReport} className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-[#0d1117] border border-white/10 rounded-lg text-white/50 hover:text-white transition-all">
              <Download className="w-3.5 h-3.5" /> Export Report
            </button>
          )}
          <button
            onClick={() => setConnectOpen(o => !o)}
            className={`flex items-center gap-1.5 text-sm px-4 py-2 rounded-xl font-medium transition-all border ${connectOpen ? 'bg-red-600 border-red-500 text-white' : 'bg-[#0d1117] border-white/10 text-white/70 hover:text-white'}`}
          >
            <Zap className="w-4 h-4" /> Connect App
          </button>
        </div>
      </div>

      {/* Connect App panel — pick a real app source, then run a real AI review on its actual code */}
      {connectOpen && (
        <div className="px-6 py-4 border-b border-white/5 bg-[#0f141b] space-y-3">
          {/* Step 1 — choose the source (exactly one) */}
          <div>
            <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1.5">Source</p>
            <div className="flex gap-2">
              <button
                onClick={() => selectSource('nbai')}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm transition-all ${source === 'nbai' ? 'border-red-500/60 bg-red-500/10 text-red-300' : 'border-white/5 bg-[#161b22] text-white/50 hover:border-white/10'}`}
              >
                <Box className="w-4 h-4" /> NavBharatAI apps
              </button>
              <button
                onClick={() => selectSource('github')}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm transition-all ${source === 'github' ? 'border-red-500/60 bg-red-500/10 text-red-300' : 'border-white/5 bg-[#161b22] text-white/50 hover:border-white/10'}`}
              >
                <Github className="w-4 h-4" /> GitHub apps
              </button>
            </div>
          </div>

          {/* Step 2 — dependent dropdown, populated by the chosen source */}
          {source && (
            <div>
              <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1.5">
                {source === 'nbai' ? 'Your NavBharatAI apps' : 'Your GitHub repositories'}
              </p>
              <div className="relative">
                <select
                  value={selectedKey}
                  onChange={e => setSelectedKey(e.target.value)}
                  disabled={reposLoading || reviewing}
                  className="w-full appearance-none bg-[#161b22] border border-white/10 rounded-xl px-3 py-2.5 pr-9 text-sm text-white focus:outline-none focus:border-red-500/50 disabled:opacity-50"
                >
                  <option value="">
                    {source === 'nbai'
                      ? (nbaiApps.length ? 'Select an app…' : 'No NavBharatAI apps found — build one first')
                      : (reposLoading ? 'Loading repositories…' : repos.length ? 'Select a repository…' : 'No repositories')}
                  </option>
                  {source === 'nbai'
                    ? nbaiApps.map(a => (
                        <option key={a.id} value={a.id}>{a.title} ({Object.keys(a.files).length} files)</option>
                      ))
                    : repos.map(r => (
                        <option key={r.fullName} value={r.fullName}>{r.fullName}{r.private ? ' 🔒' : ''}</option>
                      ))}
                </select>
                <ChevronDown className="w-4 h-4 text-white/30 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>
          )}

          {connectError && (
            <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-2 rounded-lg">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {connectError}
            </div>
          )}

          {/* Step 3 — the REAL review (real fetch + real AI review of the connected app's code) */}
          {source && (
            <button
              onClick={runConnectedReview}
              disabled={!canRunConnected}
              className="flex items-center gap-1.5 text-sm px-4 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl font-medium transition-all"
            >
              {reviewing ? <><TirangaLoader className="w-4 h-4" /> Reviewing…</> : <><Play className="w-4 h-4" /> Review Code</>}
            </button>
          )}
        </div>
      )}

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
                <Zap className="w-7 h-7 text-red-400" />
              </div>
              <p className="text-xs text-white/30">Press <span className="text-white/60 font-medium">Connect App</span> to review a NavBharatAI app or a GitHub repo</p>
              {generatedCode.trim() && (
                <button
                  onClick={runReview}
                  className="text-[11px] text-white/40 hover:text-white/70 underline underline-offset-2"
                >
                  Or quick-check the current in-editor code
                </button>
              )}
            </div>
          )}

          {reviewing && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="w-14 h-14 bg-red-500/10 rounded-2xl flex items-center justify-center border border-red-500/20 animate-pulse">
                <TirangaLoader className="w-7 h-7" />
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
                Connect a NavBharatAI app or a GitHub repo — the AI reviews its real code for security, quality, and performance issues
              </p>
              <button
                onClick={() => setConnectOpen(true)}
                className="flex items-center gap-2 text-sm px-4 py-2 bg-red-600 hover:bg-red-500 rounded-xl font-medium transition-all"
              >
                <Zap className="w-4 h-4" /> Connect App
              </button>
            </div>
          )}

          {/* Real AI summary of the connected app that was reviewed */}
          {reviewed && (reviewedApp || serverSummary) && (
            <div className="mb-3 bg-[#161b22] border border-white/10 rounded-xl px-4 py-3">
              {reviewedApp && (
                <p className="text-xs text-white/80 font-medium flex items-center gap-1.5 mb-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Reviewed: {reviewedApp}
                </p>
              )}
              {serverSummary && <p className="text-[11px] text-white/50 leading-relaxed">{serverSummary}</p>}
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
                      {/* D12: dismiss finding */}
                      <button
                        onClick={(e) => { e.stopPropagation(); setDismissedIds(prev => new Set([...prev, issue.id])); }}
                        title="Dismiss finding"
                        className="p-1 rounded hover:bg-white/10 text-white/20 hover:text-white/60 shrink-0 ml-1"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </button>

                    {/* D10: stopPropagation prevents accidental collapse when clicking inside expanded content */}
                    {isExpanded && (
                      <div onClick={(e) => e.stopPropagation()} className="border-t border-white/10 px-4 py-3 space-y-3">
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
