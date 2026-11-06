// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/rvng-import-dialog.cpp, src/extension/internal/rvng-import-dialog.h
/*
 * Common import dialog for .cdr and .vss files, and rvng_open() of the librevenge inputs.
 *
 * The parsers (librevenge with libcdr, libvisio and libwpg) run in revenge-module.wasm of
 * @inkscape-web/wasm. The app sets its loader; the module loads on the first import.
 */
import { _, SPDocument } from '@inkscape-web/core';
import { Rect } from '@inkscape-web/geom';
import { Input } from '../input.ts';

/** The librevenge parsers: the SVG text of each page, or null if the data is not supported. */
export interface RevengeBackend {
  cdrParse(bytes: Uint8Array): string[] | null;
  vsdParse(bytes: Uint8Array): string[] | null;
  wpgParse(bytes: Uint8Array): string[] | null;
}

let backend: RevengeBackend | null = null;
let loader: (() => Promise<RevengeBackend>) | null = null;

/** Set the function that loads the parsers on the first import (the app or a test sets it). */
export function setRevengeBackendLoader(load: (() => Promise<RevengeBackend>) | null): void {
  loader = load;
  backend = null;
}

/** The parsers, loaded on the first call; null if there is no loader or it fails. */
export async function ensureRevengeBackend(): Promise<RevengeBackend | null> {
  if (backend || !loader) return backend;
  try {
    backend = await loader();
  } catch (e) {
    console.error(e);
  }
  return backend;
}

const SVG_HEADER =
  '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n';

/** The XML header and doctype that upstream puts before the SVG of a page. */
export function rvng_svg_document(page: string): string {
  return SVG_HEADER + page;
}

/**
 * Set a viewBox if the document has none: scales the document to account for 72dpi scaling in
 * librevenge(<=0.0.4). Upstream repeats this in rvng_open() and WpgInput::open().
 */
export function rvng_set_viewbox(doc: SPDocument): void {
  const root = doc.getRoot();
  if (root.viewBox_set) return;
  const width = root.width.value;
  const height = root.height.value;
  doc.setWidthAndHeight(width, 'pt', height, 'pt', false);
  doc.setViewBox(Rect.fromXywh(0, 0, width, height));
}

/**
 * The page selector (upstream RvngImportDialog) without its widgets: the web dialog shows this
 * state.
 */
export class RvngImportDialog {
  /** Show the dialog; true for OK. The app sets it (upstream: INKSCAPE.use_gui()). */
  static show_dialog: ((dialog: RvngImportDialog) => Promise<boolean>) | null = null;

  /** Current selected page (1-based). */
  _current_page = 1;

  /** pages: the SVG documents of the pages (with the XML header). */
  constructor(readonly _pages: readonly string[]) {}

  get num_pages(): number {
    return this._pages.length;
  }

  getSelectedPage(): number {
    return this._current_page;
  }

  /** The label after the page number (upstream _labelTotalPages). */
  totalPagesLabel(): string {
    return _('out of %1').replace('%1', String(this.num_pages));
  }

  /** The page number changed (upstream _onPageNumberChanged). */
  setPageNumber(page: number): void {
    this._current_page = Math.min(Math.max(Math.trunc(page), 1), this.num_pages);
  }

  /**
   * The SVG of the preview (upstream _setPreviewPage): the current page, or a "No preview"
   * drawing if the page is not a document.
   */
  previewSvg(): string {
    const page = this._pages[this._current_page - 1]!;
    if (SPDocument.createNewDocFromMem(page)) return page;
    console.warn(`CDR import: Could not create preview for page ${this._current_page}`);
    return `
           <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>
               <path d='M 82,10 18,74 m 0,-64 64,64' style='fill:none;stroke:#ff0000;stroke-width:2px;'/>
               <rect x='18' y='10' width='64' height='64' style='fill:none;stroke:#000000;stroke-width:1.5px;'/>
               <text x='50' y='92' style='font-size:10px;text-anchor:middle;font-family:sans-serif;'>${_('No preview')}</text>
           </svg>
        `;
  }
}

/**
 * Open the data with a librevenge parser: the only page, or the page that the user selects in
 * the dialog. Null if the data is not supported or the parser fails; throws
 * Input.open_cancelled if the user cancels.
 */
export async function rvng_open(
  data: Uint8Array,
  parse: (backend: RevengeBackend, data: Uint8Array) => string[] | null,
): Promise<SPDocument | null> {
  const parsers = await ensureRevengeBackend();
  if (!parsers) return null;

  const output = parse(parsers, data);
  if (!output?.length) return null;

  const tmpSVGOutput = output.map(rvng_svg_document);

  let page_num = 1;

  // If only one page is present, import that one without bothering user
  if (tmpSVGOutput.length > 1 && RvngImportDialog.show_dialog) {
    const dlg = new RvngImportDialog(tmpSVGOutput);
    if (!(await RvngImportDialog.show_dialog(dlg))) throw new Input.open_cancelled();

    // Get needed page
    page_num = Math.min(Math.max(dlg.getSelectedPage(), 1), tmpSVGOutput.length);
  }

  const doc = SPDocument.createNewDocFromMem(tmpSVGOutput[page_num - 1]!);
  if (doc) rvng_set_viewbox(doc);
  return doc;
}
