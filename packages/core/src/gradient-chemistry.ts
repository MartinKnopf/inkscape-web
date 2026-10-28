// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/gradient-chemistry.cpp, src/gradient-chemistry.h
/*
 * Various utility methods for gradients
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak
 *   Johan Engelen <j.b.c.engelen@ewi.utwente.nl>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *   Tavmjong Bah <tavmjong@free.fr>
 *
 * Copyright (C) 2012 Tavmjong Bah
 * Copyright (C) 2010 Authors
 * Copyright (C) 2007 Johan Engelen
 * Copyright (C) 2001-2005 authors
 * Copyright (C) 2001 Ximian, Inc.
 */
import {
  Affine,
  atan2,
  L2,
  LineSegment,
  nearest_time,
  Point,
  Rotate,
  Scale,
  Translate,
} from '@inkscape-web/geom';
import { Color } from './colors/color.ts';
import type { SPDocument } from './document.ts';
import { DocumentUndo } from './document-undo.ts';
import { C_ } from './i18n.ts';
import {
  GrPointType,
  PaintTarget,
  SPGradient,
  SPGradientState,
  SPGradientType,
  sp_gradient_ensure_vector_normalized,
  sp_gradient_repr_set_link,
} from './object/sp-gradient.ts';
import type { SPItem } from './object/sp-item.ts';
import { SPLinearGradient } from './object/sp-linear-gradient.ts';
import type { SPObject } from './object/sp-object.ts';
import { SPGradientSpread, SPGradientUnits } from './object/sp-paint-server-data.ts';
import { SPRadialGradient } from './object/sp-radial-gradient.ts';
import { SPStop } from './object/sp-stop.ts';
import { Preferences } from './preferences.ts';
import { spStyleSetPropertyUrl } from './style.ts';
import { cssNumber } from './svg/css-ostringstream.ts';
import { sp_svg_transform_write } from './svg/svg-affine.ts';
import type { Node } from './xml/node.ts';
import { type SPCSSAttr, spReprCssChange } from './xml/repr-css.ts';

export { sp_gradient_ensure_vector_normalized };

const ICON = 'color-gradient';

// Terminology:
//
// "vector" is a gradient that has stops but not position coords. It can be referenced by one or
// more privates. Objects should not refer to it directly. It has no radial/linear distinction.
//
// "array" is a gradient that has mesh rows and patches. It may or may not have "x" and "y" attributes.
// An array does have spacial information so it cannot be normalized like a "vector".
//
// "shared" is either a "vector" or "array" that is shared between multiple objects.
//
// "private" is a gradient that is not shared. A private linear or radial gradient has no stops but
// has position coords (e.g. center, radius etc for a radial); it references a "vector" for the
// actual colors. A mesh may or may not reference an array. Each private is only used by one object.
//
// TODO: mesh gradients, swatches, text (tspans use the gradient of their text).

const propertyOf = (fill_or_stroke: PaintTarget) =>
  fill_or_stroke === PaintTarget.FOR_FILL ? 'fill' : 'stroke';

/** Creates new private gradient for the given shared gradient. */
function sp_gradient_get_private_normalized(
  document: SPDocument,
  shared: SPGradient,
  type: SPGradientType,
): SPGradient {
  if (!shared.hasStops()) throw new Error('sp_gradient_get_private_normalized: shared has no stops');
  const defs = document.getDefs();
  if (!defs) throw new Error('document has no defs');
  // create a new private gradient of the requested type
  const repr = document
    .getReprDoc()
    .createElement(
      type === SPGradientType.SP_GRADIENT_TYPE_LINEAR ? 'svg:linearGradient' : 'svg:radialGradient',
    );
  // make auto collection optional
  repr.setAttribute(
    'inkscape:collect',
    Preferences.get().getBool('/option/gradient/auto_collect', true) ? 'always' : 'never',
  );
  // link to shared
  sp_gradient_repr_set_link(repr, shared);
  // Append the new private gradient to defs
  defs.getRepr().appendChild(repr);
  // get corresponding object
  const gr = document.getObjectByRepr(repr);
  if (!(gr instanceof SPGradient)) throw new Error('no gradient object for the new repr');
  return gr;
}

/** Count how many times gr is used by the styles of o and its descendants. */
function count_gradient_hrefs(o: SPObject | null, gr: SPGradient): number {
  if (!o) return 1;
  let i = 0;
  const style = o.style;
  if (style.fill.isPaintserver() && style.getFillPaintServer() === gr) i++;
  if (style.stroke.isPaintserver() && style.getStrokePaintServer() === gr) i++;
  for (const child of o.children) i += count_gradient_hrefs(child, gr);
  return i;
}

