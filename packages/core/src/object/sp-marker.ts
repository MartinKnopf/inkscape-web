// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-marker.cpp, src/object/sp-marker.h
/*
 * SVG <marker> implementation
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Bryce Harrington <bryce@bryceharrington.org>
 *   Abhishek Sharma
 *   Jon A. Cruz <jon@joncruz.org>
 *
 * Copyright (C) 1999-2003 Lauris Kaplinski
 *               2004-2006 Bryce Harrington
 *               2008      Johan Engelen
 */
import { Affine, Point, Rect, Rotate, Scale, Translate } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import type { Drawing, DrawingGroup, DrawingItem } from '../display/drawing.ts';
import type { SPDocument } from '../document.ts';
import { SPMarkerUnits } from '../enums.ts';
import { SPMarkerReference } from '../style-internal.ts';
import { cssNumber } from '../svg/css-ostringstream.ts';
import { svgNumber } from '../svg/stringstream.ts';
import { SVGAngle } from '../svg/svg-angle.ts';
import { SVGLength, SVGLengthUnit } from '../svg/svg-length.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import { SP_ITEM_REFERENCE_FLAGS, type SPItemCtx, SPItemKey } from './sp-item.ts';
import { SPGroup } from './sp-item-group.ts';
import {
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_VIEWPORT_MODIFIED_FLAG,
  SP_OBJECT_WRITE_BUILD,
  type SPCtx,
  type SPObject,
} from './sp-object.ts';
import { SPViewBox } from './viewbox.ts';

export enum markerOrient {
  MARKER_ORIENT_ANGLE,
  MARKER_ORIENT_AUTO,
  MARKER_ORIENT_AUTO_START_REVERSE,
}

/** The drawing items of one marker type on one shape view, one per rendered marker. */
interface SPMarkerView {
  items: (DrawingItem | null)[];
}

/**
 * svg:marker (upstream SPMarker). Markers are never shown directly; SPShape shows an instance
 * of the marker at each vertex (sp_marker_show_instance).
 */
export class SPMarker extends SPGroup {
  /* units */
  markerUnits_set = false;
  markerUnits = SPMarkerUnits.SP_MARKER_UNITS_STROKEWIDTH;
  /* reference point */
  refX = new SVGLength();
  refY = new SVGLength();
  /* dimensions */
  markerWidth = new SVGLength();
  markerHeight = new SVGLength();
  /* orient */
  orient_set = false;
  orient_mode = markerOrient.MARKER_ORIENT_ANGLE;
  orient = new SVGAngle();
  /** viewBox, preserveAspectRatio and the child to parent transform (upstream base class SPViewBox). */
  readonly vb = new SPViewBox();

  /*
   * Private views indexed by key that corresponds to a particular marker type (start, mid, end)
   * on a particular path. SPMarkerView is a wrapper for a vector of pointers to DrawingItem
   * instances, one pointer for each rendered marker.
   */
  views_map = new Map<number, SPMarkerView>();

  /** Child to parent transform (viewBox, refX/refY), see SPViewBox. */
  get c2p(): Affine {
    return this.vb.c2p;
  }

  protected override build(document: SPDocument, repr: Node): void {
    this.readAttr(SPAttr.MARKERUNITS);
    this.readAttr(SPAttr.REFX);
    this.readAttr(SPAttr.REFY);
    this.readAttr(SPAttr.MARKERWIDTH);
    this.readAttr(SPAttr.MARKERHEIGHT);
    this.readAttr(SPAttr.ORIENT);
    this.readAttr(SPAttr.VIEWBOX);
    this.readAttr(SPAttr.PRESERVEASPECTRATIO);
    this.readAttr(SPAttr.STYLE);
    super.build(document, repr);
  }

