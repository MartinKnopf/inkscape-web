// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/pdfinput/pdf-input.cpp, src/extension/internal/pdfinput/pdf-input.h, src/extension/internal/pdfinput/enums.h
/*
 * Native PDF import using libpoppler.
 *
 * Authors:
 *   miklos erdelyi
 *   Abhishek Sharma
 *
 * Copyright (C) 2007 Authors
 */
import {
  _,
  C_,
  cairoBackend,
  convertUnit,
  ensureCairoBackend,
  N_,
  type PdfFontData,
  parseIntRange,
  SPDocument,
} from '@inkscape-web/core';
import { Rect } from '@inkscape-web/geom';
import type { Extension } from '../../extension.ts';
import { Implementation } from '../../implementation/implementation.ts';
import { Input } from '../../input.ts';
import { INKSCAPE_EXTENSION_URI } from '../../prefdialog/widget.ts';
import { build_from_mem } from '../../system.ts';

/** Upstream enums.h GroupBy. */
export enum GroupBy {
  BY_XOBJECT = 0,
  BY_OCGS,
}

/** Upstream enums.h FontStrategy: how the fonts of the whole document are handled. */
export enum FontStrategy {
  RENDER_MISSING,
  RENDER_ALL,
  SUBSTITUTE_MISSING,
  KEEP_MISSING,
  DELETE_MISSING,
  DELETE_ALL,
}

/** Upstream enums.h FontFallback: what happens to the text of one font. */
export enum FontFallback {
  DELETE_TEXT = 0,
  AS_SHAPES,
  AS_TEXT,
  AS_SUB,
}

/** {font id: FontFallback} (upstream FontStrategies). */
export type FontStrategies = Map<number, FontFallback>;

/** Upstream PdfImportType: the tabs of the dialog. */
export enum PdfImportType {
  PDF_IMPORT_INTERNAL,
  PDF_IMPORT_CAIRO,
}

export function pref_to_font_strategy(value: string): FontStrategy {
  switch (value) {
    case 'render-missing':
      return FontStrategy.RENDER_MISSING;
    case 'substitute':
      return FontStrategy.SUBSTITUTE_MISSING;
    case 'keep-missing':
      return FontStrategy.KEEP_MISSING;
    case 'delete-missing':
      return FontStrategy.DELETE_MISSING;
    case 'render-all':
      return FontStrategy.RENDER_ALL;
    case 'delete-all':
      return FontStrategy.DELETE_ALL;
  }
  console.warn(`Unknown fontRendering option '${value}'`);
  return FontStrategy.SUBSTITUTE_MISSING;
}

/** The poppler error messages of PdfInput::open(). */
function pdf_error_message(error: number): string {
  switch (error) {
    case 4: // errEncrypted
      return 'Document is encrypted.';
    case 1: // errOpenFile
      return "couldn't open the PDF file.";
    case 2: // errBadCatalog
      return "couldn't read the page catalog.";
    case 3: // errDamaged
      return "PDF file was damaged and couldn't be repaired.";
    case 5: // errHighlightFile
      return 'nonexistent or invalid highlight file.';
    case 6: // errBadPrinter
      return 'invalid printer.';
    case 7: // errPrinting
      return 'Error during printing.';
    case 8: // errPermission
      return 'PDF file does not allow that operation.';
    case 9: // errBadPageNum
      return 'invalid page number.';
    case 10: // errFileIO
      return 'file IO error.';
    default:
      return `Failed to load document from data (error ${error})`;
  }
}

/** A row of the font list of the dialog (upstream FontModelColumns). */
export interface PdfFontRow {
  id: number;
  family: string;
  style: string;
  weight: string;
  stretch: string;
  proc_label: string;
  proc_id: FontFallback;
  icon: string;
}

/** The label of a font strategy (upstream setFontStrategies). */
export function font_fallback_label(value: FontFallback): string {
  switch (value) {
    case FontFallback.AS_SHAPES:
      return _('Convert to paths');
    case FontFallback.AS_TEXT:
      return _('Keep original font name');
    case FontFallback.AS_SUB:
      return _('Replace by closest-named installed font');
    case FontFallback.DELETE_TEXT:
      return _('Delete text');
  }
}

