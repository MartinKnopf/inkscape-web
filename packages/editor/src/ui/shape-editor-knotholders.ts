// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/shape-editor-knotholders.cpp
/*
 * Node editing extension to objects
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Mitsuru Oka
 *   Maximilian Albert <maximilian.albert@gmail.com>
 *   Abhishek Sharma
 *   Jon A. Cruz <jon@joncruz.org>
 *
 * Licensed under GNU GPL
 *
 * TODO: the knot holders of the other shapes (rect, ellipse, star, spiral, offset, text, ...).
 */
import {
  _,
  Box3D,
  KnotHolderEntity,
  type KnotState,
  knot_state_ctrl,
  markerOrient,
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_VIEWPORT_MODIFIED_FLAG,
  SPAspect,
  SPBox3D,
  type SPItem,
  SPMarker,
  SPMarkerLoc,
  sp_marker_content_bounds,
} from '@inkscape-web/core';
import { type Affine, Point, Rect, Rotate, Translate } from '@inkscape-web/geom';
import type { SPDesktop } from '../desktop.ts';
import { KnotHolder } from './knot/knot-holder.ts';

/** box3d-change-knot-direction: Shift (upstream Modifiers). */
const mod_change_direction = (s: KnotState): boolean => s.shiftKey;
/** trans-confine: Ctrl */
const mod_trans_confine = (s: KnotState): boolean => knot_state_ctrl(s);

/** A corner of a 3D box (upstream Box3DKnotHolderEntity). */
class Box3DKnotHolderEntity extends KnotHolderEntity {
  readonly #knot_id: number;
  readonly #desktop: SPDesktop;

  constructor(desktop: SPDesktop, knot_id: number) {
    super();
    this.#desktop = desktop;
    this.#knot_id = knot_id;
  }

  knot_get(): Point {
    return this.item instanceof SPBox3D ? this.item.get_corner_screen(this.#knot_id) : new Point(0, 0);
  }

  knot_set(new_pos: Point, _origin: Point, state: KnotState): void {
    const s = this.snap_knot_position(new_pos, state);
    const box = this.item;
    if (!(box instanceof SPBox3D)) return;
    const i2dt = box.i2dtAffine();
    const movement =
      this.default_direction_is_xy() !== mod_change_direction(state) ? Box3D.Axis.XY : Box3D.Axis.Z;
    box.set_corner(
      this.#knot_id,
      s.transformed(i2dt),
      movement,
      mod_trans_confine(state),
      this.#desktop.current_zoom(),
    );
    box.set_z_orders();
    box.position_set();
  }

  knot_ungrabbed(): void {}

  default_direction_is_xy(): boolean {
    return this.#knot_id < 4;
  }
}

/** The center of a 3D box (upstream Box3DKnotHolderEntityCenter). */
class Box3DKnotHolderEntityCenter extends KnotHolderEntity {
  readonly #desktop: SPDesktop;

  constructor(desktop: SPDesktop) {
    super();
    this.#desktop = desktop;
  }

  knot_get(): Point {
    return this.item instanceof SPBox3D ? this.item.get_center_screen() : new Point(0, 0);
  }

  knot_set(new_pos: Point, origin: Point, state: KnotState): void {
    const s = this.snap_knot_position(new_pos, state);
    const box = this.item;
    if (!(box instanceof SPBox3D)) return;
    const i2dt = box.i2dtAffine();
    box.set_center(
      s.transformed(i2dt),
      origin.transformed(i2dt),
      !mod_change_direction(state) ? Box3D.Axis.XY : Box3D.Axis.Z,
      mod_trans_confine(state),
      this.#desktop.current_zoom(),
    );
    box.set_z_orders();
    box.position_set();
  }