/** If gr has other users, create a new private; also check if gr links to shared, relink if not. */
function sp_gradient_fork_private_if_necessary(
  gr: SPGradient,
  shared: SPGradient | null,
  type: SPGradientType,
  o: SPObject,
): SPGradient {
  // Orphaned gradient, no shared with stops or patches at the end of the line; this used to be an assert
  if (!shared?.hasStops()) {
    console.error('sp_gradient_fork_private_if_necessary: Orphaned gradient');
    return gr;
  }
  // user is the object that uses this gradient. TODO: tspans use the gradient of their text.
  const user = o;
  // Check the number of uses of the gradient within this object;
  // if we are private and there are no other users,
  if (!shared.isSwatch() && gr.hrefcount <= count_gradient_hrefs(user, gr)) {
    // check shared
    if (gr !== shared && gr.ref.getObject() !== shared) {
      // our href is not the shared, and shared is different from gr; relink
      sp_gradient_repr_set_link(gr.getRepr(), shared);
    }
    return gr;
  }
  const doc = gr.document;
  const defs = doc.getDefs();
  if (
    gr.hasStops() ||
    gr.state !== SPGradientState.SP_GRADIENT_STATE_UNKNOWN ||
    gr.parent !== defs ||
    gr.hrefcount > 1
  ) {
    // we have to clone a fresh new private gradient for the given shared
    // create an empty one
    const gr_new = sp_gradient_get_private_normalized(doc, shared, type);
    // copy all the attributes to it
    const repr_new = gr_new.getRepr();
    const repr = gr.getRepr();
    const copy = (name: string) => repr_new.setAttribute(name, repr.attribute(name));
    copy('gradientUnits');
    copy('gradientTransform');
    if (gr instanceof SPRadialGradient) {
      for (const name of ['cx', 'cy', 'fx', 'fy', 'r', 'fr', 'spreadMethod']) copy(name);
    } else if (gr instanceof SPLinearGradient) {
      for (const name of ['x1', 'y1', 'x2', 'y2', 'spreadMethod']) copy(name);
    }
    // Need to pass through ::update() to calculate computed values.
    gr.requestModified(1 /* SP_OBJECT_MODIFIED_FLAG */);
    gr.document.ensureUpToDate();
    return gr_new;
  }
  return gr;
}

function sp_gradient_fork_vector_if_necessary(gr: SPGradient): SPGradient {
  // Some people actually prefer their gradient vectors to be shared...
  if (!Preferences.get().getBool('/options/forkgradientvectors/value', true)) return gr;
  if (gr.hrefcount > 1) {
    const doc = gr.document;
    const repr = gr.getRepr().duplicate(doc.getReprDoc());
    doc.getDefs()?.getRepr().appendChild(repr);
    const gr_new = doc.getObjectByRepr(repr) as SPGradient;
    return sp_gradient_ensure_vector_normalized(gr_new) ?? gr_new;
  }
  return gr;
}

/** The vector of gradient; a forked vector is created and linked to gradient if another gradient uses it. */
export function sp_gradient_get_forked_vector_if_necessary(
  gradient: SPGradient,
  force_vector = false,
): SPGradient {
  let vector = gradient.getVector(force_vector);
  vector = sp_gradient_fork_vector_if_necessary(vector);
  if (gradient !== vector && gradient.ref.getObject() !== vector) {
    sp_gradient_repr_set_link(gradient.getRepr(), vector);
    gradient.repr_clear_vector(); // remove any stops now that we link to a vector
  }
  return vector;
}

/**
 * Convert an item's gradient to userspace _without_ preserving coords, setting them to defaults
 * instead. No forking or reapplying is done because this is only called for newly created privates.
 */
export function sp_gradient_reset_to_userspace(gr: SPGradient, item: SPItem): SPGradient {
  const repr = gr.getRepr();
  // calculate the bbox of the item
  item.document.ensureUpToDate();
  const bbox = item.visualBounds(); // we need "true" bbox without item_i2d_affine
  if (!bbox) return gr;
  const width = bbox.width();
  const height = bbox.height();
  const center = bbox.midpoint();

  if (gr instanceof SPRadialGradient) {
    repr.setAttributeSvgDouble('cx', center.x);
    repr.setAttributeSvgDouble('cy', center.y);
    repr.setAttributeSvgDouble('fx', center.x);
    repr.setAttributeSvgDouble('fy', center.y);
    repr.setAttributeSvgDouble('r', width / 2);
    // we want it to be elliptic, not circular
    const squeeze = Translate(center.neg())
      .multiply(Scale(1, height / width))
      .multiply(Translate(center));
    gr.gradientTransform = squeeze;
    gr.setAttributeOrRemoveIfEmpty('gradientTransform', sp_svg_transform_write(gr.gradientTransform));
  } else if (gr instanceof SPLinearGradient) {
    // Assume horizontal gradient by default (as per SVG 1.1)
    let pStart = center.sub(new Point(width / 2, 0));
    let pEnd = center.add(new Point(width / 2, 0));
    // Get the preferred gradient angle from prefs
    const angle = Preferences.get().getDouble('/dialogs/gradienteditor/angle', 0.0);
    if (angle !== 0.0) {
      // Where the line through the center at angle leaves the bounding box; the end is in the
      // direction of the angle.
      const d = Point.polar((angle / 180) * Math.PI);
      const t = (lo: number, hi: number, c: number, dc: number) =>
        Math.abs(dc) < 1e-12 ? Number.POSITIVE_INFINITY : Math.max((lo - c) / dc, (hi - c) / dc);
      const tmax = Math.min(
        t(bbox.left(), bbox.right(), center.x, d.x),
        t(bbox.top(), bbox.bottom(), center.y, d.y),
      );
      if (Number.isFinite(tmax)) {
        pStart = center.sub(d.mul(tmax));
        pEnd = center.add(d.mul(tmax));
      }
    }
    repr.setAttributeSvgDouble('x1', pStart.x);
    repr.setAttributeSvgDouble('y1', pStart.y);
    repr.setAttributeSvgDouble('x2', pEnd.x);
    repr.setAttributeSvgDouble('y2', pEnd.y);
  }
  // set the gradientUnits
  repr.setAttribute('gradientUnits', 'userSpaceOnUse');
  return gr;
}

