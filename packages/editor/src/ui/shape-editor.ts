// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/shape-editor.cpp, src/ui/shape-editor.h, src/ui/shape-editor-knotholders.cpp
/*
 * Inkscape::ShapeEditor
 * This is a container class which contains a knotholder for shapes.
 * It is attached to a single item.
 *
 * Authors: bulia byak <buliabyak@users.sf.net>
 */
import {
  type Node,
  type NodeObserver,
  NodeSatelliteArrayParam,
  type SPItem,
  SPLPEItem,
  SPMarker,
  SPOffset,
  SPPattern,
} from '@inkscape-web/core';
import type { Affine } from '@inkscape-web/geom';
import type { SPDesktop } from '../desktop.ts';
import { KnotHolder } from './knot/knot-holder.ts';
import { MarkerKnotHolder, OffsetKnotHolder } from './shape-editor-knotholders.ts';

/**
 * The knot holder of the current path effect of the item, or null (upstream createLPEKnotHolder).
 */
export function createLPEKnotHolder(item: SPItem, desktop: SPDesktop): KnotHolder | null {
  if (!(item instanceof SPLPEItem)) return null;
  const effect = item.getCurrentLPE();
  if (!effect?.isVisible() || !effect.providesKnotholder()) return null;
  const knot_holder = new KnotHolder(desktop, item);
  effect.addHandles(knot_holder, item);
  return knot_holder;
}

/**
 * The knot holder of the item (upstream createKnotHolder): the knots of a marker or an offset, or of the
 * patterns of its fill and stroke, or null. TODO: the knot holders of shapes (rect, ellipse, star, spiral, ...).
 */
export function createKnotHolder(
  item: SPItem,
  desktop: SPDesktop,
  edit_rotation = 0,
  edit_marker_mode = -1,
): KnotHolder | null {
  if (item instanceof SPMarker) return new MarkerKnotHolder(desktop, item, edit_rotation, edit_marker_mode);
  if (item instanceof SPOffset) return new OffsetKnotHolder(desktop, item);
  if (
    !(item.style.getFillPaintServer() instanceof SPPattern) &&
    !(item.style.getStrokePaintServer() instanceof SPPattern)
  ) {
    return null;
  }
  const knotholder = new KnotHolder(desktop, item);
  knotholder.add_pattern_knotholder();
  return knotholder;
}

/**
 * The knot holders of one item (upstream ShapeEditor). It rebuilds them when the path effect
 * stack of the item changes and moves the knots when the item changes.
 */
export class ShapeEditor {
  readonly desktop: SPDesktop;
  readonly #edit_transform: Affine | null;
  /** The tangent angle of the path at the marker being edited, and its SPMarkerLoc (-1: none). */
  readonly #edit_rotation: number;
  readonly #edit_marker_mode: number;
  lpeknotholder: KnotHolder | null = null;
  knotholder: KnotHolder | null = null;
  #item: SPItem | null = null;
  #repr: Node | null = null;
  #disconnect: (() => void) | null = null;
  /** Called when the item changed (the node tool updates the helper paths). */
  onItemChanged: (() => void) | null = null;
  readonly #observer: NodeObserver = {
    notifyAttributeChanged: (_node, name) => {
      if (name === 'inkscape:path-effect' && this.#item) this.reset_item();
    },
  };

  constructor(
    desktop: SPDesktop,
    edit_transform: Affine | null = null,
    edit_rotation = 0,
    edit_marker_mode = -1,
  ) {
    this.desktop = desktop;
    this.#edit_transform = edit_transform;
    this.#edit_rotation = edit_rotation;
    this.#edit_marker_mode = edit_marker_mode;
  }

  set_item(item: SPItem): void {
    this.unset_item();
    this.#item = item;
    this.lpeknotholder = createLPEKnotHolder(item, this.desktop);
    this.knotholder = createKnotHolder(item, this.desktop, this.#edit_rotation, this.#edit_marker_mode);
    // Parameters whose knots change with the path rebuild the holder (upstream
    // NodeSatelliteArrayParam::reloadKnots resets the shape editors of the node tool).
    const lpe = item instanceof SPLPEItem ? item.getCurrentLPE() : null;
    for (const param of lpe?.param_vector ?? []) {
      if (param instanceof NodeSatelliteArrayParam) {
        param.onReloadKnots = () => queueMicrotask(() => this.#item === item && this.reset_item());
      }
    }
    if (this.lpeknotholder && this.#edit_transform) this.lpeknotholder.setEditTransform(this.#edit_transform);
    if (this.knotholder && this.#edit_transform) {
      this.knotholder.setEditTransform(this.#edit_transform);
      this.knotholder.update_knots();
    }
    this.#repr = item.getRepr();
    this.#repr.addObserver(this.#observer);
    this.#disconnect = item.modifiedSignal.connect(() => {
      this.lpeknotholder?.update_knots();
      this.knotholder?.update_knots();
      this.onItemChanged?.();
    });
  }

  /** Rebuild the knot holders (e.g. after the current path effect changed). */
  reset_item(): void {
    const item = this.#item;
    if (item?.document) this.set_item(item);
    else this.unset_item();
  }

  unset_item(): void {
    this.#repr?.removeObserver(this.#observer);
    this.#repr = null;
    this.#disconnect?.();
    this.#disconnect = null;
    this.lpeknotholder?.clear();
    this.lpeknotholder = null;
    this.knotholder?.clear();
    this.knotholder = null;
    this.#item = null;
  }

  has_knotholder(): boolean {
    return this.lpeknotholder !== null || this.knotholder !== null;
  }
}
