// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/booleans-builder.cpp, src/ui/tools/booleans-builder.h
/*
 * Boolean tool shape builder.
 *
 * Authors:
 *   Martin Owens
 *
 * Copyright (C) 2022 Authors
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import {
  Colors,
  i2anc_affine,
  type ObjectSet,
  SPClipPath,
  SPImage,
  SPItem,
  type SPObject,
  SPUse,
  SPWindRule,
  sp_svg_transform_write,
  sp_svg_write_path,
} from '@inkscape-web/core';
import { Affine, PathVector, type Point } from '@inkscape-web/geom';
import type { SPDesktop } from '../../desktop.ts';
import { CanvasItemBpath } from '../../display/control/canvas-item-bpath.ts';
import { SubItem } from './booleans-subitems.ts';

/** A fragment and the canvas item that shows it. */
interface ItemPair {
  work: SubItem;
  vis: CanvasItemBpath;
  visible: boolean;
}

export enum TaskType {
  NONE,
  ADD,
  DELETE,
}

// The fill colors by task type * 2 + selected, on light and dark desks.
const fill_lite = [0x00000055, 0x0291ffff, 0x8eceffff, 0x0291ffff, 0xf299d6ff, 0xff0db3ff] as const;
const fill_dark = [0xffffff55, 0x0291ffff, 0x8eceffff, 0x0291ffff, 0xf299d6ff, 0xff0db3ff] as const;

/**
 * The fragments of the shape builder (upstream BooleanBuilder): the selected items cut into
 * all their pieces (or flattened), drawn over the canvas. A task (a click or drag) collects
 * fragments to unite (ADD) or delete; task_commit() applies it with an undo step of its own,
 * and shape_commit() writes the fragments to the document.
 * TODO: enable_undo_actions (the builder's undo steps in doc.undo), images shown on the canvas.
 */
export class BooleanBuilder {
  readonly #set: ObjectSet;
  /** The desktop of the set; null for a set without desktop (no canvas items). */
  readonly #desktop: SPDesktop | null;

  #work_items: SubItem[];
  #screen_items: ItemPair[] = [];
  #work_task: SubItem | null = null;
  #screen_task: CanvasItemBpath | null = null;
  #add_task = false;
  #dark = false;

  // Lists of _work_items which can be brought back.
  readonly #undo: SubItem[][] = [];
  readonly #redo: SubItem[][] = [];

  readonly #desk_modified_connection: (() => void) | null = null;

  constructor(set: ObjectSet, flatten = false) {
    this.#set = set;
    // The selections of the editor belong to an SPDesktop.
    this.#desktop = set.desktop() as SPDesktop | null;
    // Current state of all the items
    this.#work_items = (flatten ? SubItem.build_flatten : SubItem.build_mosaic)(set.items());

    if (this.#desktop) {
      // TODO: Somehow show the image subitems to the user.
      const nv = this.#desktop.getNamedView();
      this.#desk_modified_connection = nv.modifiedSignal.connect(() => this.#redraw_items());
      this.#redraw_items();
    }
  }

