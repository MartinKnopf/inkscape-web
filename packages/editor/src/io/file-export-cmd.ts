// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/io/file-export-cmd.cpp, src/io/file-export-cmd.h
/*
 * File export from the command line. This code, greatly modified, use to be in main.cpp. It should
 * be replaced by code shared with the file dialog (Gio::Actions?).
 *
 * Copyright (C) 2018 Tavmjong Bah
 *
 * Git blame shows that bulia byak is the main author of the original export code from
 * main.cpp. Other authors of note include Nicolas Dufour, Vinicius dos Santos Oliveira, and Bob
 * Jamison; none of whom bothered to add their names to the copyright of main.cc.
 *
 * The contents of this file may be used under the GNU General Public License Version 2 or later.
 */
import {
  Colors,
  convertUnit,
  type Node,
  parseIntRange,
  type SPDocument,
  SPFlowtext,
  SPGroup,
  SPItem,
  type SPObject,
  SPText,
  sp_item_list_to_curves,
  te_update_layout_now_recursive,
} from '@inkscape-web/core';
import { Point, Rect } from '@inkscape-web/geom';
import { db } from '../extension/db.ts';
import type { Output } from '../extension/output.ts';
import type { ParamOptionGroup } from '../extension/prefdialog/widget.ts';
import { type RenderOptions, sp_export_png_blob } from '../helper/png-write.ts';
import { copy_document, crop_to_objects } from '../ui/dialog/export.ts';

/** What area of the document is exported (upstream ExportAreaType). */
export enum ExportAreaType {
  Unset,
  Drawing,
  Page,
  Area,
}

/** A file that an export made. The name has no folder: the browser has no folders. */
export interface ExportedFile {
  name: string;
  data: Uint8Array;
}

/** The text items in the tree of an object, outside of other text items (upstream list_text_items_recursive). */
function list_text_items_recursive(root: SPObject, items: SPItem[]): void {
  for (const child of root.children) {
    if (child instanceof SPItem) {
      if (child instanceof SPText || child instanceof SPFlowtext) items.push(child);
      else if (child instanceof SPGroup) list_text_items_recursive(child, items);
    }
  }
}

/** Convert all text in the document to paths, in place (upstream convert_text_to_curves). */
export function convert_text_to_curves(doc: SPDocument): void {
  const items: SPItem[] = [];
  doc.ensureUpToDate();

  list_text_items_recursive(doc.getRoot(), items);
  for (const item of items) te_update_layout_now_recursive(item);

  const selected: SPItem[] = []; // Not used
  const to_select: Node[] = []; // Not used
  sp_item_list_to_curves(items, selected, to_select);
}

/** The area rounded to whole numbers, outwards (2geom Rect::roundOutwards). */
function round_outwards(r: Rect): Rect {
  return new Rect(Math.floor(r.left()), Math.floor(r.top()), Math.ceil(r.right()), Math.ceil(r.bottom()));
}

/** The color modes of PNG files (as in the export dialog). */
const PNG_COLOR_MODES = new Set([
  'Gray_1',
  'Gray_2',
  'Gray_4',
  'Gray_8',
  'Gray_16',
  'RGB_8',
  'RGB_16',
  'GrayAlpha_8',
  'GrayAlpha_16',
  'RGBA_8',
  'RGBA_16',
]);

/** Start with Inkscape's command line defaults and collect the files that do_export() makes. */
export class InkFileExportCmd {
  /**
   * Draws the PNG file of the area of the document (upstream sp_export_png_file). The default
   * draws with the browser, which has no choice of color mode, compression or antialiasing.
   */
  static render_png: (
    doc: SPDocument,
    area: Rect,
    width: number,
    height: number,
    options: RenderOptions,
  ) => Promise<Uint8Array> = async (doc, area, width, height, options) =>
    new Uint8Array(await (await sp_export_png_blob(doc, area, width, height, options)).arrayBuffer());

  export_area_type = ExportAreaType.Unset;
  export_area = '';
  export_type_current = '';

  export_filename = ''; // Only if one file is processed!

  export_type = '';
  export_extension = '';
  export_overwrite = false;

  export_margin = 0;
  export_area_snap = false;
  export_width = 0;
  export_height = 0;

  export_page = '';