/**
 * The PDF import dialog (upstream PdfImportDialog) without its widgets: the web dialog shows
 * this state. The settings are the parameters of the input extension (mod).
 */
export class PdfImportDialog {
  readonly _total_pages: number;
  _current_pages = 'all';
  _preview_page = 1;
  _import_method = PdfImportType.PDF_IMPORT_INTERNAL;
  readonly _font_list: PdfFontData[];
  readonly _font_model: PdfFontRow[] = [];

  constructor(
    readonly _handle: number,
    readonly _mod: Input,
  ) {
    const c = cairoBackend();
    this._total_pages = c.pdfPageCount(_handle);
    this._font_list = c.pdfFonts(_handle);
    this._setFonts(this._font_list);
    // Update the font list with this as the default
    this.setFontStrategies(this.#autoFontStrategies(pref_to_font_strategy(this.getFontRendering())));
  }

  #autoFontStrategies(s: FontStrategy): FontStrategies {
    const map = cairoBackend().pdfAutoFontStrategies(this._handle, s);
    return new Map(Object.entries(map).map(([k, v]) => [Number(k), v as FontFallback]));
  }

  /** The page selector is used only with more than one page. */
  pageNumbersSensitive(): boolean {
    return this._total_pages > 1;
  }

  getImportPages(): boolean {
    return this._mod.get_param_bool('importPages');
  }

  getSelectedPages(): string {
    return this.pageNumbersSensitive() ? this._current_pages : 'all';
  }

  getImportMethod(): PdfImportType {
    return this._import_method;
  }

  /** The tab changed (upstream _onNotebookPageChanged); whether OK is sensitive. */
  setImportMethod(method: PdfImportType): boolean {
    this._import_method = method;
    if (method === PdfImportType.PDF_IMPORT_INTERNAL) {
      return parseIntRange(this._current_pages, 1, this._total_pages).length > 0;
    }
    return true;
  }

  /**
   * The page entry changed (upstream _onPageNumberChanged): previews the first page; returns
   * whether the input is valid (then OK is sensitive).
   */
  setPageNumbers(text: string): boolean {
    this._current_pages = text;
    const nums = parseIntRange(this._current_pages, 1, this._total_pages);
    if (nums.length) this._preview_page = nums[0]!;
    return nums.length > 0;
  }

  /** Show another page in the preview (the previous and next buttons). */
  setPreviewPage(page: number): void {
    this._preview_page = Math.min(Math.max(page, 1), this._total_pages);
  }

  /** The preview of the page at most width x height (upstream _setPreviewPage). */
  previewImage(width = 200, height = 300): { width: number; height: number; data: Uint8Array } | null {
    return cairoBackend().pdfRenderPage(this._handle, this._preview_page, width, height);
  }

  /** "page / total" (upstream: the label of the preview). */
  previewLabel(): string {
    return `${this._preview_page} / ${this._total_pages}`;
  }

  /** Set a full list of all fonts in use for the whole PDF document (upstream _setFonts). */
  _setFonts(fonts: readonly PdfFontData[]): void {
    this._font_model.length = 0;
    for (const data of fonts) {
      this._font_model.push({
        id: data.id,
        family: data.family ? data.family : `${data.name} -> ${data.substitute}`,
        style: data.style,
        weight: data.weight,
        stretch: data.stretch,
        proc_label: '',
        proc_id: FontFallback.AS_TEXT,
        icon: data.cid ? 'text-convert-to-regular' : data.found ? 'on' : 'off-outline',
      });
    }
  }

  /** Saves each decided font strategy to the Svg Builder object (upstream getFontStrategies). */
  getFontStrategies(): FontStrategies {
    return new Map(this._font_model.map((row) => [row.id, row.proc_id]));
  }

  /** Update the font strats (upstream setFontStrategies). */
  setFontStrategies(fs: FontStrategies): void {
    for (const row of this._font_model) {
      const value = fs.get(row.id) ?? FontFallback.AS_TEXT;
      row.proc_id = value;
      row.proc_label = font_fallback_label(value);
    }
  }

  /** The strategy of one font changed (upstream: the cell-strat combo). */
  setFontStrategy(id: number, value: FontFallback): void {
    const row = this._font_model.find((r) => r.id === id);
    if (!row) return;
    row.proc_id = value;
    row.proc_label = font_fallback_label(value);
  }

