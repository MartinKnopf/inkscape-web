// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-shape.cpp, src/object/sp-shape.h
/*
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Abhishek Sharma
 *   Jon A. Cruz <jon@joncruz.org>
 *   Johan Engelen
 *
 * Copyright (C) 1999-2002 Lauris Kaplinski
 * Copyright (C) 2000-2001 Ximian, Inc.
 * Copyright (C) 1999-2012 Authors
 */
import {
  Affine,
  are_near,
  BezierCurve,
  type Curve,
  EPSILON,
  L2,
  LineSegment,
  middle_point,
  type OptRect,
  type Path,
  PathVector,
  type Point,
  Rotate,
  Translate,
  unify,
  write_svg_path,
} from '@inkscape-web/geom';
import type { Drawing, DrawingItem, DrawingShape } from '../display/drawing.ts';
import type { SPDocument } from '../document.ts';
import { hasPathBoolopBackend, pathBoolopBackend } from '../path/path-boolop.ts';
import { SnapCandidatePoint } from '../snap-candidate.ts';
import { SnapSourceType, SnapTargetType } from '../snap-enums.ts';
import type { SnapPreferences } from '../snap-preferences.ts';
import { SPMarkerLoc } from '../style.ts';
import { SPShapeRendering, SPStrokeCapType, SPStrokeJoinType } from '../style-enums.ts';
import { sp_svg_read_pathv, sp_svg_write_path } from '../svg/svg-path.ts';
import type { Node } from '../xml/node.ts';
import { BBoxType, SPItem, SPItemKey } from './sp-item.ts';
import { lpeItemClasses, SPLPEItem, sp_lpe_item_update_patheffect } from './sp-lpe-item.ts';
import { SPMarker, sp_marker_hide, sp_marker_show_dimension, sp_marker_show_instance } from './sp-marker.ts';
import {
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_PARENT_MODIFIED_FLAG,
  SP_OBJECT_STYLE_MODIFIED_FLAG,
  type SPCtx,
} from './sp-object.ts';
import { sp_css_uri_reference_resolve } from './uri-references.ts';

export const SP_SHAPE_WRITE_PATH = 1 << 2;

/**
 * Base class of shapes, including svg:path (upstream SPShape). The geometry is
 * the curve, a PathVector that is never changed in place: setCurve() replaces it.
 *
 * With a path effect, the curve is the result of the effects; curveBeforeLPE() is the curve
 * they start from (for svg:path the inkscape:original-d attribute).
 *
 * TODO: the 'marker' shorthand, relative stroke units (em, ex, %) in update(), path
 * intersections as snap points, print, documentExactBounds.
 */
export class SPShape extends SPLPEItem {
  // bbox cache
  bbox_geom_cache_is_valid = false;
  bbox_vis_cache_is_valid = false;
  bbox_geom_cache_transform = Affine.identity();
  bbox_vis_cache_transform = Affine.identity();
  bbox_geom_cache: OptRect = null;
  bbox_vis_cache: OptRect = null;

  protected _curve: PathVector | null = null;
  protected _curve_before_lpe: PathVector | null = null;
  /** The markers by SPMarkerLoc (hrefed by this shape). */
  _marker: (SPMarker | null)[] = [null, null, null, null];
  #release_connect: ((() => void) | null)[] = [null, null, null, null];
  #modified_connect: ((() => void) | null)[] = [null, null, null, null];

  /** The curve, or null if there is none. Do not change it in place. */
  curve(): PathVector | null {
    return this._curve;
  }

  /** Set the curve and request a display update. */
  setCurve(newCurve: PathVector | null): void {
    this._curve = newCurve;
    if (newCurve && this.document) this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
  }

  /** Same as setCurve() but without updating the display. */
  setCurveInsync(newCurve: PathVector | null): void {
    this._curve = newCurve;
  }

  /** The curve before the path effects, or null if the shape has no effect. */
  curveBeforeLPE(): PathVector | null {
    return this._curve_before_lpe;
  }