/** Convert an item's gradient to userspace if necessary, also fork it if necessary. */
export function sp_gradient_convert_to_userspace(gr: SPGradient, item: SPItem, property: string): SPGradient {
  if (gr.isSolid()) return gr;
  // First, fork it if it is shared
  gr = sp_gradient_fork_private_if_necessary(
    gr,
    gr.getVector(),
    gr instanceof SPRadialGradient
      ? SPGradientType.SP_GRADIENT_TYPE_RADIAL
      : SPGradientType.SP_GRADIENT_TYPE_LINEAR,
    item,
  );

  if (gr.getUnits() === SPGradientUnits.SP_GRADIENT_UNITS_OBJECTBOUNDINGBOX) {
    const repr = gr.getRepr();
    // calculate the bbox of the item
    item.document.ensureUpToDate();
    const bbox = item.visualBounds(); // we need "true" bbox without item_i2d_affine
    // would be degenerate otherwise
    const bbox2user = bbox
      ? new Affine(bbox.width(), 0, 0, bbox.height(), bbox.left(), bbox.top())
      : Affine.identity();

    // skew is the additional transform, defined by the proportions of the item, that we need
    // to apply to the gradient in order to work around this weird bit from SVG 1.1
    // (http://www.w3.org/TR/SVG11/pservers.html#LinearGradients):
    //
    //   When gradientUnits="objectBoundingBox" and gradientTransform is the identity
    //   matrix, the stripes of the linear gradient are perpendicular to the gradient
    //   vector in object bounding box space (i.e., the abstract coordinate system where
    //   (0,0) is at the top/left of the object bounding box and (1,1) is at the
    //   bottom/right of the object bounding box). When the object's bounding box is not
    //   square, the stripes that are conceptually perpendicular to the gradient vector
    //   within object bounding box space will render non-perpendicular relative to the
    //   gradient vector in user space due to application of the non-uniform scaling
    //   transformation from bounding box space to user space.
    const exp = bbox2user.descrim();
    const skew = new Affine(
      bbox2user.c0 / exp,
      bbox2user.c1 / exp,
      bbox2user.c2 / exp,
      bbox2user.c3 / exp,
      0,
      0,
    );

    // apply skew to the gradient
    gr.gradientTransform = skew;
    gr.setAttributeOrRemoveIfEmpty('gradientTransform', sp_svg_transform_write(gr.gradientTransform));

    // Matrix to convert points to userspace coords; postmultiply by inverse of skew so
    // as to cancel it out when it's applied to the gradient during rendering
    const point_convert = bbox2user.multiply(skew.inverse());

    if (gr instanceof SPLinearGradient) {
      const p1_u = new Point(gr.x1.computed, gr.y1.computed).transformed(point_convert);
      const p2_u = new Point(gr.x2.computed, gr.y2.computed).transformed(point_convert);
      repr.setAttributeSvgDouble('x1', p1_u.x);
      repr.setAttributeSvgDouble('y1', p1_u.y);
      repr.setAttributeSvgDouble('x2', p2_u.x);
      repr.setAttributeSvgDouble('y2', p2_u.y);
      // set the gradientUnits
      repr.setAttribute('gradientUnits', 'userSpaceOnUse');
    } else if (gr instanceof SPRadialGradient) {
      // original points in the bbox coords; converted points in userspace coords
      const c_u = new Point(gr.cx.computed, gr.cy.computed).transformed(point_convert);
      const f_u = new Point(gr.fx.computed, gr.fy.computed).transformed(point_convert);
      const r_u = gr.r.computed * point_convert.descrim();
      const fr_u = gr.fr.computed * point_convert.descrim();
      repr.setAttributeSvgDouble('cx', c_u.x);
      repr.setAttributeSvgDouble('cy', c_u.y);
      repr.setAttributeSvgDouble('fx', f_u.x);
      repr.setAttributeSvgDouble('fy', f_u.y);
      repr.setAttributeSvgDouble('r', r_u);
      repr.setAttributeSvgDouble('fr', fr_u);
      // set the gradientUnits
      repr.setAttribute('gradientUnits', 'userSpaceOnUse');
    }
  }

  // apply the gradient to the item (may be necessary if we forked it); not recursive
  // generally because grouped items will be taken care of later (we're being called
  // from sp_item_adjust_paint_recursive).
  spStyleSetPropertyUrl(item, property, gr, false);
  return gr;
}

export function sp_gradient_transform_multiply(gradient: SPGradient, postmul: Affine, set: boolean): void {
  // fixme: get gradient transform by climbing to hrefs?
  gradient.gradientTransform = set ? postmul : gradient.gradientTransform.multiply(postmul);
  gradient.gradientTransform_set = true;
  gradient.setAttributeOrRemoveIfEmpty(
    'gradientTransform',
    sp_svg_transform_write(gradient.gradientTransform),
  );
}

/** The fill or the stroke gradient of item, or null. */
export function getGradient(item: SPItem, fill_or_stroke: PaintTarget): SPGradient | null {
  const style = item.style;
  const fill = fill_or_stroke === PaintTarget.FOR_FILL;
  if (!style.getFillOrStroke(fill).isPaintserver()) return null;
  const server = fill ? style.getFillPaintServer() : style.getStrokePaintServer();
  return server instanceof SPGradient ? server : null;
}

