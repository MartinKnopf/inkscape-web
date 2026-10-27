// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/drawing-group.cpp, src/display/drawing-group.h
/*
 * Authors:
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright (C) 2011 Authors
 */
import type { DrawingGroup } from '@inkscape-web/core';
import { Affine } from '@inkscape-web/geom';
import { matrixString, SvgDrawingItem } from './drawing-item.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Group display item, an svg:g element (upstream DrawingGroup). */
export class SvgDrawingGroup extends SvgDrawingItem implements DrawingGroup {
  #transform = Affine.identity();
  #childTransform: Affine | null = null;
  #pickChildren = true;

  constructor(doc: Document) {
    super(doc.createElementNS(SVG_NS, 'g') as SVGElement);
  }

  override setTransform(transform: Affine): void {
    this.#transform = transform;
    this.#applyTransform();
  }

  /**
   * Transform applied inside the group, to the children only (upstream
   * _child_transform). A group draws nothing itself, so the element transform
   * is the child transform followed by the item transform.
   */
  setChildTransform(transform: Affine | null): void {
    this.#childTransform = transform;
    this.#applyTransform();
  }

  /** Stored only. */
  pickChildren(): boolean {
    return this.#pickChildren;
  }

  setPickChildren(pick: boolean): void {
    this.#pickChildren = pick;
  }

  #applyTransform(): void {
    const m = this.#childTransform ? this.#childTransform.multiply(this.#transform) : this.#transform;
    this.setAttribute('transform', matrixString(m));
  }
}