  getFontRendering(): string {
    return this._mod.get_param_optiongroup('fontRendering');
  }

  /** The global font rendering changed: reset any font specific items with the new strategy. */
  setFontRendering(value: string): void {
    this._mod.set_param_optiongroup('fontRendering', value);
    this.setFontStrategies(this.#autoFontStrategies(pref_to_font_strategy(value)));
  }

  /** The comment on the approximation precision (upstream: the mesh slider labels). */
  meshLabel(value = this._mod.get_param_float('approximationPrecision')): string {
    const labels = [
      C_('PDF input precision', 'rough'),
      C_('PDF input precision', 'medium'),
      C_('PDF input precision', 'fine'),
      C_('PDF input precision', 'very fine'),
    ];
    // Evenly divides the interval of possible values between the available labels
    // (the range of the mesh-precision adjustment of extension-pdfinput.glade).
    const min = 1;
    const max = 246;
    const comment_idx = Math.floor(((value - min) / (max - min)) * 4.0);
    return labels[Math.min(comment_idx, 3)]!;
  }
}

/** A local font for the font matching of the import. */
export interface PdfLocalFont {
  family: string;
  style: string;
  postscriptName: string;
}

/** Native PDF import using libpoppler (upstream PdfInput). */
export class PdfInput extends Implementation {
  /** Show the dialog; true for OK. The app sets it (upstream: INKSCAPE.use_gui()). */
  static show_dialog: ((dialog: PdfImportDialog) => Promise<boolean>) | null = null;
  /** The installed fonts for the font matching (upstream: fontconfig). The app sets it. */
  static local_fonts: (() => Promise<PdfLocalFont[]>) | null = null;

  override check(_module: Extension): boolean {
    return true;
  }

  /** Parses the selected pages of the given PDF document using PdfParser (upstream open). */
  override async open(mod: Input, uri: string, data: Uint8Array): Promise<SPDocument | null> {
    if (!(await ensureCairoBackend())) return null;
    const c = cairoBackend();
    c.pdfSetLocalFonts((await PdfInput.local_fonts?.().catch(() => [])) ?? []);

    // Open the file using poppler
    const handle = c.pdfOpen(data);
    if (handle <= 0) {
      console.warn(pdf_error_message(-handle));
      return null;
    }

    try {
      let dlg: PdfImportDialog | null = null;
      if (PdfInput.show_dialog) {
        dlg = new PdfImportDialog(handle, mod);
        if (!(await PdfInput.show_dialog(dlg))) throw new Input.open_cancelled();
      }

      // Get options
      let page_nums = '1';
      let import_method = PdfImportType.PDF_IMPORT_INTERNAL;
      let font_strats: FontStrategies;
      if (dlg) {
        page_nums = dlg.getSelectedPages();
        import_method = dlg.getImportMethod();
        font_strats = dlg.getFontStrategies();
      } else {
        const strat = pref_to_font_strategy(mod.get_param_optiongroup('fontRendering'));
        const map = c.pdfAutoFontStrategies(handle, strat);
        font_strats = new Map(Object.entries(map).map(([k, v]) => [Number(k), v]));
      }
      // Both poppler and poppler+cairo can get page num info from poppler.
      const pages = parseIntRange(page_nums, 1, c.pdfPageCount(handle));
      if (!pages.length) return null;

      // Create Inkscape document from file
      let svg: string;
      if (import_method === PdfImportType.PDF_IMPORT_INTERNAL) {
        const docname = (uri.split(/[\\/]/).pop() ?? uri).replace(/\.[^.]*$/, '');
        svg = c.pdfImport(handle, pages, {
          docname,
          importPages: mod.get_param_bool('importPages'),
          embedImages: mod.get_param_bool('embedImages'),
          convertColors: mod.get_param_bool('convertColors'),
          groupBy: mod.get_param_optiongroup('groupBy'),
          clipTo: mod.get_param_optiongroup('clipTo'),
          approximationPrecision: mod.get_param_float('approximationPrecision'),
          fontStrategies: Object.fromEntries(font_strats),
        });
      } else {
        // the poppler import
        svg = c.pdfCairoImport(handle, pages[0]!);
      }
      const doc = SPDocument.createNewDocFromMem(svg);
      if (!doc) return null;

      // Set viewBox if it doesn't exist
      if (!doc.getRoot().viewBox_set) {
        const unit = doc.getNamedView().getDisplayUnit();
        const dims = doc.getDimensions();
        doc.setViewBox(new Rect(0, 0, convertUnit(dims.x, 'px', unit), convertUnit(dims.y, 'px', unit)));
      }
      doc.ensureUpToDate();
      return doc;
    } finally {
      c.pdfClose(handle);
    }
  }

