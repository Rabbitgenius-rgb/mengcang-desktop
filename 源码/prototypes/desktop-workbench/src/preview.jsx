import React from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './ErrorBoundary.jsx';
import SublimeWorkspace from './sublime/SublimeWorkspace.jsx';
import './workspaceReset.css';
const identity = { id: 'mengcang-isolated-preview-v1' };
createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <SublimeWorkspace identity={identity} standalone />
  </ErrorBoundary>,
);
