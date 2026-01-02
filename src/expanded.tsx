import React from 'react';
import { createRoot } from 'react-dom/client';
import './polyfills';
import ExpandedApp from './ExpandedApp';
import './index.css';
import { addressBook } from './utils/addressBook';

// Initialize address book
addressBook.init();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ExpandedApp />
  </React.StrictMode>
);