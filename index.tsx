
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import AppPreviewLayout from './components/AppPreviewLayout';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppPreviewLayout>
        <App />
      </AppPreviewLayout>
    </ErrorBoundary>
  </React.StrictMode>
);
