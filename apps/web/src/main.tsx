// SPDX-License-Identifier: GPL-2.0-or-later
import { setPathBoolopBackend } from '@inkscape-web/core';
import { loadGeom } from '@inkscape-web/wasm';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { add_actions_web } from './app/actions.ts';
import { loadLanguage } from './app/language.ts';
import { loadMenu } from './ui/desktop/menubar.tsx';
import { loadShortcuts } from './ui/shortcuts.ts';
import './app/app.css';

// The path operations of the core (booleans, break apart) run in the WASM module.
const [geom] = await Promise.all([loadGeom(), loadLanguage()]);
setPathBoolopBackend(geom);
add_actions_web();
await Promise.all([loadShortcuts(), loadMenu()]);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
