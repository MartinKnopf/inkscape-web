// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/pdfinput/pdf-input.cpp, share/ui/extension-pdfinput.glade
/*
 * The PDF import dialog (upstream PdfImportDialog): the import type tabs, the pages with a
 * preview, the clip and group options, the image and color options, the mesh precision and the
 * font list with a strategy for each font. The state is PdfImportDialog of the editor.
 *
 * Authors:
 *   miklos erdelyi
 *   Abhishek Sharma
 *
 * Copyright (C) 2007 Authors
 */
import { _, Signal } from '@inkscape-web/core';
import { FontFallback, type PdfImportDialog, PdfImportType, PdfInput } from '@inkscape-web/editor';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import './pdf-input.css';

let pending: { dialog: PdfImportDialog; done: (ok: boolean) => void } | null = null;
const changed = new Signal<[]>();

/** Show the dialog for PdfInput (upstream showDialog). */
PdfInput.show_dialog = (dialog) =>
  new Promise<boolean>((resolve) => {
    pending = {
      dialog,
      done: (ok) => {
        pending = null;
        changed.emit();
        resolve(ok);
      },
    };
    changed.emit();
  });

/** The rows of a combo box of extension-pdfinput.glade: [id, label]. */
const CLIP_TO = (): [string, string][] => [
  ['none', _('None')],
  ['media-box', _('Media Box')],
  ['crop-box', _('Crop Box')],
  ['trim-box', _('Trim Box')],
  ['bleed-box', _('Bleed Box')],
  ['art-box', _('Art Box')],
];
const FONT_RENDERING = (): [string, string][] => [
  ['render-missing', _('Draw missing fonts')],
  ['substitute', _('Substitute missing fonts')],
  ['keep-missing', _("Keep missing fonts' names")],
  ['delete-missing', _('Delete missing font text')],
  ['render-all', _('Draw all text')],
  ['delete-all', _('Delete all text')],
];
const GROUP_BY = (): [string, string][] => [
  ['by-xobject', _('PDF Object')],
  ['by-layer', _('PDF Layer')],
];
const STRATEGIES = (): [FontFallback, string][] => [
  [FontFallback.AS_SHAPES, _('Draw to Shapes')],
  [FontFallback.AS_SUB, _('Use Substitute Font')],
  [FontFallback.AS_TEXT, _('Keep Original Font Name')],
  [FontFallback.DELETE_TEXT, _('Delete Text')],
];

/** A GTK label without the mnemonic marker. */
const label = (s: string) => s.replace('_', '');
/** A Pango markup label as text (the msgids of the glade file have the markup). */
const markup = (s: string) => s.replace(/<[^>]*>/g, '');

