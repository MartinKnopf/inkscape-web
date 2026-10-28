// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/drawing.h, src/display/drawing-item.h, src/display/drawing-group.h, src/display/drawing-shape.h, src/display/drawing-image.h
/*
 * Authors:
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright (C) 2011 Authors
 */
import type { Affine, OptRect, PathVector, Point, Rect } from '@inkscape-web/geom';
import type { SPFilter } from '../object/sp-filter.ts';
import type { SPItem } from '../object/sp-item.ts';
import type { SPStyle } from '../style.ts';
import type { Pixbuf } from './cairo-utils.ts';

/**
 * The display tree that SPItem.show() builds (upstream Inkscape::Drawing and
 * DrawingItem). Upstream renders it with Cairo; here only the interface is in
 * core, and the editor implements it with the browser's SVG engine. Method
 * names follow upstream, so ported show()/update() code stays the same.
 */
export interface Drawing {
  createGroup(): DrawingGroup;
  createShape(): DrawingShape;
  createImage(): DrawingImage;
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
  /** Resolve context-fill and context-stroke in the children (markers) with contextStyle. */
  setChildrenStyle(contextStyle: SPStyle | null): void;
  /** Clip this item with item (a group shown by SPClipPath), or remove the clip. */
  setClip(item: DrawingItem | null): void;
  /** Mask this item with item (a group shown by SPMask), or remove the mask. */
  setMask(item: DrawingItem | null): void;
  /**
   * Filter this item with filter, or remove the filter. Upstream passes a renderer that
   * SPFilter.build_renderer() made; here the drawing renders the SPFilter itself.
   */
  setFilterRenderer(filter: SPFilter | null): void;
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

/**
 * A bitmap image: the pixbuf is drawn at origin, scaled by scale (pixbuf
 * pixels to user units) and clipped to clipbox. The style gives image-rendering.
 */
export interface DrawingImage extends DrawingItem {
  setPixbuf(pixbuf: Pixbuf | null): void;
  setScale(sx: number, sy: number): void;
  setOrigin(origin: Point): void;
  setClipbox(box: Rect): void;
}
