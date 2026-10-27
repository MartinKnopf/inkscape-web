// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/drawing.h, src/display/drawing-item.h, src/display/drawing-group.h, src/display/drawing-shape.h
/*
 * Authors:
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright (C) 2011 Authors
 */
import type { Affine, OptRect, PathVector } from '@inkscape-web/geom';
import type { SPItem } from '../object/sp-item.ts';
import type { SPStyle } from '../style.ts';

/**
 * The display tree that SPItem.show() builds (upstream Inkscape::Drawing and
 * DrawingItem). Upstream renders it with Cairo; here only the interface is in
 * core, and the editor implements it with the browser's SVG engine. Method
 * names follow upstream, so ported show()/update() code stays the same.
 */
export interface Drawing {
  createGroup(): DrawingGroup;
  createShape(): DrawingShape;
}

export interface DrawingItem {
  /** Display key of the view (see SPItem.displayKeyNew). */
  key(): number;
  setKey(key: number): void;
  /** The item this view shows, for picking. */
  setItem(item: SPItem | null): void;
  appendChild(child: DrawingItem): void;
  prependChild(child: DrawingItem): void;
  clearChildren(): void;
  /** Move to position z among the siblings. */
  setZOrder(z: number): void;
  setTransform(transform: Affine): void;
  setOpacity(opacity: number): void;
  setVisible(visible: boolean): void;
  setSensitive(sensitive: boolean): void;
  setIsolation(isolate: boolean): void;
  setBlendMode(mode: number): void;
  setAntialiasing(antialias: boolean): void;
  /** Set the style; contextStyle resolves context-fill/context-stroke (markers). */
  setStyle(style: SPStyle | null, contextStyle?: SPStyle | null): void;
  setItemBounds(bounds: OptRect): void;
  /** Remove from the parent and release. */
  unlink(): void;
}

export interface DrawingGroup extends DrawingItem {
  setChildTransform(transform: Affine | null): void;
  setPickChildren(pick: boolean): void;
}

export interface DrawingShape extends DrawingItem {
  setPath(path: PathVector | null): void;
}