  /** The curve that tools edit: the curve before the path effects if there is one, else the curve. */
  curveForEdit(): PathVector | null {
    return this._curve_before_lpe ?? this._curve;
  }

  setCurveBeforeLPE(new_curve: PathVector | null): void {
    this._curve_before_lpe = new_curve;
  }

  /**
   * Reset the shape's curve to the "original_curve"
   * This is very important for LPEs to work properly! (the bbox might be recalculated depending on the curve in shape)
   * Set the computed curve of a shape; without display update, so that set_shape() can be called
   * from update(). Returns true if the path effects were run.
   */
  protected prepareShapeForLPE(path: Path | PathVector): boolean {
    const c = Array.isArray(path) ? path : [path];
    const before = this.curveBeforeLPE();
    if (before && !pathvEqual(before, c)) {
      this.setCurveBeforeLPE(c);
      sp_lpe_item_update_patheffect(this, true, false);
      return true;
    }
    if (this.hasPathEffectOnClipOrMaskRecursive(this)) {
      const d = this.getAttribute('d');
      if (!before && d) this.setCurveInsync(sp_svg_read_pathv(d));
      this.setCurveBeforeLPE(c);
      return true;
    }
    this.setCurveInsync(c);
    return false;
  }

  /**
   * If the shape has an effect that is not known, read the curve from d to keep its appearance.
   * Returns true in that case (the shape then does not compute its curve).
   */
  checkBrokenPathEffect(): boolean {
    if (this.hasBrokenPathEffect()) {
      console.warn(
        'The shape has unknown LPE on it. Convert to path to make it editable preserving the appearance; editing it will remove the bad LPE',
      );
      const d = this.getAttribute('d');
      if (d) {
        // unconditionally read the curve from d, if any, to preserve appearance
        this.setCurveInsync(sp_svg_read_pathv(d));
        this.setCurveBeforeLPE(this.curve());
      }
      return true;
    }
    return false;
  }

  /** Run the path effects on the curve before them; with write, store the result in d. */
  override update_patheffect(write: boolean): void {
    if (!this.curveForEdit()) this.set_shape();
    const edit = this.curveForEdit();
    if (!edit) return;
    const c_lpe: [PathVector] = [edit];
    /* if a path has an lpeitem applied, then reset the curve to the _curve_before_lpe.
     * This is very important for LPEs to work properly! (the bbox might be recalculated depending on the curve in shape)*/
    this.setCurveInsync(edit);
    let success = false;
    // avoid update lpe in each selection
    // must be set also to non effect items (satellites or parents)
    this.lpe_initialized = true;
    if (this.hasPathEffect() && this.pathEffectsEnabled()) {
      success = this.performPathEffect(c_lpe, this);
      if (success) {
        this.resetClipPathAndMaskLPE();
        this.setCurveInsync(c_lpe[0]);
        this.applyToClipPath(this);
        this.applyToMask(this);
      }
    }
    if (write && success) this.getRepr()?.setAttribute('d', sp_svg_write_path(c_lpe[0]));
    if (success) this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
  }

