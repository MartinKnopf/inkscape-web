// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/input.cpp, src/extension/input.h
/*
 * Authors:
 *   Ted Gould <ted@gould.cx>
 *
 * Copyright (C) 2002-2005 Authors
 */
import type { Node, SPDocument } from '@inkscape-web/core';
import { Extension, ExtensionState } from './extension.ts';
import type { Implementation } from './implementation/implementation.ts';
import { INKSCAPE_EXTENSION_NS, widget_tag_name } from './prefdialog/widget.ts';

/** The fields of an <input> or <output> element. */
export function read_io_fields(
  repr: Node,
  tag: string,
): { attrs: Map<string, string>; fields: Map<string, string> } {
  const attrs = new Map<string, string>();
  const fields = new Map<string, string>();
  for (const child_repr of repr.children()) {
    if (child_repr.name() !== `${INKSCAPE_EXTENSION_NS}${tag}`) continue;
    for (const [k, v] of child_repr.attributeList()) attrs.set(k, v);
    for (const c of child_repr.children()) {
      if (c.type() !== 'element') continue;
      const content = c.firstChild()?.content();
      if (content !== null && content !== undefined) fields.set(widget_tag_name(c), content);
    }
    break;
  }
  return { attrs, fields };
}

/** An extension that opens a file type (upstream Input). */
export class Input extends Extension {
  readonly extension: string | null;
  readonly mimetype: string | null;
  readonly filetypename: string | null;
  readonly filetypetooltip: string | null;
  readonly priority: number;

  constructor(in_repr: Node, implementation: Implementation, base_directory = '') {
    super(in_repr, implementation, base_directory);
    const { attrs, fields } = read_io_fields(in_repr, 'input');
    this.priority = Number.parseInt(attrs.get('priority') ?? '0', 10) || 0;
    this.extension = fields.get('extension') ?? null;
    this.mimetype = fields.get('mimetype') ?? null;
    this.filetypename = fields.get('filetypename') ?? null;
    this.filetypetooltip = fields.get('filetypetooltip') ?? null;
  }

  get_extension(): string | null {
    return this.extension;
  }
  get_filetypename(translated = false): string {
    const name = this.filetypename ?? this.get_name();
    return translated ? this.get_translation(name, null) : name;
  }

  /** Open the file data as a document (upstream open); null if it fails. */
  async open(name: string, data: Uint8Array): Promise<SPDocument | null> {
    if (!this.loaded()) this.set_state(ExtensionState.STATE_LOADED);
    if (!this.loaded()) return null;
    return this.imp.open(this, name, data);
  }
}
