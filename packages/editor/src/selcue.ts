// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/selcue.cpp, src/selcue.h
/*
 * Helper object for showing selected items
 *
 * Authors:
 *   bulia byak <bulia@users.sf.net>
 *   Carl Hetherington <inkscape@carlh.net>
 *   Abhishek Sharma
 *
 * Copyright (C) 2004 Authors
 */
import { Preferences, type Selection, type SPItem } from '@inkscape-web/core';
import type { SPDesktop } from './desktop.ts';
import { CanvasItemRect } from './display/control/canvas-item-rect.ts';

export enum SelCueType {
  NONE,
  MARK,
  BBOX,
}

/**
 * Shows which items are selected: a dashed bounding box around each item
 * (upstream SelCue, mode BBOX: /options/selcue/value is 2 in the default preferences).
 * TODO: MARK mode (a diamond at each item), anchor lines, text baselines,
 * observing /tools/bounding_box.
 */
export class SelCue {
  readonly #desktop: SPDesktop;
  readonly #selection: Selection;
  #item_bboxes: CanvasItemRect[] = [];
  #bboxes_visible = true;
  readonly #disconnect: (() => void)[];

  constructor(desktop: SPDesktop) {
    this.#desktop = desktop;
    this.#selection = desktop.getSelection();
    this.#disconnect = [
      this.#selection.connectChanged(() => this.#newItemBboxes()),
      this.#selection.connectModified(() => this.#updateItemBboxes()),
    ];
    this.#updateItemBboxes();
  }

  destroy(): void {
    for (const disconnect of this.#disconnect) disconnect();
    this.#clear();
  }

  setBboxesVisible(visible: boolean): void {
    this.#bboxes_visible = visible;
    this.#updateItemBboxes();
  }

  #mode(): SelCueType {
    return Preferences.get().getInt('/options/selcue/value', SelCueType.BBOX);
  }

  #bbox(item: SPItem) {
    const prefs_bbox = Preferences.get().getInt('/tools/bounding_box', 0);
    return prefs_bbox === 0 ? item.desktopVisualBounds() : item.desktopGeometricBounds();
  }

  #updateItemBboxes(): void {
    if (this.#mode() === SelCueType.NONE) return;
    const items = this.#selection.items();
    if (this.#item_bboxes.length !== items.length) {
      this.#newItemBboxes();
      return;
    }
    items.forEach((item, i) => {
      const rect = this.#item_bboxes[i];
      const b = this.#bbox(item);
      if (!rect) return;
      if (b) {
        rect.set_rect(b);
        rect.set_visible(this.#bboxes_visible);
      } else {
        // no bbox
        rect.set_visible(false);
      }
    });
  }

  #newItemBboxes(): void {
    this.#clear();
    // TODO: MARK mode.
    if (this.#mode() !== SelCueType.BBOX) return;
    for (const item of this.#selection.items()) {
      const bbox = this.#bbox(item);
      if (!bbox) continue;
      const rect = new CanvasItemRect(this.#desktop.getCanvasControls(), bbox);
      rect.set_stroke(0xffffffa0);
      rect.set_shadow(0x0000c0a0, 1);
      rect.set_dashed(true);
      rect.lower_to_bottom(); // Just low enough to not get in the way of other draggable knots.
      rect.set_visible(this.#bboxes_visible);
      this.#item_bboxes.push(rect);
    }
  }

  #clear(): void {
    for (const rect of this.#item_bboxes) rect.unlink();
    this.#item_bboxes = [];
  }
}
