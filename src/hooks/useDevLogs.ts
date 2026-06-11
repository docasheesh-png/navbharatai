// useDevLogs — isolated developer log state (Task 1.1 module extraction)
import { useState, useCallback } from 'react';
import type { Log } from '../types';

const INITIAL_LOGS: Log[] = [
  { id: '1', text: 'Navbharat Kernel initialized.', type: 'info', timestamp: new Date() },
  { id: '2', text: 'Virtual File System mounted.', type: 'success', timestamp: new Date() },
  { id: '3', text: 'AI Engines ready for deployment.', type: 'info', timestamp: new Date() },
];

export function useDevLogs() {
  const [logs, setLogs] = useState<Log[]>(INITIAL_LOGS);

  const addLog = useCallback((text: string, type: Log['type'] = 'info') => {
    setLogs(prev => [
      ...prev.slice(-49),
      { id: Math.random().toString(), text, type, timestamp: new Date() },
    ]);
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);

  return { logs, setLogs, addLog, clearLogs };
}
