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
  Signal,
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
  /** Emitted when the current layer changes (upstream layer_changed signal). */
  readonly signal_layer_changed = new Signal<[]>();

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

  /** All layers under the root in document order, with their depth (the sublayers follow their layer). */
  allLayers(): { layer: SPGroup; depth: number }[] {
    const root = this.currentRoot();
    const result: { layer: SPGroup; depth: number }[] = [];
    const visit = (parent: SPObject, depth: number): void => {
      for (const child of parent.children) {
        if (child instanceof SPGroup && child.layerMode() === LayerMode.LAYER) {
          result.push({ layer: child, depth });
          visit(child, depth + 1);
        } else if (child instanceof SPGroup) visit(child, depth);
      }
    };
    if (root) visit(root, 0);
    return result;
  }

  /**
   * A name for a new layer, from label (default "Layer 1"), that no other layer than obj has: a
   * number is counted up until the name is free (upstream getNextLayerName).
   */
  getNextLayerName(obj: SPObject | null, label: string | null): string {
    const incoming = label ?? 'Layer 1';
    let result = incoming;
    let base = incoming;
    let split = ' ';
    let start_num = 1;

    let pos = base.length - 1;
    while (pos >= 0 && /[0-9]/.test(base.charAt(pos))) pos--;
    const numpart = base.slice(pos + 1);
    const val = Number.parseInt(numpart, 10);
    if (numpart !== '' && val < 65536) {
      base = base.slice(0, pos + 1);
      result = incoming;
      start_num = val;
      split = '';
    }

    const current_names = new Set(
      this.allLayers()
        .filter(({ layer }) => layer !== obj)
        .map(({ layer }) => layer.label() ?? ''),
    );
    // Not sure if we need to cap it, but we'll just be paranoid for the moment
    for (let i = start_num; i < start_num + 3000 && current_names.has(result); i++) {
      result = `${base}${split}${i}`;
    }
    return result;
  }

  /** Name the layer label, or with uniquify the next free name for it (upstream renameLayer). */
  renameLayer(obj: SPObject, label: string, uniquify: boolean): void {
    obj.setAttribute('inkscape:label', uniquify ? this.getNextLayerName(obj, label) : label);
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
    this.signal_layer_changed.emit();
  }
}

/** Finds the next sibling layer of layer; null if there are no further layers under its parent. */
function next_sibling_layer(layer: SPObject): SPObject | null {
  const list = layer.parent?.children ?? [];
  return list.slice(list.indexOf(layer) + 1).find(is_layer) ?? null;
}

/** Finds the previous sibling layer of layer; null if there are none before it under its parent. */
function previous_sibling_layer(layer: SPObject): SPObject | null {
  const list = layer.parent?.children ?? [];
  return list.slice(0, list.indexOf(layer)).reverse().find(is_layer) ?? null;
}

function is_layer(object: SPObject): boolean {
  return object instanceof SPGroup && object.layerMode() === LayerMode.LAYER;
}

/** The first (deepest) descendant layer of layer along the first sublayers; layer itself if it has no sublayers. */
function first_descendant_layer(layer: SPObject): SPObject {
  for (;;) {
    const first = layer.children.find(is_layer);
    if (!first) return layer;
    layer = first;
  }
}

/** The last (topmost) child layer of layer; null if layer has no sublayers. */
function last_child_layer(layer: SPObject): SPObject | null {
  return [...layer.children].reverse().find(is_layer) ?? null;
}

function last_elder_layer(root: SPObject, layer: SPObject): SPObject | null {
  for (let l: SPObject | null = layer; l && l !== root; l = l.parent) {
    const sibling = previous_sibling_layer(l);
    if (sibling) return sibling;
  }
  return null;
}

/** Finds the next layer under root, relative to layer in depth-first order; null if there are no further layers. */
export function next_layer(root: SPObject, layer: SPObject): SPObject | null {
  const sibling = next_sibling_layer(layer);
  if (sibling) return first_descendant_layer(sibling);
  return layer.parent && layer.parent !== root ? layer.parent : null;
}

/** Finds the previous layer under root, relative to layer in depth-first order; null if there are no prior layers. */
export function previous_layer(root: SPObject, layer: SPObject): SPObject | null {
  const child = last_child_layer(layer);
  if (child) return child;
  if (layer === root) return null;
  return previous_sibling_layer(layer) ?? (layer.parent ? last_elder_layer(root, layer.parent) : null);
}

/** Where create_layer() puts the new layer. */
export enum LayerRelativePosition {
  LPOS_ABOVE,
  LPOS_BELOW,
  LPOS_CHILD,
}

let layer_suffix = 1;

/**
 * Creates a new layer with the next free id "layerNN" and appends it to root after layer (root is
 * layer or an ancestor of it).
 */
export function create_layer(
  root: SPObject,
  layer: SPObject,
  position: LayerRelativePosition,
): SPObject | null {
  const document = root.document;
  let id: string;
  do id = `layer${layer_suffix++}`;
  while (document.getObjectById(id));

  const repr = document.getReprDoc().createElement('svg:g');
  repr.setAttribute('inkscape:groupmode', 'layer');
  repr.setAttribute('id', id);

  if (position === LayerRelativePosition.LPOS_CHILD) {
    root = layer;
    const child_layer = last_child_layer(layer);
    if (child_layer) layer = child_layer;
  }
  if (root === layer) {
    root.getRepr().appendChild(repr);
  } else {
    const layer_repr = layer.getRepr();
    layer_repr.parent()?.addChild(repr, layer_repr);
    if (position === LayerRelativePosition.LPOS_BELOW) {
      // lowerOne(): before the previous sibling
      const prev = repr.prev();
      if (prev) prev.parent()?.changeOrder(repr, prev.prev());
    }
  }
  return document.getObjectByRepr(repr);
}
