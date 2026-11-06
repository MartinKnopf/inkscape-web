// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/print.cpp, src/extension/print.h
/*
 * Authors:
 *   Ted Gould <ted@gould.cx>
 *
 * Copyright (C) 2002-2004 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import type { SPDocument, SPStyle } from '@inkscape-web/core';
import type { Affine, OptRect, PathVector, Point } from '@inkscape-web/geom';
import { Extension } from './extension.ts';

/**
 * A print extension (upstream Print): the document is printed through begin(), the rendering
 * methods and finish() (see ../print.ts for the walk over the items). The EMF and WMF outputs
 * use it.
 */
export class Print extends Extension {
  setup(): number {
    return this.imp.setup(this);
  }
  begin(doc: SPDocument): number {
    return this.imp.begin(this, doc);
  }
  /** End the print; the file data. */
  finish(): Uint8Array | null {
    return this.imp.finish(this);
  }
  bind(transform: Affine, opacity: number): number {
    return this.imp.bind(this, transform, opacity);
  }
  release(): number {
    return this.imp.release(this);
  }
  fill(pathv: PathVector, ctm: Affine, style: SPStyle, pbox: OptRect, dbox: OptRect, bbox: OptRect): number {
    return this.imp.fill(this, pathv, ctm, style, pbox, dbox, bbox);
  }
  stroke(
    pathv: PathVector,
    transform: Affine,
    style: SPStyle,
    pbox: OptRect,
    dbox: OptRect,
    bbox: OptRect,
  ): number {
    return this.imp.stroke(this, pathv, transform, style, pbox, dbox, bbox);
  }
  image(px: Uint8Array, w: number, h: number, rs: number, transform: Affine, style: SPStyle): number {
    return this.imp.image(this, px, w, h, rs, transform, style);
  }
  text(text: string, p: Point, style: SPStyle): number {
    return this.imp.text(this, text, p, style);
  }
  textToPath(): boolean {
    return this.imp.textToPath(this);
  }
}