  export_dpi = 0;
  export_ignore_filters = false;
  export_text_to_path = false;
  export_ps_level = 3;
  export_pdf_level = '2.0';
  export_latex = false;
  export_id = '';
  export_id_only = false;
  export_use_hints = false;
  export_background = '';
  /** Unset is -1, which is not the same as actively set to 0. */
  export_background_opacity = -1;
  export_png_color_mode = '';
  export_plain_svg = false;
  export_png_use_dithering = false;
  export_png_compression = 6;
  export_png_antialias = 2;
  make_paths = false;

  /** Called by the action export-do with the files of the export; the web app downloads them. */
  on_files: ((files: ExportedFile[]) => void) | null = null;
  /** The files that the exports made so far; the caller takes them (see take_files()). */
  files: ExportedFile[] = [];
  /** The messages that upstream prints to stderr. */
  messages: string[] = [];

  #warn(message: string): void {
    this.messages.push(message);
    console.warn(message);
  }

  /** The files that the exports made, and forget them. */
  take_files(): ExportedFile[] {
    const files = this.files;
    this.files = [];
    return files;
  }

  set_export_area(area: string): void {
    this.export_area = area;
    this.set_export_area_type(ExportAreaType.Area);
  }

  set_export_area_type(type: ExportAreaType): void {
    if (this.export_area_type !== ExportAreaType.Unset && this.export_area_type !== type) {
      this.#warn(
        `Warning: multiple export area types have been set, overriding ${export_area_type_string(this.export_area_type)} with ${export_area_type_string(type)}`,
      );
    }
    this.export_area_type = type;
  }

  /**
   * Export the document to the types of export_type (or of the extension of export_filename)
   * and collect the files in this.files. filename_in names the document.
   */
  async do_export(doc: SPDocument, filename_in = ''): Promise<void> {
    let export_type_filename = '';
    let export_type_list: string[] = [];

    // Get export type from filename supplied with --export-filename
    if (this.export_filename !== '' && this.export_filename !== '-') {
      const slash = Math.max(this.export_filename.lastIndexOf('/'), this.export_filename.lastIndexOf('\\'));
      const dot = this.export_filename.lastIndexOf('.');
      if (dot <= slash + 1) {
        if (this.export_type === '' && this.export_extension === '') {
          this.#warn(
            'InkFileExportCmd::do_export: No export type specified. Append a supported file extension to filename provided with --export-filename or provide one or more extensions separately using --export-type',
          );
          return;
        }
        // no extension is fine if --export-type is given; explicitly stated extensions are handled later
      } else {
        export_type_filename = this.export_filename.slice(dot + 1).toLowerCase();
        this.export_filename = this.export_filename.slice(0, dot);
      }
    }

    // Get export type(s) from string supplied with --export-type
    if (this.export_type !== '') export_type_list = this.export_type.split(/[,;]/);

    // Determine actual type(s) for export.
    if (this.export_use_hints) {
      // Override type if --export-use-hints is used (hints presume PNG export for now)
      // TODO: There's actually no reason to presume. We could allow to export to any format using hints!
      if (this.export_id === '' && this.export_area_type !== ExportAreaType.Drawing) {
        this.#warn(
          'InkFileExportCmd::do_export: --export-use-hints can only be used with --export-id or --export-area-drawing.',
        );
        return;
      }
      if (export_type_list.length > 1 || (export_type_list.length === 1 && export_type_list[0] !== 'png')) {
        this.#warn(
          `InkFileExportCmd::do_export: --export-use-hints can only be used with PNG export! Ignoring --export-type=${this.export_type}.`,
        );
      }
      if (this.export_filename !== '') {
        this.#warn(
          'InkFileExportCmd::do_export: --export-filename is ignored when using --export-use-hints!',
        );
      }
      export_type_list = ['png'];
    } else if (export_type_list.length === 0) {
      if (export_type_filename !== '') {
        export_type_list.push(export_type_filename); // use extension from filename
      } else if (this.export_extension !== '') {
        // guess export type from extension
        const ext = db.get(this.export_extension);
        const extension = (ext as Output | null)?.get_extension();
        if (extension) {
          export_type_list.push(extension.slice(1));
        } else {
          this.#warn(
            'InkFileExportCmd::do_export: The supplied --export-extension was not found. Specify a file extension to get a list of available extensions for this file type.',
          );
          return;
        }
      } else {
        export_type_list.push('svg'); // fall-back to SVG by default
      }
    }

    // check if multiple export files are requested, but --export_extension was supplied
    if (this.export_extension !== '' && export_type_list.length !== 1) {
      this.#warn(
        'InkFileExportCmd::do_export: You may only specify one export type if --export_extension is supplied',
      );
      return;
    }

    const extension_list = db.get_output_list();

    // Export filename should be used when specified as the output file
    const filename_out = this.export_filename !== '' ? this.export_filename : filename_in;

    for (const Type of export_type_list) {
      // use lowercase type for following comparisons
      let type = Type.toLowerCase();
      // Remove initial "." if present in --export-type
      if (type.startsWith('.')) type = type.slice(1);
      this.export_type_current = type;

      // Check for consistency between extension of --export-filename and --export-type if both are given
      if (export_type_filename !== '' && type !== export_type_filename) {
        this.#warn(
          `InkFileExportCmd::do_export: Ignoring extension of export filename (${export_type_filename}) as it does not match the current export type (${type}).`,
        );
      }

      const export_extension_forced = this.export_extension !== '';

      // For PNG export, there is no extension, so the method below can not be used.
      if (type === 'png') {
        if (!export_extension_forced) {
          await this.do_export_png(doc, filename_out);
        } else {
          this.#warn(
            'InkFileExportCmd::do_export: The parameter --export-extension is invalid for PNG export',
          );
        }
        continue;
      }

      // for SVG export, we let the do_export_svg function handle the selection of the extension,
      // unless an extension ID was explicitly given. This makes handling of --export-plain-svg
      // easier (which should also work when multiple file types are given, unlike --export-extension)
      if (type === 'svg' && !export_extension_forced) {
        await this.do_export_svg(doc, filename_out);
        continue;
      }

      let extension_for_fn_exists = false;
      let exported = false;

      // if no extension is found, the entire list of extensions is walked through,
      // so we can use the same loop to construct the list of available formats for the error message
      const filetypes = ['.svg', '.png', '.ps', '.eps', '.pdf'];
      const exts_for_fn: string[] = [];

      for (const oext of extension_list) {
        if (oext.deactivated()) continue;
        const name = (oext.get_extension() ?? '').toLowerCase();
        filetypes.push(name);
        if (name === `.${type}`) {
          extension_for_fn_exists = true;
          exts_for_fn.push(oext.get_id());
          if (!export_extension_forced || this.export_extension === oext.get_id().toLowerCase()) {
            if (type === 'svg') await this.do_export_vector(doc, filename_out, oext);
            else if (type === 'ps')
              await this.do_export_ps_pdf(doc, filename_out, 'image/x-postscript', oext);
            else if (type === 'eps')
              await this.do_export_ps_pdf(doc, filename_out, 'image/x-e-postscript', oext);
            else if (type === 'pdf') await this.do_export_ps_pdf(doc, filename_out, 'application/pdf', oext);
            else await this.do_export_extension(doc, filename_out, oext);
            exported = true;
            break;
          }
        }
      }

      if (!exported) {
        if (export_extension_forced && extension_for_fn_exists) {
          // the located extension for this file type did not match the provided --export-extension parameter
          this.#warn(
            `InkFileExportCmd::do_export: The supplied extension ID (${this.export_extension}) does not match any of the extensions available for this file type.\nSupported IDs for this file type: [${exts_for_fn.join(', ')}]`,
          );
        } else {
          const allowed = [...new Set(filetypes)]
            .sort()
            .map((ext) => (ext.startsWith('.') ? ext.slice(1) : ext));
          this.#warn(
            `InkFileExportCmd::do_export: Unknown export type: ${type}. Allowed values: [${allowed.join(', ')}]`,
          );
        }
      }
    }
  }

  /**
   * Resizes the doc to just be the target export area (including snapping, margins, etc). If
   * object is not null, the doc will be scoped down to just the one object.
   */
  fit_to_export_area(doc: SPDocument, object: SPObject | null): void {
    let area = new Rect(0, 0, 0, 0);
    doc.ensureUpToDate();

    let obj_export_type = this.export_area_type;
    let drawing_bounds: SPItem = doc.getRoot();

    if (obj_export_type === ExportAreaType.Area) {
      /* Try to parse area (given in SVG pixels) */
      const m = /^\s*([^:\s]+):([^:\s]+):([^:\s]+):([^:\s]+)/.exec(this.export_area);
      const [x0, y0, x1, y1] = m ? [m[1], m[2], m[3], m[4]].map(Number) : [];
      if (!m || [x0, y0, x1, y1].some((v) => Number.isNaN(v))) {
        this.#warn(`Cannot parse export area '${this.export_area}'; use 'x0:y0:x1:y1'. Ignoring argument.`);
        obj_export_type = ExportAreaType.Unset;
      } else {
        area = new Rect(Math.min(x0!, x1!), Math.min(y0!, y1!), Math.max(x0!, x1!), Math.max(y0!, y1!));
      }
    }
    if (obj_export_type === ExportAreaType.Unset) {
      // Default to just the object bbox if provided, otherwise export page
      if (object instanceof SPItem) {
        obj_export_type = ExportAreaType.Drawing;
        drawing_bounds = object; // chop drawing to our object bbox
      } else {
        obj_export_type = ExportAreaType.Page;
      }
    }

    // Three choices: 1. Command-line export_area  2. Page area  3. Drawing area (Unset was handled above)
    switch (obj_export_type) {
      case ExportAreaType.Page: {
        // Export area page (explicit or if no object is given).
        const root = doc.getRoot();
        const origin = new Point(root.x.computed, root.y.computed);
        area = new Rect(origin, origin.add(doc.getDimensions()));
        break;
      }
      case ExportAreaType.Area:
        // already parsed and set above
        break;
      case ExportAreaType.Drawing: {
        // Export area drawing (explicit or if object is given).
        const areaMaybe = drawing_bounds.documentVisualBounds();
        if (areaMaybe) area = areaMaybe;
        else
          this.#warn(
            'InkFileExport::fit_to_export_area: Unable to determine a valid bounding box. Skipping.',
          );
        break;
      }
    }

    if (this.export_area_snap) area = round_outwards(area);

    // Scope document down to the provided object, if any
    if (object && this.export_id_only) {
      // Remove all other objects to complete the "crop"
      const id = object.getId();
      this.#warn(`Exporting only object with id="${id}"; all other objects hidden.`);
      if (id) crop_to_objects(doc, new Set([id]));
    }

    if (this.export_margin !== 0) {
      const unit = doc.getNamedView().getDisplayUnit();
      const margin_px = convertUnit(this.export_margin, unit, 'px');
      area = area.expandBy(margin_px);
    }

    // Only adjust the doc if we have to
    if (!doc.preferredBounds().equals(area)) doc.fitToRect(area);
  }

  /**
   * The name of the file to write (upstream get_filename_out). The browser has no folders, and
   * a name without extension is the whole name of the document.
   */
  get_filename_out(filename_in = '', object_id = ''): string {
    // Pipe out
    if (this.export_filename === '-') return '-';

    // Use filename provided with --export-filename if given
    if (this.export_filename !== '') {
      const dot = this.export_filename.lastIndexOf('.');
      const ext = dot >= 0 ? this.export_filename.slice(dot) : '';
      const cmp = `.${this.export_type_current}`;
      return this.export_filename + (ext === cmp ? '' : cmp);
    }

    // Check for pipe
    if (filename_in === '-') return '-';

    // Construct output filename from input filename and export_type.
    const slash = Math.max(filename_in.lastIndexOf('/'), filename_in.lastIndexOf('\\'));
    let extension_pos = filename_in.lastIndexOf('.');
    if (extension_pos <= slash + 1) extension_pos = -1;
    const stem = extension_pos < 0 ? filename_in : filename_in.slice(0, extension_pos);
    const extension = extension_pos < 0 ? '' : filename_in.slice(extension_pos + 1);
    if (this.export_overwrite && this.export_type_current === extension) return filename_in;
    let tag = '';
    if (this.export_type_current === extension) tag = '_out';
    if (object_id !== '') tag = `_${object_id}`;
    return `${stem}${tag}.${this.export_type_current}`;
  }

  /** Perform an SVG export. */
  async do_export_svg(doc: SPDocument, export_filename: string): Promise<number> {
    const oext = db.get(
      this.export_plain_svg ? 'org.inkscape.output.svg.plain' : 'org.inkscape.output.svg.inkscape',
    ) as Output | null;
    if (!oext) {
      this.#warn('InkFileExportCmd::do_export_svg: The SVG output is not available.');
      return 1;
    }
    return this.do_export_vector(doc, export_filename, oext);
  }

  /** Perform a vector file export (SVG, PDF, or PS) with the output extension. */
  async do_export_vector(doc: SPDocument, export_filename: string, extension: Output): Promise<number> {
    // Start with options that are once per document.
    if (this.export_text_to_path) convert_text_to_curves(doc);

    // Export pages instead of objects
    if (this.export_page !== '') {
      const pm = doc.getPageManager();
      let base = export_filename;
      let ext = 'svg';
      // Strip any possible extension
      const tmp_out = this.get_filename_out(export_filename, '');
      const extension_pos = tmp_out.lastIndexOf('.');
      if (extension_pos >= 0) {
        base = tmp_out.slice(0, extension_pos);
        ext = tmp_out.slice(extension_pos + 1);
      }
      const pages = parseIntRange(this.export_page, 1, pm.getPageCount());
      for (const page_num of pages) {
        // And if only one page is selected then we assume the user knows the filename they intended.
        const filename_out = `${base}${pages.length > 1 ? `_p${page_num}` : ''}.${ext}`;
        const copy_doc = copy_document(doc);
        // keep only this page (upstream prunePages)
        const copy_pm = copy_doc.getPageManager();
        for (const [i, page] of [...copy_pm.getPages()].entries()) {
          if (i + 1 !== page_num) copy_pm.deletePage(page, false);
        }
        copy_doc.ensureUpToDate();
        copy_doc.vacuumDocument();
        const data = await extension.save(copy_doc, filename_out);
        if (!data) {
          this.#warn(
            `InkFileExportCmd::do_export_vector: Failed to save ${this.export_plain_svg ? '' : 'Inkscape'} file to: ${filename_out}`,
          );
          return 1;
        }
        this.#add_files(filename_out, data, extension);
      }
      return 0;
    }

    // Export each object in list (or root if empty). Use ';' so in future it could be possible to
    // select multiple objects to export together.
    const objects = this.export_id === '' ? [] : this.export_id.split(/\s*;\s*/);
    if (objects.length === 0) objects.push(''); // So we do loop at least once for root.

    for (const object of objects) {
      const copy_doc = copy_document(doc);
      const filename_out = this.get_filename_out(export_filename, object);
      if (filename_out === '') return 1;

      let obj: SPObject | null = null;
      if (object !== '') {
        copy_doc.ensureUpToDate();
        // "crop" the document to the specified object, cleaning as we go.
        obj = copy_doc.getObjectById(object);
        if (obj === null) {
          this.#warn(
            `InkFileExportCmd::do_export_vector: Object ${object} not found in document, nothing to export.`,
          );
          return 1;
        }
      }
      this.fit_to_export_area(copy_doc, obj);

      const data = await extension.save(copy_doc, filename_out);
      if (!data) {
        this.#warn(
          `InkFileExportCmd::do_export_vector: Failed to save ${this.export_plain_svg ? '' : 'Inkscape'} file to: ${filename_out}`,
        );
        return 1;
      }
      this.#add_files(filename_out, data, extension);
    }
    return 0;
  }

  /** The file and the files that went next to it (the LaTeX file of a PDF). */
  #add_files(name: string, data: Uint8Array, extension: Output): void {
    this.files.push({ name, data });
    for (const extra of extension.extra_files) this.files.push(extra);
  }

  /** The background color of the export (upstream get_bgcolor). */
  get_bgcolor(doc: SPDocument): Colors.Color {
    let bgcolor = new Colors.Color(0xffffffff);
    if (this.export_background !== '') {
      // override the page color
      const c = Colors.Color.parse(this.export_background);
      if (c) bgcolor = c;
      // default is opaque if a color is given on commandline
      if (this.export_background_opacity < -0.5) this.export_background_opacity = 255;
    } else {
      // read from namedview
      const pagecolor = doc.getNamedView().getAttribute('pagecolor');
      const c = Colors.Color.parse(pagecolor);
      if (c) bgcolor = c;
    }

    if (this.export_background_opacity > -0.5) {
      // if the value is manually set
      if (this.export_background_opacity > 1.0) {
        const value = Math.min(Math.max(this.export_background_opacity, 1.0), 255.0);
        bgcolor.addOpacity(Math.floor(value) / 255.0);
      } else {
        const value = Math.min(Math.max(this.export_background_opacity, 0.0), 1.0);
        bgcolor.addOpacity(value);
      }
    } else {
      const pageopacity = doc.getNamedView().getAttribute('inkscape:pageopacity');
      if (pageopacity !== null) bgcolor.addOpacity(Number.parseFloat(pageopacity) || 1.0);
      // else it's transparent
    }
    return bgcolor;
  }

  /** Perform a PNG export. */
  async do_export_png(doc: SPDocument, export_filename: string): Promise<number> {
    let dpi = 0.0;

    // Export each object in list (or root if empty).
    const objects = this.export_id === '' ? [] : this.export_id.split(/\s*;\s*/);
    const items: SPItem[] = [];
    const objects_found: string[] = [];
    for (const object_id of objects) {
      // Find export object. (Either root or object with specified id.)
      const object = doc.getObjectById(object_id);
      if (!object) {
        this.#warn(
          `InkFileExport::do_export_png: Object with id="${object_id}" was not found in the document. Skipping.`,
        );
        continue;
      }
      if (!(object instanceof SPItem)) {
        this.#warn(
          `InkFileExportCmd::do_export_png: Object with id="${object_id}" is not a visible item. Skipping.`,
        );
        continue;
      }
      items.push(object);
      objects_found.push(object_id);
    }

    // Export pages instead of objects
    if (this.export_page !== '') {
      const pm = doc.getPageManager();
      let base = export_filename;
      // Strip any possible extension
      const extension_pos = export_filename.lastIndexOf('.');
      if (extension_pos >= 0) base = export_filename.slice(0, extension_pos);
      const pages = parseIntRange(this.export_page, 1, pm.getPageCount());
      for (const page_num of pages) {
        // We always use the png extension and ignore the extension given by the user. And if only
        // one page is selected then we assume the user knows the filename they intended.
        const filename_out = `${base}${pages.length > 1 ? `_p${page_num}` : ''}.png`;
        const page = pm.getPage(page_num - 1);
        if (page) await this.do_export_png_now(doc, filename_out, page.getDesktopRect(), dpi, items);
      }
      return 0;
    }

    if (objects.length === 0) objects_found.push(''); // So we do loop at least once for root.

    for (const object_id of objects_found) {
      const copy_doc = copy_document(doc);
      let object: SPObject | null = copy_doc.getRoot();
      if (object_id !== '') object = copy_doc.getObjectById(object_id);
      if (!object) continue;

      let filename_out = this.get_filename_out(export_filename, object_id);

      // Find file name and dpi from hints.
      if (this.export_use_hints) {
        // Retrieve export filename hint.
        const fn_hint = object.getRepr().attribute('inkscape:export-filename');
        if (fn_hint) {
          filename_out = fn_hint;
        } else {
          this.#warn(
            `InkFileExport::do_export_png: Export filename hint not found for object ${object_id}. Skipping.`,
          );
          continue;
        }

        // Retrieve export dpi hint. Only xdpi as ydpi is always the same now.
        const dpi_hint = object.getRepr().attribute('inkscape:export-xdpi');
        if (dpi_hint) {
          if (this.export_dpi || this.export_width || this.export_height) {
            this.#warn(
              `InkFileExport::do_export_png: Using bitmap dimensions from the command line (--export-dpi, --export-width, or --export-height). DPI hint ${dpi_hint} is ignored.`,
            );
          } else {
            dpi = Number.parseFloat(dpi_hint) || 0;
          }
        } else {
          this.#warn('InkFileExport::do_export_png: Export DPI hint not found for the object.');
        }
      }

      // ------------------------- File name -------------------------
      // Check we have a filename.
      if (filename_out === '') {
        this.#warn(
          'InkFileExport::do_export_png: No valid export filename given and no filename hint. Skipping.',
        );
        continue;
      }
      // The browser has no folders: no relative paths to make from the document and no folder to check.

      this.fit_to_export_area(copy_doc, object_id === '' ? null : object);
      const area = copy_doc.preferredBounds(); // whole document after fitting

      await this.do_export_png_now(copy_doc, filename_out, area, dpi, items);
    } // End loop over objects.
    return 0;
  }

  /** Write the PNG file of the area (upstream do_export_png_now). */
  async do_export_png_now(
    doc: SPDocument,
    filename_out: string,
    area: Rect,
    dpi_in: number,
    _items: readonly SPItem[],
  ): Promise<void> {
    // -------------------------- DPI -------------------------------
    let dpi = dpi_in;
    if (this.export_dpi !== 0.0 && dpi === 0.0) {
      dpi = this.export_dpi;
      if (dpi < 0.1 || dpi > 10000.0) {
        this.#warn(
          `InkFileExport::do_export_png: DPI value ${this.export_dpi} out of range [0.1 - 10000.0]. Skipping.`,
        );
        return;
      }
    }

    // default dpi
    if (dpi === 0.0) dpi = convertUnit(1, 'in', 'px');

    // -------------------------- Width and Height ---------------------------------
    const PNG_UINT_31_MAX = 0x7fffffff;
    let width = 0;
    let height = 0;
    if (this.export_height !== 0) {
      height = this.export_height;
      if (height < 1 || height > PNG_UINT_31_MAX) {
        this.#warn(
          `InkFileExport::do_export_png: Export height ${height} out of range (1 to ${PNG_UINT_31_MAX})`,
        );
        return;
      }
      dpi = convertUnit(height, 'in', 'px') / area.height();
    }

    if (this.export_width !== 0) {
      width = this.export_width;
      if (width < 1 || width > PNG_UINT_31_MAX) {
        this.#warn(
          `InkFileExport::do_export_png: Export width ${width} out of range (1 to ${PNG_UINT_31_MAX}).`,
        );
        return;
      }
      dpi = convertUnit(width, 'in', 'px') / area.width();
    }

    if (width === 0) width = Math.trunc(convertUnit(area.width(), 'px', 'in') * dpi + 0.5);
    if (height === 0) height = Math.trunc(convertUnit(area.height(), 'px', 'in') * dpi + 0.5);

    if (width < 1 || height < 1 || width > PNG_UINT_31_MAX || height > PNG_UINT_31_MAX) {
      this.#warn(
        `InkFileExport::do_export_png: Dimensions ${width}x${height} are out of range (1 to ${PNG_UINT_31_MAX}).`,
      );
      return;
    }

    // -------------------------- Bit Depth and Color Type --------------------
    if (this.export_png_color_mode !== '' && !PNG_COLOR_MODES.has(this.export_png_color_mode)) {
      this.#warn(
        `InkFileExport::do_export_png: Color mode ${this.export_png_color_mode} is invalid. It must be one of Gray_1/Gray_2/Gray_4/Gray_8/Gray_16/RGB_8/RGB_16/GrayAlpha_8/GrayAlpha_16/RGBA_8/RGBA_16.`,
      );
      return;
    }
    // TODO: the browser writes RGBA 8 bit PNG files only, so the color mode, the compression
    // level, the antialias level and the dithering are checked but have no effect.

    const bgcolor = this.get_bgcolor(doc);

    // -------------------------- Compression level ---------------------------
    if (this.export_png_compression < 0 || this.export_png_compression > 9) {
      this.#warn(
        `InkFileExport::do_export_png: Compression level ${this.export_png_compression} out of range [0 - 9]. Skipping.`,
      );
      return;
    }

    // ---------------------------- Antialias level ---------------------------
    if (this.export_png_antialias < 0 || this.export_png_antialias > 3) {
      this.#warn(
        `InkFileExport::do_export_png: Antialias level ${this.export_png_antialias} out of range [0 - 3]. Skipping.`,
      );
      return;
    }

    // ----------------------  Generate the PNG -------------------------------
    // Pass no items, because we've already cropped to just the item we care about.
    try {
      const data = await InkFileExportCmd.render_png(doc, area, width, height, { background: bgcolor });
      this.files.push({ name: filename_out, data });
    } catch (e) {
      this.#warn(
        `InkFileExport::do_export_png: Failed to export to ${filename_out}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** Perform a PDF/PS/EPS export with the output extension; the mime type must be that of the extension. */
  async do_export_ps_pdf(
    doc: SPDocument,
    filename_in: string,
    mime_type: string,
    extension?: Output,
  ): Promise<number> {
    if (!extension) {
      // Check if we support mime type.
      extension = db.get_output_list().find((o) => o.mimetype === mime_type);
      if (!extension) {
        this.#warn(
          `InkFileExportCmd::do_export_ps_pdf: Could not find an extension to export to MIME type: ${mime_type}`,
        );
        return 1;
      }
    }

    // Start with options that are once per document.
    // Set export options.
    if (this.export_text_to_path) {
      extension.set_param_optiongroup('textToPath', 'paths');
    } else if (this.export_latex) {
      extension.set_param_optiongroup('textToPath', 'LaTeX');
    }

    if (this.export_ignore_filters) {
      extension.set_param_bool('blurToBitmap', false);
    } else {
      extension.set_param_bool('blurToBitmap', true);
      let dpi = 96.0;
      if (this.export_dpi) {
        dpi = this.export_dpi;
        if (dpi < 1 || dpi > 10000.0) {
          this.#warn(`DPI value ${this.export_dpi} out of range [1 - 10000]. Using 96 dpi instead.`);
          dpi = 96;
        }
      }
      extension.set_param_int('resolution', Math.trunc(dpi));
    }

    // handle --export-pdf-version
    if (mime_type === 'application/pdf') {
      let set_export_pdf_version_fail = true;
      const pdfver_param_name = 'PDFversion';
      if (this.export_pdf_level !== '') {
        // combine "PDF " and the given command line
        const version_gui_string = `PDF-${this.export_pdf_level}`;
        try {
          // first, check if the given pdf version is selectable in the ComboBox
          if ((extension.get_param(pdfver_param_name) as ParamOptionGroup).contains(version_gui_string)) {
            extension.set_param_optiongroup(pdfver_param_name, version_gui_string);
            set_export_pdf_version_fail = false;
          } else {
            this.#warn(
              `Desired PDF export version "${this.export_pdf_level}" not supported! Hint: input one of the versions found in the pdf export dialog e.g. "2.0".`,
            );
          }
        } catch {
          // can be thrown along the way: the parameter does not exist
          this.#warn(`Parameter or Enum "${pdfver_param_name}" might not exist`);
        }
      }

      // set default pdf export version to 1.4, also if something went wrong
      if (set_export_pdf_version_fail) {
        try {
          extension.set_param_optiongroup(pdfver_param_name, 'PDF-1.4');
        } catch {
          // no such parameter
        }
      }
    }

    if (mime_type === 'image/x-postscript' || mime_type === 'image/x-e-postscript') {
      if (this.export_ps_level < 2 || this.export_ps_level > 3) {
        this.#warn('Only supported PostScript levels are 2 and 3. Defaulting to 2.');
        this.export_ps_level = 2;
      }
      extension.set_param_optiongroup('PSlevel', this.export_ps_level === 3 ? 'PS3' : 'PS2');
    }

    return this.do_export_vector(doc, filename_in, extension);
  }

  /** Export a document using an export extension. */
  async do_export_extension(doc: SPDocument, filename_in: string, extension: Output | null): Promise<number> {
    const filename_out = this.get_filename_out(filename_in);
    if (extension) {
      this.fit_to_export_area(doc, null);
      const data = await extension.save(doc, filename_out);
      if (!data) {
        this.#warn(
          `InkFileExportCmd::do_export_extension: Failed to save ${extension.get_id()} to: ${filename_out}`,
        );
        return 1;
      }
      this.#add_files(filename_out, data, extension);
    }
    return 0;
  }
}

function export_area_type_string(type: ExportAreaType): string {
  switch (type) {
    case ExportAreaType.Area:
      return '--export-area';
    case ExportAreaType.Page:
      return '--export-area-page';
    case ExportAreaType.Drawing:
      return '--export-area-drawing';
    default:
      return 'default';
  }
}
