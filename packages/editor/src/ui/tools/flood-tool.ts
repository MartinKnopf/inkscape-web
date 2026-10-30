// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/flood-tool.cpp, src/ui/tools/flood-tool.h
/*
 * Bucket fill drawing context, works by bitmap filling an area on a rendered version
 * of the current display and then tracing the result using potrace.
 *
 * Author:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   John Bintz <jcoswell@coswellproductions.org>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2006      Johan Engelen <johan@shouraizou.nl>
 * Copyright (C) 2000-2005 authors
 * Copyright (C) 2000-2001 Ximian, Inc.
 */
import {
  _,
  C_,
  convertUnit,
  DocumentUndo,
  GrayMap,
  N_,
  NC_,
  PotraceTracingEngine,
  Preferences,
  pathUnion,
  SPItem,
  sp_svg_transform_read,
  sp_svg_transform_write,
  sp_svg_write_path,
  traceBackend,
} from '@inkscape-web/core';
import { Affine, Point, Rect, Translate } from '@inkscape-web/geom';
import { have_viable_layer } from '../../context-fns.ts';
import type { SPDesktop } from '../../desktop.ts';
import { sp_export_canvas } from '../../helper/png-write.ts';
import { Rubberband, RubberbandMode, RubberbandTouchpathHandle } from '../../rubberband.ts';
import { type ModifierState, mod_alt, mod_ctrl, mod_ctrl_only, mod_shift, ToolBase } from './tool-base.ts';

/** Must match PaintBucketChannels enum */
export const channel_list: readonly string[] = [
  N_('Visible Colors'),
  N_('Red'),
  N_('Green'),
  N_('Blue'),
  N_('Hue'),
  N_('Saturation'),
  N_('Lightness'),
  N_('Alpha'),
];

/** The Close gaps choices (msgids of the context "Flood autogap"). */
export const gap_list: readonly string[] = [
  NC_('Flood autogap', 'None'),
  NC_('Flood autogap', 'Small'),
  NC_('Flood autogap', 'Medium'),
  NC_('Flood autogap', 'Large'),
];

export enum PaintBucketChannels {
  FLOOD_CHANNELS_RGB,
  FLOOD_CHANNELS_R,
  FLOOD_CHANNELS_G,
  FLOOD_CHANNELS_B,
  FLOOD_CHANNELS_H,
  FLOOD_CHANNELS_S,
  FLOOD_CHANNELS_L,
  FLOOD_CHANNELS_ALPHA,
}

// Modifiers (upstream Modifiers::Modifier, src/ui/modifiers.cpp).
/** flood-item: Ctrl */
const mod_flood_item = (s: ModifierState): boolean => mod_ctrl(s);
/** flood-touch-fill: Alt */
const mod_flood_touch_fill = (s: ModifierState): boolean => mod_alt(s);
/** select-add-to: Shift */
const mod_select_add_to = (s: ModifierState): boolean => mod_shift(s);

// Pixels are Cairo ARGB32 values: premultiplied alpha, (a << 24 | r << 16 | g << 8 | b).
const A = (px: number) => (px >>> 24) & 0xff;
const R = (px: number) => (px >>> 16) & 0xff;
const G = (px: number) => (px >>> 8) & 0xff;
const B = (px: number) => px & 0xff;
const assemble = (a: number, r: number, g: number, b: number) => ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;

/** Upstream unpremul_alpha of display/cairo-utils.h. */
function unpremul_alpha(color: number, alpha: number): number {
  if (color >= alpha) return 0xff;
  return Math.trunc((255 * color + Math.trunc(alpha / 2)) / alpha);
}

function compose_onto(px: number, bg: number): number {
  const ap = A(px);
  const ro = Math.trunc(((255 - ap) * R(bg) + 255 * R(px) + 127) / 255);
  const go = Math.trunc(((255 - ap) * G(bg) + 255 * G(px) + 127) / 255);
  const bo = Math.trunc(((255 - ap) * B(bg) + 255 * B(px) + 127) / 255);
  return assemble(255, ro, go, bo);
}

/** HSL (each 0..1) of an RGB color with components 0..1 (upstream: Color::set to an HSL color). */
function to_hsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

/** Check whether two unsigned integers are close to each other: |a-b| <= d. */
function compare_uint32(a: number, b: number, d: number): boolean {
  return Math.abs(a - b) <= d;
}

/**
 * Compare a pixel in a pixel buffer with another pixel to determine if a point should be included in the fill operation.
 * @param check The pixel in the pixel buffer to check.
 * @param orig The original selected pixel to use as the fill target color.
 * @param merged_orig_pixel The original pixel merged with the background.
 * @param dtc The desktop background color.
 * @param threshold The fill threshold.
 * @param method The fill method to use as defined in PaintBucketChannels.
 */
