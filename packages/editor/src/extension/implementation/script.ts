// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/implementation/script.cpp, src/extension/implementation/script.h
/*
 * Code for handling extensions (i.e. scripts).
 *
 * Authors:
 *   Bryce Harrington <bryce@osdl.org>
 *   Ted Gould <ted@gould.cx>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2002-2007 Authors
 */
import { _, readMem, SPDocument, type SPPage, SVG_NS_URI, saveBuf } from '@inkscape-web/core';
import { type SPDesktop, sp_namedview_document_from_window } from '../../desktop.ts';
import type { Effect } from '../effect.ts';
import type { ExecutionEnv } from '../execution-env.ts';
import type { Extension } from '../extension.ts';
import type { Input } from '../input.ts';
import type { Output } from '../output.ts';
import { INKSCAPE_EXTENSION_NS } from '../prefdialog/widget.ts';
import type { Template } from '../template.ts';
import { Implementation } from './implementation.ts';

/** The program of a script extension: its interpreter ("python", ...) and script path. */
export interface ScriptCommand {
  interpreter: string | null;
  /** The path of the script (in the browser: below /share/extensions). */
  script: string;
}

/** The result of running a script. */
export interface ScriptResult {
  stdout: Uint8Array;
  stderr: string;
  /** Set when the script could not run at all (no interpreter, ...). */
  error?: string;
}

/**
 * Runs the scripts (upstream Script::execute, which spawns the interpreter). The web app sets
 * one that runs Python in Pyodide. argv is upstream's: the parameters, then the input file,
 * which the runner writes as a temporary file with the content input.
 */
export interface ScriptRunner {
  execute(
    command: ScriptCommand,
    params: readonly string[],
    input: Uint8Array | null,
    env: Readonly<Record<string, string>>,
  ): Promise<ScriptResult>;
}

/** Shows the messages of the scripts (upstream showPopupError and gui_warning). */
export type ScriptMessageHandler = (message: string, data: string) => void;

/**
 * The implementation of the script extensions (upstream Script): runs the script with the
 * document as a temporary file and replaces the document with the output.
 * TODO: pipe-diffs, raster export, the command line argument file.
 */
export class Script extends Implementation {
  /** The runner of all scripts; null until the web app sets it. */
  static runner: ScriptRunner | null = null;
  /** Where the messages go; the console by default. */
  static on_message: ScriptMessageHandler = (message, data) => console.warn(`${message}\n${data}`);

  command: ScriptCommand | null = null;
  /** The extension that opens or saves the script output (upstream helper_extension). */
  helper_extension = '';

  /** Find the command in the <script> element (upstream load). */
  override load(module: Extension): boolean {
    if (module.loaded()) return true;
    this.helper_extension = '';
    for (const child_repr of module.get_repr().children()) {
      if (child_repr.name() !== `${INKSCAPE_EXTENSION_NS}script`) continue;
      for (const child of child_repr.children()) {
        if (child.name() === `${INKSCAPE_EXTENSION_NS}command`) {
          const script_name = child.firstChild()?.content();
          if (script_name)
            this.command = {
              interpreter: child.attribute('interpreter'),
              script: module.get_dependency_location(script_name),
            };
        } else if (child.name() === `${INKSCAPE_EXTENSION_NS}helper_extension`) {
          this.helper_extension = child.firstChild()?.content() ?? '';
        }
      }
      break;
    }
    return this.command !== null;
  }

  /** Scripts run in Python only (the interpreter of the browser). */
  override check(module: Extension): boolean {
    this.load(module);
    return (
      this.command !== null && (this.command.interpreter === null || this.command.interpreter === 'python')
    );
  }

  /** The environment of the script (upstream Extension::set_environment). */
  static environment(module: Extension, doc: SPDocument | null): Record<string, string> {
    const env: Record<string, string> = {
      // This is needed if an extension calls inkscape itself
      SELF_CALL: 'true',
    };
    // This is needed so files can be saved relative to their document location (see image-extract)
    if (doc) env.DOCUMENT_PATH = doc.documentFilename ?? '';
    if (module._translationdomain) env.INKEX_GETTEXT_DOMAIN = module._translationdomain;
    return env;
  }

