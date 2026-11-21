/**
 * failedbr #745 (queue Q-3204): to silence tsc the builder wrote `ProfilePage() { return null }` and
 * `useSocial() { return {} }`, the router served the null page, and the summary sold "profile pages with
 * follow/unfollow". A stub that quiets the compiler is not the feature it stands in for.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findHollowFeatures, hollowFeatureWriteNote, featureWords } from '../src/server/AgentV3/hollowFeature';
import { auditSummaryClaims } from '../src/server/AgentV3/claimAudit';

const ROOT = join(__dirname, '..');
const app745 = {
  'src/pages/ProfilePage.tsx': 'export default function ProfilePage() {\n  return null;\n}\n',
  'src/hooks/useSocial.ts': 'export function useSocial() { return {}; }\n',
  'src/App.tsx': "import ProfilePage from './pages/ProfilePage';\nimport { useSocial } from './hooks/useSocial';\nexport default function App() { const s = useSocial(); return <Routes><Route path=\"/profile/:id\" element={<ProfilePage />} /></Routes>; }\n",
};

describe('the stub shapes', () => {
  it('the #745 page and hook are found, with the words a summary uses', () => {
    const found = findHollowFeatures(app745);
    expect(found.map((h) => `${h.kind}:${h.name}`)).toEqual(['screen:ProfilePage', 'hook:useSocial']);
    expect(featureWords('ProfilePage')).toEqual(['profile']);
    expect(featureWords('useSocialFeed')).toEqual(['social', 'feed']);
  });

  it('a routed arrow component that is just `=> null` is found whatever its name', () => {
    const found = findHollowFeatures({
      'src/Orders.tsx': 'export const Orders = () => null;\n',
      'src/routes.tsx': "import { Orders } from './Orders';\nexport const routes = [{ path: '/orders', element: <Orders /> }];\n",
    });
    expect(found.map((h) => h.name)).toEqual(['Orders']);
  });

  it('🔒 precision: a component that does work before `return null`, an unrouted helper, an unused hook and tests are left alone', () => {
    expect(findHollowFeatures({
      'src/ScrollToTop.tsx': "export function ScrollToTop() { useEffect(() => window.scrollTo(0, 0), []); return null; }\n",
      'src/Spacer.tsx': 'export function Spacer() { return null; }\n',
      'src/hooks/useNothing.ts': 'export function useNothing() { return {}; }\n',
      'src/__tests__/FakePage.tsx': 'export function FakePage() { return null; }\n',
      'src/App.tsx': '<ScrollToTop />',
    })).toEqual([]);
  });
});

describe('the builder hears it while the file is open', () => {
  it('names the stub; a real page gets no note', () => {
    expect(hollowFeatureWriteNote('src/pages/ProfilePage.tsx', app745['src/pages/ProfilePage.tsx'])).toContain('EMPTY STUB');
    expect(hollowFeatureWriteNote('src/hooks/useSocial.ts', app745['src/hooks/useSocial.ts'])).toContain('useSocial');
    expect(hollowFeatureWriteNote('src/pages/HomePage.tsx', 'export default function HomePage() { return <h1>Hi</h1>; }')).toBe('');
  });
});

describe('the summary cannot sell the stub', () => {
  const base = { consoleCaptured: true, screenshotTaken: true, previewVerified: true };
  const hollow = findHollowFeatures(app745).map((h) => ({ name: h.name, words: h.words }));

  it('"profile pages with follow/unfollow" is contradicted', () => {
    const c = auditSummaryClaims('Your social app is ready:\n- Profile pages with follow/unfollow\n- A feed', { ...base, hollowFeatures: hollow });
    expect(c.map((x) => x.kind)).toContain('feature-claimed-but-empty');
    expect(c.find((x) => x.kind === 'feature-claimed-but-empty')?.measured).toContain('ProfilePage');
  });

  it('🔒 a line that says the part is not built yet, or a summary that never names it, is not contradicted', () => {
    expect(auditSummaryClaims('Profile page is a placeholder for now.', { ...base, hollowFeatures: hollow }).map((x) => x.kind)).not.toContain('feature-claimed-but-empty');
    expect(auditSummaryClaims('A calculator with history.', { ...base, hollowFeatures: hollow }).map((x) => x.kind)).not.toContain('feature-claimed-but-empty');
  });
});

describe('wired', () => {
  it('the route records it and hands it to the claim audit; the dispatcher notes it at write time', () => {
    const route = readFileSync(join(ROOT, 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain('hollowFeatures = findHollowFeatures(whole);');
    expect(route).toContain("code: 'HOLLOW_FEATURE'");
    expect(route).toContain('hollowFeatures: hollowFeatures.map((h) => ({ name: h.name, words: h.words })),');
    const disp = readFileSync(join(ROOT, 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
    expect(disp).toContain('security += hollowFeatureWriteNote(p, files[p]);');
  });
});

// failedbr #728 (queue Q-3205): "Working AI replies — simulated responses that feel helpful and natural".
describe('Q-3205 — simulated AI replies are not sold as working', () => {
  const base = { consoleCaptured: true, screenshotTaken: true, previewVerified: true };
  it('the real #728 line is contradicted', () => {
    const c = auditSummaryClaims('- **Working AI replies** — simulated responses that feel helpful and natural', base);
    expect(c.map((x) => x.kind)).toContain('ai-working-but-simulated');
  });
  it('🔒 an honest line, or a real AI line, is left alone', () => {
    expect(auditSummaryClaims('The chat uses sample replies until you connect an AI key.', base).map((x) => x.kind)).not.toContain('ai-working-but-simulated');
    expect(auditSummaryClaims('Working AI replies through your OpenAI key.', base).map((x) => x.kind)).not.toContain('ai-working-but-simulated');
  });
});
