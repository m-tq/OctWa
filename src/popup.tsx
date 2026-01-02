import React from 'react';
import { createRoot } from 'react-dom/client';
import './polyfills';
import PopupApp from './PopupApp';
import './index.css';
import { addressBook } from './utils/addressBook';

// Initialize address book
addressBook.init();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PopupApp />
  </React.StrictMode>
);