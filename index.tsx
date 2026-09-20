import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initializeOffline } from './services/offlineService';
import { registerWorkspaceOfflineGuard } from './services/workspaceOfflineGuard';
import { ErrorBoundary } from './components/core';
import {
  applyAppearancePreferences,
  loadAppearancePreferences,
} from './services/appearancePreferences';

// Apply the saved preference before React mounts so the shell does not flash the wrong
// palette or reading scale. The preview iframe has its own document and is intentionally
// unaffected by these root attributes.
applyAppearancePreferences(loadAppearancePreferences());
registerWorkspaceOfflineGuard();
void initializeOffline();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

const root = createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
