// SPDX-License-Identifier: GPL-2.0-or-later
// Application shell: menu bar, toolbox, docked panels and status bar.
import { _ } from '@inkscape-web/core';
import { attachActionShortcuts, CanvasGrid, SPDesktop } from '@inkscape-web/editor';
import { DockviewReact, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview-react';
import { useEffect, useRef } from 'react';
import 'dockview-react/dist/styles/dockview.css';
import { MenuBar } from '../ui/desktop/menubar.tsx';
import { dialogComponents, setDialogDock } from '../ui/dialog/dialog-manager.ts';
import { GuidelineDialogHost } from '../ui/dialog/guides.tsx';
import { SnapToolbar } from '../ui/toolbar/snap-toolbar.tsx';
import { ToolToolbar } from '../ui/toolbar/tool-toolbar.tsx';
import { Toolbars } from '../ui/toolbar/toolbars.tsx';
import {
  getActiveDesktop,
  setActiveDesktop,
  useActiveDesktop,
  useActiveDocument,
  useDocumentTitle,
  useZoom,
} from './active-desktop.ts';
import { sp_file_new_default } from './file.ts';

/** The canvas with rulers and a desktop for a new document from the default template. */
function DrawingPanel() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const grid = new CanvasGrid(host);
    let desktop: SPDesktop | null = null;
    let disposed = false;
    sp_file_new_default().then((doc) => {
      if (disposed) return;
      desktop = new SPDesktop(grid.canvas, doc);
      grid.set_desktop(desktop);
      desktop.schedule_zoom_from_document();
      setActiveDesktop(desktop);
    });
    return () => {
      disposed = true;
      desktop?.destroy();
      grid.destroy();
      if (getActiveDesktop() === desktop) setActiveDesktop(null);
    };
  }, []);
  return <div className="drawing" ref={ref} />;
}

const components = { drawing: DrawingPanel, ...dialogComponents } satisfies Record<
  string,
  React.FunctionComponent<IDockviewPanelProps>
>;

function onReady(e: DockviewReadyEvent) {
  setDialogDock(e.api);
  e.api.addPanel({ id: 'drawing', component: 'drawing', title: _('Drawing') });
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
        <DockviewReact className="dockview-theme-light" components={components} onReady={onReady} />
      </div>
      <StatusBar />
      <GuidelineDialogHost />
    </div>
  );
}
