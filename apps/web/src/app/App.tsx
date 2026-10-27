// SPDX-License-Identifier: GPL-2.0-or-later
// Application shell: menu bar, toolbox, docked panels and status bar.
import { _ } from '@inkscape-web/core';
import { attachCanvasShortcuts, Canvas, SPDesktop, ToolBase } from '@inkscape-web/editor';
import { DockviewReact, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview-react';
import { useEffect, useRef, useState } from 'react';
import 'dockview-react/dist/styles/dockview.css';
import { getActiveDesktop, setActiveDesktop, useActiveDesktop, useZoom } from './active-desktop.ts';
import { sp_file_new_default, sp_file_open_dialog } from './file.ts';

/** Top-level menus, same labels as upstream share/ui/menus.ui. */
const MENUS = [
  '_File',
  '_Edit',
  '_View',
  '_Layer',
  '_Object',
  '_Path',
  '_Text',
  'Filter_s',
  'Exte_nsions',
  '_Help',
];

/** Menu items by menu, with labels from share/ui/menus.ui. TODO: all items, the action system. */
const MENU_ITEMS: Record<string, { label: string; run: () => void }[]> = {
  _File: [{ label: '_Open...', run: () => void documentOpen() }],
};

/** Remove the GTK mnemonic marker ("_File" → "File"). */
const label = (s: string) => s.replace('_', '');

/** app.document-open: replace the document of the active desktop with a file. */
async function documentOpen(): Promise<void> {
  const doc = await sp_file_open_dialog();
  const dt = getActiveDesktop();
  if (!doc || !dt) return;
  dt.setDocument(doc);
  dt.zoom_page();
}

/** The canvas with a desktop for a new document from the default template. */
function DrawingPanel() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const canvas = new Canvas(host);
    let desktop: SPDesktop | null = null;
    let tool: ToolBase | null = null;
    let disposed = false;
    sp_file_new_default().then((doc) => {
      if (disposed) return;
      desktop = new SPDesktop(canvas, doc);
      tool = new ToolBase(desktop);
      desktop.schedule_zoom_from_document();
      setActiveDesktop(desktop);
    });
    const detachKeys = attachCanvasShortcuts(host, () => desktop);
    return () => {
      disposed = true;
      detachKeys();
      tool?.destroy();
      desktop?.destroy();
      canvas.destroy();
      if (getActiveDesktop() === desktop) setActiveDesktop(null);
    };
  }, []);
  return <div className="drawing" ref={ref} />;
}

const components = { drawing: DrawingPanel } satisfies Record<
  string,
  React.FunctionComponent<IDockviewPanelProps>
>;

function onReady(e: DockviewReadyEvent) {
  e.api.addPanel({ id: 'drawing', component: 'drawing', title: _('Drawing') });
}

function MenuBar() {
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <nav className="menubar">
      {MENUS.map((m) => (
        <div key={m} className="menu">
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setOpen(open === m ? null : m)}
          >
            {label(_(m))}
          </button>
          {open === m && MENU_ITEMS[m] && (
            <div className="menu-popup" role="menu" onPointerDown={(e) => e.stopPropagation()}>
              {MENU_ITEMS[m].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(null);
                    item.run();
                  }}
                >
                  {label(_(item.label))}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
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
  return (
    <div className="app">
      <MenuBar />
      <div className="workspace">
        <div className="toolbox" />
        <DockviewReact className="dockview-theme-light" components={components} onReady={onReady} />
      </div>
      <StatusBar />
    </div>
  );
}