export function compare_pixels(
  check: number,
  orig: number,
  merged_orig_pixel: number,
  dtc: number,
  threshold: number,
  method: PaintBucketChannels,
): boolean {
  const [ac, rc, gc, bc] = [A(check), R(check), G(check), B(check)];
  const [ao, ro, go, bo] = [A(orig), R(orig), G(orig), B(orig)];
  const [rd, gd, bd] = [R(dtc), G(dtc), B(dtc)];
  const [amop, rmop, gmop, bmop] = [
    A(merged_orig_pixel),
    R(merged_orig_pixel),
    G(merged_orig_pixel),
    B(merged_orig_pixel),
  ];

  let hsl_orig: [number, number, number] = [0, 0, 0];
  let hsl_check: [number, number, number] = [0, 0, 0];
  if (
    method === PaintBucketChannels.FLOOD_CHANNELS_H ||
    method === PaintBucketChannels.FLOOD_CHANNELS_S ||
    method === PaintBucketChannels.FLOOD_CHANNELS_L
  ) {
    hsl_orig = to_hsl(ro / ao, go / ao, bo / ao);
    hsl_check = to_hsl(rc / ac, gc / ac, bc / ac);
  }

  switch (method) {
    case PaintBucketChannels.FLOOD_CHANNELS_ALPHA:
      return compare_uint32(ac, ao, threshold);
    case PaintBucketChannels.FLOOD_CHANNELS_R:
      return compare_uint32(ac ? unpremul_alpha(rc, ac) : 0, ao ? unpremul_alpha(ro, ao) : 0, threshold);
    case PaintBucketChannels.FLOOD_CHANNELS_G:
      return compare_uint32(ac ? unpremul_alpha(gc, ac) : 0, ao ? unpremul_alpha(go, ao) : 0, threshold);
    case PaintBucketChannels.FLOOD_CHANNELS_B:
      return compare_uint32(ac ? unpremul_alpha(bc, ac) : 0, ao ? unpremul_alpha(bo, ao) : 0, threshold);
    case PaintBucketChannels.FLOOD_CHANNELS_RGB: {
      const amc = 255; // Why are we looking at desktop? Cairo version ignores destop alpha
      const rmc = Math.trunc(((255 - ac) * rd + 255 * rc + 127) / 255);
      const gmc = Math.trunc(((255 - ac) * gd + 255 * gc + 127) / 255);
      const bmc = Math.trunc(((255 - ac) * bd + 255 * bc + 127) / 255);

      let diff = 0; // The total difference between each of the 3 color components
      diff += Math.abs(unpremul_alpha(rmc, amc) - (amop ? unpremul_alpha(rmop, amop) : 0));
      diff += Math.abs(unpremul_alpha(gmc, amc) - (amop ? unpremul_alpha(gmop, amop) : 0));
      diff += Math.abs(unpremul_alpha(bmc, amc) - (amop ? unpremul_alpha(bmop, amop) : 0));
      return Math.trunc(diff / 3) <= Math.trunc((threshold * 3) / 4);
    }
    case PaintBucketChannels.FLOOD_CHANNELS_H:
      return Math.trunc(Math.abs(hsl_check[0] - hsl_orig[0]) * 100.0) <= threshold;
    case PaintBucketChannels.FLOOD_CHANNELS_S:
      return Math.trunc(Math.abs(hsl_check[1] - hsl_orig[1]) * 100.0) <= threshold;
    case PaintBucketChannels.FLOOD_CHANNELS_L:
      return Math.trunc(Math.abs(hsl_check[2] - hsl_orig[2]) * 100.0) <= threshold;
  }
  return false;
}

const PIXEL_CHECKED = 1;
const PIXEL_QUEUED = 2;
const PIXEL_PAINTABLE = 4;
const PIXEL_NOT_PAINTABLE = 8;
const PIXEL_COLORED = 16;

// The trace pixel buffer: flags per pixel; t is the pixel index.
type Trace = Uint8Array;
const is_pixel_checked = (tr: Trace, t: number) => ((tr[t] ?? 0) & PIXEL_CHECKED) === PIXEL_CHECKED;
const is_pixel_queued = (tr: Trace, t: number) => ((tr[t] ?? 0) & PIXEL_QUEUED) === PIXEL_QUEUED;
const is_pixel_paintability_checked = (tr: Trace, t: number) =>
  ((tr[t] ?? 0) & PIXEL_PAINTABLE) !== 0 && ((tr[t] ?? 0) & PIXEL_NOT_PAINTABLE) === 0;
