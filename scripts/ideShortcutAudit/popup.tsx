import React from 'react';
import { createRoot } from 'react-dom/client';
import './harness.css';
import { VirtualKeyboard } from '../../src/components/ide/VirtualKeyboard';
declare global { interface Window { __fired: Array<{ keys: string[]; command?: string }>; __closed: boolean } }
window.__fired = []; window.__closed = false;
createRoot(document.getElementById('root')!).render(
  <VirtualKeyboard onShortcutTrigger={(keys, command) => { window.__fired.push({ keys, command }); }} onClose={() => { window.__closed = true; }} onToggleCursor={() => {}} />,
);
