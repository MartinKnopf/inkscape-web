// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/rvng-import-dialog.cpp
/*
 * The page selector of the CorelDRAW and Visio import (upstream RvngImportDialog): a preview of
 * the page and the page number. The state is RvngImportDialog of the editor.
 */
import { _, Signal } from '@inkscape-web/core';
import { RvngImportDialog } from '@inkscape-web/editor';
import { useState, useSyncExternalStore } from 'react';
import './rvng-import-dialog.css';

let pending: { dialog: RvngImportDialog; done: (ok: boolean) => void } | null = null;
const changed = new Signal<[]>();

/** Show the dialog for rvng_open (upstream showDialog). */
RvngImportDialog.show_dialog = (dialog) =>
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

/** A GTK label without the mnemonic marker. */
const label = (s: string) => s.replace('_', '');

function RvngImportDialogView({ dialog, done }: { dialog: RvngImportDialog; done: (ok: boolean) => void }) {
  const [page, setPage] = useState(dialog.getSelectedPage());
  const preview = dialog.previewSvg();

  return (
    <div className="guide-dialog-backdrop">
      <div
        className="guide-dialog rvng-dialog"
        role="dialog"
        aria-label={_('Page Selector')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') done(false);
        }}
      >
        <h3>{_('Page Selector')}</h3>
        <img
          className="rvng-preview"
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview)}`}
          alt={_('Preview')}
        />
        <label className="ext-row rvng-page">
          <span>{_('Select page:')}</span>
          <input
            type="number"
            aria-label={_('Select page:')}
            min={1}
            max={dialog.num_pages}
            step={1}
            value={page}
            onChange={(e) => {
              dialog.setPageNumber(Number(e.target.value) || 1);
              setPage(dialog.getSelectedPage());
            }}
          />
          <span>{dialog.totalPagesLabel()}</span>
        </label>
        <div className="guide-dialog-buttons">
          <button type="button" onClick={() => done(false)}>
            {label(_('_Cancel'))}
          </button>
          <button type="button" onClick={() => done(true)}>
            {label(_('_OK'))}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The page selector while an import asks for the page. Render once in the app. */
export function RvngImportDialogHost() {
  const current = useSyncExternalStore(
    (cb) => changed.connect(cb),
    () => pending,
  );
  if (!current) return null;
  return <RvngImportDialogView dialog={current.dialog} done={current.done} />;
}
