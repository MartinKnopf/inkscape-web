// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-item-transform.cpp, src/object/sp-item-transform.h
/*
 * Transforming single items
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Frank Felfe <innerspace@iname.com>
 *   bulia byak <buliabyak@gmail.com>
 *   Johan Engelen <goejendaagh@zonnet.nl>
 *   Abhishek Sharma
 *   Diederik van Lierop <mail@diedenrezi.nl>
 *
 * Copyright (C) 1999-2011 authors
 */
import { Affine, are_near, EPSILON, type Rect, Scale, Translate } from '@inkscape-web/geom';

/**
 * Calculate the transformation that maps the visual bounding box bbox_visual to
 * the box (x0, y0)-(x1, y1), for a stroke width that differs per side (the
 * difference of bbox_visual and bbox_geom). x1 < x0 or y1 < y0 mirrors.
 * transform_stroke scales the stroke with the area; preserve is "Preserve
 * transforms". Upstream: get_scale_transform_for_variable_stroke.
 * TODO: get_scale_transform_for_uniform_stroke, get_visual_bbox.
 */
export function get_scale_transform_for_variable_stroke(
  bbox_visual: Rect,
  bbox_geom: Rect,
  transform_stroke: boolean,
  preserve: boolean,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Affine {
  const p2o = Translate(bbox_visual.min().neg());
  const o2n = Translate(x0, y0);
  let scale = Scale(1, 1);
  // Moves the objects to compensate for the drift caused by the stroke width change.
  let unbudge = Translate(0, 0);

  const w0 = bbox_visual.width();
  const h0 = bbox_visual.height();
  let w1 = x1 - x0; // can have any sign
  let h1 = y1 - y0;

  let r0w = w0 - bbox_geom.width(); // average stroke width of the left and right edges
  let r0h = h0 - bbox_geom.height(); // average stroke width of the top and bottom edges
  if (r0w === Number.POSITIVE_INFINITY || Math.abs(r0w) < 1e-6) r0w = 0;
  if (r0h === Number.POSITIVE_INFINITY || Math.abs(r0h) < 1e-6) r0h = 0;

  const flip_x = w1 > 0 ? 1 : -1;
  const flip_y = h1 > 0 ? 1 : -1;
  // w1 and h1 are negative when mirroring; use the absolute values from here on.
  w1 = Math.abs(w1);
  h1 = Math.abs(h1);

  if (Math.abs(w0 - r0w) < 1e-6 && Math.abs(h0 - r0h) < 1e-6) return Affine.identity();

  // A negative stroke: the geometric box is larger than the visual box (clipped objects).
  if (r0w < 0 || r0h < 0) {
    const direct = Scale((flip_x * w1) / w0, (flip_y * h1) / h0);
    return p2o.multiply(direct).multiply(o2n);
  }

  // The ratio of the left/right and of the top/bottom stroke widths stays the same.
  const stroke_ratio_w = Math.abs(r0w) < 1e-6 ? 1 : (bbox_geom.left() - bbox_visual.left()) / r0w;
  const stroke_ratio_h = Math.abs(r0h) < 1e-6 ? 1 : (bbox_geom.top() - bbox_visual.top()) / r0h;

  let scale_x = 1;
  let scale_y = 1;

  if (Math.abs(w0 - r0w) < 1e-6 || w1 === 0) {
    // A vertical line.
    scale_y = h1 / h0;
    scale_x = transform_stroke ? 1 : scale_y;
    unbudge = unbudge.multiply(Translate(-flip_x * 0.5 * (scale_x - 1.0) * w0, 0));
    unbudge = unbudge.multiply(Translate(flip_x * 0.5 * (w1 - w0), 0));
  } else if (Math.abs(h0 - r0h) < 1e-6 || h1 === 0) {
    // A horizontal line.
    scale_x = w1 / w0;
    scale_y = transform_stroke ? 1 : scale_x;
    unbudge = unbudge.multiply(Translate(0, -flip_y * 0.5 * (scale_y - 1.0) * h0));
    unbudge = unbudge.multiply(Translate(0, flip_y * 0.5 * (h1 - h0)));
  } else if (transform_stroke && !preserve) {
    // Scale the stroke with the area of the geometric box:
    // r1w^2 * (w0 - r0w) * (h0 - r0h) = r0w^2 * (w1 - r1w) * (h1 - r1h), a quadratic equation in r1w.
    const A = w0 * h0 - r0h * w0 - r0w * h0;
    const B = r0h * w1 + r0w * h1;
    const C = -w1 * h1;
    if (B * B - 4 * A * C < 0) {
      console.warn('variable stroke scaling error', transform_stroke, preserve, r0w, r0h, w0, h0, w1, h1);
    } else {
      let det = -C / B;
      if (!are_near((A * C) / B / B, 0.0, EPSILON)) det = (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A);
      const r1w = r0w * det;
      const r1h = r0h * det;
      scale_x = (w1 - r1w) / (w0 - r0w);
      scale_y = (h1 - r1h) / (h0 - r0h);
      // Keep the corner of the visual box where it is, although the stroke width changed.
      unbudge = unbudge.multiply(
        Translate(
          -flip_x * stroke_ratio_w * (r0w * scale_x - r1w),
          -flip_y * stroke_ratio_h * (r0h * scale_y - r1h),
        ),
      );
    }
  } else if (!transform_stroke && !preserve) {
    // Scale the geometric box with a constant stroke.
    scale_x = (w1 - r0w) / (w0 - r0w);
    scale_y = (h1 - r0h) / (h0 - r0h);
    unbudge = unbudge.multiply(
      Translate(
        -flip_x * stroke_ratio_w * r0w * (scale_x - 1),
        -flip_y * stroke_ratio_h * r0h * (scale_y - 1),
      ),
    );
  } else if (!transform_stroke) {
    // "Preserve transforms": the geometric mean of r0w and r0h stays the same.
    const A = h1 * (w0 - r0w);
    const B = h0 * r0w - w0 * r0h;
    const C = -w1 * (h0 - r0h);
    if (B * B - 4 * A * C < 0) {
      console.warn('variable stroke scaling error', transform_stroke, preserve, r0w, r0h, w0, h0, w1, h1);
    } else {
      const Sx_div_Sy = (-B + Math.sqrt(B * B - 4 * A * C)) / 2 / A;
      scale_x = (w1 - r0w * Sx_div_Sy) / (w0 - r0w);
      scale_y = (h1 - r0h / Sx_div_Sy) / (h0 - r0h);
      unbudge = unbudge.multiply(
        Translate(
          -flip_x * stroke_ratio_w * r0w * scale_x * (1.0 - Math.sqrt(1.0 / scale_x / scale_y)),
          -flip_y * stroke_ratio_h * r0h * scale_y * (1.0 - Math.sqrt(1.0 / scale_x / scale_y)),
        ),
      );
    }
  } else {
    // "Preserve transforms", and the stroke is scaled.
    scale_x = w1 / w0;
    scale_y = h1 / h0;
  }

  // Account for mirroring.
  scale = scale.multiply(Scale(flip_x * scale_x, flip_y * scale_y));
  return p2o.multiply(scale).multiply(unbudge).multiply(o2n);
}
