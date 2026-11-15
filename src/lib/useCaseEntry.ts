// A public use-case page links here with ?usecase=<slug>&source=seo.
// The prompt is loaded from our own API and kept until the builder opens,
// including after the normal sign-in.

export const USE_CASE_PROMPT_KEY = 'nbi_usecase_prompt';
export const USE_CASE_SOURCE_KEY = 'nbi_usecase_source';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface UseCaseRequest {
  slug: string;
  source: 'seo' | '';
}

export function readUseCaseRequest(search: string): UseCaseRequest | null {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  let q: URLSearchParams;
  try { q = new URLSearchParams(raw); } catch { return null; }
  const slug = String(q.get('usecase') || '');
  if (!SLUG.test(slug) || slug.length > 80) return null;
  return { slug, source: q.get('source') === 'seo' ? 'seo' : '' };
}

export function useCasePromptUrl(slug: string): string {
  return `/api/use-cases/${encodeURIComponent(slug)}`;
}
