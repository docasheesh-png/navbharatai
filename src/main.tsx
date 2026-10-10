import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { BuildProvider } from './components/ide/BuildContext';
import axios from 'axios';
import { auth } from './lib/firebase';

// Keep API authentication centralized so individual billing/security requests
// cannot accidentally fall back to a client-controlled userId.
axios.interceptors.request.use(async (config) => {
  const user = auth.currentUser;
  if (user) {
    const token = await user.getIdToken();
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BuildProvider>
      <App />
    </BuildProvider>
  </StrictMode>,
);
