// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/prototype.cpp, src/ui/dialog/prototype.h
/*
 * A bare minimum example of a dialog: it shows the id of the root of the document and a line for
 * each selection change. Copy it to start a new dialog.
 *
 * Author:
 *   Tavmjong Bah
 *
 * Copyright (C) Tavmjong Bah <tavmjong@free.fr>
 */
import type { Selection, SPDocument } from '@inkscape-web/core';

/** The text of the demonstration label for a document (upstream Prototype::documentReplaced). */
export function prototype_document_label(document: SPDocument | null): string {
  const root = document?.getRoot();
  return root ? `Document's SVG id: ${root.getId() ?? 'null'}` : 'Prototype';
}

/**
 * The line that the dialog adds when the selection changes (upstream Prototype::selectionChanged):
 * the id of the selected object, else of the layer, else "unknown".
 */
export function prototype_selection_line(selection: Selection): string {
  const object = selection.single() ?? selection.activeContext();
  return `Selection changed to ${object ? (object.getId() ?? 'null') : 'unknown'}`;
}
