// SPDX-License-Identifier: GPL-2.0-or-later
import {
  setCairoBackendLoader,
  setImagePixelsLoader,
  setPathBoolopBackend,
  setTextLayoutBackend,
  setTraceBackend,
} from '@inkscape-web/core';
import { browser_cairo_renderer_hooks, cairo_renderer_hooks, load_image_pixels } from '@inkscape-web/editor';
import { loadGeom } from '@inkscape-web/wasm';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { add_actions_web } from './app/actions.ts';
import { loadFonts } from './app/fonts.ts';
import { loadLanguage } from './app/language.ts';
import { loadPreferences } from './app/preferences-storage.ts';
import { loadMenu } from './ui/desktop/menubar.tsx';
import { loadShortcuts } from './ui/shortcuts.ts';
import './app/app.css';

// Stored preferences are loaded before anything reads them.
loadPreferences();
// The path operations of the core (booleans, break apart) run in the WASM module.
const [geom] = await Promise.all([loadGeom(), loadLanguage(), loadFonts()]);
setPathBoolopBackend(geom);
// Trace Bitmap and the paint bucket: potrace and the trace filters in WASM, images decoded by the browser.
setTraceBackend(geom);
setImagePixelsLoader(load_image_pixels);
// PDF, PS and EPS export: cairo in its own WASM module, loaded on the first export.
setCairoBackendLoader(() => import('@inkscape-web/wasm/cairo').then((m) => m.loadCairo()));
cairo_renderer_hooks.current = browser_cairo_renderer_hooks;
// Text layout: wrap shapes, the scanline maker and text on path use livarot.
setTextLayoutBackend(geom);
add_actions_web();
await Promise.all([loadShortcuts(), loadMenu()]);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
