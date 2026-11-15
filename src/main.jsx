import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './auth.jsx';
import './index.css';
import { guardNumberWheel } from './lib/numberWheel.js';

// A mouse-wheel turn over a number box must never change the figure typed in it.
guardNumberWheel();

// HashRouter keeps client-side routing working with no backend SPA-fallback config.
ReactDOM.createRoot(document.getElementById('root')).render(
  <HashRouter>
    <AuthProvider>
      <App />
    </AuthProvider>
  </HashRouter>
);
