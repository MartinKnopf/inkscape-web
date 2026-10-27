// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/widget/desktop-widget.cpp
// Window title of a document.

/**
 * The window title: "*" when modified, the document name and " - Inkscape"
 * (upstream SPDesktopWidget::updateTitle without render and color modes).
 */
export function documentTitle(name: string, modifiedSinceSave: boolean): string {
  return `${modifiedSinceSave ? '*' : ''}${name} - Inkscape`;
}