  knot_ungrabbed(): void {}
}

/** The corner and center knots of a 3D box (upstream Box3DKnotHolder). TODO: pattern and hatch knots. */
export class Box3DKnotHolder extends KnotHolder {
  constructor(desktop: SPDesktop, item: SPBox3D) {
    super(desktop, item);
    for (let knot_id = 0; knot_id < 8; ++knot_id) {
      const entity_corner = new Box3DKnotHolderEntity(desktop, knot_id);
      const tooltip = entity_corner.default_direction_is_xy()
        ? _(
            'Resize box in X/Y direction; with <b>%1</b> along the Z axis; with <b>%2</b> to constrain to the directions of edges or diagonals',
          )
        : _(
            'Resize box along the Z axis; with <b>%1</b> in X/Y direction; with <b>%2</b> to constrain to the directions of edges or diagonals',
          );
      entity_corner.create(
        desktop,
        item,
        this,
        'CANVAS_ITEM_CTRL_TYPE_SHAPER',
        `Box3D:corner${knot_id}`,
        tooltip.replace('%1', 'Shift').replace('%2', 'Ctrl'),
      );
      this.add(entity_corner);
    }
    const entity_center = new Box3DKnotHolderEntityCenter(desktop);
    entity_center.create(
      desktop,
      item,
      this,
      'CANVAS_ITEM_CTRL_TYPE_MARKER',
      'Box3D:center',
      _('Move the box in perspective'),
    );
    this.add(entity_center);
  }
}

/* SPMarker */

/** marker x scale = (marker width)/(view box width) */
function getMarkerXScale(marker: SPMarker): number {
  const w = marker.vb.viewBox.width();
  return w !== 0 ? marker.markerWidth.computed / w : 1.0;
}

function getMarkerYScale(marker: SPMarker): number {
  const h = marker.vb.viewBox.height();
  return h !== 0 ? marker.markerHeight.computed / h : 1.0;
}

/**
 * edit_rotation is the tangent angle that is used in orient auto mode. It is applied in the
 * edit_transform, so it needs to be undone and then the orient.computed can be applied.
 */
function getMarkerRotation(
  marker: SPMarker,
  edit_rotation: number,
  edit_marker_mode: number,
  reverse = false,
): Affine {
  if (
    marker.orient_mode === markerOrient.MARKER_ORIENT_AUTO_START_REVERSE &&
    edit_marker_mode === SPMarkerLoc.SP_MARKER_LOC_START
  ) {
    return Rotate.from_degrees(180.0);
  }
  if (marker.orient_mode === markerOrient.MARKER_ORIENT_ANGLE) {
    return reverse
      ? Rotate.from_degrees(edit_rotation - marker.orient.computed)
      : Rotate.from_degrees(marker.orient.computed - edit_rotation);
  }
  return Rotate.from_degrees(0.0);
}

/** Used to translate the knots when the marker's minimum bounds are less than zero. */
function getMarkerBounds(marker: SPMarker, desktop: SPDesktop): Rect {
  const bounds = sp_marker_content_bounds(marker, desktop.getDocument());
  // Upstream dereferences the empty bounds; a marker without content has no knots to drag.
  return bounds ?? new Rect(new Point(0, 0), new Point(0, 0));
}

/** The marker of the item of an entity. */
function markerOf(item: SPItem | null): SPMarker {
  if (!(item instanceof SPMarker)) throw new Error('the item of a marker knot is not a marker');
  return item;
}

/**
 * The knot that sets the refX/refY attributes of the marker. It is actually shown in the center
 * of the shape vs the actual refX/refY position, to make it more intuitive.
 */
class MarkerKnotHolderEntityReference extends KnotHolderEntity {
  constructor(
    protected readonly desktop: SPDesktop,
    protected readonly _edit_rotation: number,
    protected readonly _edit_marker_mode: number,
  ) {
    super();
  }

  knot_get(): Point {
    const m = markerOf(this.item);
    const min = getMarkerBounds(m, this.desktop).min();
    // knot is actually shown at center of marker, not at its reference point
    return new Point(
      (-m.refX.computed + min.x + m.vb.viewBox.width() / 2) * getMarkerXScale(m),
      (-m.refY.computed + min.y + m.vb.viewBox.height() / 2) * getMarkerYScale(m),
    ).transformed(getMarkerRotation(m, this._edit_rotation, this._edit_marker_mode));
  }

  knot_ungrabbed(): void {}

  knot_set(p: Point): void {
    const m = markerOf(this.item);
    const min = getMarkerBounds(m, this.desktop).min();
    const s = p.neg().transformed(getMarkerRotation(m, this._edit_rotation, this._edit_marker_mode, true));
    m.refX.assign(s.x / getMarkerXScale(m) + min.x + m.vb.viewBox.width() / 2);
    m.refY.assign(s.y / getMarkerYScale(m) + min.y + m.vb.viewBox.height() / 2);
    m.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
  }
}

/** The knot that rotates the marker (sets orient). */
class MarkerKnotHolderEntityOrient extends KnotHolderEntity {
  #originals_set = false;
  /** Angle that the center of the marker makes with the orient knot. */
  #original_center_angle = 0;
  #original_radius = 0;
  #original_center = new Point(0, 0);

