// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/toolbar/command-toolbar.cpp, src/ui/toolbar/command-toolbar.h, share/ui/toolbar-commands.ui
/*
 * Commands bar (the toolbar under the menu): buttons for the common actions.
 *
 * Copyright (C) 2023 Authors
 */
import { _ } from '@inkscape-web/core';
import { InkscapeApplication, shortcutLabel } from '@inkscape-web/editor';
import { Fragment, useSyncExternalStore } from 'react';
import { runAction } from '../../app/actions.ts';
import { iconUrl } from '../icon-loader.ts';
import './toolbar.css';

/** A button: the detailed action name, the icon and the tooltip. A string is a separator. */
type Item = readonly [action: string, icon: string, tooltip: string];

/** The buttons of share/ui/toolbar-commands.ui, in groups. */
const GROUPS: readonly (readonly Item[])[] = [
  [
    ['app.document-new', 'document-new', 'New'],
    ['app.document-open', 'document-open', 'Open...'],
    ['win.document-save', 'document-save', 'Save'],
    ['win.document-print', 'document-print', 'Print...'],
  ],
  [
    ['win.document-import', 'document-import', 'Import...'],
    ["win.dialog-open('Export')", 'document-export', 'Export...'],
  ],
  [
    ['doc.undo', 'edit-undo', 'Undo'],
    ['doc.redo', 'edit-redo', 'Redo'],
  ],
  [
    ['app.copy', 'edit-copy', 'Copy'],
    ['app.cut', 'edit-cut', 'Cut'],
    ['win.paste', 'edit-paste', 'Paste'],
  ],
  [
    ['win.canvas-zoom-selection', 'zoom-fit-selection', 'Zoom Selection'],
    ['win.canvas-zoom-drawing', 'zoom-fit-drawing', 'Zoom Drawing'],
    ['win.canvas-zoom-page', 'zoom-fit-page', 'Zoom Page'],
    ['win.canvas-zoom-center-page', 'zoom-center-page', 'Zoom Center Page'],
  ],
  [
    ['app.duplicate', 'edit-duplicate', 'Duplicate'],
    ['app.clone', 'edit-clone', 'Create Clone'],
    ['app.clone-unlink', 'edit-clone-unlink', 'Unlink Clone'],
  ],
  [
    ['app.selection-group', 'object-group', 'Group'],
    ['app.selection-ungroup', 'object-ungroup', 'Ungroup'],
  ],
  [
    ["win.dialog-open('FillStroke')", 'dialog-fill-and-stroke', 'Fill and Stroke'],
    ["win.dialog-open('Text')", 'dialog-text-and-font', 'Text and Font'],
    ["win.dialog-open('Objects')", 'dialog-objects', 'Layers and Objects'],
    ["win.dialog-open('XMLEditor')", 'dialog-xml-editor', 'XML Editor'],
    ["win.dialog-open('Selectors')", 'dialog-selectors', 'Selectors and CSS...'],
    ["win.dialog-open('AlignDistribute')", 'dialog-align-and-distribute', 'Align and Distribute...'],
  ],
  [
    ["win.dialog-open('DocumentProperties')", 'document-properties', 'Document Properties...'],
    ["win.dialog-open('Preferences')", 'preferences-system', 'Preferences...'],
  ],
];

/** A number that changes when actions change (enabled states), to render again. */
let version = 0;
function useActionStates(): number {
  return useSyncExternalStore(
    (cb) =>
      InkscapeApplication.instance().actions.signal_changed.connect(() => {
        version++;
        cb();
      }),
    () => version,
  );
}

/** The commands bar. A button is disabled if its action does not exist or is disabled. vertical: the wide screen setup. */
export function CommandsToolbar({ vertical = false }: { vertical?: boolean }) {
  useActionStates();
  const app = InkscapeApplication.instance();
  return (
    <div
      className={vertical ? 'commands-toolbar vertical' : 'commands-toolbar'}
      role="toolbar"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
    >
      {GROUPS.map((group, i) => (
        <Fragment key={group[0]?.[0]}>
          {i > 0 && <span className="toolbar-separator" />}
          {group.map(([action, icon, text]) => {
            const key = shortcutLabel(action);
            const title = key ? `${_(text)} (${key})` : _(text);
            return (
              <button
                key={action}
                type="button"
                className="toolbar-button"
                title={title}
                aria-label={_(text)}
                disabled={!app.actions.is_enabled(action)}
                onClick={() => runAction(action)}
              >
                <img src={iconUrl(icon)} alt="" width={16} height={16} />
              </button>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
