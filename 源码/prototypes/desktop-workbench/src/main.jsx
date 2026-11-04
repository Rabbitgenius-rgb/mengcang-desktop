import React from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './ErrorBoundary.jsx';
import StandaloneApp from './StandaloneApp.jsx';
import './workspaceReset.css';
createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <StandaloneApp />
  </ErrorBoundary>,
);
