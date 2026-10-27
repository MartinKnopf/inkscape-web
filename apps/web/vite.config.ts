// SPDX-License-Identifier: GPL-2.0-or-later
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Upstream data (icons, palettes, translations, ...) from @inkscape-web/assets.
  publicDir: '../../packages/assets/dist',
});
