// ENTRY POINT — provided and correct. Put routing, context providers and global wrappers inside
// src/App.tsx, NOT here. Keep the ErrorBoundary import and the <ErrorBoundary> wrapper below: the app
// root is already protected, and rewriting this file is what drops the boundary and breaks the build.
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import ErrorBoundary from './ErrorBoundary';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
