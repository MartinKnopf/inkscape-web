// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/rvng-import-dialog.cpp
/*
 * The page selector of the CorelDRAW and Visio import (upstream RvngImportDialog): a preview of
 * the page and the page number. The state is RvngImportDialog of the editor. Like the GTK
 * dialog (set_modal), it is a modal <dialog>.
 */
import { _, Signal } from '@inkscape-web/core';
import { RvngImportDialog } from '@inkscape-web/editor';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import './rvng-import-dialog.css';

let pending: { id: number; dialog: RvngImportDialog; done: (ok: boolean) => void } | null = null;
let requests = 0;
const changed = new Signal<[]>();

/** Show the dialog for rvng_open (upstream showDialog). A new request cancels the open one. */
RvngImportDialog.show_dialog = (dialog) =>
  new Promise<boolean>((resolve) => {
    pending?.done(false);
    const request = {
      id: ++requests,
      dialog,
      done: (ok: boolean) => {
        if (pending === request) {
          pending = null;
          changed.emit();
        }
        resolve(ok);
      },
    };
    pending = request;
    changed.emit();
  });

/** A GTK label without the mnemonic marker. */
const label = (s: string) => s.replace('_', '');

function RvngImportDialogView({ dialog, done }: { dialog: RvngImportDialog; done: (ok: boolean) => void }) {
  const [page, setPage] = useState(dialog.getSelectedPage());
  const ref = useRef<HTMLDialogElement>(null);
  const preview = dialog.previewSvg();

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
    return () => el?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className="guide-dialog rvng-dialog"
      aria-label={_('Page Selector')}
      onCancel={(e) => {
        // Escape
        e.preventDefault();
        done(false);
      }}
      // The keys belong to the dialog, not to the shortcuts of the app.
      onKeyDown={(e) => e.stopPropagation()}
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
    </dialog>
  );
}

/** The page selector while an import asks for the page. Render once in the app. */
export function RvngImportDialogHost() {
  const current = useSyncExternalStore(
    (cb) => changed.connect(cb),
    () => pending,
  );
  if (!current) return null;
  // A new request gets a new dialog (key), so its page state starts at 1.
  return <RvngImportDialogView key={current.id} dialog={current.dialog} done={current.done} />;
}