  constructor(
    protected readonly desktop: SPDesktop,
    protected readonly _edit_rotation: number,
    protected readonly _edit_marker_mode: number,
  ) {
    super();
  }

  knot_get(): Point {
    const m = markerOf(this.item);
    const min = getMarkerBounds(m, this.desktop).min();
    return new Point(
      (-m.refX.computed + m.vb.viewBox.width() + min.x) * getMarkerXScale(m),
      (-m.refY.computed + min.y) * getMarkerYScale(m),
    ).transformed(getMarkerRotation(m, this._edit_rotation, this._edit_marker_mode));
  }

  knot_ungrabbed(): void {
    this.#originals_set = false;
  }

  knot_set(p: Point, origin: Point, state: KnotState): void {
    if (!this.#originals_set) {
      const m = markerOf(this.item);
      const min = getMarkerBounds(m, this.desktop).min();
      // If the marker is set to auto or auto-start-reverse, set its type to orient and
      // calculate and set the default angle for the orient mode.
      if (m.orient_mode !== markerOrient.MARKER_ORIENT_ANGLE) {
        m.orient.assign(
          m.orient_mode === markerOrient.MARKER_ORIENT_AUTO_START_REVERSE &&
            this._edit_marker_mode === SPMarkerLoc.SP_MARKER_LOC_START
            ? this._edit_rotation + 180.0
            : this._edit_rotation,
        );
        m.orient_mode = markerOrient.MARKER_ORIENT_ANGLE;
        m.orient_set = true;
      }
      // The original marker center is used to calculate the angle with the mouse. The refX/refY
      // change to adjust for the new rotation, to look stationary on the canvas while editing.
      this.#original_center = new Point(
        (-m.refX.computed + min.x + m.vb.viewBox.width() / 2) * getMarkerXScale(m),
        (-m.refY.computed + min.y + m.vb.viewBox.height() / 2) * getMarkerYScale(m),
      ).transformed(getMarkerRotation(m, this._edit_rotation, this._edit_marker_mode));
      this.#original_center_angle =
        (Math.atan2(
          m.markerHeight.computed - m.markerHeight.computed / 2,
          m.markerWidth.computed - m.markerWidth.computed / 2,
        ) *
          180.0) /
        Math.PI;
      this.#original_radius = this.#original_center.length();
      this.#originals_set = true;
    }
    this.#set_internal(p, origin, state);
    this.update_knot();
  }

  #set_internal(p: Point, _origin: Point, _state: KnotState): void {
    const m = markerOf(this.item);
    const min = getMarkerBounds(m, this.desktop).min();
    const center = this.#original_center;
    // edit_rotation is the tangent angle to the shapes and needs to be taken into account while setting the orient angle
    let new_angle = (Math.atan2(p.y - center.y, p.x - center.x) * 180.0) / Math.PI;
    new_angle = new_angle + this._edit_rotation + this.#original_center_angle;
    const axis_angle = -((Math.atan2(center.y, center.x) * 180.0) / Math.PI + this._edit_rotation);

    m.orient.assign(new_angle);
    m.orient_mode = markerOrient.MARKER_ORIENT_ANGLE;
    m.orient_set = true;

    const a = (-(axis_angle + m.orient.computed) * Math.PI) / 180.0;
    m.refX.assign(
      -(this.#original_radius * Math.cos(a)) / getMarkerXScale(m) + min.x + m.vb.viewBox.width() / 2,
    );
    m.refY.assign(
      -(this.#original_radius * Math.sin(a)) / getMarkerYScale(m) + min.y + m.vb.viewBox.height() / 2,
    );
    m.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
  }
}

/** The knots at the corners of the marker scale it around its center, not its reference point. */
class MarkerKnotHolderEntityScale extends KnotHolderEntity {
  #originals_set = false;
  #original_scaleX = 1;
  #original_scaleY = 1;
  #original_refX = 0;
  #original_refY = 0;
  #original_width = 0;
  #original_height = 0;

