import { Component, ErrorInfo, ReactNode } from "react";
import { recordError } from "../lib/observability";

/** The innermost component named in a React component stack, e.g. "BillingPanel". Never props. */
export function firstComponent(componentStack: string | null | undefined): string {
  const m = /^\s*(?:at\s+)?([A-Z][A-Za-z0-9_$]{0,60})/m.exec(componentStack ?? '');
  return m ? m[1] : 'unknown';
}

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
  /**
   * How many times the user has pressed Try Again on this boundary.
   *
   * Deliberately NOT reset when the error clears: the question it answers is "has retrying already
   * failed here", and that is only knowable across attempts.
   */
  retries: number;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = { hasError: false, errorMessage: '', retries: 0 };

  // Returns a PARTIAL state on purpose — `retries` must survive, or the escape below could never
  // appear no matter how many times the same screen failed.
  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, errorMessage: error.message };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught:", error.message, errorInfo.componentStack);
    // P2.2 — through the ONE reporter (src/lib/observability): sanitized, deduplicated, rate-limited,
    // production-only and unable to throw. In the phone apps this is also a Crashlytics non-fatal.
    // `retries` says whether this is a HARD failure (a retry already failed) or a first blip; the
    // component stack names WHICH screen broke without carrying any of its data.
    recordError(error, {
      kind: 'react-render',
      url: typeof window !== 'undefined' ? window.location.href : undefined,
      keys: { retries: this.state.retries, component: firstComponent(errorInfo.componentStack) },
    });
  }

  public render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="flex-1 flex items-center justify-center bg-surface p-8">
          <div className="max-w-sm w-full bg-card border border-red-500/20 rounded-2xl p-6 text-center space-y-4">
            <div className="w-12 h-12 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto">
              <span className="text-danger text-2xl">⚠</span>
            </div>
            <div>
              <h2 className="text-sm font-black text-ink uppercase tracking-widest">Something went wrong</h2>
              <p className="text-[10px] text-faint font-bold uppercase tracking-wider mt-1">This screen hit an unexpected error.</p>
            </div>
            {/* 🔒 A RETRY THAT CANNOT WORK MUST NOT BE THE ONLY WAY OUT (admin 2026-08-27).
                This button used to do one thing: clear the flag and re-render THE SAME children, with
                the same props and the same data. For a deterministic crash — a value of the wrong
                shape, a missing field, anything that is a property of the data rather than of the
                moment — that is guaranteed to fail again, immediately, every time. The admin's words:
                "kitna bhi re try karo, kuch nahi hota — app band karni padti hai." Killing the app was
                genuinely the only exit, and that is on this screen, not on them.

                Retrying is still offered FIRST, because some render errors really are transient. But
                once a retry has failed, the honest thing is to stop offering the move that just did
                not work and offer one that actually escapes: leaving for Home. That is a full reload
                AND a different route, so neither the in-memory state nor the view that crashed
                survives it. A plain reload would not do — views live in the query string, so it would
                land straight back on the screen that broke. */}
            {this.state.retries === 0 ? (
              <button
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-on-accent text-xs font-bold rounded-xl transition-all"
                onClick={() => this.setState({ hasError: false, errorMessage: '', retries: 1 })}
              >
                Try Again
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-[10px] text-muted font-semibold">
                  Retrying did not help — this screen keeps failing.
                </p>
                <button
                  className="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-on-accent text-xs font-bold rounded-xl transition-all"
                  onClick={() => { try { window.location.href = '/'; } catch { /* nothing else to try */ } }}
                >
                  Go to the home page
                </button>
                <button
                  className="w-full px-4 py-2 bg-raised hover:bg-raised-hover text-muted text-xs font-bold rounded-xl transition-all"
                  onClick={() => this.setState({ hasError: false, errorMessage: '', retries: this.state.retries + 1 })}
                >
                  Try again anyway
                </button>
              </div>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