export function sp_last_stop(gradient: SPGradient): SPStop | null {
  for (let stop = gradient.getFirstStop(); stop; stop = stop.getNextStop()) {
    if (!stop.getNextStop()) return stop;
  }
  return null;
}

export function sp_get_before_after_stops(stop: SPStop | null): [SPStop | null, SPStop | null] {
  return stop ? [stop.getPrevStop(), stop.getNextStop()] : [null, null];
}

function get_before_after_stops(gradient: SPGradient, offset: number): [SPStop | null, SPStop | null] {
  let before: SPStop | null = null;
  let stop = gradient.getFirstStop();
  while (stop && stop.offset < offset) {
    before = stop;
    stop = stop.getNextStop();
  }
  return [before, stop && stop.offset > offset ? stop : null];
}

export function sp_number_of_stops(gradient: SPGradient): number {
  return gradient.getStopCount();
}

export function sp_number_of_stops_before_stop(gradient: SPGradient | null, target: SPStop): number {
  if (!gradient) return 0;
  let n = 0;
  for (let stop = gradient.getFirstStop(); stop; stop = stop.getNextStop()) {
    if (stop === target) return n;
    n++;
  }
  return n;
}

/** The n-th stop counting from 0; make no assumptions about offsets. */
export function sp_get_nth_stop(gradient: SPGradient, index: number): SPStop | null {
  let stop = gradient.getFirstStop();
  for (let i = 0; i < index && stop; ++i) stop = stop.getNextStop();
  return stop;
}

/**
 * The stop of the dragger number stop_i. If the gradient has no stop at offset 0, the tool has
 * created a handle for the start anyway, so stop N is the stop element N-1.
 */
export function sp_get_stop_i(gradient: SPGradient, stop_i: number): SPStop | null {
  let stop = gradient.getFirstStop();
  if (!stop) return null;
  // if this is valid but weird gradient without an offset-zero stop element,
  // inkscape has created a handle for the start of gradient anyway,
  // so when it asks for stop N that corresponds to stop element N-1
  if (stop.offset !== 0) stop_i--;
  for (let i = 0; i < stop_i; i++) {
    if (!stop) return null;
    stop = stop.getNextStop();
  }
  return stop;
}

function sp_repr_set_css_double(node: Node | null, key: string, value: number): void {
  node?.setAttribute(key, cssNumber(value));
}

/** Insert a stop at offset between prev_stop and next_stop (one may be null); its color is interpolated. */
export function sp_vector_add_stop(
  vector: SPGradient,
  prev_stop: SPStop | null,
  next_stop: SPStop | null,
  offset: number,
): SPStop | null {
  // this function doesn't deal with empty gradients
  if (!prev_stop && !next_stop) return null;
  let cnew: Color;
  let new_stop_repr: Node;
  const xmlDoc = vector.getRepr().document();
  if (!prev_stop || !next_stop) {
    // inserting stop past next or before previous is supported
    const stop = (prev_stop ?? next_stop) as SPStop;
    const repr = stop.getRepr();
    new_stop_repr = repr.duplicate(xmlDoc);
    vector.getRepr().addChild(new_stop_repr, prev_stop ? repr : null);
    cnew = stop.getColor();
  } else {
    const repr = prev_stop.getRepr();
    new_stop_repr = repr.duplicate(xmlDoc);
    vector.getRepr().addChild(new_stop_repr, repr);
    cnew = prev_stop
      .getColor()
      .averaged(next_stop.getColor(), (offset - prev_stop.offset) / (next_stop.offset - prev_stop.offset));
  }
  const newstop = vector.document.getObjectByRepr(new_stop_repr) as SPStop;
  newstop.offset = offset;
  sp_repr_set_css_double(new_stop_repr, 'offset', offset);
  newstop.setColor(cnew);
  return newstop;
}

/** Delete the stop of gradient if it keeps at least 2 stops. */
export function sp_gradient_delete_stop(gradient: SPGradient | null, stop: SPStop | null): boolean {
  if (!stop || !gradient) return false;
  if (gradient.getStopCount() > 2) {
    // 2 is the minimum
    gradient.getRepr().removeChild(stop.getRepr());
    DocumentUndo.done(gradient.document, C_('Undo', 'Delete gradient stop'), ICON);
    return true;
  }
  return false;
}

/** Make gradient well-formed if needed; from gradient-vector.cpp */
function verify_grad(gradient: SPGradient): boolean {
  const stops = gradient.children.filter((c) => c instanceof SPStop);
  const xmlDoc = gradient.getRepr().document();
  if (stops.length < 1) {
    for (const offset of [0.0, 1.0]) {
      const child = xmlDoc.createElement('svg:stop');
      sp_repr_set_css_double(child, 'offset', offset);
      SPStop.setColorRepr(child, new Color(0x000000ff));
      gradient.getRepr().appendChild(child);
    }
    return true;
  }
  const stop = stops.at(-1) as SPStop;
  if (stops.length < 2) {
    sp_repr_set_css_double(stop.getRepr(), 'offset', 0.0);
    const child = stop.getRepr().duplicate(xmlDoc);
    sp_repr_set_css_double(child, 'offset', 1.0);
    gradient.getRepr().addChild(child, stop.getRepr());
    return true;
  }
  return false;
}