function Select({
  label: text,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <label className="ext-row">
      <span>{text}</span>
      <select aria-label={text} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([id, l]) => (
          <option key={id} value={id}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The page preview (upstream _drawFunc). */
function Preview({ dialog, page }: { dialog: PdfImportDialog; page: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the page selects the image
  useEffect(() => {
    const image = dialog.previewImage(200, 300);
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!image || !el || !ctx) return;
    el.width = image.width;
    el.height = image.height;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  }, [dialog, page]);
  return <canvas ref={canvas} className="pdfin-preview" aria-label={_('Preview')} />;
}

function PdfImportDialogView({ dialog, done }: { dialog: PdfImportDialog; done: (ok: boolean) => void }) {
  const mod = dialog._mod;
  const [, setVersion] = useState(0);
  const update = () => setVersion((v) => v + 1);
  const [pages, setPages] = useState('all');
  const [ok, setOk] = useState(true);
  const [method, setMethod] = useState(dialog.getImportMethod());

  const param = (name: string, checked: boolean, text: string) => (
    <label className="ext-row">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => {
          mod.set_param_bool(name, e.target.checked);
          update();
        }}
      />
      <span>{text}</span>
    </label>
  );
  const tab = (type: PdfImportType, text: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={method === type}
      onClick={() => {
        setMethod(type);
        setOk(dialog.setImportMethod(type));
      }}
    >
      {text}
    </button>
  );
  const precision = mod.get_param_float('approximationPrecision');

  return (
    <div className="guide-dialog-backdrop">
      <div
        className="guide-dialog pdfin-dialog"
        role="dialog"
        aria-label={_('PDF Import Settings')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') done(false);
        }}
      >
        <h3>{_('PDF Import Settings')}</h3>
        <div className="pdfin-content">
          <div className="pdfin-settings">
            <div className="ext-tabs" role="tablist">
              {tab(PdfImportType.PDF_IMPORT_INTERNAL, markup(_('<b>Internal import</b>')))}
              {tab(PdfImportType.PDF_IMPORT_CAIRO, markup(_('<b>Cairo import</b>')))}
            </div>
            {method === PdfImportType.PDF_IMPORT_INTERNAL ? (
              <>
                <p className="pdfin-note">
                  {markup(
                    _(
                      '<i>Import via internal library. Editable text is reconstructed. Pages, layers and margins are preserved, object fills and strokes are recombined and gradient meshes are converted to tiles.</i>',
                    ),
                  )}
                </p>
                <label className="ext-row">
                  <span>{_('Pages')}</span>
                  <input
                    aria-label={_('Pages')}
                    title={_(
                      "Type in the page range you want to import using the format 1-4 or 1,2,3,4 or the keyword 'all' to specify all pages.",
                    )}
                    value={pages}
                    disabled={!dialog.pageNumbersSensitive()}
                    aria-invalid={!ok}
                    className={ok ? undefined : 'error'}
                    onChange={(e) => {
                      setPages(e.target.value);
                      setOk(dialog.setPageNumbers(e.target.value));
                    }}
                  />
                </label>
                <Select
                  label={_('Clip to')}
                  value={mod.get_param_optiongroup('clipTo')}
                  options={CLIP_TO()}
                  onChange={(v) => {
                    mod.set_param_optiongroup('clipTo', v);
                    update();
                  }}
                />
                <Select
                  label={_('Group by')}
                  value={mod.get_param_optiongroup('groupBy')}
                  options={GROUP_BY()}
                  onChange={(v) => {
                    mod.set_param_optiongroup('groupBy', v);
                    update();
                  }}
                />
                {param('embedImages', mod.get_param_bool('embedImages'), _('Embed Images'))}
                {param('convertColors', mod.get_param_bool('convertColors'), _('Convert Colors to sRGB'))}
                {param('importPages', mod.get_param_bool('importPages'), _('Import Pages'))}
                <label className="ext-row ext-number">
                  <span>{_('Precision of approximating gradient meshes')}</span>
                  <input
                    type="range"
                    min={1}
                    max={246}
                    step={1}
                    value={precision}
                    onChange={(e) => {
                      mod.set_param_float('approximationPrecision', Number(e.target.value));
                      update();
                    }}
                  />
                  <span>{dialog.meshLabel(precision)}</span>
                </label>
                <h4>{_('Fonts')}</h4>
                <Select
                  label={_('Fonts')}
                  value={dialog.getFontRendering()}
                  options={FONT_RENDERING()}
                  onChange={(v) => {
                    dialog.setFontRendering(v);
                    update();
                  }}
                />
                <table className="pdfin-fonts" aria-label={_('List of all PDF Fonts')}>
                  <thead>
                    <tr>
                      <th>{_('Family Name')}</th>
                      <th>{_('Style')}</th>
                      <th>{_('Weight')}</th>
                      <th>{_('Stretch')}</th>
                      <th>{_('Strategy')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dialog._font_model.map((row) => (
                      <tr key={row.id}>
                        <td className={`pdfin-font-${row.icon}`}>{row.family}</td>
                        <td>{row.style}</td>
                        <td>{row.weight}</td>
                        <td>{row.stretch}</td>
                        <td>
                          <select
                            aria-label={`${_('Strategy')} ${row.family}`}
                            value={row.proc_id}
                            onChange={(e) => {
                              dialog.setFontStrategy(row.id, Number(e.target.value));
                              update();
                            }}
                          >
                            {STRATEGIES().map(([id, l]) => (
                              <option key={id} value={id}>
                                {l}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <p className="pdfin-note">
                {markup(
                  _(
                    '<i>Import via external library. Text consists of groups containing cloned glyphs where each glyph is a path. Images are stored internally. Meshes cause entire document to be rendered as a raster image.</i>',
                  ),
                )}
              </p>
            )}
          </div>
          <div className="pdfin-preview-box">
            <Preview dialog={dialog} page={dialog._preview_page} />
            <div className="ext-row">
              <button
                type="button"
                aria-label={_('Previous page')}
                disabled={dialog._preview_page <= 1}
                onClick={() => {
                  dialog.setPreviewPage(dialog._preview_page - 1);
                  update();
                }}
              >
                ‹
              </button>
              <span>{dialog.previewLabel()}</span>
              <button
                type="button"
                aria-label={_('Next page')}
                disabled={dialog._preview_page >= dialog._total_pages}
                onClick={() => {
                  dialog.setPreviewPage(dialog._preview_page + 1);
                  update();
                }}
              >
                ›
              </button>
            </div>
          </div>
        </div>
        <div className="guide-dialog-buttons">
          <button type="button" onClick={() => done(false)}>
            {label(_('_Cancel'))}
          </button>
          <button type="button" disabled={!ok} onClick={() => done(true)}>
            {label(_('_OK'))}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The PDF import dialog while an import asks for its settings. Render once in the app. */
export function PdfImportDialogHost() {
  const current = useSyncExternalStore(
    (cb) => changed.connect(cb),
    () => pending,
  );
  if (!current) return null;
  return <PdfImportDialogView dialog={current.dialog} done={current.done} />;
}
