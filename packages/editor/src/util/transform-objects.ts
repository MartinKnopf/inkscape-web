// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/util/transform-objects.cpp, src/util/transform-objects.h
// Stand-alone selection transformation operations (used by the Transform dialog).
import { _, get_scale_transform_for_variable_stroke, type ObjectSet, type SPItem } from '@inkscape-web/core';
import { type Affine, EPSILON, type Rect, Rotate, Translate } from '@inkscape-web/geom';

/** How the values of transform_skew are given (upstream SkewUnits). */
export enum SkewUnits {
  /** Values are in percent (10 = 10%). */
  Percent,
  /** Values are angles in radians; they are converted with tan(). */
  AngleRadians,
  /** Values are linear displacements. */
  Absolute,
}

/**
 * Called with a message when an operation is refused. Upstream flashes the
 * message on the message stack of the desktop.
 */
export type Flash = (message: string) => void;

const SINGULAR = () => _('Transform matrix is singular, <b>not used</b>.');

/** The items with a preferred bound, sorted by their anchor on the axis (upstream BBoxSort). */
function sortedByAnchor(items: SPItem[], dim: 'x' | 'y', positive: boolean): SPItem[] {
  const entries: { item: SPItem; anchor: number }[] = [];
  const [begin, end] = positive ? [1, 0] : [0, 1];
  for (const item of items) {
    const bbox: Rect | null = item.desktopPreferredBounds();
    if (!bbox) continue;
    const [lo, hi] = dim === 'x' ? [bbox.left(), bbox.right()] : [bbox.top(), bbox.bottom()];
    entries.push({ item, anchor: begin * lo + end * hi });
  }
  return entries.sort((a, b) => a.anchor - b.anchor).map((e) => e.item);
}

/**
 * Move the selection by (x, y) px, or to (x, y) when not relative. With
 * apply_separately and relative, each object moves by one more step than the
 * previous one. yaxisdir converts the relative y from screen to document direction.
 */
export function transform_move(
  selection: ObjectSet,
  x: number,
  y: number,
  relative: boolean,
  apply_separately: boolean,
  yaxisdir: number,
): void {
  if (selection.isEmpty()) return;
  // If relative, y is specified in screen coordinates (UI); adapt it to the document y-axis direction.
  if (relative) y *= yaxisdir;

  if (!apply_separately || !relative) {
    if (relative) {
      selection.moveRelative(x, y);
    } else {
      const bbox = selection.preferredBounds();
      if (bbox) selection.moveRelative(x - bbox.left(), y - bbox.top());
    }
    return;
  }

  // Shift each object relatively to the previous one.
  const selected = selection.items();
  if (!selected.length) return;
  if (Math.abs(x) > 1e-6) {
    let move = x;
    for (const item of sortedByAnchor(selected, 'x', x > 0)) {
      item.move_rel(Translate(move, 0));
      move += x;
    }
  }
  if (Math.abs(y) > 1e-6) {
    let move = y;
    for (const item of sortedByAnchor(selected, 'y', y > 0)) {
      item.move_rel(Translate(0, move));
      move += y;
    }
  }
}

/** The scaler for a bounding box that gets the size (sx, sy), in px or in percent. */
function scalerFor(
  bbox_pref: Rect,
  bbox_geom: Rect,
  sx: number,
  sy: number,
  is_percent: boolean,
  transform_stroke: boolean,
  preserve: boolean,
): Affine {
  let new_width = sx;
  let new_height = sy;
  if (is_percent) {
    new_width = (sx / 100) * bbox_pref.width();
    new_height = (sy / 100) * bbox_pref.height();
  }
  if (Math.abs(new_width) < 1e-6) new_width = 1e-6;
  if (Math.abs(new_height) < 1e-6) new_height = 1e-6;
  const mid = bbox_pref.midpoint();
  return get_scale_transform_for_variable_stroke(
    bbox_pref,
    bbox_geom,
    transform_stroke,
    preserve,
    mid.x - new_width / 2,
    mid.y - new_height / 2,
    mid.x + new_width / 2,
    mid.y + new_height / 2,
  );
}

