import { useState, useCallback, useEffect } from 'react';

export function useUndoRedo<T>(initial: T, maxHistory = 50) {
  const [history, setHistory] = useState<T[]>([initial]);
  const [index, setIndex] = useState(0);

  const current = history[index];

  const push = useCallback((value: T) => {
    setHistory(prev => {
      const truncated = prev.slice(0, index + 1);
      const next = [...truncated, value].slice(-maxHistory);
      return next;
    });
    setIndex(prev => Math.min(prev + 1, maxHistory - 1));
  }, [index, maxHistory]);

  const undo = useCallback(() => {
    setIndex(prev => Math.max(0, prev - 1));
  }, []);

  const redo = useCallback(() => {
    setIndex(prev => Math.min(history.length - 1, prev + 1));
  }, [history.length]);

  const canUndo = index > 0;
  const canRedo = index < history.length - 1;

  return { current, push, undo, redo, canUndo, canRedo };
}