  /** Remove the canvas items. */
  destroy(): void {
    this.#desk_modified_connection?.();
    for (const si of this.#screen_items) si.vis.unlink();
    this.#screen_items = [];
    this.#screen_task?.unlink();
    this.#screen_task = null;
  }

  has_items(): boolean {
    return this.#work_items.length > 0;
  }
  has_task(): boolean {
    return !!this.#work_task;
  }
  has_changes(): boolean {
    return this.#undo.length > 0;
  }

  /** The current fragments. */
  work_items(): readonly SubItem[] {
    return this.#work_items;
  }

  /** Control the visual appearence of this particular bpath */
  #redraw_item(bpath: CanvasItemBpath, selected: boolean, task: TaskType, image: boolean): void {
    const i = task * 2 + Number(selected);
    let fill: number = (this.#dark ? fill_dark : fill_lite)[i] ?? 0;
    if (image) {
      // Make image items less opaque
      fill = ((fill | 0xff) - 0xcc) >>> 0;
    }
    bpath.set_fill(fill, SPWindRule.SP_WIND_RULE_POSITIVE);
    bpath.set_stroke(task === TaskType.NONE ? 0x000000dd : 0xffffffff);
    bpath.set_stroke_width(task === TaskType.NONE ? 1.0 : 3.0);
  }

  /** Update to visuals with the latest subitem list. */
  #redraw_items(): void {
    const desktop = this.#desktop;
    if (!desktop) return;

    this.#dark = Colors.get_perceptual_lightness(desktop.getNamedView().getDeskColor()) < 0.5;

    for (const si of this.#screen_items) si.vis.unlink();
    this.#screen_items = [];

    for (const subitem of this.#work_items) {
      // Construct BPath from each subitem!
      const bpath = new CanvasItemBpath(desktop.getCanvasControls(), subitem.get_pathv(), false);
      this.#redraw_item(bpath, subitem.getSelected(), TaskType.NONE, subitem.is_image());
      this.#screen_items.push({ work: subitem, vis: bpath, visible: true });
    }
    this.#screen_task?.raise_to_top();
  }

  /** The fragment at the desktop point. */
  get_item(point: Point): ItemPair | null {
    const world = this.#world(point);
    for (const pair of this.#screen_items) {
      if (pair.vis.contains(world, 2.0)) return pair;
    }
    return null;
  }

  /** Highlight any shape under the mouse at this point. */
  highlight(point: Point, add = true): boolean {
    if (this.has_task()) return true;

    const world = this.#world(point);
    let done = false;
    for (const si of this.#screen_items) {
      const hover: boolean = !done && si.vis.contains(world, 2.0);
      const task = hover ? (add ? TaskType.ADD : TaskType.DELETE) : TaskType.NONE;
      this.#redraw_item(si.vis, si.work.getSelected(), task, si.work.is_image());
      if (hover) si.vis.raise_to_top();
      done = done || hover;
    }
    return done;
  }

  /** Returns true if this root item contains an image work item. */
  contains_image(root: SPItem): boolean {
    return this.#work_items.some((subitem) => subitem.get_root() === root && subitem.is_image());
  }

  /** Select the shape under the cursor */
  task_select(point: Point, add_task = true): boolean {
    if (this.has_task()) this.task_cancel();
    const si = this.get_item(point);
    if (!si) return false;
    this.#add_task = add_task;
    this.#work_task = si.work.clone();
    this.#work_task.setSelected(true);
    if (this.#desktop) {
      this.#screen_task = new CanvasItemBpath(
        this.#desktop.getCanvasControls(),
        this.#work_task.get_pathv(),
        false,
      );
      const task = add_task ? TaskType.ADD : TaskType.DELETE;
      this.#redraw_item(this.#screen_task, true, task, this.#work_task.is_image());
    }
    si.vis.set_visible(false);
    si.visible = false;
    this.#redraw_item(si.vis, false, TaskType.NONE, this.#work_task.is_image());
    return true;
  }