  protected override release(): void {
    for (const key of this.views_map.keys()) sp_marker_hide(this, key);
    this.views_map.clear();
    super.release();
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.MARKERUNITS:
        this.markerUnits_set = false;
        this.markerUnits = SPMarkerUnits.SP_MARKER_UNITS_STROKEWIDTH;
        if (value === 'strokeWidth') {
          this.markerUnits_set = true;
        } else if (value === 'userSpaceOnUse') {
          this.markerUnits = SPMarkerUnits.SP_MARKER_UNITS_USERSPACEONUSE;
          this.markerUnits_set = true;
        }
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_VIEWPORT_MODIFIED_FLAG);
        break;
      case SPAttr.REFX:
        this.refX.readOrUnset(value);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.REFY:
        this.refY.readOrUnset(value);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.MARKERWIDTH:
        this.markerWidth.readOrUnset(value, SVGLengthUnit.NONE, 3.0, 3.0);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.MARKERHEIGHT:
        this.markerHeight.readOrUnset(value, SVGLengthUnit.NONE, 3.0, 3.0);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.ORIENT:
        this.orient_set = false;
        this.orient_mode = markerOrient.MARKER_ORIENT_ANGLE;
        this.orient.assign(0.0);
        this.orient._set = false;
        if (value === 'auto') {
          this.orient_mode = markerOrient.MARKER_ORIENT_AUTO;
          this.orient_set = true;
        } else if (value === 'auto-start-reverse') {
          this.orient_mode = markerOrient.MARKER_ORIENT_AUTO_START_REVERSE;
          this.orient_set = true;
        } else if (value) {
          this.orient.readOrUnset(value);
          if (this.orient._set) {
            this.orient_mode = markerOrient.MARKER_ORIENT_ANGLE;
            this.orient_set = this.orient._set;
          }
        }
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.VIEWBOX:
        this.vb.set_viewBox(value);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_VIEWPORT_MODIFIED_FLAG);
        break;
      case SPAttr.PRESERVEASPECTRATIO:
        this.vb.set_preserveAspectRatio(value);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_VIEWPORT_MODIFIED_FLAG);
        break;
      default:
        super.set(key, value);
        break;
    }
  }

  protected override update(ctx: SPCtx, flags: number): void {
    // Copy parent context, initialize transformations and set up viewport
    const ictx: SPItemCtx = {
      ...(ctx as SPItemCtx),
      i2doc: Affine.identity(),
      i2vp: Affine.identity(),
      viewport: Rect.fromXywh(0, 0, this.markerWidth.computed, this.markerHeight.computed),
    };
    const rctx = this.vb.get_rctx(ictx, 1);

    // Shift according to refX, refY
    const ref = new Point(this.refX.computed, this.refY.computed).transformed(this.vb.c2p);
    this.vb.c2p = this.vb.c2p.multiply(Translate(-ref.x, -ref.y));

    // And invoke parent method
    super.update(rctx, flags);

    // As last step set additional transform of drawing group
    for (const view of this.views_map.values()) {
      for (const item of view.items) (item as DrawingGroup | null)?.setChildTransform(this.c2p);
    }
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) repr = xmlDoc.createElement('svg:marker');
    if (!repr) return super.write(xmlDoc, repr, flags);

    if (this.markerUnits_set) {
      repr.setAttribute(
        'markerUnits',
        this.markerUnits === SPMarkerUnits.SP_MARKER_UNITS_STROKEWIDTH ? 'strokeWidth' : 'userSpaceOnUse',
      );
    } else {
      repr.removeAttribute('markerUnits');
    }
    const lengths = [
      ['refX', this.refX],
      ['refY', this.refY],
      ['markerWidth', this.markerWidth],
      ['markerHeight', this.markerHeight],
    ] as const;
    for (const [name, len] of lengths) repr.setAttribute(name, len._set ? svgNumber(len.computed) : null);

    if (this.orient_set) {
      if (this.orient_mode === markerOrient.MARKER_ORIENT_AUTO) {
        repr.setAttribute('orient', 'auto');
      } else if (this.orient_mode === markerOrient.MARKER_ORIENT_AUTO_START_REVERSE) {
        repr.setAttribute('orient', 'auto-start-reverse');
      } else {
        repr.setAttribute('orient', cssNumber(this.orient.computed));
      }
    } else {
      repr.removeAttribute('orient');
    }

    this.vb.write_viewBox(repr);
    this.vb.write_preserveAspectRatio(repr);
    return super.write(xmlDoc, repr, flags);
  }

  protected override show(_drawing: Drawing, _key: number, _flags: number): DrawingItem | null {
    // Markers in tree are never shown directly even if outside of <defs>.
    return null;
  }

  /** Show the marker content in a group (SPGroup.show), for one instance. */
  private_show(drawing: Drawing, key: number, flags: number): DrawingItem | null {
    return super.show(drawing, key, flags);
  }

  /**
   * Calculate the transformation for this marker.
   * @param base The marker position and direction (see SPShape.get_markers).
   */
  get_marker_transform(base: Affine, linewidth: number, start_marker = false): Affine {
    // Default is MARKER_ORIENT_AUTO
    let result = base;
    if (this.orient_mode === markerOrient.MARKER_ORIENT_AUTO_START_REVERSE) {
      if (start_marker) result = Rotate.from_degrees(180.0).multiply(base);
    } else if (this.orient_mode !== markerOrient.MARKER_ORIENT_AUTO) {
      /* fixme: Orient units (Lauris) */
      result = Rotate.from_degrees(this.orient.computed).multiply(Translate(base.translation()));
    }
    if (this.markerUnits === SPMarkerUnits.SP_MARKER_UNITS_STROKEWIDTH) {
      result = Scale(linewidth).multiply(result);
    }
    return result;
  }
}

