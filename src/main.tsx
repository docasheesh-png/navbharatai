import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { BuildProvider } from './components/ide/BuildContext';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BuildProvider>
      <App />
    </BuildProvider>
  </StrictMode>,
);
