// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/attrdialog.cpp, src/ui/dialog/attrdialog.h
/*
 * Authors:
 *   Martin Owens
 *   Tavmjong Bah
 *
 * Copyright (C) 2018 Martin Owens
 */
import { C_, DocumentUndo, type Node, type SPDocument } from '@inkscape-web/core';

const ICON = 'dialog-xml-editor';

/** Whether name is allowed as the name of a new attribute (not empty, no whitespace, not used). */
export function isValidNewAttributeName(node: Node, name: string): boolean {
  return name !== '' && !/\s/.test(name) && node.attribute(name) === null;
}

/**
 * Set an attribute from the value column of the dialog (upstream
 * AttrDialog::valueEdited): an empty value removes the attribute. Returns
 * false if nothing changed.
 */
export function attrValueEdited(doc: SPDocument, node: Node, name: string, value: string): boolean {
  if (name === '' || node.attribute(name) === value || (value === '' && node.attribute(name) === null)) {
    return false;
  }
  node.setAttribute(name, value === '' ? null : value);
  DocumentUndo.done(doc, C_('Undo', 'Change attribute value'), ICON);
  return true;
}

/** Remove an attribute (upstream AttrDialog::deleteAttribute). */
export function attrDelete(doc: SPDocument, node: Node, name: string): void {
  if (node.attribute(name) === null) return;
  node.removeAttribute(name);
  DocumentUndo.done(doc, C_('Undo', 'Delete attribute'), ICON);
}

/** Rename an attribute and keep its value (upstream AttrDialog::nameEdited). Returns false if the name is not allowed. */
export function attrRename(doc: SPDocument, node: Node, oldName: string, name: string): boolean {
  const value = node.attribute(oldName);
  if (value === null || oldName === name || !isValidNewAttributeName(node, name)) return false;
  node.removeAttribute(oldName);
  node.setAttribute(name, value);
  DocumentUndo.done(doc, C_('Undo', 'Rename attribute'), ICON);
  return true;
}

/** Set the content of a text node or comment (the text view of the dialog). */
export function contentEdited(doc: SPDocument, node: Node, content: string): boolean {
  if (node.content() === content) return false;
  node.setContent(content);
  DocumentUndo.done(doc, C_('Undo', 'Type text'), ICON);
  return true;
}
