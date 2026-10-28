// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/dropper-tool.cpp, src/ui/tools/dropper-tool.h
/*
 * Tool for picking colors from drawing
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 1999-2005 authors
 * Copyright (C) 2001-2002 Ximian, Inc.
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { C_, Colors, DocumentUndo, Preferences, type SPItem } from '@inkscape-web/core';
import { CubicBezier, Path, Point, Rect } from '@inkscape-web/geom';
import type { SPDesktop } from '../../desktop.ts';
import { sp_desktop_set_color } from '../../desktop-style.ts';
import { CanvasItemBpath } from '../../display/control/canvas-item-bpath.ts';
import { sp_export_canvas } from '../../helper/png-write.ts';
import { type ModifierState, mod_alt, mod_ctrl, mod_shift, ToolBase } from './tool-base.ts';

/** Values of /tools/dropper/pick. */
export enum PickMode {
  PICK_VISIBLE,
  PICK_ACTUAL,
}

// Modifiers of the dropper tool, from share/keys/inkscape.xml (upstream Modifiers::Modifier).
/** dropper-dropping: Ctrl */
const dropper_dropping = (s: ModifierState): boolean => mod_ctrl(s);
/** dropper-invert: Alt */
const dropper_invert = (s: ModifierState): boolean => mod_alt(s);
/** dropper-stroke: Shift */
const dropper_stroke = (s: ModifierState): boolean => mod_shift(s);

/** The largest radius, in screen px, of the area to average. */
const MAX_RADIUS = 400;

/**
 * The average color of the pixels of RGBA image data (not premultiplied, as canvases give it),
 * as 0xRRGGBBAA: the channels are weighted by their alpha, the alpha is the mean alpha.
 * `inside` selects the pixels to use (default all). Returns null if no pixel is selected.
 */
export function average_color(
  data: ArrayLike<number>,
  width: number,
  height: number,
  inside: (x: number, y: number) => boolean = () => true,
): { r: number; g: number; b: number; a: number } | null {
  let n = 0;
  let sa = 0;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inside(x, y)) continue;
      const i = (y * width + x) * 4;
      const a = (data[i + 3] as number) / 255;
      sr += (data[i] as number) * a;
      sg += (data[i + 1] as number) * a;
      sb += (data[i + 2] as number) * a;
      sa += a;
      n++;
    }
  }
  if (n === 0) return null;
  if (sa === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return { r: sr / sa / 255, g: sg / sa / 255, b: sb / sa / 255, a: sa / n };
}

/** The Color (RGB with opacity) of an average_color() result. */
export function color_from_average(c: { r: number; g: number; b: number; a: number }): Colors.Color {
  return new Colors.Color(Colors.SpaceType.RGB, [c.r, c.g, c.b, c.a]);
}

/** The circle path (four Beziers) of the given center and radius. */
function circle_path(c: Point, r: number): Path {
  const k = 0.5522847498307936 * r;
  const p = (x: number, y: number) => new Point(c.x + x, c.y + y);
  const path = new Path(p(r, 0));
  path.appendCurve(new CubicBezier(p(r, 0), p(r, k), p(k, r), p(0, r)));
  path.appendCurve(new CubicBezier(p(0, r), p(-k, r), p(-r, k), p(-r, 0)));
  path.appendCurve(new CubicBezier(p(-r, 0), p(-r, -k), p(-k, -r), p(0, -r)));
  path.appendCurve(new CubicBezier(p(0, -r), p(k, -r), p(r, -k), p(r, 0)));
  path.close();
  return path;
}

/**
 * The dropper tool (upstream DropperTool): click to set the fill of the selection to the color
 * under the pointer, Shift+click for the stroke, Alt+click for the inverse color, drag to average
 * the colors in a circle. With Ctrl the color of the selection is applied to the object under the
 * pointer. With the preference /tools/dropper/pick = PICK_VISIBLE the color is composed with the
 * page color and has no opacity; /tools/dropper/setalpha says whether picked opacity is assigned.
 *
 * The color comes from rendering the area under the pointer by the browser from the serialized
 * document (see sp_export_canvas()), not from the display tree, at the zoom of the canvas. The
 * picking is async: the color is applied some milliseconds after the button release.
 * TODO: the live color in the status bar and the cursor, the one-time pick signal (used by the
 * fill and stroke dialog), the copy of the color to the clipboard, translucency groups.
 */
export class DropperTool extends ToolBase {
  /** The center of the circle to average, window coordinates, while dragging. */
  centre = new Point(0, 0);
  radius = 0;
  dragging = false;
  readonly #area: CanvasItemBpath;

  constructor(desktop: SPDesktop) {
    super(desktop, '/tools/dropper');
    this.#area = new CanvasItemBpath(desktop.getCanvasControls());
    this.#area.set_stroke(0x0000007f);
    this.#area.set_fill(0x0);
    this.#area.set_visible(false);

    const prefs = Preferences.get();
    if (prefs.getBool('/tools/dropper/selcue')) this.enableSelectionCue();
    if (prefs.getBool('/tools/dropper/gradientdrag')) this.enableGrDrag();
  }

  override destroy(): void {
    this.#area.unlink();
    this.ungrabCanvasEvents();
    super.destroy();
  }

  /**
   * The picked color as it is applied (upstream get_color()): inverted for invert, and without
   * opacity unless the preferences say to pick and assign it.
   */
  static finish_color(picked: Colors.Color, invert: boolean): Colors.Color {
    const prefs = Preferences.get();
    const pick = prefs.getInt('/tools/dropper/pick', PickMode.PICK_ACTUAL);
    const setalpha = prefs.getBool('/tools/dropper/setalpha', true);
    const color = picked.clone();
    if (invert) color.invert();
    if (pick !== PickMode.PICK_ACTUAL || !setalpha) color.enableOpacity(false);
    return color;
  }