  /**
   * x_Sign and y_Sign are the position (+/-) of the scaling knot in reference to the center;
   * they make sure scaling works correctly for the other corners.
   */
  constructor(
    protected readonly desktop: SPDesktop,
    protected readonly _edit_rotation: number,
    protected readonly _edit_marker_mode: number,
    protected readonly _x_Sign: number,
    protected readonly _y_Sign: number,
  ) {
    super();
  }

  knot_ungrabbed(): void {
    this.#originals_set = false;
  }

  knot_get(): Point {
    const m = markerOf(this.item);
    const min = getMarkerBounds(m, this.desktop).min();
    return new Point(
      (-m.refX.computed + m.vb.viewBox.width() + min.x) * getMarkerXScale(m),
      (-m.refY.computed + m.vb.viewBox.height() + min.y) * getMarkerYScale(m),
    ).transformed(getMarkerRotation(m, this._edit_rotation, this._edit_marker_mode));
  }

  knot_set(p: Point, origin: Point, state: KnotState): void {
    // keep track of the original values before the knot/mouse position is being moved
    if (!this.#originals_set) {
      const m = markerOf(this.item);
      this.#original_scaleX = getMarkerXScale(m);
      this.#original_scaleY = getMarkerYScale(m);
      this.#original_refX = m.refX.computed;
      this.#original_refY = m.refY.computed;
      this.#original_width = m.vb.viewBox.width();
      this.#original_height = m.vb.viewBox.height();
      this.#originals_set = true;
    }
    this.#set_internal(p, origin, state);
    this.update_knot();
  }

  #set_internal(p: Point, origin: Point, state: KnotState): void {
    const m = markerOf(this.item);
    const min = getMarkerBounds(m, this.desktop).min();
    let adjusted_origin = origin;
    let adjusted_p = p;
    if (m.orient_mode === markerOrient.MARKER_ORIENT_ANGLE) {
      const t = Translate(min).multiply(Rotate.from_degrees(this._edit_rotation - m.orient.computed));
      adjusted_origin = adjusted_origin.transformed(t);
      adjusted_p = adjusted_p.transformed(t);
    } else if (
      m.orient_mode === markerOrient.MARKER_ORIENT_AUTO_START_REVERSE &&
      this._edit_marker_mode === SPMarkerLoc.SP_MARKER_LOC_START
    ) {
      const t = Translate(min).multiply(Rotate.from_degrees(180.0));
      adjusted_origin = adjusted_origin.transformed(t);
      adjusted_p = adjusted_p.transformed(t);
    }