  /** Add the fragment under the cursor to the task. */
  task_add(point: Point): boolean {
    if (!this.#work_task) return false;
    const si = this.get_item(point);
    // Invisible items are already processed.
    if (!si?.visible) return false;
    si.vis.set_visible(false);
    si.visible = false;
    this.#work_task.add(si.work);
    this.#screen_task?.set_bpath(this.#work_task.get_pathv(), false);
    return true;
  }

  task_cancel(): void {
    this.#work_task = null;
    this.#screen_task?.unlink();
    this.#screen_task = null;
    for (const si of this.#screen_items) {
      si.vis.set_visible(true);
      si.visible = true;
    }
  }

  task_commit(): void {
    if (!this.#work_task) return;

    // Manage undo/redo
    this.#undo.push(this.#work_items);
    this.#redo.length = 0;

    // A. Delete all items from _work_items that aren't visible
    this.#work_items = this.#screen_items.filter((si) => si.visible).map((si) => si.work);
    if (this.#add_task) {
      // B. Add _work_task to _work_items for union tasks
      this.#work_items.push(this.#work_task);
    }

    // C. Reset everything
    this.#work_task = null;
    this.#screen_task?.unlink();
    this.#screen_task = null;
    this.#redraw_items();
  }

  /**
   * Commit the changes to the document (finish). Returns the new objects, or the items of the
   * set without changes (unless all). replace deletes the original items.
   */
  shape_commit(all = false, replace = true): SPObject[] {
    const ret: SPObject[] = [];
    const used_images = new Map<SPItem, SPItem>();
    const doc = this.#set.document();
    const items = this.#set.items();
    const defs = doc?.getDefs();

    // Only commit anything if we have changes, return selection.
    if ((!this.has_changes() && !all) || !doc || !defs) return [...items];
    const xml_doc = doc.getReprDoc();

    // Count number of selected items.
    const selected = this.#work_items.filter((subitem) => subitem.getSelected()).length;

    for (const subitem of this.#work_items) {
      // Either this object is selected, or no objects are selected at all.
      if (!subitem.getSelected() && selected) continue;
      let root = subitem.get_root();
      let item = subitem.get_item();
      let style = subitem.getStyle();
      // For the rare occasion the user generates from a hole (no item)
      if (!root) {
        root = items[0] ?? null;
        style = root?.style ?? null;
      }
      if (!root || !style) {
        console.warn("Can't generate itemless object in boolean-builder.");
        continue;
      }
      const parent = root.parent;
      if (!(parent instanceof SPItem)) {
        console.warn("Can't generate top-most object in boolean-builder.");
        continue;
      }

      let repr = xml_doc.createElement('svg:path');
      repr.setAttribute(
        'd',
        sp_svg_write_path(PathVector.transformed(subitem.get_pathv(), parent.dt2iAffine())),
      );
      repr.setAttribute('style', style.writeIfDiff(parent.style));

      // Images and clipped clones are re/clipped instead of path-constructs
      if ((item instanceof SPImage || item instanceof SPUse) && item.getId()) {
        if (item instanceof SPImage) {
          // An image may have been contained without groups or layers with transforms
          // moving it to the defs would lose this information. So we add it in now.
          const tr = i2anc_affine(item, parent);

          // Make a copy of the image when not replacing it
          const used = used_images.get(item);
          if (!used) {
            const orig = item;
            if (item.parent !== defs && !replace) {
              const copy_repr = item.getRepr().duplicate(xml_doc);
              item = defs.appendChildRepr(copy_repr) as SPItem;
            }
            item.setAttributeOrRemoveIfEmpty('transform', sp_svg_transform_write(tr));
            used_images.set(orig, item);
          } else {
            // Make sure the id we use below is the copy, or the original dependiong on replace
            item = used;
          }
        }

        // Consume existing repr as the clipPath and replace with clone of image
        let clone_tr = Affine.identity();
        const clip_id = SPClipPath.create([repr], doc);
        let href_id = `#${item.getId()}`;

        if (item instanceof SPUse) {
          href_id = item.getAttribute('xlink:href') ?? href_id;
          clone_tr = i2anc_affine(item, parent);
          // Remove the original clone's transform from the new clip object
          repr.setAttribute('transform', sp_svg_transform_write(clone_tr.inverse()));
        }

        repr = xml_doc.createElement('svg:use');
        repr.setAttribute('x', '0');
        repr.setAttribute('y', '0');
        repr.setAttribute('xlink:href', href_id);
        repr.setAttribute('clip-path', `url(#${clip_id})`);
        repr.setAttribute('transform', sp_svg_transform_write(clone_tr));
      }

      parent.getRepr().addChild(repr, root.getRepr());
      const object = doc.getObjectByRepr(repr);
      if (object) ret.push(object);
    }
    this.#work_items = [];

    for (const item of used_images.values()) {
      // Images that are used in a fragment are moved,
      if (item.parent !== defs && replace) {
        const img_repr = item.getRepr();
        img_repr.parent()?.removeChild(img_repr);
        defs.getRepr().appendChild(img_repr);
      }
    }

    // Apart from the used images, everything else is to be deleted.
    if (replace) {
      for (const item of items) {
        if (!used_images.has(item)) item.deleteObject();
      }
    }

    return ret;
  }

  undo(): void {
    const prev = this.#undo.pop();
    if (!prev) return;
    // Cancel any task;
    this.task_cancel();
    // Shuffle the undo stack
    this.#redo.push(this.#work_items);
    this.#work_items = prev;
    // Redraw the screen items
    this.#redraw_items();
  }

  redo(): void {
    const next = this.#redo.pop();
    if (!next) return;
    // Cancel any task;
    this.task_cancel();
    // Shuffle the undo stack
    this.#undo.push(this.#work_items);
    this.#work_items = next;
    // Redraw the screen items
    this.#redraw_items();
  }

  /** The world (canvas) point of a desktop point. */
  #world(point: Point): Point {
    return this.#desktop ? point.transformed(this.#desktop.getCanvas().get_affine()) : point;
  }
}
