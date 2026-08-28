import { Component, ErrorInfo, ReactNode } from "react";

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
    // P2.2 — report React render errors to the backend error tracker (→ Cloud Error
    // Reporting + admin view). Best-effort, production-only, never throws.
    if (import.meta.env?.PROD) {
      try {
        fetch('/api/logs/error', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: error.message,
            type: 'react-render',
            stack: (error.stack || '').slice(0, 2000),
            // A repeat tells us this is a HARD failure, not a blip — the difference between an error
            // worth a glance and one that is trapping a real user right now.
            retries: this.state.retries,
            source: (errorInfo.componentStack || '').slice(0, 1000),
            url: typeof window !== 'undefined' ? window.location.href : undefined,
            ts: Date.now(),
          }),
        }).catch(() => {});
      } catch { /* reporting must never break the fallback UI */ }
    }
  }

  public render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="flex-1 flex items-center justify-center bg-[#0d1117] p-8">
          <div className="max-w-sm w-full bg-[#161b22] border border-red-500/20 rounded-2xl p-6 text-center space-y-4">
            <div className="w-12 h-12 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto">
              <span className="text-red-400 text-2xl">⚠</span>
            </div>
            <div>
              <h2 className="text-sm font-black text-white uppercase tracking-widest">Something went wrong</h2>
              <p className="text-[10px] text-[#484f58] font-bold uppercase tracking-wider mt-1">{this.state.errorMessage || 'An unexpected error occurred'}</p>
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
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-all"
                onClick={() => this.setState({ hasError: false, errorMessage: '', retries: 1 })}
              >
                Try Again
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-[10px] text-[#8b949e] font-semibold">
                  Retrying did not help — this screen keeps failing.
                </p>
                <button
                  className="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-all"
                  onClick={() => { try { window.location.href = '/'; } catch { /* nothing else to try */ } }}
                >
                  Go to the home page
                </button>
                <button
                  className="w-full px-4 py-2 bg-white/5 hover:bg-white/10 text-[#8b949e] text-xs font-bold rounded-xl transition-all"
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
