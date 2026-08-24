import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = { hasError: false, errorMessage: '' };

  public static getDerivedStateFromError(error: Error): State {
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
            <button
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-all"
              onClick={() => this.setState({ hasError: false, errorMessage: '' })}
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
