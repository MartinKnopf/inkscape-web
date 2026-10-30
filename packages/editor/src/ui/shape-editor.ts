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
} from '@inkscape-web/core';
import type { Affine } from '@inkscape-web/geom';
import type { SPDesktop } from '../desktop.ts';
import { KnotHolder } from './knot/knot-holder.ts';

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
 * The knot holders of one item (upstream ShapeEditor). It rebuilds them when the path effect
 * stack of the item changes and moves the knots when the item changes.
 * TODO: the knot holders of shapes (createKnotHolder for rect, ellipse, star, spiral, ...).
 */
export class ShapeEditor {
  readonly desktop: SPDesktop;
  readonly #edit_transform: Affine | null;
  lpeknotholder: KnotHolder | null = null;
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

  constructor(desktop: SPDesktop, edit_transform: Affine | null = null) {
    this.desktop = desktop;
    this.#edit_transform = edit_transform;
  }

  set_item(item: SPItem): void {
    this.unset_item();
    this.#item = item;
    this.lpeknotholder = createLPEKnotHolder(item, this.desktop);
    // Parameters whose knots change with the path rebuild the holder (upstream
    // NodeSatelliteArrayParam::reloadKnots resets the shape editors of the node tool).
    const lpe = item instanceof SPLPEItem ? item.getCurrentLPE() : null;
    for (const param of lpe?.param_vector ?? []) {
      if (param instanceof NodeSatelliteArrayParam) {
        param.onReloadKnots = () => queueMicrotask(() => this.#item === item && this.reset_item());
      }
    }
    if (this.lpeknotholder && this.#edit_transform) this.lpeknotholder.setEditTransform(this.#edit_transform);
    this.#repr = item.getRepr();
    this.#repr.addObserver(this.#observer);
    this.#disconnect = item.modifiedSignal.connect(() => {
      this.lpeknotholder?.update_knots();
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
    this.#item = null;
  }

  has_knotholder(): boolean {
    return this.lpeknotholder !== null;
  }
}