const is_pixel_paintable = (tr: Trace, t: number) => ((tr[t] ?? 0) & PIXEL_PAINTABLE) === PIXEL_PAINTABLE;
const is_pixel_colored = (tr: Trace, t: number) => ((tr[t] ?? 0) & PIXEL_COLORED) === PIXEL_COLORED;
const mark_pixel_checked = (tr: Trace, t: number) => {
  tr[t] = (tr[t] ?? 0) | PIXEL_CHECKED;
};
const mark_pixel_queued = (tr: Trace, t: number) => {
  tr[t] = (tr[t] ?? 0) | PIXEL_QUEUED;
};
const mark_pixel_paintable = (tr: Trace, t: number) => {
  tr[t] = ((tr[t] ?? 0) | PIXEL_PAINTABLE) ^ PIXEL_NOT_PAINTABLE;
};
const mark_pixel_not_paintable = (tr: Trace, t: number) => {
  tr[t] = ((tr[t] ?? 0) | PIXEL_NOT_PAINTABLE) ^ PIXEL_PAINTABLE;
};
const mark_pixel_colored = (tr: Trace, t: number) => {
  tr[t] = (tr[t] ?? 0) | PIXEL_COLORED;
};
const clear_pixel_paintability = (tr: Trace, t: number) => {
  tr[t] = (tr[t] ?? 0) ^ PIXEL_PAINTABLE ^ PIXEL_NOT_PAINTABLE;
};

interface BitmapCoordsInfo {
  is_left: boolean;
  x: number;
  y: number;
  y_limit: number;
  width: number;
  height: number;
  threshold: number;
  radius: number;
  method: PaintBucketChannels;
  dtc: number;
  merged_orig_pixel: number;
  bbox: Rect;
  screen: Rect;
  max_queue_size: number;
  current_step: number;
}

