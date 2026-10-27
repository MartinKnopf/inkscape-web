// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/layer-manager.cpp, src/layer-manager.h, src/object/object-hierarchy.cpp
/*
 * Inkscape::LayerManager
 *
 * Owned by the Desktop, this manager tracks layer objects as
 * distinct entities from groups, providing a comprehensive set
 * of utilities, signals and other Layer based organisation.
 *
 * Refactored from LayerManager and layer-fns in 2021.
 *
 * Copyright 2001 Ximian, Inc.
 *           2002 Lauris Kaplinski <lauris@kaplinski.com>
 *           2006 John Bintz <jcoswell@coswellproductions.org>
 *           2006 MenTaLguY <mental@rydia.net>
 *           2007 Jon A. Cruz <jon@joncruz.org>
 *           2008 Johan Engelen <j.b.c.engelen@ewi.utwente.nl>
 *           2010 Abhishek Sharma
 *           2021 Martin Owens <doctormo@geek-2.com>
 */
import {
  LayerMode,
  type ObjectSetLayerManager,
  Preferences,
  SPDefs,
  type SPDocument,
  SPGroup,
  type SPObject,
} from '@inkscape-web/core';
import type { SPDesktop } from './desktop.ts';

/**
 * The current layer of a desktop (upstream LayerManager). The layer
 * hierarchy is the chain of groups from the root to the current layer
 * (upstream ObjectHierarchy); every group in it shows as a layer in this
 * desktop, so that entered groups behave like layers for picking.
 * TODO: the layer list and its signals, layer names, next/previous layer,
 * hide/lock all, resources of the document.
 */
export class LayerManager implements ObjectSetLayerManager {
  readonly #desktop: SPDesktop;
  /** From the root (top) to the current layer (bottom). */
  #hierarchy: SPGroup[] = [];
  #releaseConnections: (() => void)[] = [];

  constructor(desktop: SPDesktop) {
    this.#desktop = desktop;
  }

  /** Called when the desktop shows another document. */
  _setDocument(document: SPDocument | null): void {
    this.#setHierarchy(document ? [document.getRoot()] : []);
  }

  /** The root (bottom) layer: the document root. */
  currentRoot(): SPGroup | null {
    return this.#hierarchy[0] ?? null;
  }

  /** The current (top) layer. */
  currentLayer(): SPGroup | null {
    return this.#hierarchy.at(-1) ?? null;
  }

  /** Go back to the root layer. */
  reset(): void {
    const root = this.currentRoot();
    if (root) this.#setHierarchy([root]);
  }

  isRoot(): boolean {
    return this.currentLayer() === this.currentRoot();
  }

  /** Make object (a group in the root) the current layer. With clear, the selection is cleared if the preference says so. */
  setCurrentLayer(object: SPObject, clear = false): void {
    const root = this.currentRoot();
    if (!root) return;
    if (root !== object && !root.isAncestorOf(object)) return;
    const chain = [object, ...object.ancestorList(false)].reverse();
    const fromRoot = chain.slice(chain.indexOf(root));
    if (!fromRoot.every((o) => o instanceof SPGroup)) return;
    this.#setHierarchy(fromRoot as SPGroup[]);

    if (clear && Preferences.get().getBool('/options/selection/layerdeselect', true)) {
      this.#desktop.getSelection().clear();
    }
  }

  /** The layer that contains object: itself if it is a layer, else its nearest layer ancestor (or the root). Null in defs. */
  layerForObject(object: SPObject): SPObject | null {
    if (this.isLayer(object)) return object;
    const root = this.currentRoot();
    let o = object.parent;
    while (o && o !== root && !this.isLayer(o)) {
      // Objects in defs have no layer and are NOT in the root layer
      if (o instanceof SPDefs) return null;
      o = o.parent;
    }
    return o;
  }

  /** True if object is a layer, or a group shown as a layer in this desktop (an entered group). */
  isLayer(object: SPObject): boolean {
    return object instanceof SPGroup && object.effectiveLayerMode(this.#desktop.dkey) === LayerMode.LAYER;
  }

  #setHierarchy(chain: SPGroup[]): void {
    for (const disconnect of this.#releaseConnections) disconnect();
    // Deactivate the groups that leave the hierarchy, activate the new ones (upstream _layer_activated).
    for (const group of this.#hierarchy) {
      if (!chain.includes(group)) group.setLayerDisplayMode(this.#desktop.dkey, LayerMode.GROUP);
    }
    for (const group of chain) group.setLayerDisplayMode(this.#desktop.dkey, LayerMode.LAYER);
    this.#hierarchy = chain;
    // When a layer in the hierarchy goes away, its parent becomes the current layer.
    this.#releaseConnections = chain.map((group, i) =>
      group.releaseSignal.connect(() => this.#setHierarchy(this.#hierarchy.slice(0, i))),
    );
  }
}
