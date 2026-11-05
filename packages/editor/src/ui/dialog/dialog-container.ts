// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/dialog-container.cpp, src/ui/dialog/dialog-container.h
/*
 * The container of the dialogs of a window.
 *
 * The editor has no user interface framework, so the application that shows the dialogs sets
 * the container (upstream: SPDesktop::getContainer()). win.dialog-open and win.dialog-toggle use it.
 */

/** What the actions need from the place where dialogs are shown. */
export interface DialogContainer {
  /** Open the dialog with the key (dialog-data.cpp), or show it if it is open (upstream new_dialog). */
  new_dialog(key: string): void;
  /** Show all dialogs if they are hidden, else hide them. */
  toggle_dialogs(): void;
  /** Whether a dialog with this key exists (the dialogs that are ported). */
  has_dialog(key: string): boolean;
}

let container: DialogContainer | null = null;

/** The container of the dialogs, or null if the application has none. */
export function get_dialog_container(): DialogContainer | null {
  return container;
}

export function set_dialog_container(value: DialogContainer | null): void {
  container = value;
}
