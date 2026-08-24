import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

const ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />,
  error:   <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />,
  info:    <Info className="w-4 h-4 text-indigo-400 flex-shrink-0" />,
  warning: <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />,
};
const COLORS: Record<ToastType, string> = {
  success: 'border-emerald-500/30 bg-emerald-900/20',
  error:   'border-red-500/30 bg-red-900/20',
  info:    'border-indigo-500/30 bg-indigo-900/20',
  warning: 'border-amber-500/30 bg-amber-900/20',
};

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).slice(2);
    // F1/D3: Error/warning toasts stay longer; success also gets 5s to be readable
    const duration = type === 'error' ? 8000 : type === 'warning' ? 6000 : type === 'success' ? 5000 : 4000;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return { toasts, addToast, removeToast };
}

interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onRemove }) => (
  // L5: aria-live so screen readers announce new toasts
  <div role="status" aria-live="polite" aria-atomic="false" className="fixed bottom-20 right-4 z-[500] flex flex-col gap-2 max-w-xs w-full pointer-events-none lg:bottom-6">
    <AnimatePresence>
      {toasts.map(t => (
        <motion.div
          key={t.id}
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.95 }}
          className={`flex items-start gap-3 px-4 py-3 rounded-2xl border backdrop-blur-xl shadow-2xl pointer-events-auto ${COLORS[t.type]}`}
          style={{ background: '#161b22ee' }}
        >
          {ICONS[t.type]}
          <p className="text-[11px] text-white font-medium flex-1 leading-relaxed">{t.message}</p>
          <button
            onClick={() => onRemove(t.id)}
            className="p-0.5 hover:bg-white/10 rounded-md text-white/40 hover:text-white transition-colors flex-shrink-0"
          >
            <X className="w-3 h-3" />
          </button>
        </motion.div>
      ))}
    </AnimatePresence>
  </div>
);
