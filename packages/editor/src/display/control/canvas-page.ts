// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/control/canvas-page.cpp, src/display/control/canvas-page.h
/*
 * Authors:
 *   Martin Owens <doctormo@geek-2.com>
 *
 * Copyright (C) 2021 Martin Owens
 */
import { Colors } from '@inkscape-web/core';
import { Point, type Rect } from '@inkscape-web/geom';
import type { CanvasItemGroup } from './canvas-item.ts';
import { CanvasItemRect } from './canvas-item-rect.ts';
import { CanvasItemText } from './canvas-item-text.ts';

/**
 * The visual representation of one page on a canvas (upstream CanvasPage):
 * a filled background rectangle with a drop shadow below the drawing, and
 * the border, the margin and bleed boxes and the label above it. The items
 * are in desktop coordinates and drawn with screen-sized lines.
 * TODO: checkerboard background, outline mode.
 */
export class CanvasPage {
  static readonly DEFAULT_BACKGROUND_COLOR = 0xffffffff;
  static readonly DEFAULT_BORDER_COLOR = 0x0000001a;
  static readonly DEFAULT_CANVAS_COLOR = 0xffffffff;
  static readonly DEFAULT_MARGIN_COLOR = 0x1699d751;
  static readonly DEFAULT_BLEED_COLOR = 0xbe310e31;
  static readonly DEFAULT_SHADOW_COLOR = 0x000000a0;
  static readonly DEFAULT_SHADOW_COLOR_LIGHT = 0xffffffa0;

  is_selected = false;

  #shadow_size = 0;
  #border_on_top = true;
  #background_color = CanvasPage.DEFAULT_BACKGROUND_COLOR;
  #border_color = CanvasPage.DEFAULT_BORDER_COLOR;
  #canvas_color = CanvasPage.DEFAULT_CANVAS_COLOR;
  #margin_color = CanvasPage.DEFAULT_MARGIN_COLOR;
  #bleed_color = CanvasPage.DEFAULT_BLEED_COLOR;
  #shadow_color = CanvasPage.DEFAULT_SHADOW_COLOR;
  #label_style = 'default';

  #foreground: CanvasItemRect | null = null;
  #background: CanvasItemRect | null = null;
  #margin: CanvasItemRect | null = null;
  #bleed: CanvasItemRect | null = null;
  #label: CanvasItemText | null = null;

  /** Add the page canvas to the given canvas item groups. */
  add(size: Rect, background_group: CanvasItemGroup, border_group: CanvasItemGroup): void {
    // Foreground 'border'
    this.#foreground = new CanvasItemRect(border_group, size);
    this.#foreground.element.setAttribute('class', 'CanvasItemRect:foreground');
    // Background rectangle 'fill'
    this.#background = new CanvasItemRect(background_group, size);
    this.#background.element.setAttribute('class', 'CanvasItemRect:background');
    this.#background.set_stroke(0x00000000);
    this.#margin = new CanvasItemRect(border_group, size);
    this.#margin.element.setAttribute('class', 'CanvasItemRect:margin');
    this.#margin.set_stroke(this.#margin_color);
    this.#bleed = new CanvasItemRect(border_group, size);
    this.#bleed.element.setAttribute('class', 'CanvasItemRect:bleed');
    this.#bleed.set_stroke(this.#bleed_color);
    this.#label = new CanvasItemText(border_group, new Point(0, 0), '{Page Label}');
  }