  static init(): void {
    const PDF_COMMON_INPUT_PARAMS =
      `<param name="embedImages" gui-text="${N_('Embed Images')}" type="bool">true</param>\n` +
      `<param name="convertColors" gui-text="${N_('Convert Colors to sRGB')}" type="bool">true</param>\n` +
      `<param name="importPages" gui-text="${N_('Import Pages')}" type="bool">true</param>\n` +
      `<param name="approximationPrecision" gui-text="${N_('Approximation Precision:')}" type="float" min="1" max="100">2.0</param>\n` +
      `<param name="fontRendering" gui-text="${N_('Font Rendering:')}" type="optiongroup">\n` +
      `<option value="render-missing">${N_('Render Missing')}</option>\n` +
      `<option value="substitute">${N_('Substitute missing fonts')}</option>\n` +
      `<option value="keep-missing">${N_("Keep missing fonts' names")}</option>\n` +
      `<option value="delete-missing">${N_('Delete missing font text')}</option>\n` +
      `<option value="render-all">${N_('Draw all text')}</option>\n` +
      `<option value="delete-all">${N_('Delete all text')}</option>\n` +
      '</param>\n' +
      `<param name="clipTo" gui-text="${N_('Text output options:')}" type="optiongroup">\n` +
      `<option value="none">${N_('None')}</option>\n` +
      `<option value="media-box">${N_('Media Box')}</option>\n` +
      `<option value="crop-box">${N_('Crop Box')}</option>\n` +
      `<option value="trim-box">${N_('Trim Box')}</option>\n` +
      `<option value="bleed-box">${N_('Bleed Box')}</option>\n` +
      `<option value="art-box">${N_('Art Box')}</option>\n` +
      '</param>\n' +
      `<param name="groupBy" gui-text="${N_('Group by:')}" type="optiongroup">\n` +
      `<option value="by-xobject">${N_('PDF XObject')}</option>\n` +
      `<option value="by-layer">${N_('PDF Layer')}</option>\n` +
      '</param>\n';

    /* PDF in */
    build_from_mem(
      `<inkscape-extension xmlns="${INKSCAPE_EXTENSION_URI}">\n` +
        `<name>${N_('PDF Input')}</name>\n` +
        '<id>org.inkscape.input.pdf</id>\n' +
        PDF_COMMON_INPUT_PARAMS +
        '<input>\n' +
        '<extension>.pdf</extension>\n' +
        '<mimetype>application/pdf</mimetype>\n' +
        `<filetypename>${N_('Portable Document Format (*.pdf)')}</filetypename>\n` +
        `<filetypetooltip>${N_('Portable Document Format')}</filetypetooltip>\n` +
        '</input>\n' +
        '</inkscape-extension>',
      new PdfInput(),
    );

    /* AI in */
    build_from_mem(
      `<inkscape-extension xmlns="${INKSCAPE_EXTENSION_URI}">\n` +
        `<name>${N_('AI Input')}</name>\n` +
        '<id>org.inkscape.input.ai</id>\n' +
        PDF_COMMON_INPUT_PARAMS +
        '<input>\n' +
        '<extension>.ai</extension>\n' +
        '<mimetype>image/x-adobe-illustrator</mimetype>\n' +
        `<filetypename>${N_('Adobe Illustrator 9.0 and above (*.ai)')}</filetypename>\n` +
        `<filetypetooltip>${N_('Open files saved in Adobe Illustrator 9.0 and newer versions')}</filetypetooltip>\n` +
        '</input>\n' +
        '</inkscape-extension>',
      new PdfInput(),
    );
  }
}
