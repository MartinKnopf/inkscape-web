// SPDX-License-Identifier: GPL-2.0-or-later
// Application shell: menu bar, toolbox and docked panels.
import { _ } from '@inkscape-web/core';
import { DockviewReact, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';

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

/** Remove the GTK mnemonic marker ("_File" → "File"). */
const label = (s: string) => s.replace('_', '');

function DrawingPanel() {
  return <div className="drawing" />;
}

const components = { drawing: DrawingPanel } satisfies Record<
  string,
  React.FunctionComponent<IDockviewPanelProps>
>;

function onReady(e: DockviewReadyEvent) {
  e.api.addPanel({ id: 'drawing', component: 'drawing', title: _('Drawing') });
}

export function App() {
  return (
    <div className="app">
      <nav className="menubar">
        {MENUS.map((m) => (
          <button key={m} type="button">
            {label(_(m))}
          </button>
        ))}
      </nav>
      <div className="workspace">
        <div className="toolbox" />
        <DockviewReact className="dockview-theme-light" components={components} onReady={onReady} />
      </div>
    </div>
  );
}