  /** Remove the page from the canvas. */
  remove(): void {
    for (const item of this.#items()) item.unlink();
    this.#foreground = this.#background = this.#margin = this.#bleed = this.#label = null;
  }

  show(): void {
    for (const item of this.#items()) item.set_visible(true);
  }

  hide(): void {
    for (const item of this.#items()) item.set_visible(false);
  }

  set_guides_visible(show: boolean): void {
    this.#margin?.set_visible(show);
    this.#bleed?.set_visible(show);
  }

  #items() {
    return [this.#foreground, this.#background, this.#margin, this.#bleed, this.#label].filter((i) => !!i);
  }

  /**
   * Update the visual representation of a page on screen.
   *
   * @param size - The size of the page in desktop units
   * @param txt - An optional label for the page
   * @param outline - Disable normal rendering and show as an outline.
   */
  update(
    size: Rect,
    margin: Rect | null,
    bleed: Rect | null,
    txt: string,
    outline = false,
    is_yaxisdown = true,
  ): void {
    // Put these in the preferences?
    let border_on_top = this.#border_on_top;
    const shadow_color = this.#shadow_color;
    const select_color = 0x000000cc;
    let border_color = this.#border_color;

    // This is used when showing the viewport as *not a page* it's mostly
    // never used as the first page is normally the viewport too.
    if (outline) {
      border_on_top = false;
      this.#shadow_size = 0;
      border_color = select_color;
    }

    if (this.#margin) {
      this.#margin.set_stroke(this.#margin_color);
      const vis = !!margin && !margin.equals(size);
      this.#margin.set_visible(vis);
      if (vis && margin) this.#margin.set_rect(margin);
    }
    if (this.#bleed) {
      this.#bleed.set_stroke(this.#bleed_color);
      const vis = !!bleed && !bleed.equals(size);
      this.#bleed.set_visible(vis);
      if (vis && bleed) this.#bleed.set_rect(bleed);
    }
    // This will put the border on the background OR foreground layer as needed.
    for (const [rect, is_foreground] of [
      [this.#foreground, true],
      [this.#background, false],
    ] as const) {
      if (!rect) continue;
      rect.set_rect(size);
      if (is_foreground === border_on_top) {
        rect.set_visible(true);
        rect.set_stroke(this.is_selected ? select_color : border_color);
      } else {
        rect.set_visible(false);
        rect.set_stroke(0x0);
      }
      // This undoes the hide for the background rect, and additionally gives it a fill and shadow.
      if (!is_foreground) {
        rect.set_visible(true);
        rect.set_fill(this.#background_color);
        rect.set_shadow(shadow_color, this.#shadow_size);
      } else {
        rect.set_fill(0x0);
        rect.set_shadow(0x0, 0);
      }
    }
    if (this.#label) this.#updateTextItem(this.#label, size, txt, is_yaxisdown);
  }

  /** Update the page's textual label. */
  #updateTextItem(label: CanvasItemText, page: Rect, txt: string, is_yaxisdown: boolean): void {
    // Default style for the label
    let fontsize = 10.0;
    let foreground = 0xffffffff;
    let background = 0x00000099;
    let selected = 0x0e5bf199;
    let anchor = new Point(0.0, 1.0);
    let coord = page.corner(0);
    let radius = 0.2;

    // Change the colors for whiter/lighter backgrounds
    if (Colors.get_perceptual_lightness(new Colors.Color(this.#canvas_color)) < 0.5) {
      foreground = 0x000000ff;
      background = 0xffffff99;
      selected = 0x50afe7ff;
    }

    if (this.#label_style === 'below') {
      radius = 1.0;
      fontsize = 14.0;
      anchor = new Point(0.5, -0.2);
      coord = new Point(page.midpoint().x, is_yaxisdown ? page.bottom() : page.top());
      if (txt) {
        const bullet = this.is_selected ? ' • ' : '   ';
        txt = bullet + txt + bullet;
      }
    }

    label.set_fontsize(fontsize);
    label.set_fill(foreground);
    label.set_background(this.is_selected ? selected : background);
    label.set_bg_radius(radius);
    label.set_anchor(anchor);
    label.set_coord(coord);
    label.set_visible(txt.length > 0);
    label.set_text(txt);
    label.set_border(4.0);
  }

  setOnTop(on_top: boolean): boolean {
    if (on_top === this.#border_on_top) return false;
    this.#border_on_top = on_top;
    return true;
  }

  setShadow(shadow: number): boolean {
    if (this.#shadow_size === shadow) return false;
    this.#shadow_size = shadow;
    return true;
  }

  /** Set the colors (0xRRGGBBAA). Returns true if any changed. */
  setPageColor(
    border: number,
    bg: number,
    canvas: number,
    margin: number,
    bleed: number,
    shadow: number,
  ): boolean {
    const next = [border, bg, canvas, margin, bleed, shadow];
    const current = [
      this.#border_color,
      this.#background_color,
      this.#canvas_color,
      this.#margin_color,
      this.#bleed_color,
      this.#shadow_color,
    ];
    if (next.every((c, i) => c === current[i])) return false;
    [
      this.#border_color,
      this.#background_color,
      this.#canvas_color,
      this.#margin_color,
      this.#bleed_color,
      this.#shadow_color,
    ] = next as [number, number, number, number, number, number];
    return true;
  }

  setLabelStyle(style: string): boolean {
    if (style === this.#label_style) return false;
    this.#label_style = style;
    return true;
  }
}
