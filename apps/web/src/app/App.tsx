// SPDX-License-Identifier: GPL-2.0-or-later
// Application shell: menu bar, toolbox, docked panels and status bar.

import { _ } from '@inkscape-web/core';
import { attachActionShortcuts } from '@inkscape-web/editor';
import { DockviewReact, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview-react';
import { useEffect, useSyncExternalStore } from 'react';
import 'dockview-react/dist/styles/dockview.css';
import { PdfImportDialogHost } from '../extension/internal/pdfinput/pdf-input.tsx';
import { PrefDialogHost } from '../extension/prefdialog/prefdialog.tsx';
import { MenuBar } from '../ui/desktop/menubar.tsx';
import { CommandPaletteHost } from '../ui/dialog/command-palette.tsx';
import { dialogComponents, setDialogDock } from '../ui/dialog/dialog-manager.ts';
import { GuidelineDialogHost } from '../ui/dialog/guides.tsx';
import { LayerPropertiesDialogHost } from '../ui/dialog/layer-properties.tsx';
import { MessageDialogHost } from '../ui/dialog/message-dialog.tsx';
import { NewFromTemplateHost } from '../ui/dialog/new-from-template.tsx';
import { SaveTemplateDialogHost } from '../ui/dialog/save-template-dialog.tsx';
import { CommandsToolbar } from '../ui/toolbar/commands-toolbar.tsx';
import { SnapToolbar } from '../ui/toolbar/snap-toolbar.tsx';
import { ToolToolbar } from '../ui/toolbar/tool-toolbar.tsx';
import { Toolbars } from '../ui/toolbar/toolbars.tsx';
import { ColorPaletteBar } from '../ui/widget/color-palette.tsx';
import { useActiveDesktop, useActiveDocument, useDocumentTitle, useZoom } from './active-desktop.ts';
import {
  document_new,
  restoreAutosaved,
  setDocumentDock,
  startAutoSave,
  warnBeforeUnload,
} from './documents.ts';
import { DocumentTab, DrawingPanel } from './drawing-panel.tsx';
import { useLayout } from './layout.ts';
import { getRecentFiles } from './recent-files.ts';

const components = { drawing: DrawingPanel, ...dialogComponents } satisfies Record<
  string,
  React.FunctionComponent<IDockviewPanelProps>
>;

const tabComponents = { document: DocumentTab };

function onReady(e: DockviewReadyEvent) {
  setDialogDock(e.api);
  setDocumentDock(e.api);
  // Upstream starts with one window with a new document.
  void document_new().then(restoreAutosaved);
}

/** Status bar with the zoom of the active desktop (upstream ui/widget/status-bar). */
function StatusBar() {
  const desktop = useActiveDesktop();
  const zoom = useZoom(desktop);
  // The rotation changes with the same signal as the zoom (upstream: update_rotation).
  const rotation = useSyncExternalStore(
    (cb) => desktop?.signal_zoom_changed.connect(cb) ?? (() => {}),
    () => desktop?.current_rotation() ?? 0,
  );
  const degrees = Math.round((((rotation * 180) / Math.PI + 540) % 360) - 180);
  return (
    <footer className="statusbar">
      <label className="rotation" title={_('Canvas rotation in degrees (Ctrl+Shift+wheel)')}>
        <input
          type="number"
          aria-label={_('Rotation')}
          value={degrees}
          min={-180}
          max={180}
          disabled={!desktop}
          onChange={(e) => {
            const value = Number.parseFloat(e.target.value);
            if (desktop && Number.isFinite(value)) {
              desktop.rotate_absolute_center_point(desktop.current_center(), (value * Math.PI) / 180);
            }
          }}
        />
        °
      </label>
      <span className="zoom">{`${Math.round(zoom * 100)}%`}</span>
    </footer>
  );
}

export function App() {
  const { bars, wide } = useLayout();
  document.title = useDocumentTitle(useActiveDocument());
  useEffect(() => attachActionShortcuts(), []);
  useEffect(() => {
    void getRecentFiles().load();
    const offs = [startAutoSave(), warnBeforeUnload()];
    return () => {
      for (const off of offs) off();
    };
  }, []);
  return (
    <div className="app">
      <MenuBar />
      {bars.commands && !wide && <CommandsToolbar />}
      {(bars.toppanel || bars.snaptoolbox) && (
        <div className="commandbar">
          {bars.toppanel ? <Toolbars /> : <div className="toolbars-spacer" />}
          {bars.snaptoolbox && <SnapToolbar />}
        </div>
      )}
      <div className="workspace">
        {bars.toolbox && (
          <div className="toolbox">
            <ToolToolbar />
          </div>
        )}
        <DockviewReact
          className="dockview-theme-light"
          components={components}
          tabComponents={tabComponents}
          onReady={onReady}
        />
        {bars.commands && wide && <CommandsToolbar vertical />}
      </div>
      {bars.panels && <ColorPaletteBar />}
      {bars.statusbar && <StatusBar />}
      <CommandPaletteHost />
      <GuidelineDialogHost />
      <PrefDialogHost />
      <PdfImportDialogHost />
      <LayerPropertiesDialogHost />
      <MessageDialogHost />
      <NewFromTemplateHost />
      <SaveTemplateDialogHost />
    </div>
  );
}
