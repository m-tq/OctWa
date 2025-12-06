import React from 'react';
import { createRoot } from 'react-dom/client';
import './polyfills';
import ExpandedApp from './ExpandedApp';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ExpandedApp />
  </React.StrictMode>
);