/** Add a stop after current (or before it, if it is the last), halfway to its neighbor. */
export function sp_gradient_add_stop(gradient: SPGradient | null, current: SPStop | null): SPStop | null {
  if (!gradient || !current) return null;
  if (verify_grad(gradient)) {
    // gradient has been fixed by adding stop(s), don't insert another one
    return null;
  }
  let stop = current;
  let next = stop.getNextStop();
  if (!next) {
    const prev = stop.getPrevStop();
    if (prev) {
      next = stop;
      stop = prev;
    }
  }
  const xmlDoc = gradient.getRepr().document();
  let new_stop_repr: Node;
  if (next) {
    new_stop_repr = stop.getRepr().duplicate(xmlDoc);
    gradient.getRepr().addChild(new_stop_repr, stop.getRepr());
  } else {
    next = stop;
    const prev = stop.getPrevStop() as SPStop;
    new_stop_repr = prev.getRepr().duplicate(xmlDoc);
    gradient.getRepr().addChild(new_stop_repr, prev.getRepr());
  }
  const newstop = gradient.document.getObjectByRepr(new_stop_repr) as SPStop;
  newstop.offset = (stop.offset + next.offset) * 0.5;
  newstop.setColor(stop.getColor().averaged(next.getColor()));
  sp_repr_set_css_double(new_stop_repr, 'offset', newstop.offset);
  DocumentUndo.done(gradient.document, C_('Undo', 'Add gradient stop'), ICON);
  return newstop;
}

/** Add a stop at offset with the interpolated color. */
export function sp_gradient_add_stop_at(gradient: SPGradient | null, offset: number): SPStop | null {
  if (!gradient) return null;
  verify_grad(gradient);
  // find stops before and after given offset
  const [before, after] = get_before_after_stops(gradient, offset);
  if (!before && !after) return null;
  const stop = sp_vector_add_stop(gradient, before, after, offset);
  if (stop) DocumentUndo.done(gradient.document, C_('Undo', 'Add gradient stop'), ICON);
  return stop;
}

export function sp_set_gradient_stop_color(document: SPDocument, stop: SPStop, color: Color): void {
  sp_repr_set_css_double(stop.getRepr(), 'offset', stop.offset);
  stop.setColor(color);
  DocumentUndo.maybeDone(document, 'gradient:stop:color', C_('Undo', 'Change gradient stop color'), ICON);
}

/** The stop of vector for a handle of the gradient tool. */
function stop_for_point(vector: SPGradient, point_type: GrPointType, point_i: number): SPStop | null {
  switch (point_type) {
    case GrPointType.POINT_LG_BEGIN:
    case GrPointType.POINT_RG_CENTER:
    case GrPointType.POINT_RG_FOCUS:
      return vector.getFirstStop();
    case GrPointType.POINT_LG_END:
    case GrPointType.POINT_RG_R1:
    case GrPointType.POINT_RG_R2:
      return sp_last_stop(vector);
    case GrPointType.POINT_LG_MID:
    case GrPointType.POINT_RG_MID1:
    case GrPointType.POINT_RG_MID2:
      return sp_get_stop_i(vector, point_i);
    default:
      console.warn('Bad linear/radial gradient handle type');
      return null;
  }
}

export function sp_item_gradient_get_stop(
  item: SPItem,
  point_type: GrPointType,
  point_i: number,
  fill_or_stroke: PaintTarget,
): SPStop | null {
  const gradient = getGradient(item, fill_or_stroke);
  if (!(gradient instanceof SPLinearGradient || gradient instanceof SPRadialGradient)) return null;
  return stop_for_point(gradient.getVector(), point_type, point_i);
}

export function sp_item_gradient_stop_query_style(
  item: SPItem,
  point_type: GrPointType,
  point_i: number,
  fill_or_stroke: PaintTarget,
): Color {
  return (
    sp_item_gradient_get_stop(item, point_type, point_i, fill_or_stroke)?.getColor() ?? new Color(0x000000ff)
  );
}

export function sp_item_gradient_stop_set_style(
  item: SPItem,
  point_type: GrPointType,
  point_i: number,
  fill_or_stroke: PaintTarget,
  stop: SPCSSAttr,
): void {
  const gradient = getGradient(item, fill_or_stroke);
  if (!(gradient instanceof SPLinearGradient || gradient instanceof SPRadialGradient)) return;
  const vector = sp_gradient_get_forked_vector_if_necessary(gradient);
  const s = stop_for_point(vector, point_type, point_i);
  if (s) spReprCssChange(s.getRepr(), stop, 'style');
}

export function sp_item_gradient_reverse_vector(item: SPItem, fill_or_stroke: PaintTarget): void {
  sp_gradient_reverse_vector(getGradient(item, fill_or_stroke));
}

/** Reverse the order of the stops (offset → 1 - offset). */
export function sp_gradient_reverse_vector(gradient: SPGradient | null): void {
  if (!gradient) return;
  const vector = sp_gradient_get_forked_vector_if_necessary(gradient);
  const xmlDoc = vector.getRepr().document();
  const children = vector.childList();
  const offsets = children.map((c) => Number.parseFloat(c.getRepr().attribute('offset') ?? '') || 0);
  const copies = children.map((c) => c.getRepr().duplicate(xmlDoc));
  for (const child of children) child.deleteObject();
  for (let i = copies.length - 1; i >= 0; i--) {
    const copy = copies[i] as Node;
    vector.appendChildRepr(copy);
    copy.setAttributeSvgDouble('offset', 1 - (offsets[i] as number));
  }
}