/** A double-ended queue of points (upstream std::deque<Geom::Point>). */
class FillQueue {
  #items: [number, number][] = [];
  #head = 0;
  get size(): number {
    return this.#items.length - this.#head;
  }
  empty(): boolean {
    return this.size === 0;
  }
  front(): [number, number] {
    return this.#items[this.#head] as [number, number];
  }
  pop_front(): void {
    this.#head++;
    if (this.#head > 1024 && this.#head * 2 > this.#items.length) {
      this.#items = this.#items.slice(this.#head);
      this.#head = 0;
    }
  }
  push_back(p: [number, number]): void {
    this.#items.push(p);
  }
  push_front(p: [number, number]): void {
    if (this.#head > 0) this.#items[--this.#head] = p;
    else this.#items.unshift(p);
  }
  /** The points, front first, for sorting; set them back with assign(). */
  toArray(): [number, number][] {
    return this.#items.slice(this.#head);
  }
  assign(items: [number, number][]): void {
    this.#items = items;
    this.#head = 0;
  }
}

/** Check if a pixel can be included in the fill. */
function check_if_pixel_is_paintable(
  px: Uint32Array,
  trace_px: Trace,
  t: number,
  x: number,
  y: number,
  orig_color: number,
  bci: BitmapCoordsInfo,
): boolean {
  if (is_pixel_paintability_checked(trace_px, t)) return is_pixel_paintable(trace_px, t);
  const pixel = px[x + y * bci.width] ?? 0;
  if (compare_pixels(pixel, orig_color, bci.merged_orig_pixel, bci.dtc, bci.threshold, bci.method)) {
    mark_pixel_paintable(trace_px, t);
    return true;
  }
  mark_pixel_not_paintable(trace_px, t);
  return false;
}

enum ScanlineCheckResult {
  OK,
  ABORTED,
  BOUNDARY,
}

/** Determine if the provided coordinates are within the pixel buffer limits. */
const coords_in_range = (x: number, y: number, bci: BitmapCoordsInfo) =>
  x >= 0 && y >= 0 && x < bci.width && y < bci.height;

const PAINT_DIRECTION_LEFT = 1;
const PAINT_DIRECTION_RIGHT = 2;
const PAINT_DIRECTION_UP = 4;
const PAINT_DIRECTION_DOWN = 8;
const PAINT_DIRECTION_ALL = 15;

/** Paint a pixel or a square (if autogap is enabled) on the trace pixel buffer. */
function paint_pixel(
  px: Uint32Array,
  trace_px: Trace,
  orig_color: number,
  bci: BitmapCoordsInfo,
  original_point_trace_t: number,
): number {
  if (bci.radius === 0) {
    mark_pixel_colored(trace_px, original_point_trace_t);
    return PAINT_DIRECTION_ALL;
  }
  let can_paint_up = true;
  let can_paint_down = true;
  let can_paint_left = true;
  let can_paint_right = true;

  for (let ty = bci.y - bci.radius; ty <= bci.y + bci.radius; ty++) {
    for (let tx = bci.x - bci.radius; tx <= bci.x + bci.radius; tx++) {
      if (coords_in_range(tx, ty, bci)) {
        const t = tx + ty * bci.width;
        if (!is_pixel_colored(trace_px, t)) {
          if (check_if_pixel_is_paintable(px, trace_px, t, tx, ty, orig_color, bci)) {
            mark_pixel_colored(trace_px, t);
          } else {
            if (tx < bci.x) can_paint_left = false;
            if (tx > bci.x) can_paint_right = false;
            if (ty < bci.y) can_paint_up = false;
            if (ty > bci.y) can_paint_down = false;
          }
        }
      }
    }
  }

  let paint_directions = 0;
  if (can_paint_left) paint_directions += PAINT_DIRECTION_LEFT;
  if (can_paint_right) paint_directions += PAINT_DIRECTION_RIGHT;
  if (can_paint_up) paint_directions += PAINT_DIRECTION_UP;
  if (can_paint_down) paint_directions += PAINT_DIRECTION_DOWN;
  return paint_directions;
}

/** Push a point to be checked onto the bottom of the rendered pixel buffer check queue. */
function push_point_onto_queue(q: FillQueue, max: number, trace_px: Trace, t: number, x: number, y: number) {
  if (!is_pixel_queued(trace_px, t) && q.size < max) {
    q.push_back([x, y]);
    mark_pixel_queued(trace_px, t);
  }
}

/** Shift a point to be checked onto the top of the rendered pixel buffer check queue. */
function shift_point_onto_queue(q: FillQueue, max: number, trace_px: Trace, t: number, x: number, y: number) {
  if (!is_pixel_queued(trace_px, t) && q.size < max) {
    q.push_front([x, y]);
    mark_pixel_queued(trace_px, t);
  }
}

/** Scan a row in the rendered pixel buffer and add points to the fill queue as necessary. */
function perform_bitmap_scanline_check(
  fill_queue: FillQueue,
  px: Uint32Array,
  trace_px: Trace,
  orig_color: number,
  bci: BitmapCoordsInfo,
  ext: { min_x: number; max_x: number },
): ScanlineCheckResult {
  let aborted = false;
  let reached_screen_boundary = false;
  let ok: boolean;

  let keep_tracing: boolean;
  let initial_paint = true;

  let current_trace_t = bci.x + bci.y * bci.width;
  let paint_directions: number;

  let currently_painting_top = false;
  let currently_painting_bottom = false;

  const top_ty = bci.y > 0 ? bci.y - 1 : 0;
  const bottom_ty = bci.y + 1;

  const can_paint_top = top_ty > 0;
  const can_paint_bottom = bottom_ty < bci.height;

  let front_of_queue = fill_queue.empty() ? null : fill_queue.front();

  do {
    ok = false;
    if (bci.is_left) keep_tracing = bci.x !== 0;
    else keep_tracing = bci.x < bci.width;

    ext.min_x = Math.min(ext.min_x, bci.x);
    ext.max_x = Math.max(ext.max_x, bci.x);

    if (keep_tracing) {
      if (check_if_pixel_is_paintable(px, trace_px, current_trace_t, bci.x, bci.y, orig_color, bci)) {
        paint_directions = paint_pixel(px, trace_px, orig_color, bci, current_trace_t);
        if (bci.radius === 0) {
          mark_pixel_checked(trace_px, current_trace_t);
          if (front_of_queue && front_of_queue[0] === bci.x && front_of_queue[1] === bci.y) {
            fill_queue.pop_front();
            front_of_queue = fill_queue.empty() ? null : fill_queue.front();
          }
        }

        if (can_paint_top && paint_directions & PAINT_DIRECTION_UP) {
          const t = current_trace_t - bci.width;
          if (!is_pixel_queued(trace_px, t)) {
            const ok_to_paint = check_if_pixel_is_paintable(px, trace_px, t, bci.x, top_ty, orig_color, bci);
            if (initial_paint) currently_painting_top = !ok_to_paint;
            if (ok_to_paint && !currently_painting_top) {
              currently_painting_top = true;
              push_point_onto_queue(fill_queue, bci.max_queue_size, trace_px, t, bci.x, top_ty);
            }
            if (!ok_to_paint && currently_painting_top) currently_painting_top = false;
          }
        }

        if (can_paint_bottom && paint_directions & PAINT_DIRECTION_DOWN) {
          const t = current_trace_t + bci.width;
          if (!is_pixel_queued(trace_px, t)) {
            const ok_to_paint = check_if_pixel_is_paintable(
              px,
              trace_px,
              t,
              bci.x,
              bottom_ty,
              orig_color,
              bci,
            );
            if (initial_paint) currently_painting_bottom = !ok_to_paint;
            if (ok_to_paint && !currently_painting_bottom) {
              currently_painting_bottom = true;
              push_point_onto_queue(fill_queue, bci.max_queue_size, trace_px, t, bci.x, bottom_ty);
            }
            if (!ok_to_paint && currently_painting_bottom) currently_painting_bottom = false;
          }
        }

        if (bci.is_left) {
          if (paint_directions & PAINT_DIRECTION_LEFT) {
            bci.x--;
            current_trace_t--;
            ok = true;
          }
        } else if (paint_directions & PAINT_DIRECTION_RIGHT) {
          bci.x++;
          current_trace_t++;
          ok = true;
        }

        initial_paint = false;
      }
    } else if (bci.bbox.min().x > bci.screen.min().x) {
      aborted = true;
      break;
    } else {
      reached_screen_boundary = true;
    }
  } while (ok);

  if (aborted) return ScanlineCheckResult.ABORTED;
  if (reached_screen_boundary) return ScanlineCheckResult.BOUNDARY;
  return ScanlineCheckResult.OK;
}

/** The rendered visible drawing for a fill (upstream: the first part of sp_flood_do_flood_fill). */
export interface FloodBitmap {
  /** Premultiplied ARGB32 pixels, row by row. */
  px: Uint32Array;
  width: number;
  height: number;
  /** World (window + scroll) to bitmap coordinates. */
  world2img: Affine;
  /** Document to bitmap coordinates. */
  doc2img: Affine;
  /** The visible area, desktop coordinates. */
  screen: Rect;
  /** The desktop (page background) color, transparent. */
  dtc: number;
}

/** The result of the fill: the trace buffer and the filled range, or why there is none. */
export interface FloodFillResult {
  trace_px: Uint8Array;
  min_x: number;
  max_x: number;
  min_y: number;
  max_y: number;
  aborted: boolean;
  reached_screen_boundary: boolean;
}

/**
 * Flood fill the bitmap from fill_points (bitmap coordinates) (upstream: the fill loop of
 * sp_flood_do_flood_fill). With is_touch_fill only the first point gives the color.
 * bbox is the visual bounds of the drawing, desktop coordinates.
 */
export function flood_fill_bitmap(
  bm: FloodBitmap,
  fill_points: readonly Point[],
  bbox: Rect,
  is_touch_fill: boolean,
  method: PaintBucketChannels,
  threshold_pref: number,
  radius: number,
): FloodFillResult {
  const { px, width, height, dtc } = bm;
  const trace_px = new Uint8Array(width * height);

  const fill_queue = new FillQueue();
  const color_queue: Point[] = [];

  let aborted = false;
  const y_limit = height - 1;

  let threshold = threshold_pref;
  switch (method) {
    case PaintBucketChannels.FLOOD_CHANNELS_ALPHA:
    case PaintBucketChannels.FLOOD_CHANNELS_RGB:
    case PaintBucketChannels.FLOOD_CHANNELS_R:
    case PaintBucketChannels.FLOOD_CHANNELS_G:
    case PaintBucketChannels.FLOOD_CHANNELS_B:
      threshold = Math.trunc((255 * threshold) / 100);
      break;
    default:
      break;
  }

  const bci: BitmapCoordsInfo = {
    is_left: true,
    x: 0,
    y: 0,
    y_limit,
    width,
    height,
    threshold,
    method,
    bbox,
    screen: bm.screen,
    dtc,
    radius,
    merged_orig_pixel: 0,
    max_queue_size: Math.trunc((width * height) / 4),
    current_step: 0,
  };

  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  for (let i = 0; i < fill_points.length; i++) {
    const p = fill_points[i] as Point;
    const pw = new Point(clamp(p.x, width - 1), clamp(p.y, height - 1));
    if (is_touch_fill && i !== 0) {
      const x = Math.trunc(pw.x);
      const y = Math.trunc(pw.y);
      push_point_onto_queue(fill_queue, bci.max_queue_size, trace_px, x + y * width, x, y);
    } else {
      color_queue.push(pw);
    }
  }

  let reached_screen_boundary = false;
  let first_run = true;
  const sort_size_threshold = 5;

  let min_y = height;
  let max_y = 0;
  const ext = { min_x: width, max_x: 0 };

  while (color_queue.length && !aborted) {
    const color_point = color_queue.shift() as Point;
    const cx = Math.trunc(color_point.x);
    const cy = Math.trunc(color_point.y);

    const orig_color = px[cx + cy * width] ?? 0;
    bci.merged_orig_pixel = compose_onto(orig_color, dtc);

    const t0 = cx + cy * width;
    if (!is_pixel_checked(trace_px, t0) && !is_pixel_colored(trace_px, t0)) {
      // As upstream, the paintability of the trace buffer's first pixel is checked here.
      if (check_if_pixel_is_paintable(px, trace_px, 0, cx, cy, orig_color, bci)) {
        shift_point_onto_queue(fill_queue, bci.max_queue_size, trace_px, t0, cx, cy);
        if (!first_run) {
          for (let t = 0; t < width * height; t++) clear_pixel_paintability(trace_px, t);
        }
        first_run = false;
      }
    }

    let old_fill_queue_size = fill_queue.size;

    while (!fill_queue.empty() && !aborted) {
      let cp = fill_queue.front();

      if (bci.radius === 0) {
        const new_fill_queue_size = fill_queue.size;

        /*
         * To reduce the number of points in the fill queue, periodically
         * resort all of the points in the queue so that scanline checks
         * can complete more quickly.  A point cannot be checked twice
         * in a normal scanline checks, so forcing scanline checks to start
         * from one corner of the rendered area as often as possible
         * will reduce the number of points that need to be checked and queued.
         */
        if (new_fill_queue_size > sort_size_threshold && new_fill_queue_size > old_fill_queue_size) {
          const items = fill_queue.toArray().sort((a, b) => b[1] - a[1]);
          let start_sort = 0;
          let end_sort = 0;
          let sort_y = cp[1];
          for (let i = 0; i < items.length; i++) {
            const current_y = (items[i] as [number, number])[1];
            if (current_y !== sort_y) {
              if (start_sort !== end_sort) sort_range(items, start_sort, end_sort);
              sort_y = current_y;
              start_sort = i;
            }
            end_sort = i;
          }
          if (start_sort !== end_sort) sort_range(items, start_sort, end_sort);
          fill_queue.assign(items);
          cp = fill_queue.front();
        }
        old_fill_queue_size = new_fill_queue_size;
      }

      fill_queue.pop_front();

      const [x, y] = cp;
      min_y = Math.min(y, min_y);
      max_y = Math.max(y, max_y);

      let t = x + y * width;
      if (!is_pixel_checked(trace_px, t)) {
        mark_pixel_checked(trace_px, t);

        if (y === 0) {
          if (bbox.min().y > bm.screen.min().y) {
            aborted = true;
            break;
          }
          reached_screen_boundary = true;
        }

        if (y === y_limit) {
          if (bbox.max().y < bm.screen.max().y) {
            aborted = true;
            break;
          }
          reached_screen_boundary = true;
        }

        bci.is_left = true;
        bci.x = x;
        bci.y = y;

        let result = perform_bitmap_scanline_check(fill_queue, px, trace_px, orig_color, bci, ext);
        if (result === ScanlineCheckResult.ABORTED) aborted = true;
        else if (result === ScanlineCheckResult.BOUNDARY) reached_screen_boundary = true;

        if (bci.x < width) {
          t++;
          if (!is_pixel_checked(trace_px, t) && !is_pixel_queued(trace_px, t)) {
            mark_pixel_checked(trace_px, t);
            bci.is_left = false;
            bci.x = x + 1;

            result = perform_bitmap_scanline_check(fill_queue, px, trace_px, orig_color, bci, ext);
            if (result === ScanlineCheckResult.ABORTED) aborted = true;
            else if (result === ScanlineCheckResult.BOUNDARY) reached_screen_boundary = true;
          }
        }
      }

      bci.current_step++;
      if (bci.current_step > bci.max_queue_size) aborted = true;
    }
  }

  return { trace_px, min_x: ext.min_x, max_x: ext.max_x, min_y, max_y, aborted, reached_screen_boundary };
}

/** Sort items[start, end) by decreasing x (upstream std::sort with sort_fill_queue_horizontal). */
function sort_range(items: [number, number][], start: number, end: number): void {
  const part = items.slice(start, end).sort((a, b) => b[0] - a[0]);
  items.splice(start, part.length, ...part);
}

/**
 * Perform the bitmap-to-vector tracing and place the traced path onto the document.
 * Returns a warning message, or null.
 */
function do_trace(
  bm: FloodBitmap,
  fill: FloodFillResult,
  desktop: SPDesktop,
  transform: Affine,
  union_with_selection: boolean,
): string | null {
  const document = desktop.getDocument();
  const { min_x, max_x, min_y, max_y } = fill;

  const gray_map = new GrayMap(max_x - min_x + 1, max_y - min_y + 1);
  for (let y = min_y; y <= max_y; y++) {
    for (let x = min_x; x <= max_x; x++) {
      const colored = is_pixel_colored(fill.trace_px, x + y * bm.width);
      gray_map.setPixel(x - min_x, y - min_y, colored ? GrayMap.BLACK : GrayMap.WHITE);
    }
  }

  const pte = new PotraceTracingEngine();
  const results = pte.traceGrayMap(gray_map);

  const xml_doc = document.getReprDoc();
  const prefs = Preferences.get();
  // The offset is stored in /tools/paintbucket/offsetunits (upstream uses the number as screen px).
  const offset = convertUnit(
    prefs.getDouble('/tools/paintbucket/offset', 0.0),
    prefs.getString('/tools/paintbucket/offsetunits') || 'px',
    'px',
  );

  for (const result of results) {
    const pathRepr = xml_doc.createElement('svg:path');
    /* Set style */
    desktop.applyCurrentOrToolStyle(pathRepr, '/tools/paintbucket', false);

    const d = traceBackend().floodPathData(sp_svg_write_path(result.path), offset * desktop.current_zoom());
    if (!d) {
      return _('<b>Too much inset</b>, the result is empty.');
    }
    pathRepr.setAttribute('d', d);

    const layer = desktop.layerManager().currentLayer();
    if (!layer) return null;
    layer.getRepr().addChild(pathRepr, null);

    const reprobj = document.getObjectByRepr(pathRepr);
    if (reprobj instanceof SPItem) {
      reprobj.doWriteTransform(transform);

      // premultiply the item transform by the accumulated parent transform in the paste layer
      const local = layer.i2docAffine();
      if (!local.isIdentity()) {
        const t_str = pathRepr.attribute('transform');
        const item_t = (t_str ? sp_svg_transform_read(t_str) : null) ?? Affine.identity();
        // (we're dealing with unattached repr, so we write to its attr instead of using sp_item_set_transform)
        pathRepr.setAttributeOrRemoveIfEmpty(
          'transform',
          sp_svg_transform_write(item_t.multiply(local.inverse())),
        );
      }

      const selection = desktop.getSelection();
      pathRepr.setPosition(-1);

      if (union_with_selection) {
        selection.add(reprobj);
        pathUnion(selection, true);
      } else {
        selection.set(reprobj);
      }
    }
  }
  return null;
}

/**
 * Render the visible drawing and 60% around it to a bitmap (upstream: the rendering in
 * sp_flood_do_flood_fill). The browser renders the document asynchronously, like the PNG
 * export, so items are drawn as the browser draws their SVG.
 * TODO: canvas rotation (the bitmap is axis-aligned in document coordinates).
 */
export async function render_flood_bitmap(desktop: SPDesktop): Promise<FloodBitmap> {
  // Render 160% of the physical display to the render pixel buffer, so that available
  // fill areas off the screen can be included in the fill.
  const padding = 1.6;

  // image space is world space with an offset
  const screen_world = desktop.getCanvas().get_area_world();
  const screen = screen_world.transformed(desktop.w2d());
  const dims = screen_world.dimensions();
  const width = Math.ceil(dims.x * padding);
  const height = Math.ceil(dims.y * padding);
  const world2img = Translate(new Point(width - dims.x, height - dims.y).div(2).sub(screen_world.min()));
  const doc2img = desktop.doc2dt().multiply(desktop.d2w()).multiply(world2img);

  const area = new Rect(0, 0, width, height).transformed(doc2img.inverse());
  const canvas = await sp_export_canvas(desktop.getDocument(), area, width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const rgba = ctx?.getImageData(0, 0, width, height).data ?? new Uint8ClampedArray(4 * width * height);

  // Cairo's premultiplied ARGB32.
  const px = new Uint32Array(width * height);
  for (let i = 0; i < px.length; i++) {
    const a = rgba[4 * i + 3] ?? 0;
    const pm = (c: number) => Math.trunc(((rgba[4 * i + c] ?? 0) * a + 127) / 255);
    px[i] = assemble(a, pm(0), pm(1), pm(2));
  }

  // make color transparent for 'alpha' flood mode to work
  const bg = desktop.getNamedView().getBackgroundColor().toRGBA();
  const dtc = assemble(0, (bg >>> 24) & 0xff, (bg >>> 16) & 0xff, (bg >>> 8) & 0xff);

  return { px, width, height, world2img, doc2img, screen, dtc };
}

/**
 * Perform a flood fill operation on the rendered bitmap (upstream sp_flood_do_flood_fill).
 * Returns a message for the status bar, or null.
 * @param world_points The fill points (world coordinates): the cursor position for a click,
 *   else the points of the Rubberband "touch selection" (upstream: is_point_fill decides).
 * @param union_with_selection If true, union the new fill with the current selection.
 * @param is_touch_fill If true, use only the initial contact point in the Rubberband "touch selection" as the fill target color.
 */
export function sp_flood_do_flood_fill(
  desktop: SPDesktop,
  bm: FloodBitmap,
  world_points: readonly Point[],
  union_with_selection: boolean,
  is_touch_fill: boolean,
): string | null {
  const document = desktop.getDocument();
  document.ensureUpToDate();

  const bbox = document.getRoot().visualBounds();
  if (!bbox) return _('<b>Area is not bounded</b>, cannot fill.');

  const prefs = Preferences.get();
  const method = prefs.getInt('/tools/paintbucket/channels', 0) as PaintBucketChannels;
  const threshold = Math.min(Math.max(prefs.getInt('/tools/paintbucket/threshold', 1), 0), 100);
  const radius = Math.min(Math.max(prefs.getInt('/tools/paintbucket/autogap', 0), 0), 3);

  const fill_points = world_points.map((p) => p.transformed(bm.world2img));

  const fill = flood_fill_bitmap(
    bm,
    fill_points,
    bbox.transformed(document.doc2dt()),
    is_touch_fill,
    method,
    threshold,
    radius,
  );

  if (fill.aborted) return _('<b>Area is not bounded</b>, cannot fill.');

  let message: string | null = null;
  if (fill.reached_screen_boundary) {
    message = C_(
      '',
      '<b>Only the visible part of the bounded area was filled.</b> If you want to fill all of the area, undo, zoom out, and fill again.',
    );
  }

  const trace_padding = radius + 1;
  const y_limit = bm.height - 1;
  if (fill.min_y > trace_padding) fill.min_y -= trace_padding;
  if (fill.max_y < y_limit - trace_padding) fill.max_y += trace_padding;
  if (fill.min_x > trace_padding) fill.min_x -= trace_padding;
  if (fill.max_x < bm.width - 1 - trace_padding) fill.max_x += trace_padding;

  const inverted_affine = Translate(fill.min_x, fill.min_y).multiply(bm.doc2img.inverse());

  message = do_trace(bm, fill, desktop, inverted_affine, union_with_selection) ?? message;

  DocumentUndo.done(document, C_('Undo', 'Fill bounded area'), 'color-fill');
  return message;
}

/**
 * The paint bucket tool (upstream FloodTool): a click fills the area around it that has the
 * same color (visible colors, a color channel or alpha, within a threshold) with a traced
 * path; dragging fills all areas the pointer touches, with Alt only those of the first color.
 * Shift adds the fill to the selection (union); Ctrl+click sets the tool style on the clicked
 * object. Grow/shrink offsets the result, Close gaps closes small gaps in the outlines.
 * TODO: the knots of the selected shape (ShapeEditor), status bar messages, cursor.
 */
export class FloodTool extends ToolBase {
  dragging = false;
  /** The last message of a fill (upstream: flashed in the status bar). */
  message: string | null = null;
  /** Resolves when the last fill is done (tests and the e2e checks wait for it). */
  pending: Promise<void> = Promise.resolve();

  constructor(desktop: SPDesktop) {
    super(desktop, '/tools/paintbucket');
    // TODO: Why does the flood tool use a hardcoded tolerance instead of a pref?
    this.tolerance = 4;
    if (Preferences.get().getBool('/tools/paintbucket/selcue')) this.enableSelectionCue();
  }

  static set_channels(channels: number): void {
    Preferences.get().setInt('/tools/paintbucket/channels', channels);
  }

  /** Ctrl+click: set the tool style on the clicked object (upstream item_handler). */
  #applyStyle(event: PointerEvent): boolean {
    const item = this._desktop.getItemAtPoint(this._windowPoint(event), true);
    if (!item) return false;
    // Set style
    this._desktop.applyCurrentOrToolStyle(item.getRepr(), '/tools/paintbucket', false);
    DocumentUndo.done(this._desktop.getDocument(), C_('Undo', 'Set style on object'), 'color-fill');
    return true;
  }

  override root_handler(event: Event): boolean {
    let ret = false;
    switch (event.type) {
      case 'pointerdown': {
        const e = event as PointerEvent;
        if (e.button !== 0) break;
        if (mod_flood_item(e)) {
          ret = this.#applyStyle(e);
          break;
        }
        if (have_viable_layer(this._desktop)) {
          // save drag origin
          const w = this._windowPoint(e);
          this.saveDragOrigin(w);
          this.dragging = true;
          this.grabCanvasEvents(e);

          const p = this._desktopPoint(w);
          const rubberband = Rubberband.get(this._desktop);
          rubberband.setMode(RubberbandMode.TOUCHPATH);
          rubberband.setHandle(RubberbandTouchpathHandle.RUBBERBAND_TOUCHPATH_FLOOD);
          rubberband.start(this._desktop, p);
          ret = true;
        }
        break;
      }
      case 'pointermove': {
        const e = event as PointerEvent;
        if (this.dragging && e.buttons & 1) {
          const w = this._windowPoint(e);
          if (!this.checkDragMoved(w)) break;
          const rubberband = Rubberband.get(this._desktop);
          if (rubberband.isStarted()) rubberband.move(this._desktopPoint(w));
          ret = true;
        }
        break;
      }
      case 'pointerup': {
        const e = event as PointerEvent;
        if (e.button !== 0) break;
        this.ungrabCanvasEvents(e);
        const r = Rubberband.get(this._desktop);
        if (r.isStarted()) {
          this.dragging = false;
          const is_point_fill = this.within_tolerance;
          const is_touch_fill = mod_flood_touch_fill(e);
          const union_with_selection = mod_select_add_to(e);
          const desktop = this._desktop;
          const cursor = desktop.getCanvas().canvas_to_world(this._windowPoint(e));
          // The points of the touch path, before the rubberband is stopped.
          const fill_points = is_point_fill ? [cursor] : [...r.getPoints()];
          // The browser renders asynchronously (upstream: setWaitingCursor while it renders).
          this.pending = render_flood_bitmap(desktop).then((bm) => {
            this.message = sp_flood_do_flood_fill(
              desktop,
              bm,
              fill_points,
              union_with_selection,
              is_touch_fill,
            );
          });
          r.stop();
          ret = true;
        }
        break;
      }
      case 'keydown': {
        const e = event as KeyboardEvent;
        if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !mod_ctrl_only(e)) {
          // prevent the zoom field from activating
          ret = true;
        }
        break;
      }
    }
    return ret || super.root_handler(event);
  }
}