  /** Compute the curve from the attributes (rect, ellipse, …). Subclasses override it. */
  set_shape(): void {}

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    for (let i = 0; i < SPMarkerLoc.SP_MARKER_LOC_QTY; i++) {
      this.set_marker(i, this.style.marker_ptrs[i]?.value() ?? null);
    }
    if (!this.hasPathEffectOnClipOrMaskRecursive(this)) {
      const SPPath = lpeItemClasses.SPPath;
      if (SPPath && this instanceof SPPath) {
        const originald = this.getAttribute('inkscape:original-d');
        if (originald) {
          if (this.isOnClipboard()) this.setAttribute('d', originald);
          this.setAttribute('inkscape:original-d', null);
        }
      }
    }
  }

  protected override release(): void {
    for (let i = 0; i < SPMarkerLoc.SP_MARKER_LOC_QTY; i++) this.#detach_marker(i);
    this._curve = null;
    this._curve_before_lpe = null;
    super.release();
  }

  protected override update(ctx: SPCtx, flags: number): void {
    // Any update can change the bounding box,
    // so the cached version can no longer be used.
    this.bbox_vis_cache_is_valid = false;
    this.bbox_geom_cache_is_valid = false;

    super.update(ctx, flags);

    /* This stanza checks that an object's marker style agrees with
     * the marker objects it has allocated.  sp_shape_set_marker ensures
     * that the appropriate marker objects are present (or absent) to
     * match the style.
     */
    for (let i = 0; i < SPMarkerLoc.SP_MARKER_LOC_QTY; i++) {
      this.set_marker(i, this.style.marker_ptrs[i]?.value() ?? null);
    }

    if (flags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_PARENT_MODIFIED_FLAG)) {
      if (flags & SP_OBJECT_MODIFIED_FLAG) {
        for (const v of this.views) (v.drawingitem as DrawingShape).setPath(this._curve);
      }
    }

    if (this.hasMarkers()) {
      /* Dimension marker views */
      for (const v of this.views) {
        SPItem.ensureKey(v.drawingitem);
        for (let i = 0; i < SPMarkerLoc.SP_MARKER_LOC_QTY; i++) {
          const marker = this._marker[i];
          if (marker) {
            sp_marker_show_dimension(
              marker,
              v.drawingitem.key() + SPItemKey.ITEM_KEY_MARKERS + i,
              this.numberOfMarkers(i),
            );
          }
        }
      }
      /* Update marker views */
      for (const v of this.views) sp_shape_update_marker_view(this, v.drawingitem, v.drawing);
      // Marker selector needs this here or marker previews are not rendered.
      for (const v of this.views) v.drawingitem.setChildrenStyle(this.context_style); // Resolve 'context-xxx' in children.
    }
  }

  protected override modified(flags: number): void {
    super.modified(flags);
    if (flags & SP_OBJECT_STYLE_MODIFIED_FLAG) {
      for (const v of this.views) {
        if (this.hasMarkers()) {
          this.context_style = this.style;
          v.drawingitem.setStyle(this.style, this.context_style);
          v.drawingitem.setChildrenStyle(this.context_style); // Resolve 'context-xxx' in children.
        } else if (this.parent) {
          this.context_style = this.parent.context_style;
          v.drawingitem.setStyle(this.style, this.context_style);
        }
      }
    }
    // TODO: update the filter regions.
    if (!this._curve) sp_lpe_item_update_patheffect(this, true, false);
  }

  override bbox(transform: Affine, bboxtype: BBoxType): OptRect {
    // If the object is clipped, the update function that invalidates
    // the cache doesn't get called if the object is moved, so we need
    // to compare the transformations as well.
    if (bboxtype === BBoxType.VISUAL_BBOX) {
      this.bbox_vis_cache = this.either_bbox(
        transform,
        bboxtype,
        this.bbox_vis_cache_is_valid,
        this.bbox_vis_cache,
        this.bbox_vis_cache_transform,
      );
      if (this.bbox_vis_cache) {
        this.bbox_vis_cache_transform = transform;
        this.bbox_vis_cache_is_valid = true;
      }
      return this.bbox_vis_cache;
    }
    this.bbox_geom_cache = this.either_bbox(
      transform,
      bboxtype,
      this.bbox_geom_cache_is_valid,
      this.bbox_geom_cache,
      this.bbox_geom_cache_transform,
    );
    if (this.bbox_geom_cache) {
      this.bbox_geom_cache_transform = transform;
      this.bbox_geom_cache_is_valid = true;
    }
    return this.bbox_geom_cache;
  }

  either_bbox(
    transform: Affine,
    bboxtype: BBoxType,
    cacheIsValid: boolean,
    bboxCache: OptRect,
    transformCache: Affine,
  ): OptRect {
    // Return the cache if possible.
    if (cacheIsValid && bboxCache) {
      const delta = transformCache.inverse().multiply(transform);
      if (delta.isTranslation()) {
        // Don't re-adjust the cache if we haven't moved
        if (!delta.isNonzeroTranslation()) return bboxCache;
        // delta is pure translation so it's safe to use it as is
        return bboxCache.transformed(delta);
      }
    }

    if (!this._curve || this._curve.length === 0) return null;

    let bbox = PathVector.boundsExact(PathVector.transformed(this._curve, transform));
    if (!bbox) return null;

    if (bboxtype === BBoxType.VISUAL_BBOX) {
      // convert the stroke to a path and calculate that path's geometric bbox
      if (!this.style.stroke.isNone() && !this.style.stroke_extensions.hairline) {
        const outline = this.#strokeOutline();
        if (outline) {
          bbox = unify(bbox, PathVector.boundsExact(PathVector.transformed(outline, transform)));
        } else {
          // Without the path operations (WASM), expand by half the stroke width.
          bbox = bbox.expandBy(0.5 * this.style.stroke_width.computed * transform.descrim());
        }
      }
      if (this.hasMarkers()) {
        for (const [, marker, tr] of this.get_markers()) {
          const marker_item = marker.item_list()[0];
          if (marker_item) {
            const box = marker_item.visualBounds(
              marker_item.transform.multiply(marker.c2p).multiply(tr).multiply(transform),
            );
            bbox = unify(bbox, box);
          }
        }
      }
    }
    return bbox;
  }

  /**
   * The outline of the stroke in item coordinates, for the visual bbox (upstream item_to_outline
   * with bbox_only, livarot in WASM), or null without the path operations or stroke.
   * TODO: dashes.
   */
  #strokeOutline(): PathVector | null {
    const style = this.style;
    const stroke_width = style.stroke_width.computed;
    if (!this._curve || !hasPathBoolopBackend() || stroke_width <= EPSILON) return null;
    const join =
      style.stroke_linejoin.computed === SPStrokeJoinType.SP_STROKE_LINEJOIN_MITER
        ? 2 // join_pointy
        : style.stroke_linejoin.computed === SPStrokeJoinType.SP_STROKE_LINEJOIN_ROUND
          ? 1 // join_round
          : 0; // join_straight
    const butt =
      style.stroke_linecap.computed === SPStrokeCapType.SP_STROKE_LINECAP_SQUARE
        ? 1 // butt_square
        : style.stroke_linecap.computed === SPStrokeCapType.SP_STROKE_LINECAP_ROUND
          ? 2 // butt_round
          : 0; // butt_straight
    const miter = style.stroke_miterlimit.value * stroke_width;
    const d = pathBoolopBackend().strokeOutline(write_svg_path(this._curve), stroke_width, join, butt, miter);
    return sp_svg_read_pathv(d);
  }

  protected override show(drawing: Drawing, _key: number, _flags: number): DrawingItem {
    const s = drawing.createShape();
    s.setPath(this._curve);

    /* This stanza checks that an object's marker style agrees with
     * the marker objects it has allocated.  sp_shape_set_marker ensures
     * that the appropriate marker objects are present (or absent) to
     * match the style.
     */
    for (let i = 0; i < SPMarkerLoc.SP_MARKER_LOC_QTY; i++) {
      this.set_marker(i, this.style.marker_ptrs[i]?.value() ?? null);
    }

    if (this.hasMarkers()) {
      /* provide key and dimension the marker views */
      SPItem.ensureKey(s);
      for (let i = 0; i < SPMarkerLoc.SP_MARKER_LOC_QTY; i++) {
        const marker = this._marker[i];
        if (marker) {
          sp_marker_show_dimension(marker, s.key() + SPItemKey.ITEM_KEY_MARKERS + i, this.numberOfMarkers(i));
        }
      }
      /* Update marker views */
      sp_shape_update_marker_view(this, s, drawing);
      this.context_style = this.style;
      s.setStyle(this.style, this.context_style);
      s.setChildrenStyle(this.context_style); // Resolve 'context-xxx' in children.
    } else if (this.parent) {
      this.context_style = this.parent.context_style;
      s.setStyle(this.style, this.context_style);
    }
    // apply 'shape-rendering' presentation attribute
    s.setAntialiasing(
      this.style.shape_rendering.computed !== SPShapeRendering.SP_CSS_SHAPE_RENDERING_CRISPEDGES,
    );
    return s;
  }

  protected override hide(key: number): void {
    for (let i = 0; i < SPMarkerLoc.SP_MARKER_LOC_QTY; ++i) {
      const marker = this._marker[i];
      if (!marker) continue;
      for (const v of this.views) {
        if (key === v.key) sp_marker_hide(marker, v.drawingitem.key() + SPItemKey.ITEM_KEY_MARKERS + i);
      }
    }
  }

  /** True if the shape has any markers. */
  hasMarkers(): boolean {
    /* Note, we're ignoring 'marker' settings, which technically should apply for
       all three settings.  This should be fixed later such that if 'marker' is
       specified, then all three should appear. */

    // Ignore markers for objects which are inside markers themselves.
    for (let parent = this.parent; parent !== null; parent = parent.parent) {
      if (parent instanceof SPMarker) return false;
    }
    return !!this._curve && this._marker.some((m) => m !== null);
  }

  /** Number of markers that the shape has of type (an SPMarkerLoc). */
  numberOfMarkers(type: number): number {
    const pathv = this._curve;
    if (!pathv?.length) return 0;
    switch (type) {
      case SPMarkerLoc.SP_MARKER_LOC: {
        if (!this._marker[SPMarkerLoc.SP_MARKER_LOC]) return 0;
        let n = 0;
        for (const path_it of pathv) n += path_it.size() + 1;
        return n;
      }
      case SPMarkerLoc.SP_MARKER_LOC_START:
        // there is only a start marker on the first path of a pathvector
        return this._marker[SPMarkerLoc.SP_MARKER_LOC_START] ? 1 : 0;
      case SPMarkerLoc.SP_MARKER_LOC_MID: {
        if (!this._marker[SPMarkerLoc.SP_MARKER_LOC_MID]) return 0;
        let n = 0;
        for (const path_it of pathv) n += path_it.size() + 1;
        // Minus the start and end marker, but never negative.
        // A path or polyline may have only one point.
        return n > 1 ? n - 2 : 0;
      }
      case SPMarkerLoc.SP_MARKER_LOC_END:
        // there is only an end marker on the last path of a pathvector
        return this._marker[SPMarkerLoc.SP_MARKER_LOC_END] ? 1 : 0;
      default:
        return 0;
    }
  }

  /**
   * Lists every marker on this shape along with its transform and marker type.
   * The transform returned is not premultiplied by `marker.c2p`.
   */
  get_markers(): [SPMarkerLoc, SPMarker, Affine][] {
    const markers: [SPMarkerLoc, SPMarker, Affine][] = [];
    const pathv = this._curve;
    if (!pathv?.length) return markers; // empty list

    const width = this.style.stroke_width.computed;
    const add_marker = (marker_type: SPMarkerLoc, m: Affine, start: boolean) => {
      const marker = this._marker[marker_type];
      if (marker) markers.push([marker_type, marker, marker.get_marker_transform(m, width, start)]);
    };
    const front = pathv[0] as Path;

    // START marker
    {
      const m = sp_shape_marker_get_transform_at_start(front.at(0));
      for (const marker_type of [SPMarkerLoc.SP_MARKER_LOC, SPMarkerLoc.SP_MARKER_LOC_START]) {
        add_marker(marker_type, m, true);
      }
    }

    // MID marker
    pathv.forEach((path_it, index) => {
      const last = index === pathv.length - 1;
      const size = path_it.size();
      // START position
      // if this is the last path and it is a moveto-only, don't draw mid marker there
      if (index !== 0 && !(last && size === 0)) {
        const m = sp_shape_marker_get_transform_at_start(path_it.at(0));
        for (const marker_type of [SPMarkerLoc.SP_MARKER_LOC, SPMarkerLoc.SP_MARKER_LOC_MID]) {
          add_marker(marker_type, m, false);
        }
      }
      // MID position
      if (size > 1) {
        /* Put marker between curve_it1 and curve_it2.
         * Loop to end_default (so including closing segment), because when a path is closed,
         * there should be a midpoint marker between last segment and closing straight line segment
         */
        for (let i = 1; i < size; i++) {
          const m = sp_shape_marker_get_transform(path_it.at(i - 1), path_it.at(i));
          for (const marker_type of [SPMarkerLoc.SP_MARKER_LOC, SPMarkerLoc.SP_MARKER_LOC_MID]) {
            add_marker(marker_type, m, false);
          }
        }
      }
      // END position
      if (!last && !path_it.empty()) {
        const m = sp_shape_marker_get_transform_at_end(path_it.at(Math.max(size - 1, 0)));
        for (const marker_type of [SPMarkerLoc.SP_MARKER_LOC, SPMarkerLoc.SP_MARKER_LOC_MID]) {
          add_marker(marker_type, m, false);
        }
      }
    });

    // END marker
    {
      /* Get reference to last curve in the path.
       * For moveto-only path, this returns the "closing line segment". */
      const path_last = pathv[pathv.length - 1] as Path;
      const index = path_last.size();
      const m = sp_shape_marker_get_transform_at_end(path_last.at(index > 0 ? index - 1 : index));
      for (const marker_type of [SPMarkerLoc.SP_MARKER_LOC, SPMarkerLoc.SP_MARKER_LOC_END]) {
        add_marker(marker_type, m, false);
      }
    }
    return markers;
  }

  /**
   * Adds a new marker to shape object at the location indicated by key.  value
   * must be a valid URI reference resolvable from the shape object (i.e., present
   * in the document <defs>).  If the shape object already has a marker
   * registered at the given position, it is removed first.  Then the
   * new marker is hrefed and its signals connected.
   */
  set_marker(key: number, value: string | null): void {
    if (key > SPMarkerLoc.SP_MARKER_LOC_END) return;
    const mrk = sp_css_uri_reference_resolve(this.document, value);
    const marker = mrk instanceof SPMarker ? mrk : null;
    if (marker === this._marker[key]) return;
    this.#detach_marker(key);
    if (marker) {
      this._marker[key] = marker;
      marker.hrefObject(this);
      this.#release_connect[key] = marker.releaseSignal.connect(() => this.#detach_marker(key));
      this.#modified_connect[key] = marker.modifiedSignal.connect((_m, flags) => {
        // changing marker can impact object's visual bounding box, so request update on this object itself
        if (flags & SP_OBJECT_MODIFIED_FLAG) this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
      });
    }
  }

  /** Detach, hide and unref the marker at key (upstream sp_shape_marker_release and part of set_marker). */
  #detach_marker(key: number): void {
    const marker = this._marker[key];
    if (!marker) return;
    this.#release_connect[key]?.();
    this.#modified_connect[key]?.();
    this.#release_connect[key] = null;
    this.#modified_connect[key] = null;
    for (const v of this.views)
      sp_marker_hide(marker, v.drawingitem.key() + SPItemKey.ITEM_KEY_MARKERS + key);
    marker.unhrefObject(this);
    this._marker[key] = null;
  }

  /**
   * The nodes of the curve as snap points (cusp or smooth), line midpoints
   * and the object midpoint, as the snap preferences ask.
   * TODO: the self-intersections of each path (SNAPTARGET_PATH_INTERSECTION).
   */
  override snappoints(p: SnapCandidatePoint[], snapprefs: SnapPreferences): void {
    const pathv = this._curve;
    if (!pathv?.length) return;
    const i2dt = this.i2dtAffine();
    const add = (pt: Point, s: SnapSourceType, t: SnapTargetType) =>
      p.push(new SnapCandidatePoint(pt.transformed(i2dt), s, t));
    if (snapprefs.isTargetSnappable(SnapTargetType.SNAPTARGET_OBJECT_MIDPOINT)) {
      const bbox = this.desktopVisualBounds();
      if (bbox) {
        p.push(
          new SnapCandidatePoint(
            bbox.midpoint(),
            SnapSourceType.SNAPSOURCE_OBJECT_MIDPOINT,
            SnapTargetType.SNAPTARGET_OBJECT_MIDPOINT,
          ),
        );
      }
    }
    const cusp = snapprefs.isTargetSnappable(SnapTargetType.SNAPTARGET_NODE_CUSP);
    const smooth = snapprefs.isTargetSnappable(SnapTargetType.SNAPTARGET_NODE_SMOOTH);
    const midpoints = snapprefs.isTargetSnappable(SnapTargetType.SNAPTARGET_LINE_MIDPOINT);
    for (const path_it of pathv) {
      // Add the first point of the path
      if (cusp)
        add(path_it.initialPoint(), SnapSourceType.SNAPSOURCE_NODE_CUSP, SnapTargetType.SNAPTARGET_NODE_CUSP);
      // Only the stroked part (end_default): the closing segment is included if it is not degenerate.
      const curves = path_it.closed() ? path_it.curves() : path_it.openCurves();
      curves.forEach((curve_it1, i) => {
        // For each path: consider midpoints of line segments for snapping
        if (midpoints && curve_it1 instanceof LineSegment) {
          add(
            middle_point(curve_it1.initialPoint(), curve_it1.finalPoint()),
            SnapSourceType.SNAPSOURCE_LINE_MIDPOINT,
            SnapTargetType.SNAPTARGET_LINE_MIDPOINT,
          );
        }
        const curve_it2 = curves[i + 1];
        if (!curve_it2) {
          // Add the last point of the path, but only for open paths
          // (for closed paths the first and last point will coincide)
          if (cusp && !path_it.closed())
            add(
              curve_it1.finalPoint(),
              SnapSourceType.SNAPSOURCE_NODE_CUSP,
              SnapTargetType.SNAPTARGET_NODE_CUSP,
            );
          return;
        }
        const nodetype = get_nodetype(curve_it1, curve_it2);
        if (nodetype === GeomNodeType.NODE_SMOOTH) {
          if (smooth)
            add(
              curve_it1.finalPoint(),
              SnapSourceType.SNAPSOURCE_NODE_SMOOTH,
              SnapTargetType.SNAPTARGET_NODE_SMOOTH,
            );
        } else if (nodetype === GeomNodeType.NODE_CUSP) {
          if (cusp)
            add(
              curve_it1.finalPoint(),
              SnapSourceType.SNAPSOURCE_NODE_CUSP,
              SnapTargetType.SNAPTARGET_NODE_CUSP,
            );
        }
      });
    }
  }
}