export function sp_item_gradient_invert_vector_color(item: SPItem, fill_or_stroke: PaintTarget): void {
  const gradient = getGradient(item, fill_or_stroke);
  if (!gradient) return;
  const vector = sp_gradient_get_forked_vector_if_necessary(gradient);
  for (const child of vector.childList()) {
    if (child instanceof SPStop) {
      const color = child.getColor();
      color.invert();
      child.setColor(color);
    }
  }
}

// HACK: linear and radial gradients may have first and/or last stops moved from their default positions
// of 0 and 1 respectively; this is not what gradient tool was built to handle; instead of making extensive
// changes to try to fix it, this hack just makes sure that midpoint draggers don't move to the true 0/1 limits;
// with that, code relying on sp_get_stop_i will work correctly
function midpoint_offset_hack(offset: number): number {
  const EPS = 0.0001;
  if (offset <= 0) return EPS;
  if (offset >= 1) return 1 - EPS;
  return offset;
}

/** Move the mid stop point_i of gradient to offset (vector forked if needed). */
function set_mid_offset(gradient: SPGradient, point_i: number, offset: number, write_repr: boolean): void {
  const vector = sp_gradient_get_forked_vector_if_necessary(gradient);
  gradient.ensureVector();
  const vs = gradient.vector.stops[point_i];
  if (vs) vs.offset = offset;
  const stopi = sp_get_stop_i(vector, point_i);
  if (!stopi) return;
  stopi.offset = offset;
  if (write_repr) sp_repr_set_css_double(stopi.getRepr(), 'offset', stopi.offset);
  else stopi.requestModified(1 | 8 /* SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_STYLE_MODIFIED_FLAG */);
}

/**
 * Set the position of point point_type of the gradient applied to item (either fill_or_stroke)
 * to p_w (in desktop coordinates). write_repr makes the change permanent.
 */
export function sp_item_gradient_set_coords(
  item: SPItem,
  point_type: GrPointType,
  point_i: number,
  p_w: Point,
  fill_or_stroke: PaintTarget,
  write_repr: boolean,
  scale: boolean,
): void {
  let gradient = getGradient(item, fill_or_stroke);
  if (!gradient) return;
  // Needed only if units are set to SP_GRADIENT_UNITS_OBJECTBOUNDINGBOX
  gradient = sp_gradient_convert_to_userspace(gradient, item, propertyOf(fill_or_stroke));

  const i2d = item.i2dtAffine();
  // now p is in gradient's original coordinates
  const p = p_w.transformed(i2d.inverse()).transformed(gradient.gradientTransform.inverse());
  const repr = gradient.getRepr();
  const modified = () => gradient.requestModified(1 /* SP_OBJECT_MODIFIED_FLAG */);

  if (gradient instanceof SPLinearGradient) {
    const lg = gradient;
    switch (point_type) {
      case GrPointType.POINT_LG_BEGIN:
      case GrPointType.POINT_LG_END: {
        const begin = point_type === GrPointType.POINT_LG_BEGIN;
        const [mx, my, ox, oy] = begin ? [lg.x1, lg.y1, lg.x2, lg.y2] : [lg.x2, lg.y2, lg.x1, lg.y1];
        if (scale) {
          ox.computed += mx.computed - p.x;
          oy.computed += my.computed - p.y;
        }
        mx.computed = p.x;
        my.computed = p.y;
        if (write_repr) {
          const [nx, ny, onx, ony] = begin ? ['x1', 'y1', 'x2', 'y2'] : ['x2', 'y2', 'x1', 'y1'];
          if (scale) {
            repr.setAttributeSvgDouble(onx, ox.computed);
            repr.setAttributeSvgDouble(ony, oy.computed);
          }
          repr.setAttributeSvgDouble(nx, mx.computed);
          repr.setAttributeSvgDouble(ny, my.computed);
        } else {
          modified();
        }
        break;
      }
      case GrPointType.POINT_LG_MID: {
        // using X-coordinates only to determine the offset, assuming p has been snapped to the vector from begin to end.
        const begin = new Point(lg.x1.computed, lg.y1.computed);
        const end = new Point(lg.x2.computed, lg.y2.computed);
        const offset = midpoint_offset_hack(nearest_time(p, new LineSegment(begin, end)));
        set_mid_offset(lg, point_i, offset, write_repr);
        break;
      }
      default:
        console.warn('Bad linear gradient handle type');
        break;
    }
  } else if (gradient instanceof SPRadialGradient) {
    const rg = gradient;
    const c = new Point(rg.cx.computed, rg.cy.computed);
    const g2d = gradient.gradientTransform.multiply(i2d);
    const c_w = c.transformed(g2d); // now in desktop coords
    if (
      (point_type === GrPointType.POINT_RG_R1 || point_type === GrPointType.POINT_RG_R2) &&
      L2(p_w.sub(c_w)) < 1e-3
    ) {
      // prevent setting a radius too close to the center
      return;
    }
    let new_transform: Affine | null = null;
    switch (point_type) {
      case GrPointType.POINT_RG_CENTER:
        rg.fx.computed = p.x + (rg.fx.computed - rg.cx.computed);
        rg.fy.computed = p.y + (rg.fy.computed - rg.cy.computed);
        rg.cx.computed = p.x;
        rg.cy.computed = p.y;
        if (write_repr) {
          repr.setAttributeSvgDouble('fx', rg.fx.computed);
          repr.setAttributeSvgDouble('fy', rg.fy.computed);
          repr.setAttributeSvgDouble('cx', rg.cx.computed);
          repr.setAttributeSvgDouble('cy', rg.cy.computed);
        } else {
          modified();
        }
        break;
      case GrPointType.POINT_RG_FOCUS:
        rg.fx.computed = p.x;
        rg.fy.computed = p.y;
        if (write_repr) {
          repr.setAttributeSvgDouble('fx', rg.fx.computed);
          repr.setAttributeSvgDouble('fy', rg.fy.computed);
        } else {
          modified();
        }
        break;
      case GrPointType.POINT_RG_R1:
      case GrPointType.POINT_RG_R2: {
        const r_g =
          point_type === GrPointType.POINT_RG_R1
            ? c.add(new Point(rg.r.computed, 0))
            : c.add(new Point(0, -rg.r.computed));
        const r_w = r_g.transformed(g2d);
        const r_angle = atan2(r_w.sub(c_w));
        const move_angle = atan2(p_w.sub(c_w)) - r_angle;
        const move_stretch = L2(p_w.sub(c_w)) / L2(r_w.sub(c_w));
        const move = Translate(c_w.neg())
          .multiply(Rotate(-r_angle))
          .multiply(Scale(move_stretch, scale ? move_stretch : 1))
          .multiply(Rotate(r_angle))
          .multiply(Rotate(move_angle))
          .multiply(Translate(c_w));
        new_transform = gradient.gradientTransform.multiply(i2d).multiply(move).multiply(i2d.inverse());
        break;
      }
      case GrPointType.POINT_RG_MID1:
      case GrPointType.POINT_RG_MID2: {
        const start = new Point(rg.cx.computed, rg.cy.computed);
        const end =
          point_type === GrPointType.POINT_RG_MID1
            ? new Point(rg.cx.computed + rg.r.computed, rg.cy.computed)
            : new Point(rg.cx.computed, rg.cy.computed - rg.r.computed);
        const offset = midpoint_offset_hack(nearest_time(p, new LineSegment(start, end)));
        set_mid_offset(rg, point_i, offset, write_repr);
        break;
      }
      default:
        console.warn('Bad radial gradient handle type');
        break;
    }
    if (new_transform) {
      gradient.gradientTransform = new_transform;
      gradient.gradientTransform_set = true;
      if (write_repr) {
        gradient.setAttributeOrRemoveIfEmpty(
          'gradientTransform',
          sp_svg_transform_write(gradient.gradientTransform),
        );
      } else {
        modified();
      }
    }
  }
}

