// SPDX-License-Identifier: GPL-2.0-or-later
// Helpers shared by the tool controls bars.
import { _, type SPItem } from '@inkscape-web/core';
import type { SPDesktop } from '@inkscape-web/editor';
import { useEffect, useReducer } from 'react';
import { iconUrl } from '../icon-loader.ts';
import './toolbar.css';

/**
 * Re-render when the selection changes, a selected object changes, or an
 * undo step is done, undone or redone (upstream: the selection signals and
 * the repr observers of the toolbars).
 */
export function useSelectionUpdates(desktop: SPDesktop): void {
  const [, update] = useReducer((n: number) => n + 1, 0);
  const doc = desktop.getDocument();
  useEffect(() => {
    const selection = desktop.getSelection();
    const off = [
      selection.connectChanged(update),
      selection.connectModified(update),
      doc.commitSignal.connect(update),
      doc.modifiedSinceSaveSignal.connect(update),
    ];
    return () => {
      for (const f of off) f();
    };
  }, [desktop, doc]);
}

/** The selected items of type T. */
export function selectedOfType<T extends SPItem>(
  desktop: SPDesktop,
  type: abstract new (...args: never[]) => T,
): T[] {
  return desktop
    .getSelection()
    .items()
    .filter((i): i is T => i instanceof type);
}

/** "New:" when no object of the tool's type is selected, else "Change:" (upstream _mode_item). */
export function ModeLabel({ n_selected }: { n_selected: number }) {
  const markup = n_selected === 0 ? _('<b>New:</b>') : _('<b>Change:</b>');
  return <b className="toolbar-mode">{markup.replace(/<\/?b>/g, '')}</b>;
}

/** A toolbar button with an icon from the icon theme. */
export function IconButton(props: {
  icon: string;
  tooltip: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="toolbar-button"
      title={props.tooltip}
      aria-pressed={props.active}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <img src={iconUrl(props.icon)} alt="" width={16} height={16} />
    </button>
  );
}
