// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/output.cpp, src/extension/output.h
/*
 * Authors:
 *   Ted Gould <ted@gould.cx>
 *
 * Copyright (C) 2006 Johan Engelen <johan@shouraizou.nl>
 * Copyright (C) 2002-2004 Authors
 */
import type { Node, SPDocument } from '@inkscape-web/core';
import { Extension, ExtensionState } from './extension.ts';
import type { Implementation } from './implementation/implementation.ts';
import { read_io_fields } from './input.ts';

/** An extension that saves a file type (upstream Output). */
export class Output extends Extension {
  readonly extension: string | null;
  readonly mimetype: string | null;
  readonly filetypename: string | null;
  readonly filetypetooltip: string | null;
  /** Saving loses Inkscape data (dataloss="true" by default). */
  readonly dataloss: boolean;
  readonly raster: boolean;
  readonly priority: number;

  constructor(in_repr: Node, implementation: Implementation, base_directory = '') {
    super(in_repr, implementation, base_directory);
    const { attrs, fields } = read_io_fields(in_repr, 'output');
    this.priority = Number.parseInt(attrs.get('priority') ?? '0', 10) || 0;
    this.raster = attrs.get('raster') === 'true';
    this.extension = fields.get('extension') ?? null;
    this.mimetype = fields.get('mimetype') ?? null;
    this.filetypename = fields.get('filetypename') ?? null;
    this.filetypetooltip = fields.get('filetypetooltip') ?? null;
    this.dataloss = fields.get('dataloss') !== 'false';
  }

  get_extension(): string | null {
    return this.extension;
  }
  get_filetypename(translated = false): string {
    const name = this.filetypename ?? this.get_name();
    return translated ? this.get_translation(name, null) : name;
  }

  /** Save the document (upstream save); the file data, or null if it fails. */
  async save(doc: SPDocument, name: string): Promise<Uint8Array | null> {
    if (!this.loaded()) this.set_state(ExtensionState.STATE_LOADED);
    if (!this.loaded()) return null;
    return this.imp.save(this, doc, name);
  }
}
