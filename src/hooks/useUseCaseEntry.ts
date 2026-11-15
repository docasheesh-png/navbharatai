import { useEffect, useRef, useState } from 'react';
import { saveDraft } from '../components/agentv3/composerDraft';
import { readUseCaseRequest, useCasePromptUrl, USE_CASE_PROMPT_KEY, USE_CASE_SOURCE_KEY } from '../lib/useCaseEntry';

/**
 * If this visit came from a curated app-idea page, fetch that idea's prompt,
 * keep it for the builder, then open the builder. A signed-out person gets the
 * normal sign-in first; the prompt stays until the builder opens.
 */
export function useUseCaseEntry(opts: {
  user: unknown;
  loadingUser: boolean;
  toggleTab: (view: 'nbi_pro_chat') => boolean;
  setShowAuth: (open: boolean) => void;
}): void {
  const [ready, setReady] = useState(false);
  const started = useRef(false);
  const opened = useRef(false);

  useEffect(() => {
    if (started.current) return;
    if (typeof window === 'undefined') return;
    const req = readUseCaseRequest(window.location.search);
    if (!req) return;
    started.current = true;
    void (async () => {
      try {
        const res = await fetch(useCasePromptUrl(req.slug));
        const data = await res.json().catch(() => null);
        if (!res.ok || typeof data?.prompt !== 'string' || !data.prompt.trim()) return;
        saveDraft(data.prompt);
        try {
          sessionStorage.setItem(USE_CASE_PROMPT_KEY, data.prompt);
          if (req.source === 'seo') sessionStorage.setItem(USE_CASE_SOURCE_KEY, JSON.stringify({ slug: req.slug, source: 'seo' }));
        } catch { /* private mode: the draft still tries */ }
        const url = new URL(window.location.href);
        url.searchParams.delete('usecase');
        url.searchParams.delete('source');
        window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
        setReady(true);
      } catch { /* no invented prompt */ }
    })();
  }, []);

  useEffect(() => {
    if (!ready || opened.current || opts.loadingUser) return;
    if (!opts.user) {
      opts.setShowAuth(true);
      return;
    }
    opened.current = true;
    opts.toggleTab('nbi_pro_chat');
  }, [ready, opts.user, opts.loadingUser, opts.toggleTab, opts.setShowAuth]);
}
