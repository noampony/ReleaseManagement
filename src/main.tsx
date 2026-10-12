import React from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  return <main aria-label="Daily R&D Sync" />;
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
