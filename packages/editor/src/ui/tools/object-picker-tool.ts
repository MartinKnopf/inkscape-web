// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/object-picker-tool.cpp, src/ui/tools/object-picker-tool.h
import { Signal, type SPObject } from '@inkscape-web/core';
import { Point, Rect } from '@inkscape-web/geom';
import { set_active_tool } from '../../actions/actions-tools.ts';
import type { SPDesktop } from '../../desktop.ts';
import { CanvasItemRect } from '../../display/control/canvas-item-rect.ts';
import { CanvasItemText } from '../../display/control/canvas-item-text.ts';
import { ToolBase } from './tool-base.ts';

/** Label text size. */
const fontsize = 12;

/** The item, or else the page, at the window point. */
export function get_item_at(desktop: SPDesktop, point: Point): SPObject | null {
  const item = desktop.getItemAtPoint(point, false);
  if (item) return item;
  const pt = desktop.w2d(desktop.getCanvas().canvas_to_world(point));
  return desktop.getDocument().getPageManager().findPageAt(pt);
}

/**
 * The object picker tool (upstream ObjectPickerTool): shows the id of the object under the
 * pointer, and reports the object clicked with the left button. Dialogs use it to pick an object.
 * If no handler of object_picked claims the click (returns true) the tool switches back to the
 * tool that was active before. TODO: the status bar message.
 */
export class ObjectPickerTool extends ToolBase {
  /** The slot of upstream signal_object_picked: gets the picked object, returns true to keep the tool active. */
  readonly object_picked: { handler: ((object: SPObject) => boolean) | null } = { handler: null };
  /** Emitted when the tool is destroyed. */
  readonly signal_tool_switched = new Signal<[]>();
  readonly #label: CanvasItemText;
  readonly #frame: CanvasItemRect;
  readonly #disconnectZoom: () => void;

  constructor(desktop: SPDesktop) {
    super(desktop, '/tools/picker');
    // Text label and its frame.
    const group = desktop.getCanvasTemp();
    this.#frame = new CanvasItemRect(group);
    this.#label = new CanvasItemText(group);
    this.#label.set_fontsize(fontsize);
    this.#label.set_fill(0x000000ff); // black text
    this.#label.set_background(0xffffffbf); // white with some transparency
    this.#label.set_border(4);
    this.#label.set_visible(false);
    this.#frame.set_shadow(0x00000020, 1);
    this.#frame.set_stroke(0); // transparent
    this.#frame.set_visible(false);
    // Erase the text on zoom; it doesn't scale well.
    this.#disconnectZoom = desktop.signal_zoom_changed.connect(() => this.show_text(new Point(0, 0), null));
  }

  override destroy(): void {
    this.#disconnectZoom();
    this.#label.unlink();
    this.#frame.unlink();
    this.ungrabCanvasEvents();
    this.signal_tool_switched.emit();
    super.destroy();
  }

  override root_handler(event: Event): boolean {
    let handled = false;
    let switch_back = false;
    if (event.type === 'pointermove') {
      const cursor = this._windowPoint(event as PointerEvent);
      this.show_text(cursor, get_item_at(this._desktop, cursor)?.getId() ?? null);
    } else if (event.type === 'pointerdown' && (event as PointerEvent).button === 0) {
      const cursor = this._windowPoint(event as PointerEvent);
      const item = get_item_at(this._desktop, cursor);
      this.show_text(cursor, item?.getId() ?? null);
      if (item && !this.object_picked.handler?.(item)) switch_back = true;
    }
    if (switch_back) {
      const last = this.get_last_active_tool();
      if (last) set_active_tool(this._desktop, last);
      handled = true;
    }
    return handled || super.root_handler(event);
  }

  /** Show text above the window point cursor; null hides the label. */
  show_text(cursor: Point, text: string | null): void {
    this.#label.set_visible(false);
    this.#frame.set_visible(false);
    const desktop = this._desktop;
    if (text === null) return;
    const position = desktop.w2d(
      desktop.getCanvas().canvas_to_world(new Point(cursor.x, cursor.y - 2.5 * fontsize)),
    );
    this.#label.set_text(text);
    this.#label.set_coord(position);
    this.#label.set_visible(true);
    // The text size is not measured in the port: estimate it from the character count.
    const zoom = desktop.current_zoom();
    const w = (text.length * fontsize * 0.6 + 8) / zoom;
    const h = (fontsize + 8) / zoom;
    this.#frame.set_rect(
      new Rect(
        new Point(position.x - w / 2, position.y - h / 2),
        new Point(position.x + w / 2, position.y + h / 2),
      ),
    );
    this.#frame.set_visible(true);
  }
}