/** The type of the node between two curves (upstream Geom::NodeType without NODE_SYMM; renamed: xml NodeType exists). */
export enum GeomNodeType {
  NODE_NONE,
  NODE_CUSP,
  NODE_SMOOTH,
}

/**
 * Unit tangent of c at t = 0 (forward) or t = 1 (backward); exact for Bezier curves
 * (the first control point that differs from the end, as upstream's derivatives give it),
 * numeric for other curve types.
 */
function unitTangentAt(c: Curve, t: 0 | 1): Point {
  if (c instanceof BezierCurve) {
    const pts = t === 0 ? c.controlPoints() : [...c.controlPoints()].reverse();
    const p0 = pts[0] as Point;
    for (const p of pts.slice(1)) {
      const d = t === 0 ? p.sub(p0) : p0.sub(p);
      if (L2(d) > 1e-12) return d.normalized();
    }
    return p0.sub(p0);
  }
  for (const eps of [1e-6, 1e-3, 0.1]) {
    const d = t === 0 ? c.pointAt(eps).sub(c.pointAt(0)) : c.pointAt(1).sub(c.pointAt(1 - eps));
    if (L2(d) > 1e-12) return d.normalized();
  }
  return c.finalPoint().sub(c.initialPoint());
}

/** Whether the node between c_incoming and c_outgoing is smooth or a cusp (upstream Geom::get_nodetype). */
export function get_nodetype(c_incoming: Curve, c_outgoing: Curve): GeomNodeType {
  if (!are_near(c_incoming.pointAt(1), c_outgoing.pointAt(0))) return GeomNodeType.NODE_NONE;
  const deriv_1 = unitTangentAt(c_incoming, 1);
  const deriv_2 = unitTangentAt(c_outgoing, 0);
  const this_angle_L2 = L2(deriv_1);
  const next_angle_L2 = L2(deriv_2);
  const both_angles_L2 = L2(deriv_1.add(deriv_2));
  if (this_angle_L2 > 1e-6 && next_angle_L2 > 1e-6 && this_angle_L2 + next_angle_L2 - both_angles_L2 < 1e-3) {
    return GeomNodeType.NODE_SMOOTH;
  }
  return GeomNodeType.NODE_CUSP;
}

