// SPDX-License-Identifier: GPL-2.0-or-later
import { setPathBoolopBackend } from '@inkscape-web/core';
import { loadGeom } from '@inkscape-web/wasm';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { loadLanguage } from './app/language.ts';
import './app/app.css';

// The path operations of the core (booleans, break apart) run in the WASM module.
const [geom] = await Promise.all([loadGeom(), loadLanguage()]);
setPathBoolopBackend(geom);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