/**
 * Set up the DrawingItem array's size in the SPMarkerView with key. This is called from
 * SPShape.update() for shapes that have markers.  It removes the old view of the marker and
 * establishes a new one, registering it with the marker's list of views for future updates.
 *
 * @param marker Marker to create views in.
 * @param key Key to give each SPMarkerView.
 * @param size Number of DrawingItems to put in the SPMarkerView.
 */
export function sp_marker_show_dimension(marker: SPMarker, key: number, size: number): void {
  const view = marker.views_map.get(key);
  if (view) {
    if (view.items.length !== size) {
      // Need to change size of vector! (We should not really need to do this.)
      sp_marker_hide_items(marker, key);
      view.items = new Array(size).fill(null);
    }
  } else {
    marker.views_map.set(key, { items: new Array(size).fill(null) });
  }
}

/**
 * Shows an instance of a marker.  This is called during sp_shape_update_marker_view()
 * show and transform a child item in the drawing for all views with the given key.
 * `drawing` is extra: upstream gets it from parent->drawing().
 */
export function sp_marker_show_instance(
  marker: SPMarker,
  parent: DrawingItem,
  drawing: Drawing,
  loc: number,
  pos: number,
  z_order: number,
  marker_transform: Affine,
  linewidth: number,
): DrawingItem | null {
  // Do not show marker if linewidth == 0 and markerUnits == strokeWidth
  // otherwise Cairo will fail to render anything on the tile
  // that contains the "degenerate" marker.
  if (marker.markerUnits === SPMarkerUnits.SP_MARKER_UNITS_STROKEWIDTH && linewidth === 0) return null;

  const key = parent.key() + SPItemKey.ITEM_KEY_MARKERS + loc;
  const view = marker.views_map.get(key);
  // Key not found, or position index too large, doesn't exist.
  if (!view || pos >= view.items.length) return null;

  // If not already created
  if (!view.items[pos]) {
    /* Parent class ::show method */
    const item = marker.private_show(drawing, key, SP_ITEM_REFERENCE_FLAGS);
    view.items[pos] = item;
    if (item) {
      parent.appendChild(item);
      (item as DrawingGroup).setChildTransform(marker.c2p);
    }
  }

  const item = view.items[pos];
  if (item) {
    item.setTransform(marker_transform);
    item.setZOrder(z_order);
  }
  return item ?? null;
}

/** Hide the children of the marker views with key and release the instance groups. */
function sp_marker_hide_items(marker: SPMarker, key: number): void {
  for (const child of marker.item_list()) child.invokeHide(key);
  for (const item of marker.views_map.get(key)?.items ?? []) item?.unlink();
}

/**
 * Hides/removes all views of the given marker that have key 'key'.
 * This replaces SPItem implementation because we have our own views
 * @param key SPMarkerView key to hide.
 */
export function sp_marker_hide(marker: SPMarker, key: number): void {
  sp_marker_hide_items(marker, key);
  marker.views_map.delete(key);
}

SPMarkerReference.isMarker = (obj: SPObject) => obj instanceof SPMarker;
