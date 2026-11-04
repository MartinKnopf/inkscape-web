// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/export.cpp, src/ui/dialog/export-single.cpp, share/ui/dialog-export.glade
/*
 * Export dialog (single image)
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Johan Engelen <j.b.c.engelen@ewi.utwente.nl>
 *   Anshudhar Kumar Singh <anshudhar2001@gmail.com>
 *
 * Copyright (C) 1999-2007, 2021 Authors
 * Copyright (C) 2001-2002 Ximian, Inc.
 */
import { _, Colors, convertUnit, Preferences, type SPPage } from '@inkscape-web/core';
import {
  area_x_change,
  area_y_change,
  DPI_BASE,
  db,
  dpi_change,
  EXPORT_AREA_PREF,
  EXPORT_AREAS,
  EXPORT_COORD_PRECISION,
  type ExportArea,
  type ExportGeometry,
  export_area_bounds,
  export_bitmap_size,
  export_filename,
  export_hint_dpi,
  export_raster,
  export_vector_area,
  get_export_bg_color,
  type Output,
  PAGE_UNITS,
  page_exports,
  type SPDesktop,
  save_export_hints,
  set_export_bg_color,
  with_extension,
} from '@inkscape-web/editor';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useActiveDesktop } from '../../app/active-desktop.ts';
import { sp_file_save_blob, sp_file_save_blobs } from '../../app/file.ts';
import { ExtensionWidgets } from '../../extension/prefdialog/prefdialog.tsx';
import { useSelectionUpdates } from '../toolbar/toolbar.tsx';
import { SpinButton } from '../widget/spinbutton.tsx';
import { objectKey, useReprVersion } from './use-repr.ts';

/** The text of a mnemonic label without the marker. */
const label = (s: string) => s.replace('_', '');

/** The names of the area buttons (upstream: the labels of si_s_document, si_s_page, ...). */
const AREA_LABELS = (): Record<ExportArea, string> => ({
  drawing: _('Document'),
  page: _('Page'),
  selection: _('Selection'),
  custom: _('Custom'),
});

/** The PNG export of the dialog (upstream: the raster output org.inkscape.output.png.inkscape). */
const PNG = 'png';

/**
 * The vector outputs of the file type list (upstream ExtensionList::setup): the outputs with
 * is_exported, or all with /dialogs/export/show_all_extensions.
 */
function vectorOutputs(): Output[] {
  const all = Preferences.get().getBool('/dialogs/export/show_all_extensions', false);
  return db.get_output_list().filter((o) => !o.raster && (all || o.is_exported()) && o.get_extension());
}

/** The area of the last export from the preferences (upstream setDefaultSelectionMode). */
function areaFromPrefs(): ExportArea {
  const name = Preferences.get().getString(EXPORT_AREA_PREF);
  return EXPORT_AREAS.find((a) => a === name) ?? 'drawing';
}

/**
 * The Export dialog (dialog key "Export"): export the document, the page, the selection or a custom
 * area as a PNG. The size in pixels, the dpi and the area are linked as in Inkscape. The image is
 * rendered by the browser from the document; the user picks the file when exporting.
 * With several pages, the page area has a page list: export the chosen page, or all pages as
 * one PNG each (named by their export hints or labels) into a folder.
 * The file type list also has the vector outputs (PDF): they export the page(s) or the area
 * with the options of the output; all pages go into one file.
 * TODO: the preview, the raster outputs, the batch export, the file format options of the PNG.
 */
export function ExportDialog() {
  const desktop = useActiveDesktop();
  if (!desktop) return null;
  return <ExportSingle key={objectKey(desktop.doc)} desktop={desktop} />;
}