export function sp_item_gradient_get_vector(item: SPItem, fill_or_stroke: PaintTarget): SPGradient | null {
  return getGradient(item, fill_or_stroke)?.getVector() ?? null;
}

export function sp_item_gradient_get_spread(item: SPItem, fill_or_stroke: PaintTarget): SPGradientSpread {
  return getGradient(item, fill_or_stroke)?.fetchSpread() ?? SPGradientSpread.SP_GRADIENT_SPREAD_PAD;
}

/**
 * The position of point point_type of the gradient applied to item (either fill_or_stroke), in
 * desktop coordinates.
 */
export function getGradientCoords(
  item: SPItem,
  point_type: GrPointType,
  point_i: number,
  fill_or_stroke: PaintTarget,
): Point {
  const gradient = getGradient(item, fill_or_stroke);
  let p = new Point(0, 0);
  if (!gradient) return p;
  const midOffset = (g: SPGradient) => g.vector.stops[point_i]?.offset;

  if (gradient instanceof SPLinearGradient) {
    const lg = gradient;
    const begin = new Point(lg.x1.computed, lg.y1.computed);
    const end = new Point(lg.x2.computed, lg.y2.computed);
    switch (point_type) {
      case GrPointType.POINT_LG_BEGIN:
        p = begin;
        break;
      case GrPointType.POINT_LG_END:
        p = end;
        break;
      case GrPointType.POINT_LG_MID: {
        const offset = midOffset(lg);
        if (offset !== undefined) p = begin.lerp(offset, end);
        break;
      }
      default:
        console.warn('Bad linear gradient handle type');
        break;
    }
  } else if (gradient instanceof SPRadialGradient) {
    const rg = gradient;
    const c = new Point(rg.cx.computed, rg.cy.computed);
    const r1 = new Point(rg.cx.computed + rg.r.computed, rg.cy.computed);
    const r2 = new Point(rg.cx.computed, rg.cy.computed - rg.r.computed);
    switch (point_type) {
      case GrPointType.POINT_RG_CENTER:
        p = c;
        break;
      case GrPointType.POINT_RG_FOCUS:
        p = new Point(rg.fx.computed, rg.fy.computed);
        break;
      case GrPointType.POINT_RG_R1:
        p = r1;
        break;
      case GrPointType.POINT_RG_R2:
        p = r2;
        break;
      case GrPointType.POINT_RG_MID1:
      case GrPointType.POINT_RG_MID2: {
        const offset = midOffset(rg);
        if (offset !== undefined) p = c.lerp(offset, point_type === GrPointType.POINT_RG_MID1 ? r1 : r2);
        break;
      }
      default:
        console.warn('Bad radial gradient handle type');
        break;
    }
  }

  if (gradient.getUnits() === SPGradientUnits.SP_GRADIENT_UNITS_OBJECTBOUNDINGBOX) {
    item.document.ensureUpToDate();
    const bbox = item.visualBounds(); // we need "true" bbox without item_i2d_affine
    if (bbox) p = p.transformed(new Affine(bbox.width(), 0, 0, bbox.height(), bbox.left(), bbox.top()));
  }
  return p.transformed(gradient.gradientTransform.multiply(item.i2dtAffine()));
}