    // x_Sign and y_Sign are (+/- 1) to set the appropriate sign for derived classes
    const orig_width = this._x_Sign * ((this.#original_width * this.#original_scaleX) / 2);
    const orig_height = this._y_Sign * ((this.#original_height * this.#original_scaleY) / 2);

    // x & y displacement between origin and new mouse displacement
    const dx = adjusted_p.x - adjusted_origin.x;
    const dy = adjusted_p.y - adjusted_origin.y;
    let adjusted_scaleX = dx / orig_width + 1;
    let adjusted_scaleY = dy / orig_height + 1;

    const set_size = () => {
      m.markerWidth.assign(m.vb.viewBox.width() * adjusted_scaleX);
      m.markerHeight.assign(m.vb.viewBox.height() * adjusted_scaleY);
      m.refX.assign(
        (this.#original_refX * this.#original_scaleX) / adjusted_scaleX -
          (min.x + m.vb.viewBox.width() / 2) * (this.#original_scaleX / adjusted_scaleX - 1),
      );
      m.refY.assign(
        (this.#original_refY * this.#original_scaleY) / adjusted_scaleY -
          (min.y + m.vb.viewBox.height() / 2) * (this.#original_scaleY / adjusted_scaleY - 1),
      );
    };

    if (mod_trans_confine(state)) {
      // uniform scaling when Ctrl is pressed
      adjusted_scaleX = Math.abs(adjusted_scaleX);
      adjusted_scaleY = Math.abs(adjusted_scaleY);
      // possible areas based on which x/y coord is used to calculate uniform scale
      const dx_area = m.vb.viewBox.width() * adjusted_scaleX * (m.vb.viewBox.height() * adjusted_scaleX);
      const dy_area = m.vb.viewBox.width() * adjusted_scaleY * (m.vb.viewBox.height() * adjusted_scaleY);
      if (dy_area > dx_area) adjusted_scaleX = adjusted_scaleY;
      else if (dx_area > dy_area) adjusted_scaleY = adjusted_scaleX;
      adjusted_scaleX *= this.#original_scaleX;
      adjusted_scaleY *= this.#original_scaleY;
      set_size();
    } else {
      adjusted_scaleX *= this.#original_scaleX;
      adjusted_scaleY *= this.#original_scaleY;
      // make sure the preserveAspectRatio is none when the user wants to use non-uniform scaling
      if (m.vb.aspect_align !== SPAspect.SP_ASPECT_NONE) m.setAttribute('preserveAspectRatio', 'none');
      if (adjusted_scaleX > 0.0 && adjusted_scaleY > 0.0) set_size();
    }
    m.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_VIEWPORT_MODIFIED_FLAG);
  }
}

/** A scale knot at the reference point (upstream MarkerKnotHolderEntityScale2). */
class MarkerKnotHolderEntityScale2 extends MarkerKnotHolderEntityScale {
  override knot_get(): Point {
    const m = markerOf(this.item);
    const min = getMarkerBounds(m, this.desktop).min();
    // this corresponds to the reference point
    return new Point(
      (-m.refX.computed + min.x) * getMarkerXScale(m),
      (-m.refY.computed + min.y) * getMarkerYScale(m),
    ).transformed(getMarkerRotation(m, this._edit_rotation, this._edit_marker_mode));
  }
}

/** A scale knot at the bottom left corner (upstream MarkerKnotHolderEntityScale3). */
class MarkerKnotHolderEntityScale3 extends MarkerKnotHolderEntityScale {
  override knot_get(): Point {
    const m = markerOf(this.item);
    const min = getMarkerBounds(m, this.desktop).min();
    return new Point(
      (-m.refX.computed + min.x) * getMarkerXScale(m),
      (-m.refY.computed + m.vb.viewBox.height() + min.y) * getMarkerYScale(m),
    ).transformed(getMarkerRotation(m, this._edit_rotation, this._edit_marker_mode));
  }
}

/**
 * The knots of a marker (upstream MarkerKnotHolder): reference point, orientation and scale.
 * edit_rotation is the tangent angle of the path at the marker, edit_marker_mode its SPMarkerLoc.
 */
export class MarkerKnotHolder extends KnotHolder {
  constructor(desktop: SPDesktop, item: SPMarker, edit_rotation: number, edit_marker_mode: number) {
    super(desktop, item);
    const entity_reference = new MarkerKnotHolderEntityReference(desktop, edit_rotation, edit_marker_mode);
    const entity_orient = new MarkerKnotHolderEntityOrient(desktop, edit_rotation, edit_marker_mode);
    const entity_scale = new MarkerKnotHolderEntityScale(desktop, edit_rotation, edit_marker_mode, 1, 1);
    // these two additional knots have the same scaling functionality but also serve as a fill in for the empty corners of the marker bounding box
    const entity_scale2 = new MarkerKnotHolderEntityScale2(desktop, edit_rotation, edit_marker_mode, -1, -1);
    const entity_scale3 = new MarkerKnotHolderEntityScale3(desktop, edit_rotation, edit_marker_mode, -1, 1);

    entity_reference.create(
      desktop,
      item,
      this,
      'CANVAS_ITEM_CTRL_TYPE_SHAPER',
      'Marker:reference',
      _('Drag to adjust the refX/refY position of the marker'),
    );
    entity_orient.create(
      desktop,
      item,
      this,
      'CANVAS_ITEM_CTRL_TYPE_ROTATE',
      'Marker:orient',
      _('Adjust marker orientation through rotation'),
    );
    for (const scale of [entity_scale, entity_scale2, entity_scale3]) {
      scale.create(
        desktop,
        item,
        this,
        'CANVAS_ITEM_CTRL_TYPE_SIZER',
        'Marker:scale',
        _('Adjust the <b>size</b> of the marker'),
      );
    }
    this.add(entity_reference);
    this.add(entity_orient);
    this.add(entity_scale);
    this.add(entity_scale2);
    this.add(entity_scale3);
  }
}
