// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/parameter/text.cpp, src/display/control/canvas-item-text.cpp
/*
 * The text that path effects show on the canvas (Path length, Text label).
 *
 * Upstream makes a CanvasItemText in the constructor of each TextParam, on the active desktop. That
 * puts the text on the wrong desktop when another document is active. Here each desktop draws the
 * texts of the effects of its own document.
 */
import { type Effect, LivePathEffectObject, type SPDocument, SPLPEItem, TextParam } from '@inkscape-web/core';
import { Point } from '@inkscape-web/geom';
import type { SPDesktop } from '../desktop.ts';
import { CanvasItemText } from './control/canvas-item-text.ts';

/**
 * Draws the canvas text of the path effects of a document on a desktop, in the temp group. Call
 * update() when the document changes: it adds the texts of the effects that are applied to an item,
 * moves the others and removes the texts of the effects that are not applied any more.
 */
export class LPECanvasTexts {
  readonly #desktop: SPDesktop;
  readonly #doc: SPDocument;
  readonly #items = new Map<TextParam, CanvasItemText>();

  constructor(desktop: SPDesktop, doc: SPDocument) {
    this.#desktop = desktop;
    this.#doc = doc;
  }

  update(): void {
    const wanted = new Set<TextParam>();
    for (const obj of this.#doc.getDefs()?.children ?? []) {
      if (!(obj instanceof LivePathEffectObject)) continue;
      // The items that use the effect (not getCurrrentLPEItems(): the flag "deleted" of the object stays set after an undo).
      const lpe = obj.get_lpe();
      if (!lpe || !obj.hrefList.some((o) => o instanceof SPLPEItem)) continue;
      for (const param of textParams(lpe)) wanted.add(param);
    }
    for (const [param, item] of this.#items) {
      if (!wanted.has(param) || !param.canvasText()) {
        item.unlink();
        this.#items.delete(param);
      }
    }
    for (const param of wanted) {
      const data = param.canvasText();
      if (!data) continue;
      let item = this.#items.get(param);
      if (!item) {
        item = new CanvasItemText(this.#desktop.getCanvasTemp(), new Point(0, 0), data.text);
        this.#items.set(param, item);
      }
      item.set_text(data.text);
      item.set_coord(data.pos);
      item.set_anchor(data.anchor);
    }
  }

  destroy(): void {
    for (const item of this.#items.values()) item.unlink();
    this.#items.clear();
  }
}

function textParams(lpe: Effect): TextParam[] {
  return lpe.param_vector.filter((p): p is TextParam => p instanceof TextParam);
}