/**
 * Sets item fill or stroke to the gradient of the specified type with given vector, creating
 * new private gradient, if needed. gr has to be a normalized vector.
 */
export function sp_item_set_gradient(
  item: SPItem,
  gr: SPGradient,
  type: SPGradientType,
  fill_or_stroke: PaintTarget,
): SPGradient {
  if (gr.state !== SPGradientState.SP_GRADIENT_STATE_VECTOR) {
    throw new Error('sp_item_set_gradient: gr is not a normalized vector');
  }
  const style = item.style;
  const fill = fill_or_stroke === PaintTarget.FOR_FILL;
  const ps = style.getFillOrStroke(fill).isPaintserver()
    ? fill
      ? style.getFillPaintServer()
      : style.getStrokePaintServer()
    : null;
  const update = () =>
    item.requestDisplayUpdate(1 | 8 /* SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_STYLE_MODIFIED_FLAG */);

  if (
    (type === SPGradientType.SP_GRADIENT_TYPE_LINEAR && ps instanceof SPLinearGradient) ||
    (type === SPGradientType.SP_GRADIENT_TYPE_RADIAL && ps instanceof SPRadialGradient)
  ) {
    // Current fill style is the gradient of the required type
    const current = ps;
    if (
      !current.isSwatch() &&
      (current.hrefcount === 1 || current.hrefcount === count_gradient_hrefs(item, current))
    ) {
      // current is private and it's either used once, or all its uses are by children of item;
      // so just change its href to vector
      if (current !== gr && current.getVector() !== gr) {
        // href is not the vector
        sp_gradient_repr_set_link(current.getRepr(), gr);
        current.repr_clear_vector(); // remove any stops now that we link to a vector
      }
      update();
      return current;
    }
    // the gradient is not private, or it is shared with someone else;
    // normalize it (this includes creating new private if necessary)
    const normalized = sp_gradient_fork_private_if_necessary(current, gr, type, item);
    if (normalized !== current) {
      // We have to change object style here; recursive because this is used from
      // fill&stroke and must work for groups etc.
      spStyleSetPropertyUrl(item, propertyOf(fill_or_stroke), normalized, true);
    }
    update();
    return normalized;
  }
  // Current fill style is not a gradient or wrong type, so construct everything
  let constructed = sp_gradient_get_private_normalized(item.document, gr, type);
  constructed = sp_gradient_reset_to_userspace(constructed, item);
  spStyleSetPropertyUrl(item, propertyOf(fill_or_stroke), constructed, true);
  update();
  return constructed;
}

function addStop(parent: Node, color: Color, opacity: number, offset: string): void {
  const repr = parent.document().createElement('svg:stop');
  const copy = color.clone();
  copy.addOpacity(opacity);
  SPStop.setColorRepr(repr, copy);
  repr.setAttribute('offset', offset);
  parent.appendChild(repr);
}

/** Create a normalized gradient vector of color in the defs (one stop for a swatch). */
export function sp_document_default_gradient_vector(
  document: SPDocument,
  color: Color,
  opacity: number,
  singleStop: boolean,
): SPGradient {
  const defs = document.getDefs();
  if (!defs) throw new Error('document has no defs');
  const repr = document.getReprDoc().createElement('svg:linearGradient');
  if (!singleStop) {
    // make auto collection optional
    repr.setAttribute(
      'inkscape:collect',
      Preferences.get().getBool('/option/gradient/auto_collect', true) ? 'always' : 'never',
    );
    // set here, but removed when it's edited in the gradient editor
    // Use a gradient prefix for the ID - it's a vector with stop definitions for either linear or radial gradient
    repr.setAttribute('id', document.generateUniqueId('gradient'));
  } else {
    // Use a swatch prefix for the id, for better UX
    repr.setAttribute('id', document.generateUniqueId('swatch'));
  }
  addStop(repr, color, opacity, '0');
  if (!singleStop) {
    // second stop without transparency - no more forcing users to fix alpha channel on new gradients
    addStop(repr, color, 1.0, '1');
  }
  defs.getRepr().appendChild(repr);
  const gr = document.getObjectByRepr(repr);
  if (!(gr instanceof SPGradient)) throw new Error('no gradient object for the new vector');
  gr.state = SPGradientState.SP_GRADIENT_STATE_VECTOR;
  return gr;
}

/** The vector of the linear or radial gradient (fill if fillorstroke) of item, or null. */
export function sp_item_get_gradient(item: SPItem, fillorstroke: boolean): SPGradient | null {
  const style = item.style;
  if (!style.getFillOrStroke(fillorstroke).isPaintserver()) return null;
  const server = fillorstroke ? style.getFillPaintServer() : style.getStrokePaintServer();
  if (
    server instanceof SPLinearGradient ||
    server instanceof SPRadialGradient ||
    (server instanceof SPGradient && server.getVector().isSwatch())
  ) {
    return (server as SPGradient).getVector();
  }
  return null;
}
