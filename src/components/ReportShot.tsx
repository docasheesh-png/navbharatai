// A screenshot attached to ONE message in a report conversation.
//
// WHY THIS IS A COMPONENT AND NOT AN `<img src>`. The image lives behind an authorised route, and an
// image tag sends no auth header — so the obvious build would need a public URL, which puts somebody's
// screenshot (often of their own half-broken account screen) behind a link that leaks the moment it is
// pasted anywhere. This fetches the bytes with the caller's own credentials instead.
//
// It also fetches LAZILY, one message at a time. The thread is loaded every time the report sheet
// opens; shipping every attachment with it would drag megabytes onto a phone that is, by definition,
// already having a bad time.

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

export interface ReportShotProps {
  /** Full URL of the authorised JSON route that returns `{ dataUrl }`. */
  src: string;
  /** Extra headers (the user path needs a Firebase token, the admin path an admin token). */
  headers?: () => Promise<Record<string, string>> | Record<string, string>;
  alt: string;
}

export function ReportShot({ src, headers, alt }: ReportShotProps) {
  const [state, setState] = useState<{ url?: string; failed?: boolean }>({});

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const h = headers ? await headers() : undefined;
        const res = await fetch(src, h ? { headers: h } : undefined);
        const data = await res.json().catch(() => null);
        if (!alive) return;
        // 🔒 An honest failure, never a broken image icon with no explanation: a reader must be able
        // to tell "there was no picture" from "the picture would not load", because only one of those
        // is a reason to ask the person again.
        if (!res.ok || typeof data?.dataUrl !== 'string') { setState({ failed: true }); return; }
        setState({ url: data.dataUrl });
      } catch {
        if (alive) setState({ failed: true });
      }
    })();
    return () => { alive = false; };
  }, [src, headers]);

  if (state.failed) {
    return (
      <span className="mt-1.5 flex items-center gap-1.5 text-[10px] text-amber-300/80">
        <AlertTriangle className="w-3 h-3" /> The screenshot could not be loaded.
      </span>
    );
  }
  if (!state.url) {
    return (
      <span className="mt-1.5 flex items-center gap-1.5 text-[10px] text-zinc-500">
        <Loader2 className="w-3 h-3 animate-spin" /> Loading screenshot…
      </span>
    );
  }
  return <img src={state.url} alt={alt} className="mt-1.5 w-full rounded-lg border border-white/10" />;
}

export default ReportShot;