  /**
   * Run the script with params and the input file; the output, or null if it did not run or was
   * canceled (upstream execute). The text of stderr goes to the message handler unless ignored.
   */
  async execute(
    module: Extension,
    params: readonly string[],
    input: Uint8Array | null,
    doc: SPDocument | null,
    ignore_stderr = false,
  ): Promise<Uint8Array | null> {
    if (!this.command && !this.load(module)) return null;
    const runner = Script.runner;
    if (!runner || !this.command) {
      Script.on_message(_('Could not run the extension.'), _('No script interpreter is available.'));
      return null;
    }
    const result = await runner.execute(this.command, params, input, Script.environment(module, doc));
    if (result.error) {
      Script.on_message(_('Could not run the extension.'), result.error);
      return null;
    }
    if (result.stderr && !ignore_stderr) {
      Script.on_message(
        _(
          'Inkscape has received additional data from the script executed.  The script did not return an error, but this may indicate the results will not be as expected.',
        ),
        result.stderr,
      );
    }
    return result.stdout;
  }

  /** Run a template script on the template file; its SVG output as a new document (upstream new_from_template). */
  override async new_from_template(module: Template): Promise<SPDocument | null> {
    const params: string[] = [];
    module.paramListString(params);
    const source = module.get_template_source();
    if (source === null) return null;
    const out = await this.execute(module, params, new TextEncoder().encode(source), null);
    if (!out || out.length === 0) return null;
    return SPDocument.createNewDocFromMem(new TextDecoder().decode(out));
  }

  /** Take an existing document and selected page and resize or add items as needed. */
  override async resize_to_template(module: Template, doc: SPDocument, page: SPPage | null): Promise<void> {
    // No page means 'resize the svg document'
    const id = page ? page.getId() : doc.getRoot().getId();
    await this._change_extension(module, doc, [`--page=${id}`], true);
  }

  override async effect(
    module: Effect,
    _executionEnv: ExecutionEnv | null,
    desktop: SPDesktop | null,
    document: SPDocument,
  ): Promise<void> {
    if (desktop) sp_namedview_document_from_window(desktop);

    if (module.no_doc) {
      // this is a no-doc extension, e.g. a Help menu command;
      // just run the command without any files, ignoring errors
      const params: string[] = [];
      module.paramListString(params);
      await this.execute(module, params, null, document, module.ignore_stderr);
      return;
    }

    const params: string[] = [];
    if (desktop) {
      // Add selected object IDs
      for (const id of desktop.getSelection().getState().selected_ids) params.push(`--id=${id}`);
    }
    await this._change_extension(module, document, params, module.ignore_stderr);
  }

  /**
   * Run the script on the document and replace the document with the output (upstream
   * _change_extension).
   */
  async _change_extension(
    module: Extension,
    doc: SPDocument,
    params: string[],
    ignore_stderr: boolean,
  ): Promise<void> {
    module.paramListString(params);
    // Save current document to a temporary file we can send to the extension
    const input = new TextEncoder().encode(saveBuf(doc.getReprDoc(), SVG_NS_URI));
    const data = await this.execute(module, params, input, doc, ignore_stderr);
    if (!data || data.length === 0) return;

    const new_xmldoc = data.length > 10 ? readMem(new TextDecoder().decode(data), SVG_NS_URI) : null;
    if (new_xmldoc) doc.rebase(new_xmldoc);
    else Script.on_message(_('The output from the extension could not be parsed.'), '');
  }

  /** Run an input script on the file; its SVG output as a document (upstream open). */
  override async open(module: Input, _name: string, data: Uint8Array): Promise<SPDocument | null> {
    const params: string[] = [];
    module.paramListString(params);
    const out = await this.execute(module, params, data, null);
    if (!out || out.length <= 10) return null;
    // TODO: open the output with the helper extension.
    return SPDocument.createNewDocFromMem(new TextDecoder().decode(out));
  }

  /** Run an output script on the document; the file data (upstream save). */
  override async save(module: Output, doc: SPDocument, _name: string): Promise<Uint8Array | null> {
    const params: string[] = [];
    module.paramListString(params);
    const input = new TextEncoder().encode(saveBuf(doc.getReprDoc(), SVG_NS_URI));
    const out = await this.execute(module, params, input, doc);
    return out && out.length > 0 ? out : null;
  }
}
