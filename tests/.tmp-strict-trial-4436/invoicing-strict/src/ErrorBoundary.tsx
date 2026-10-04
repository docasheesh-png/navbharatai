// PROVIDED AND CORRECT — do not rewrite this file.
//
// It already extends React.Component with its Props/State generics, which is the ONLY thing that
// gives `this.state`, `this.setState` and `this.props` their types. A rewrite that drops the
// `extends` clause compiles to nothing but errors:
//
//     Property 'setState' does not exist on type 'ErrorBoundary'.
//     Property 'props' does not exist on type 'ErrorBoundary'.
//
// That happened to a real user (2026-08-23): the file was replaced, then rewritten three more times,
// each attempt still missing the clause, on an app whose preview was already rendering. If you need
// different fallback UI, edit the markup inside render() — leave the class declaration alone.
import React from 'react';

interface Props { children: React.ReactNode; }
interface State { error: Error | null; }

/** Catches render errors in the tree below so one broken component can't white-screen the whole app. */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) { console.error('App crashed:', error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '40px auto' }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ color: '#666', marginBottom: 16 }}>{this.state.error.message}</p>
          <button onClick={() => this.setState({ error: null })} style={{ padding: '8px 16px', cursor: 'pointer' }}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
export default ErrorBoundary;
