// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/implementation/implementation.cpp, src/extension/implementation/implementation.h
/*
 * Author:  Ted Gould <ted@gould.cx>
 * Copyright (c) 2003-2005,2007
 */
import type { SPDocument } from '@inkscape-web/core';
import type { SPDesktop } from '../../desktop.ts';
import type { Effect } from '../effect.ts';
import type { ExecutionEnv } from '../execution-env.ts';
import type { Extension } from '../extension.ts';
import type { Input } from '../input.ts';
import type { Output } from '../output.ts';

/**
 * The base class of the implementations of extensions (upstream Implementation): what an
 * extension does when it is loaded, opens, saves or changes a document. The browser runs the
 * implementations asynchronously.
 */
export class Implementation {
  load(_module: Extension): boolean {
    return true;
  }
  unload(_module: Extension): void {}
  check(_module: Extension): boolean {
    return true;
  }
  cancelProcessing(): boolean {
    return true;
  }
  commitDocument(): void {}

  /** Open data (the file name is name) as a document; null if it fails. */
  async open(_module: Input, _name: string, _data: Uint8Array): Promise<SPDocument | null> {
    return null;
  }
  /** Save the document; the file data, or null if it fails. */
  async save(_module: Output, _doc: SPDocument, _name: string): Promise<Uint8Array | null> {
    return null;
  }
  /** Change the document of desktop (or document without a desktop). */
  async effect(
    _module: Effect,
    _executionEnv: ExecutionEnv | null,
    _desktop: SPDesktop | null,
    _document: SPDocument,
  ): Promise<void> {}
}
