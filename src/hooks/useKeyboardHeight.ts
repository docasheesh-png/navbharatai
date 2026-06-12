import { useEffect, useState } from 'react';

// Returns the current on-screen keyboard height in px (0 when hidden).
// Uses the VisualViewport API (Safari 13+, Chrome 61+, Firefox 91+).
export function useKeyboardHeight(): number {
  const [kbHeight, setKbHeight] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const kh = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKbHeight(kh);
    };

    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return kbHeight;
}
