// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/init.cpp
/*
 * This is what gets executed to initialize all of the modules.  For
 * the internal modules this involves executing their initialization
 * functions, for external ones it involves reading their .spmodule
 * files and bringing them into Sodipodi.
 *
 * Authors:
 *   Ted Gould <ted@gould.cx>
 *
 * Copyright (C) 2002-2004 Authors
 */
import { _ } from '@inkscape-web/core';
import {
  BlurEdge,
  build_from_mem,
  CairoEpsOutput,
  CairoPsOutput,
  CairoRendererPdfOutput,
  CdrInput,
  Emf,
  ExecutionEnv,
  type Extension,
  Gif,
  GimpGrad,
  Grid,
  LatexOutput,
  OdfOutput,
  PdfInput,
  PngOutput,
  PovOutput,
  Script,
  Svg,
  Svgz,
  setUemfBackendLoader,
  TemplateFromFile,
  TemplateOther,
  TemplatePaper,
  TemplateScreen,
  TemplateSocial,
  TemplateVideo,
  VsdInput,
  WpgInput,
} from '@inkscape-web/editor';
import { load_template_files } from '../app/templates.ts';
import { showMessageDialog } from '../ui/dialog/message-dialog.tsx';
import { PyodideRunner } from './implementation/pyodide-runner.ts';
import { setWorking } from './prefdialog/prefdialog.tsx';

/** The folder of the bundled extensions (upstream INKSCAPE_EXTENSIONDIR). */
const EXTENSIONS_DIR = '/share/extensions';

export const runner = new PyodideRunner();

/**
 * Build the extensions of share/extensions from their .inx files (upstream
 * build_module_from_dir) and set up the Python runner. Python itself loads on the first run.
 */
export async function load_extensions(): Promise<Extension[]> {
  // The internal modules (upstream init()). SVG is built into the file functions of the app.
  Svg.init();
  Svgz.init();
  TemplateFromFile.init();
  TemplatePaper.init();
  TemplateScreen.init();
  TemplateVideo.init();
  TemplateSocial.init();
  TemplateOther.init();
  CairoRendererPdfOutput.init();
  CairoPsOutput.init();
  CairoEpsOutput.init();
  PdfInput.init();
  CdrInput.init();
  VsdInput.init();
  WpgInput.init();
  PngOutput.init();
  PovOutput.init();
  OdfOutput.init();
  LatexOutput.init();
  Gif.init();
  // EMF and WMF: libuemf and the upstream import in their own WASM module, loaded on first use.
  setUemfBackendLoader(() => import('@inkscape-web/wasm/uemf').then((m) => m.loadUemf()));
  Emf.init();
  // Effects
  BlurEdge.init();
  GimpGrad.init();
  Grid.init();
  // The template files (the template folder) for the templates that list files.
  await load_template_files();

  Script.runner = runner;
  Script.on_message = (message, data) =>
    void showMessageDialog({
      title: _('Extension'),
      message: data ? `${message}\n\n${data}` : message,
      buttons: [{ id: 'ok', label: _('_OK') }],
      cancel: 'ok',
      default: 'ok',
    });
  let running: string | null = null;
  let loading = '';
  const update = () => setWorking(running && (loading || _("Running '%s'...").replace('%s', running)));
  ExecutionEnv.on_working = (effect, on) => {
    running = on ? effect.get_name() : null;
    update();
  };
  runner.on_status = (text) => {
    loading = text;
    update();
  };

  const index = await fetch(`${EXTENSIONS_DIR}/index.json`);
  if (!index.ok) return [];
  const files = (await index.json()) as string[];
  const texts = await Promise.all(
    files.map(async (f) => {
      const response = await fetch(`${EXTENSIONS_DIR}/${f}`);
      return response.ok ? ([f, await response.text()] as const) : null;
    }),
  );
  const modules: Extension[] = [];
  for (const entry of texts) {
    if (!entry) continue;
    const module = build_from_mem(entry[1], null, `${EXTENSIONS_DIR}/${entry[0]}`);
    if (!module) continue;
    // Extensions whose dependencies are not met are not shown (upstream check_extensions).
    if (!module.check()) module.deactivate();
    else modules.push(module);
  }
  return modules;
}