function ExportSingle({ desktop }: { desktop: SPDesktop }) {
  const doc = desktop.getDocument();
  const prefs = Preferences.get();
  useSelectionUpdates(desktop);
  useReprVersion(doc.rroot);
  const pm = doc.getPageManager();
  const selectedPage = useSyncExternalStore(
    (cb) => pm.connectPageSelected(cb),
    () => pm.getSelected(),
  );

  const [area, setArea] = useState<ExportArea>(areaFromPrefs);
  const [dpi, setDpi] = useState(() => prefs.getDouble('/dialogs/export/defaultxdpi/value', DPI_BASE));
  const [unit, setUnit] = useState(() => doc.getNamedView().getDisplayUnit());
  const [custom, setCustom] = useState<Omit<ExportGeometry, 'dpi'> | null>(null);
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [filename, setFilename] = useState('');
  const [userFilename, setUserFilename] = useState(false);
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState(PNG);
  const outputs = vectorOutputs();
  const output = outputs.find((o) => o.get_id() === format) ?? null;
  const ext = output?.get_extension() ?? '.png';

  const selectionEmpty = desktop.getSelection().isEmpty();
  // An empty selection cannot be exported: use the document instead (upstream setDefaultSelectionMode).
  const shown: ExportArea = area === 'selection' && selectionEmpty ? 'drawing' : area;
  const bounds = shown === 'custom' ? null : export_area_bounds(desktop, shown);
  const page = doc.preferredBounds().transformed(desktop.doc2dt());
  const base = bounds ?? page;
  const area_px =
    shown === 'custom' && custom
      ? custom
      : { x0: base.left(), y0: base.top(), x1: base.right(), y1: base.bottom() };
  const g: ExportGeometry = { ...area_px, dpi };
  const size = export_bitmap_size(g);
  const bg = get_export_bg_color(doc);

  // Suggest a filename and the saved dpi when the area changes, unless the user typed a filename.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the area and the document matter
  useEffect(() => {
    if (!userFilename) setFilename(export_filename(desktop, shown, ext));
    else setFilename((f) => with_extension(f, ext));
    const hint = export_hint_dpi(desktop, shown);
    if (hint) setDpi(hint);
  }, [shown, doc, selectedPage, ext]);

  const chooseArea = (a: ExportArea) => {
    setArea(a);
    prefs.setString(EXPORT_AREA_PREF, a);
  };
  /** Edit the area: the geometry changes and the area becomes custom. */
  const editArea = (next: ExportGeometry) => {
    setCustom({ x0: next.x0, y0: next.y0, x1: next.x1, y1: next.y1 });
    chooseArea('custom');
  };
  const toUnit = (px: number) => convertUnit(px, 'px', unit);
  const fromUnit = (v: number) => convertUnit(v, unit, 'px');
  const field = (text: string, value: number, onChange: (px: number) => void) => (
    <SpinButton
      label={text}
      tooltip={text}
      value={toUnit(value)}
      min={-1000000}
      max={1000000}
      step={0.1}
      digits={EXPORT_COORD_PRECISION}
      onChange={(v) => onChange(fromUnit(v))}
    />
  );

  /** Export with the vector output (upstream SingleExport::onExport with a vector output). */
  const exportVector = async (o: Output, pages: readonly SPPage[] | null) => {
    const items = selectedOnly ? [...desktop.getSelection().items()] : [];
    const data = await export_vector_area(o, desktop, g, items, pages);
    if (!data) throw new Error(_('Could not export to filename <b>%s</b>.\n').replace('%s', filename));
    return new Blob([data as BlobPart], { type: o.mimetype ?? 'application/octet-stream' });
  };

  const doExport = async () => {
    setBusy(true);
    try {
      const only = selectedOnly ? desktop.getSelection().items() : null;
      const page = selectedPage ?? pm.getFirstPage();
      const blob = output
        ? await exportVector(output, shown === 'page' && pm.hasPages() && page ? [page] : null)
        : await export_raster(desktop, g, { background: bg, only: only ? [...only] : null });
      const name = with_extension(filename.split(/[\\/]/).pop() || 'bitmap', ext);
      if (await sp_file_save_blob(blob, name)) {
        setFilename(name);
        // Save the export hints back to the svg document.
        save_export_hints(desktop, shown, name, g.dpi);
        setUserFilename(false);
      }
    } catch (e) {
      console.error(e);
      alert(`${_('Export')}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  /** Export each page as its own PNG (upstream: the pages of the batch export); vector: one file. */
  const exportPages = async () => {
    setBusy(true);
    try {
      if (output) {
        const name = with_extension(filename.split(/[\\/]/).pop() || 'drawing', ext);
        await sp_file_save_blob(await exportVector(output, pm.getPages()), name);
        return;
      }
      const files = [];
      for (const e of page_exports(pm.getPages(), dpi, '.png')) {
        const { width, height } = export_bitmap_size(e.geometry);
        if (width < 1 || height < 1) continue;
        files.push({
          name: e.filename,
          data: await export_raster(desktop, e.geometry, { background: bg, only: null }),
        });
      }
      await sp_file_save_blobs(files);
    } catch (e) {
      console.error(e);
      alert(`${_('Export')}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const labels = AREA_LABELS();
  const multipage = shown === 'page' && pm.getPageCount() > 1;
  return (
    <div className="export-dialog">
      <fieldset className="export-areas">
        <legend className="export-legend">{_('Export area')}</legend>
        {EXPORT_AREAS.map((a) => (
          <button
            key={a}
            type="button"
            aria-pressed={shown === a}
            disabled={a === 'selection' && selectionEmpty}
            onClick={() => chooseArea(a)}
          >
            {labels[a]}
          </button>
        ))}
      </fieldset>

      {multipage && (
        <label className="export-row">
          <span>{_('Page')}</span>
          <select
            aria-label={_('Page')}
            value={selectedPage ? pm.getPageIndex(selectedPage) : 0}
            onChange={(e) => pm.selectPageIndex(Number(e.target.value))}
          >
            {pm.getPages().map((p, i) => (
              <option key={objectKey(p)} value={i}>
                {p.getLabel()}
              </option>
            ))}
          </select>
        </label>
      )}

      {shown === 'custom' && (
        <div className="export-grid">
          {field(_('Left'), g.x0, (v) => editArea(area_x_change(g, 'x0', v)))}
          {field(_('Right'), g.x1, (v) => editArea(area_x_change(g, 'x1', v)))}
          {field(_('Top'), g.y0, (v) => editArea(area_y_change(g, 'y0', v)))}
          {field(_('Bottom'), g.y1, (v) => editArea(area_y_change(g, 'y1', v)))}
          {field(_('Width'), g.x1 - g.x0, (v) => editArea(area_x_change(g, 'width', v)))}
          {field(_('Height'), g.y1 - g.y0, (v) => editArea(area_y_change(g, 'height', v)))}
          <label className="spinbutton">
            <span className="spinbutton-label">{_('Units')}</span>
            <select value={unit} onChange={(e) => setUnit(e.target.value)}>
              {PAGE_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {!output && (
        <>
          <h4>{_('Image Size')}</h4>
          <div className="export-grid">
            <SpinButton
              label={_('Width')}
              tooltip={_('Width')}
              value={size.width}
              min={1}
              max={16384}
              step={1}
              digits={0}
              onChange={(v) => setDpi(dpi_change(g, 'bmwidth', v).dpi)}
            />
            <SpinButton
              label={_('Height')}
              tooltip={_('Height')}
              value={size.height}
              min={1}
              max={16384}
              step={1}
              digits={0}
              onChange={(v) => setDpi(dpi_change(g, 'bmheight', v).dpi)}
            />
            <SpinButton
              label={_('DPI')}
              tooltip={_('DPI')}
              value={dpi}
              min={1}
              max={100000}
              step={0.1}
              digits={2}
              onChange={(v) => {
                setDpi(v);
                prefs.setDouble('/dialogs/export/defaultxdpi/value', v);
              }}
            />
          </div>
        </>
      )}

      <label className="export-row">
        <input type="checkbox" checked={selectedOnly} onChange={(e) => setSelectedOnly(e.target.checked)} />
        <span>{_('Export Selected Only')}</span>
      </label>
      {!output && (
        <div className="export-row">
          <span>{_('Background Color')}</span>
          <input
            type="color"
            aria-label={_('Background color')}
            value={bg.toString(false)}
            onChange={(e) => {
              const c = Colors.Color.parse(e.target.value);
              if (c) set_export_bg_color(doc, c.withOpacity(bg.getOpacity()));
            }}
          />
          <SpinButton
            label={_('Alpha')}
            tooltip={_('Opacity of the background')}
            value={bg.getOpacity()}
            min={0}
            max={1}
            step={0.05}
            digits={2}
            onChange={(v) => {
              const c = bg.clone();
              c.setOpacity(v);
              set_export_bg_color(doc, c);
            }}
          />
        </div>
      )}

      <label className="export-row">
        <span>{_('File type')}</span>
        <select aria-label={_('File type')} value={format} onChange={(e) => setFormat(e.target.value)}>
          <option value={PNG}>{_('Portable Network Graphic (*.png)')}</option>
          {outputs.map((o) => (
            <option key={o.get_id()} value={o.get_id()}>
              {o.get_filetypename(true)}
            </option>
          ))}
        </select>
      </label>
      {output && <ExtensionWidgets key={output.get_id()} module={output} />}

      <label className="export-row">
        <span>{_('Filename')}</span>
        <input
          className="export-filename"
          value={filename}
          onChange={(e) => {
            setFilename(e.target.value);
            setUserFilename(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy) void doExport();
          }}
        />
      </label>
      <div className="export-row">
        <button type="button" className="export-button" disabled={busy} onClick={() => void doExport()}>
          {busy ? _('Exporting') : label(_('Export'))}
        </button>
        {multipage && (
          <button type="button" className="export-button" disabled={busy} onClick={() => void exportPages()}>
            {_('Export all pages')}
          </button>
        )}
      </div>
    </div>
  );
}