  override root_handler(event: Event): boolean {
    let ret = false;
    switch (event.type) {
      case 'pointerdown': {
        const e = event as PointerEvent;
        if (e.button === 0) {
          this.centre = this._windowPoint(e);
          this.dragging = true;
          this.radius = 0;
          this.grabCanvasEvents(e);
          ret = true;
        }
        break;
      }
      case 'pointermove': {
        const e = event as PointerEvent;
        if (!this.dragging || !(e.buttons & 1)) break;
        // Calculate the radius of the average.
        const rw = Math.min(this._windowPoint(e).sub(this.centre).length(), MAX_RADIUS);
        if (rw === 0) break;
        this.radius = rw;
        // Show the circle on the canvas.
        const cd = this._desktopPoint(this.centre);
        this.#area.set_bpath([circle_path(cd, rw / this._desktop.current_zoom())]);
        this.#area.set_visible(true);
        ret = true;
        break;
      }
      case 'pointerup': {
        const e = event as PointerEvent;
        if (e.button !== 0) break;
        this.#area.set_visible(false);
        const was_dragging = this.dragging;
        this.dragging = false;
        this.ungrabCanvasEvents(e);
        if (was_dragging) void this.#apply(e, this.centre, this.radius);
        ret = true;
        break;
      }
      case 'keydown': {
        const e = event as KeyboardEvent;
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          // Prevent the zoom field from activating.
          if (!(mod_ctrl(e) && !e.shiftKey && !e.altKey)) ret = true;
        } else if (e.key === 'Escape') {
          this._desktop.getSelection().clear();
        }
        break;
      }
    }
    return ret || super.root_handler(event);
  }

  /** Pick the color at the release of the button and set it (upstream ButtonReleaseEvent handler). */
  async #apply(state: ModifierState, centre: Point, radius: number): Promise<void> {
    const desktop = this._desktop;
    const stroke = dropper_stroke(state);
    const dropping = dropper_dropping(state);
    const invert = dropper_invert(state);
    const selection = desktop.getSelection();
    const old_selection: SPItem[] = [...selection.items()];

    // Get the color from the selected objects: only if dropping and an object's color is set.
    let picked: Colors.Color | null = null;
    if (dropping) {
      for (const obj of selection.items()) {
        const style = obj.style;
        if (!stroke && style.fill.set) {
          picked = style.fill.getColor().clone();
          picked.addOpacity(style.fill_opacity.as_double());
        } else if (stroke && style.stroke.set) {
          picked = style.stroke.getColor().clone();
          picked.addOpacity(style.stroke_opacity.as_double());
        }
      }
    }
    const drop = !!picked;
    if (drop) {
      // Change the selected object to the object under the cursor.
      const item = desktop.getItemAtPoint(centre, true);
      if (item) selection.set(item);
    } else {
      picked = await this.sample(centre, radius);
    }
    if (!picked || desktop.getTool() !== this) return;

    // Do the actual color setting.
    sp_desktop_set_color(desktop, DropperTool.finish_color(picked, invert), false, !stroke);
    if (!selection.isEmpty()) {
      DocumentUndo.done(desktop.getDocument(), C_('Undo', 'Set picked color'), 'color-picker');
    }
    if (drop) selection.setList(old_selection);
  }

  /**
   * The average color of the pixels of the canvas in the circle with radius around the window point
   * centre (a single pixel for radius 0), over the page color for PICK_VISIBLE.
   */
  async sample(centre: Point, radius: number): Promise<Colors.Color | null> {
    const desktop = this._desktop;
    const prefs = Preferences.get();
    // The pixels of the area, window coordinates (upstream: pick_area = r.roundOutwards()).
    const area =
      radius > 0
        ? new Rect(
            new Point(Math.floor(centre.x - radius), Math.floor(centre.y - radius)),
            new Point(Math.ceil(centre.x + radius), Math.ceil(centre.y + radius)),
          )
        : new Rect(
            new Point(Math.floor(centre.x), Math.floor(centre.y)),
            new Point(Math.floor(centre.x) + 1, Math.floor(centre.y) + 1),
          );
    const width = area.width();
    const height = area.height();
    // The same area in document coordinates.
    const to_doc = (p: Point) =>
      desktop.w2d(desktop.getCanvas().canvas_to_world(p)).transformed(desktop.dt2doc());
    const doc_area = new Rect(to_doc(area.min()), to_doc(area.max()));

    const canvas = await sp_export_canvas(desktop.getDocument(), doc_area, width, height);
    const data = canvas.getContext('2d')?.getImageData(0, 0, width, height).data;
    if (!data) return null;
    const inside =
      radius > 0
        ? (x: number, y: number) =>
            (x + 0.5 + area.left() - centre.x) ** 2 + (y + 0.5 + area.top() - centre.y) ** 2 <=
            radius * radius
        : undefined;
    const avg = average_color(data, width, height, inside);
    if (!avg) return null;
    let color = color_from_average(avg);

    const pick = prefs.getInt('/tools/dropper/pick', PickMode.PICK_ACTUAL);
    if (pick === PickMode.PICK_VISIBLE || avg.a === 0) {
      // Compose with the page color (shown without transparency).
      const bg = desktop.getNamedView().getBackgroundColor();
      bg.setOpacity(1);
      color = bg.composed(color);
    }
    return color;
  }
}
