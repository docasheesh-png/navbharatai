import { useState, useCallback } from 'react';

export function useUndoRedo<T>(initial: T, maxHistory = 50) {
  const [state, setState] = useState<{ history: T[]; index: number }>({
    history: [initial],
    index: 0,
  });

  const current = state.history[state.index];

  // Single atomic state update — no stale-closure race between setHistory + setIndex
  const push = useCallback((value: T) => {
    setState(prev => {
      const truncated = prev.history.slice(0, prev.index + 1);
      const next = [...truncated, value].slice(-maxHistory);
      return { history: next, index: next.length - 1 };
    });
  }, [maxHistory]);

  const undo = useCallback(() => {
    setState(prev =>
      prev.index > 0 ? { ...prev, index: prev.index - 1 } : prev
    );
  }, []);

  const redo = useCallback(() => {
    setState(prev =>
      prev.index < prev.history.length - 1
        ? { ...prev, index: prev.index + 1 }
        : prev
    );
  }, []);

  const canUndo = state.index > 0;
  const canRedo = state.index < state.history.length - 1;

  return { current, push, undo, redo, canUndo, canRedo };
}
