import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './polyfills';
import App from './App.tsx';
import './index.css';
import { addressBook } from './utils/addressBook';
import { bootstrapUIStyle } from './components/UIStyleProvider';

// Apply the user's chosen UI style before first paint to avoid FOUC.
bootstrapUIStyle();

// Initialize address book
addressBook.init();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);