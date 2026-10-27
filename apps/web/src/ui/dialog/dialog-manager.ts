// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/dialog-data.cpp, src/ui/dialog/dialog-data.h, src/ui/dialog/dialog-manager.cpp
import { _ } from '@inkscape-web/core';
import type { DockviewApi, IDockviewPanelProps } from 'dockview-react';
import type { FunctionComponent } from 'react';
import { ObjectsDialog } from './objects.tsx';
import { XmlTreeDialog } from './xml-tree.tsx';
import './dialog.css';

/** A dialog that win.dialog-open can open (upstream DialogData). */
interface DialogData {
  /** Title, with the mnemonic marker of upstream dialog-data.cpp. */
  label: string;
  component: FunctionComponent<IDockviewPanelProps>;
}

/**
 * The dialogs by dialog key (upstream dialog-data.cpp).
 * TODO: the other dialogs.
 */
const DIALOGS: Record<string, DialogData> = {
  Objects: { label: _('Layers and Object_s'), component: ObjectsDialog },
  XMLEditor: { label: _('_XML Editor'), component: XmlTreeDialog },
};

/** The React components of the dialogs for DockviewReact, by dialog key. */
export const dialogComponents = Object.fromEntries(
  Object.entries(DIALOGS).map(([key, data]) => [key, data.component]),
);

let dockview: DockviewApi | null = null;

/** Set the dockview that holds the dialogs (upstream DialogContainer of the window). */
export function setDialogDock(api: DockviewApi | null): void {
  dockview = api;
}

/**
 * Open the dialog with key, or show it if it is open (action
 * win.dialog-open). A new dialog is a tab beside the open dialogs; the first
 * dialog docks right of the drawing.
 */
export function openDialog(key: string): void {
  const data = DIALOGS[key];
  if (!dockview || !data) return;
  const existing = dockview.getPanel(key);
  if (existing) {
    existing.api.setActive();
    return;
  }
  const sibling = Object.keys(DIALOGS)
    .map((k) => dockview?.getPanel(k))
    .find((p) => p);
  const panel = dockview.addPanel({
    id: key,
    component: key,
    title: data.label.replace('_', ''),
    position: sibling ? { referenceGroup: sibling.group } : { referencePanel: 'drawing', direction: 'right' },
  });
  if (!sibling) panel.api.setSize({ width: 320 });
  panel.api.setActive();
}