/**
 * Calculate the transform required to get a marker's path object in the
 * right place for particular path segment on a shape.
 *
 * From SVG spec:
 * The axes of the temporary new user coordinate system are aligned according to the orient attribute on the 'marker'
 * element and the slope of the curve at the given vertex. (Note: if there is a discontinuity at a vertex, the slope
 * is the average of the slopes of the two segments of the curve that join at the given vertex. If a slope cannot be
 * determined, the slope is assumed to be zero.)
 */
export function sp_shape_marker_get_transform(c1: Curve, c2: Curve): Affine {
  const p = c1.pointAt(1);
  const tang1 = unitTangentAt(c1, 1);
  const tang2 = unitTangentAt(c2, 0);
  const angle1 = Math.atan2(tang1.y, tang1.x);
  const angle2 = Math.atan2(tang2.y, tang2.x);
  let ret_angle = 0.5 * (angle1 + angle2);
  if (Math.abs(angle2 - angle1) > Math.PI) {
    /* ret_angle is in the middle of the larger of the two sectors between angle1 and
     * angle2, so flip it by 180degrees to force it to the middle of the smaller sector.
     *
     * (Imagine a circle with rays drawn at angle1 and angle2 from the centre of the
     * circle.  Those two rays divide the circle into two sectors.)
     */
    ret_angle += Math.PI;
  }
  return Rotate(ret_angle).multiply(Translate(p));
}

