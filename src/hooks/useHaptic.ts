// React hook for haptic feedback in native shell. Provides tactile feedback on user actions
// (button clicks, form submission). NO-OP on web.

import { triggerHaptic } from '../lib/nativeShell';

/**
 * Hook to provide haptic feedback on user actions in native shell.
 * Returns a function to trigger feedback; NO-OP on web.
 * @param style - Feedback intensity: 'light' (default), 'medium', 'heavy'
 */
export function useHaptic(style: 'light' | 'medium' | 'heavy' = 'light') {
  return async () => {
    // Cast window as NativeShellContext (it has the Capacitor API if on native).
    void triggerHaptic(window as any, style);
  };
}
