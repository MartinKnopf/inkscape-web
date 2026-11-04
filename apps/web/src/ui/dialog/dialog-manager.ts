// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/dialog-data.cpp, src/ui/dialog/dialog-data.h, src/ui/dialog/dialog-manager.cpp
import { _ } from '@inkscape-web/core';
import type { DockviewApi, IDockviewPanelProps } from 'dockview-react';
import type { FunctionComponent } from 'react';
import { getDocumentAnchor } from '../../app/documents.ts';
import { AlignAndDistributeDialog } from './align-and-distribute.tsx';
import { CloneTilerDialog } from './clonetiler.tsx';
import { DebugDialog } from './debug.tsx';
import { DocumentPropertiesDialog } from './document-properties.tsx';
import { DocumentResourcesDialog } from './document-resources.tsx';
import { ExportDialog } from './export.tsx';
import { ExtensionsGalleryDialog, FilterGalleryDialog } from './extensions-gallery.tsx';
import { FillAndStrokeDialog } from './fill-and-stroke.tsx';
import { FilterEffectsDialog } from './filter-effects-dialog.tsx';
import { FontCollectionsManagerDialog } from './font-collections-manager.tsx';
import { IconPreviewDialog } from './icon-preview.tsx';
import { InkscapePreferencesDialog } from './inkscape-preferences.tsx';
import { LivePathEffectDialog } from './livepatheffect-editor.tsx';
import { ObjectPropertiesDialog } from './object-properties.tsx';
import { ObjectsDialog } from './objects.tsx';
import { SelectorsDialog } from './selectorsdialog.tsx';
import { SvgFontsDialog } from './svg-fonts-dialog.tsx';
import { SwatchesDialog } from './swatches.tsx';
import { SymbolsDialog } from './symbols.tsx';
import { FontBrowserDialog, TextEditDialog } from './text-edit.tsx';
import { TraceDialog } from './tracedialog.tsx';
import { TransformationDialog } from './transformation.tsx';
import { UndoHistoryDialog } from './undo-history.tsx';
import { XmlTreeDialog } from './xml-tree.tsx';
import './dialog.css';

/** A dialog that win.dialog-open can open (upstream DialogData). */
interface DialogData {
  /** Title, with the mnemonic marker of upstream dialog-data.cpp. */
  label: string;
  component: FunctionComponent<IDockviewPanelProps>;
  /** Width in px when the dialog is the first one that is docked. Default 320. */
  width?: number;
}

/**
 * The dialogs by dialog key (upstream dialog-data.cpp).
 * TODO: the other dialogs.
 */
const DIALOGS: Record<string, DialogData> = {
  AlignDistribute: { label: _('_Align and Distribute'), component: AlignAndDistributeDialog },
  DebugWindow: { label: _('_Debugger'), component: DebugDialog },
  DocumentProperties: { label: _('_Document Properties'), component: DocumentPropertiesDialog },
  CloneTiler: { label: _('Tiled Clones'), component: CloneTilerDialog, width: 440 },
  DocumentResources: { label: _('_Document Resources'), component: DocumentResourcesDialog, width: 480 },
  Export: { label: _('_Export'), component: ExportDialog },
  FillStroke: { label: _('_Fill and Stroke'), component: FillAndStrokeDialog },
  FontBrowser: { label: _('_Font Browser'), component: FontBrowserDialog, width: 360 },
  FontCollections: { label: _('_Font Collections'), component: FontCollectionsManagerDialog, width: 480 },
  SVGFonts: { label: _('SVG Font Editor'), component: SvgFontsDialog, width: 480 },
  ExtensionsGallery: { label: _('_Extension Gallery'), component: ExtensionsGalleryDialog, width: 480 },
  FilterEffects: { label: _('Filter _Editor'), component: FilterEffectsDialog, width: 400 },
  FilterGallery: { label: _('Filter Gallery'), component: FilterGalleryDialog, width: 480 },
  Preferences: { label: _('P_references'), component: InkscapePreferencesDialog, width: 640 },
  IconPreview: { label: _('Icon Preview'), component: IconPreviewDialog },
  LivePathEffect: { label: _('Path E_ffects'), component: LivePathEffectDialog },
  ObjectProperties: { label: _('_Object Properties'), component: ObjectPropertiesDialog },
  Objects: { label: _('Layers and Object_s'), component: ObjectsDialog },
  Selectors: { label: _('_Selectors and CSS'), component: SelectorsDialog },
  Swatches: { label: _('S_watches'), component: SwatchesDialog },
  Symbols: { label: _('S_ymbols'), component: SymbolsDialog },
  Text: { label: _('_Text and Font'), component: TextEditDialog },
  Trace: { label: _('_Trace Bitmap'), component: TraceDialog },
  Transform: { label: _('Transfor_m'), component: TransformationDialog },
  UndoHistory: { label: _('Undo _History'), component: UndoHistoryDialog },
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

/** Whether a dialog with key exists (the dialogs that are ported). */
export function hasDialog(key: string): boolean {
  return key in DIALOGS;
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
    position: sibling
      ? { referenceGroup: sibling.group }
      : { referencePanel: getDocumentAnchor(dockview) ?? '', direction: 'right' },
  });
  if (!sibling) panel.api.setSize({ width: data.width ?? 320 });
  panel.api.setActive();
}