export function sp_shape_marker_get_transform_at_start(c: Curve): Affine {
  const p = c.pointAt(0);
  if (c.isDegenerate()) {
    /* FIXME: the svg spec says to search for a better alternative than zero angle directionality:
     * http://www.w3.org/TR/SVG11/implnote.html#PathElementImplementationNotes */
    return Translate(p);
  }
  const tang = unitTangentAt(c, 0);
  return Rotate(Math.atan2(tang.y, tang.x)).multiply(Translate(p));
}

export function sp_shape_marker_get_transform_at_end(c: Curve): Affine {
  const p = c.pointAt(1);
  if (c.isDegenerate()) {
    /* FIXME: the svg spec says to search for a better alternative than zero angle directionality:
     * http://www.w3.org/TR/SVG11/implnote.html#PathElementImplementationNotes */
    return Translate(p);
  }
  const tang = unitTangentAt(c, 1);
  return Rotate(Math.atan2(tang.y, tang.x)).multiply(Translate(p));
}

/**
 * Updates the instances (views) of a given marker in a shape.
 * Marker views have to be scaled already.  The transformation
 * is retrieved and then shown by calling sp_marker_show_instance.
 */
function sp_shape_update_marker_view(shape: SPShape, ai: DrawingItem, drawing: Drawing): void {
  if (!shape.curve()) return;
  // the first vertex should get a start marker, the last an end marker, and all the others a mid marker
  // see bug 456148

  // Record the number of instances of each marker type and their absolute position
  const counter = [0, 0, 0, 0];
  let z_order = 0;
  for (const [type, marker, tr] of shape.get_markers()) {
    const pos = counter[type] ?? 0;
    counter[type] = pos + 1;
    sp_marker_show_instance(marker, ai, drawing, type, pos, z_order++, tr, shape.style.stroke_width.computed);
  }
}

lpeItemClasses.SPShape = SPShape;

/** Exact equality of two path vectors (upstream PathVector::operator==). */
function pathvEqual(a: PathVector, b: PathVector): boolean {
  return a.length === b.length && a.every((p, i) => p.equals(b[i] as Path));
}