/** Scale the selection around its center to the size (sx, sy) in px, or to sx and sy percent. */
export function transform_scale(
  selection: ObjectSet,
  sx: number,
  sy: number,
  is_percent: boolean,
  apply_separately: boolean,
  transform_stroke: boolean,
  preserve: boolean,
): void {
  if (selection.isEmpty()) return;
  if (apply_separately) {
    for (const item of selection.items()) {
      const bbox_pref = item.desktopPreferredBounds();
      const bbox_geom = item.desktopGeometricBounds();
      if (!bbox_pref || !bbox_geom) continue;
      const scaler = scalerFor(bbox_pref, bbox_geom, sx, sy, is_percent, transform_stroke, preserve);
      item.setI2dAffine(item.i2dtAffine().multiply(scaler));
      item.doWriteTransform(item.transform);
    }
  } else {
    const bbox_pref = selection.preferredBounds();
    const bbox_geom = selection.geometricBounds();
    if (!bbox_pref || !bbox_geom) return;
    selection.applyAffine(scalerFor(bbox_pref, bbox_geom, sx, sy, is_percent, transform_stroke, preserve));
  }
}

/** Rotate the selection by angle_degrees (counterclockwise), or each object around its center. */
export function transform_rotate(
  selection: ObjectSet,
  angle_degrees: number,
  apply_separately: boolean,
): void {
  if (selection.isEmpty()) return;
  if (apply_separately) {
    for (const item of selection.items()) item.rotate_rel(Rotate.from_degrees(angle_degrees));
  } else {
    const center = selection.center();
    if (center) selection.rotateRelative(center, angle_degrees);
  }
}

/**
 * Skew the selection by (hx, hy) in the given units, around its center or
 * each object around its own. Returns false and flashes a message when the
 * skew is singular.
 */
export function transform_skew(
  selection: ObjectSet,
  hx: number,
  hy: number,
  units: SkewUnits,
  apply_separately: boolean,
  yaxisdir: number,
  flash: Flash = () => {},
): boolean {
  if (selection.isEmpty()) return false;
  const skew = (sx: number, sy: number) => {
    if (apply_separately) {
      for (const item of selection.items()) item.skew_rel(sx, sy);
    } else {
      const center = selection.center();
      if (center) selection.skewRelative(center, sx, sy);
    }
  };

  if (units === SkewUnits.Percent) {
    hy *= yaxisdir; // match the UI behavior for the vertical direction
    if (Math.abs(0.01 * hx * 0.01 * hy - 1.0) < EPSILON) {
      flash(SINGULAR());
      return false;
    }
    skew(0.01 * hx, 0.01 * hy);
  } else if (units === SkewUnits.AngleRadians) {
    const half = Math.PI / 2;
    if (
      Math.abs(hx - hy + half) < EPSILON ||
      Math.abs(hx - hy - half) < EPSILON ||
      Math.abs((hx - hy) / 3 + half) < EPSILON ||
      Math.abs((hx - hy) / 3 - half) < EPSILON
    ) {
      flash(SINGULAR());
      return false;
    }
    skew(Math.tan(hx), Math.tan(hy));
  } else {
    // Absolute (linear) displacement inputs.
    const x = hx;
    const y = hy * yaxisdir;
    if (apply_separately) {
      for (const item of selection.items()) {
        const bbox = item.desktopPreferredBounds();
        if (!bbox) continue;
        if (Math.abs(((x / bbox.height()) * y) / bbox.width() - 1.0) < EPSILON) {
          flash(SINGULAR());
          return false;
        }
        item.skew_rel(x / bbox.height(), y / bbox.width());
      }
    } else {
      const center = selection.center();
      const bbox = selection.preferredBounds();
      if (center && bbox) {
        if (Math.abs(((x / bbox.height()) * y) / bbox.width() - 1.0) < EPSILON) {
          flash(SINGULAR());
          return false;
        }
        selection.skewRelative(center, x / bbox.height(), y / bbox.width());
      }
    }
  }
  return true;
}

/**
 * Apply the matrix to the selection: replace the transform of each item with
 * it, or post-multiply the transform of each item. Returns false and flashes a
 * message when the matrix is singular.
 */
export function transform_apply_matrix(
  selection: ObjectSet,
  affine: Affine,
  replace_matrix: boolean,
  flash: Flash = () => {},
): boolean {
  if (selection.isEmpty()) return false;
  if (affine.isSingular()) {
    flash(SINGULAR());
    return false;
  }
  if (replace_matrix) {
    for (const item of selection.items()) {
      item.setItemTransform(affine);
      item.updateRepr();
    }
  } else {
    selection.applyAffine(affine);
  }
  return true;
}
