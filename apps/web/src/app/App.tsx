// SPDX-License-Identifier: GPL-2.0-or-later
// Application shell: menu bar, toolbox, docked panels and status bar.
import { _ } from '@inkscape-web/core';
import {
  attachActionShortcuts,
  attachCanvasShortcuts,
  Canvas,
  SPDesktop,
  shortcutLabel,
} from '@inkscape-web/editor';
import * as Menubar from '@radix-ui/react-menubar';
import { DockviewReact, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview-react';
import { useEffect, useRef } from 'react';
import 'dockview-react/dist/styles/dockview.css';
import { runAction } from './actions.ts';
import {
  getActiveDesktop,
  setActiveDesktop,
  useActiveDesktop,
  useActiveDocument,
  useDocumentTitle,
  useUndoState,
  useZoom,
} from './active-desktop.ts';
import { sp_file_new_default } from './file.ts';

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

/** An item of a menu: label from share/ui/menus.ui and the action id. */
interface MenuItem {
  label: string;
  action: string;
}

/** Menu items by menu. TODO: all items, sections, submenus. */
const MENU_ITEMS: Record<string, MenuItem[]> = {
  _File: [
    { label: '_New', action: 'app.document-new' },
    { label: '_Open...', action: 'app.document-open' },
    { label: '_Save', action: 'win.document-save' },
    { label: 'Save _As...', action: 'win.document-save-as' },
  ],
  _Edit: [
    { label: '_Undo', action: 'doc.undo' },
    { label: '_Redo', action: 'doc.redo' },
  ],
};

/** Remove the GTK mnemonic marker ("_File" → "File"). */
const label = (s: string) => s.replace('_', '');

/** The canvas with a desktop for a new document from the default template. */
function DrawingPanel() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const canvas = new Canvas(host);
    let desktop: SPDesktop | null = null;
    let disposed = false;
    sp_file_new_default().then((doc) => {
      if (disposed) return;
      desktop = new SPDesktop(canvas, doc);
      desktop.schedule_zoom_from_document();
      setActiveDesktop(desktop);
    });
    const detachKeys = attachCanvasShortcuts(host, () => desktop);
    return () => {
      disposed = true;
      detachKeys();
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
  const { canUndo, canRedo } = useUndoState(useActiveDocument());
  const enabled: Record<string, boolean> = { 'doc.undo': canUndo, 'doc.redo': canRedo };
  return (
    <Menubar.Root className="menubar">
      {MENUS.map((m) => (
        <Menubar.Menu key={m}>
          <Menubar.Trigger className="menu-trigger">{label(_(m))}</Menubar.Trigger>
          {MENU_ITEMS[m] && (
            <Menubar.Portal>
              <Menubar.Content className="menu-popup" align="start" loop>
                {MENU_ITEMS[m].map((item) => (
                  <Menubar.Item
                    key={item.action}
                    className="menu-item"
                    disabled={enabled[item.action] === false}
                    onSelect={() => void runAction(item.action)}
                  >
                    <span>{label(_(item.label))}</span>
                    <span className="menu-shortcut">{shortcutLabel(item.action)}</span>
                  </Menubar.Item>
                ))}
              </Menubar.Content>
            </Menubar.Portal>
          )}
        </Menubar.Menu>
      ))}
    </Menubar.Root>
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
  document.title = useDocumentTitle(useActiveDocument());
  useEffect(() => attachActionShortcuts((id) => void runAction(id)), []);
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
