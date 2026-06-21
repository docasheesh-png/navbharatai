import { describe, it, expect } from 'vitest';
import { extractRequestedFeatures, computeFeatureCoverage, featureChecklist } from '../src/server/project/FeatureCoverage';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';

describe('extractRequestedFeatures', () => {
  it('returns empty array for generic prompt', () => {
    expect(extractRequestedFeatures('build a simple app')).toHaveLength(0);
  });

  it('detects "auth" from login keyword', () => {
    const features = extractRequestedFeatures('app with login');
    expect(features.map(f => f.id)).toContain('auth');
  });

  it('detects "search" from search keyword', () => {
    const features = extractRequestedFeatures('search functionality');
    expect(features.map(f => f.id)).toContain('search');
  });

  it('detects multiple features at once', () => {
    const features = extractRequestedFeatures('todo app with login and search');
    const ids = features.map(f => f.id);
    expect(ids).toContain('auth');
    expect(ids).toContain('search');
  });
});

describe('computeFeatureCoverage', () => {
  it('returns 100 coverage when nothing specific was requested', () => {
    const vfs = VirtualFileSystem.fromRecord({ 'src/App.tsx': 'const App = () => <div>Hello</div>' });
    const report = computeFeatureCoverage('build a simple app', vfs);
    expect(report.coverage).toBe(100);
  });

  it('returns 0 coverage when requested feature is missing from source', () => {
    const vfs = VirtualFileSystem.fromRecord({ 'src/App.tsx': 'const App = () => <div>Hello</div>' });
    const report = computeFeatureCoverage('build app with auth login', vfs);
    const authItem = report.items.find(i => i.id === 'auth');
    expect(authItem?.status).toBe('fail');
  });

  it('returns pass for feature that is implemented in source', () => {
    const vfs = VirtualFileSystem.fromRecord({
      'src/App.tsx': 'function App() { const [user, login] = useState(null); return <div>{user ? "logged in" : <LoginForm />}</div>; }',
    });
    const report = computeFeatureCoverage('app with login', vfs);
    const authItem = report.items.find(i => i.id === 'auth');
    expect(authItem?.status).toBe('pass');
  });

  it('reports correct requested count', () => {
    const vfs = VirtualFileSystem.fromRecord({ 'src/App.tsx': '' });
    const report = computeFeatureCoverage('app with search and filter', vfs);
    expect(report.requested).toBeGreaterThanOrEqual(2);
  });
});

describe('featureChecklist', () => {
  it('returns empty string when no features detected', () => {
    expect(featureChecklist('build a simple app')).toBe('');
  });

  it('returns checklist string mentioning the feature label', () => {
    const checklist = featureChecklist('app with login');
    expect(checklist).toContain('Authentication');
  });
});
