// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/implementation/implementation.cpp, src/extension/implementation/implementation.h
/*
 * Author:  Ted Gould <ted@gould.cx>
 * Copyright (c) 2003-2005,2007
 */
import type { SPDocument, SPPage, SPStyle } from '@inkscape-web/core';
import type { Affine, OptRect, PathVector, Point } from '@inkscape-web/geom';
import type { SPDesktop } from '../../desktop.ts';
import type { Effect } from '../effect.ts';
import type { ExecutionEnv } from '../execution-env.ts';
import type { Extension } from '../extension.ts';
import type { Input } from '../input.ts';
import type { Output } from '../output.ts';
import type { Print } from '../print.ts';
import type { Template, TemplatePreset } from '../template.ts';

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
  /**
   * Write a raster export (upstream export_raster): png is the PNG file that the export made;
   * the file data of the output format, or null if it fails.
   */
  async export_raster(
    _module: Output,
    _doc: SPDocument,
    _png: Uint8Array,
    _name: string,
  ): Promise<Uint8Array | null> {
    return null;
  }
  /** Make a new document from the template; null if it fails (upstream new_from_template). */
  async new_from_template(_module: Template): Promise<SPDocument | null> {
    return null;
  }
  /** Resize the page (null: the document) to the size of the template. */
  async resize_to_template(_module: Template, _doc: SPDocument, _page: SPPage | null): Promise<void> {}
  /** Whether the template makes a page of this size in px (also rotated). */
  match_template_size(_module: Template, _width: number, _height: number): boolean {
    return false;
  }
  /** Add presets that the implementation makes up (for example one for each file). */
  get_template_presets(_module: Template, _presets: TemplatePreset[]): void {}
  /** Change the document of desktop (or document without a desktop). */
  async effect(
    _module: Effect,
    _executionEnv: ExecutionEnv | null,
    _desktop: SPDesktop | null,
    _document: SPDocument,
  ): Promise<void> {}

  // ----- Print functions (the print extensions, see ../print.ts) -----
  setup(_module: Print): number {
    return 0;
  }
  begin(_module: Print, _doc: SPDocument): number {
    return 0;
  }
  /** End the print; the file data (upstream writes the file to the "destination" parameter). */
  finish(_module: Print): Uint8Array | null {
    return null;
  }
  /** Whether text should be printed as paths. */
  textToPath(_module: Print): boolean {
    return false;
  }
  bind(_module: Print, _transform: Affine, _opacity: number): number {
    return 0;
  }
  release(_module: Print): number {
    return 0;
  }
  fill(
    _module: Print,
    _pathv: PathVector,
    _ctm: Affine,
    _style: SPStyle,
    _pbox: OptRect,
    _dbox: OptRect,
    _bbox: OptRect,
  ): number {
    return 0;
  }
  stroke(
    _module: Print,
    _pathv: PathVector,
    _transform: Affine,
    _style: SPStyle,
    _pbox: OptRect,
    _dbox: OptRect,
    _bbox: OptRect,
  ): number {
    return 0;
  }
  /** px: RGBA pixels (the Gdk::Pixbuf format), rs the row stride. */
  image(
    _module: Print,
    _px: Uint8Array,
    _w: number,
    _h: number,
    _rs: number,
    _transform: Affine,
    _style: SPStyle,
  ): number {
    return 0;
  }
  text(_module: Print, _text: string, _p: Point, _style: SPStyle): number {
    return 0;
  }
}
