// SPDX-License-Identifier: GPL-2.0-or-later
// Application shell: menu bar, toolbox, docked panels and status bar.
import { attachActionShortcuts } from '@inkscape-web/editor';
import { DockviewReact, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview-react';
import { useEffect } from 'react';
import 'dockview-react/dist/styles/dockview.css';
import { MenuBar } from '../ui/desktop/menubar.tsx';
import { dialogComponents, setDialogDock } from '../ui/dialog/dialog-manager.ts';
import { GuidelineDialogHost } from '../ui/dialog/guides.tsx';
import { MessageDialogHost } from '../ui/dialog/message-dialog.tsx';
import { SnapToolbar } from '../ui/toolbar/snap-toolbar.tsx';
import { ToolToolbar } from '../ui/toolbar/tool-toolbar.tsx';
import { Toolbars } from '../ui/toolbar/toolbars.tsx';
import { useActiveDesktop, useActiveDocument, useDocumentTitle, useZoom } from './active-desktop.ts';
import {
  document_new,
  restoreAutosaved,
  setDocumentDock,
  startAutoSave,
  warnBeforeUnload,
} from './documents.ts';
import { DocumentTab, DrawingPanel } from './drawing-panel.tsx';
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
  const zoom = useZoom(useActiveDesktop());
  return (
    <footer className="statusbar">
      <span className="zoom">{`${Math.round(zoom * 100)}%`}</span>
    </footer>
  );
}

export function App() {
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
      <div className="commandbar">
        <Toolbars />
        <SnapToolbar />
      </div>
      <div className="workspace">
        <div className="toolbox">
          <ToolToolbar />
        </div>
        <DockviewReact
          className="dockview-theme-light"
          components={components}
          tabComponents={tabComponents}
          onReady={onReady}
        />
      </div>
      <StatusBar />
      <GuidelineDialogHost />
      <MessageDialogHost />
    </div>
  );
}
