// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/box3d.cpp, src/object/box3d.h
/*
 * SVG <box3d> implementation
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Maximilian Albert <Anhalter42@gmx.de>
 *   Abhishek Sharma
 *   Jon A. Cruz <jon@joncruz.org>
 *
 * Copyright (C) 2007      Authors
 * Copyright (C) 1999-2002 Lauris Kaplinski
 * Copyright (C) 2000-2001 Ximian, Inc.
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { Affine, L2, Point } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import { Box3D, Proj } from '../axis-manip.ts';
import type { SPDocument } from '../document.ts';
import { _ } from '../i18n.ts';
import { Line, lies_in_sector } from '../line-geometry.ts';
import { PerspectiveLine } from '../perspective-line.ts';
import { Pt3 } from '../proj_pt.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import { Box3DSide } from './box3d-side.ts';
import { ObjectSet } from './object-set.ts';
import { Persp3D } from './persp3d.ts';
import { Persp3DReference } from './persp3d-reference.ts';
import type { SPItem } from './sp-item.ts';
import { SPGroup } from './sp-item-group.ts';
import { SP_OBJECT_WRITE_BUILD, SP_OBJECT_WRITE_EXT, type SPObject } from './sp-object.ts';

/** The current perspective of each document (upstream SPDocument::current_persp3d). */
const current_persp3d = new WeakMap<SPDocument, Persp3D | null>();

/**
 * The perspective that new boxes use (upstream SPDocument::getCurrentPersp3D): the one set with
 * setCurrentPersp3D() if it is still in the defs, else the first one in the defs, or null.
 */
export function getCurrentPersp3D(doc: SPDocument): Persp3D | null {
  const plist = doc.getDefs()?.children.filter((c) => c instanceof Persp3D) ?? [];
  const current = current_persp3d.get(doc);
  if (current && plist.includes(current)) return current;
  // If not, return the first perspective in defs (which may be NULL of none exists)
  const first = Persp3D.document_first_persp(doc);
  current_persp3d.set(doc, first);
  return first;
}

export function setCurrentPersp3D(doc: SPDocument, persp: Persp3D | null): void {
  current_persp3d.set(doc, persp);
}

function box3d_get_proj_corner(id: number, c0: Pt3, c7: Pt3): Pt3 {
  return new Pt3(
    id & Box3D.Axis.X ? c7.at(Proj.Axis.X) : c0.at(Proj.Axis.X),
    id & Box3D.Axis.Y ? c7.at(Proj.Axis.Y) : c0.at(Proj.Axis.Y),
    id & Box3D.Axis.Z ? c7.at(Proj.Axis.Z) : c0.at(Proj.Axis.Z),
    1.0,
  );
}

/*
 * To keep the snappoint from jumping randomly between the two lines when the mouse pointer is close to
 * their intersection, we remember the last snapped line and keep snapping to this specific line as long
 * as the distance from the intersection to the mouse pointer is less than remember_snap_threshold.
 */
// Should we make the threshold settable in the preferences?
const remember_snap_threshold = 30;
let remember_snap_index = 0;

function box3d_snap(box: SPBox3D, id: number, pt_proj: Pt3, start_pt: Pt3, zoom: number): Pt3 {
  const z_coord = start_pt.at(Proj.Axis.Z);
  const diff_x = box.save_corner7.at(Proj.Axis.X) - box.save_corner0.at(Proj.Axis.X);
  const diff_y = box.save_corner7.at(Proj.Axis.Y) - box.save_corner0.at(Proj.Axis.Y);
  const x_coord = start_pt.at(Proj.Axis.X);
  const y_coord = start_pt.at(Proj.Axis.Y);
  const tmat = box.get_perspective()!.perspective_impl.tmat;
  const img = (x: number, y: number) => tmat.image(new Pt3(x, y, z_coord, 1.0)).affine();
  const A = img(x_coord, y_coord);
  const B = img(x_coord + diff_x, y_coord);
  const C = img(x_coord + diff_x, y_coord + diff_y);
  const D = img(x_coord, y_coord + diff_y);
  const E = img(x_coord - diff_x, y_coord + diff_y);
  const pt = tmat.image(pt_proj).affine();

  // TODO: Replace these lines between corners with lines from a corner to a vanishing point
  //       (this might help to prevent rounding errors if the box is small)
  const pl1 = new Line(A, B);
  const pl2 = new Line(A, D);
  const diag1 = new Line(A, id === -1 || !(id & Box3D.Axis.X) === !(id & Box3D.Axis.Y) ? C : E);
  const diag2 = new Line(A, E); // diag2 is only taken into account if id equals -1, i.e., if we are snapping the center

  const snap_pts = [pl1.closest_to(pt), pl2.closest_to(pt), diag1.closest_to(pt)];
  if (id === -1) snap_pts.push(diag2.closest_to(pt));

  // determine the distances to all potential snapping points
  const snap_dists = snap_pts.map((p) => L2(p.sub(pt)) * zoom);
  // while we are within a given tolerance of the starting point,
  // keep snapping to the same point to avoid jumping
  const within_tolerance = snap_dists.every((d) => d <= remember_snap_threshold);
  // find the closest snapping point
  let snap_index = -1;
  let snap_dist = Number.POSITIVE_INFINITY;
  snap_dists.forEach((d, i) => {
    if (d < snap_dist) {
      snap_index = i;
      snap_dist = d;
    }
  });
  // snap to the closest point (or the previously remembered one
  // if we are within tolerance of the starting point)
  let result: Point;
  if (within_tolerance) {
    result = snap_pts[remember_snap_index] ?? snap_pts[snap_index]!;
  } else {
    remember_snap_index = snap_index;
    result = snap_pts[snap_index]!;
  }
  return tmat.preimage(result, z_coord, Proj.Axis.Z);
}

function box3d_XY_axes_are_swapped(box: SPBox3D): boolean {
  const persp = box.get_perspective();
  if (!persp) return false;
  const l1 = new PerspectiveLine(box.get_corner_screen(3, false), Proj.Axis.X, persp);
  const l2 = new PerspectiveLine(box.get_corner_screen(3, false), Proj.Axis.Y, persp);
  const v1 = l1.direction().normalized();
  const v2 = l2.direction().normalized();
  return v1.x * v2.y - v1.y * v2.x > 0;
}

/*
 * In standard perspective we have:
 * 2 = front face
 * 1 = top face
 * 0 = left face
 * 3 = right face
 * 4 = bottom face
 * 5 = rear face
 */
function box3d_aux_set_z_orders(box: SPBox3D, z_orders: number[], ...order: number[]): void {
  if (box.document.yaxisdir() > 0) order.reverse();
  order.forEach((v, i) => {
    z_orders[i] = v;
  });
}

const A = Box3D.Axis;

/* All VPs infinite */
function box3d_set_new_z_orders_case0(box: SPBox3D, z: number[], central_axis: Box3D.Axis): void {
  const swapped = box3d_XY_axes_are_swapped(box);
  const set = (...o: number[]) => box3d_aux_set_z_orders(box, z, ...o);
  switch (central_axis) {
    case A.X:
      if (!swapped) set(2, 0, 4, 1, 3, 5);
      else set(3, 1, 5, 2, 4, 0);
      break;
    case A.Y:
      if (!swapped) set(2, 3, 1, 4, 0, 5);
      else set(5, 0, 4, 1, 3, 2);
      break;
    case A.Z:
      if (!swapped) set(2, 0, 1, 4, 3, 5);
      else set(5, 3, 4, 1, 0, 2);
      break;
    default:
      if (!swapped) set(2, 3, 4, 1, 0, 5);
      else set(5, 0, 1, 4, 3, 2);
      break;
  }
}

/* Precisely one finite VP */
function box3d_set_new_z_orders_case1(
  box: SPBox3D,
  z: number[],
  central_axis: Box3D.Axis,
  fin_axis: Box3D.Axis,
): void {
  const persp = box.get_perspective()!;
  const vp = persp.get_VP(Box3D.toProj(fin_axis)).affine();
  // note: in some of the case distinctions below we rely upon the fact that oaxis1 and oaxis2 are ordered
  const [oaxis1, oaxis2] = Box3D.get_remaining_axes(fin_axis);
  const inside1 = box.pt_lies_in_PL_sector(vp, 3, 3 ^ oaxis2, oaxis1);
  const inside2 = box.pt_lies_in_PL_sector(vp, 3, 3 ^ oaxis1, oaxis2);
  const swapped = box3d_XY_axes_are_swapped(box);
  const set = (...o: number[]) => box3d_aux_set_z_orders(box, z, ...o);
  switch (central_axis) {
    case A.X:
      if (!swapped) set(2, 4, 0, 1, 3, 5);
      else set(5, 3, 1, 0, 2, 4);
      break;
    case A.Y:
      if (inside2 > 0) set(1, 2, 3, 0, 5, 4);
      else if (inside2 < 0) set(2, 3, 1, 4, 0, 5);
      else if (!swapped) set(2, 3, 1, 5, 0, 4);
      else set(5, 0, 4, 1, 3, 2);
      break;
    case A.Z:
      if (inside2) {
        if (!swapped) set(2, 1, 3, 0, 4, 5);
        else set(5, 3, 4, 0, 1, 2);
      } else if (inside1) {
        if (!swapped) set(2, 0, 1, 4, 3, 5);
        else set(5, 3, 4, 1, 0, 2);
      } else {
        // "regular" case
        if (!swapped) set(0, 1, 2, 5, 4, 3);
        else set(5, 3, 4, 0, 2, 1);
      }
      break;
    default:
      if (!swapped) set(2, 3, 4, 5, 0, 1);
      else set(5, 0, 1, 3, 2, 4);
      break;
  }
}

/* Precisely 2 finite VPs */
function box3d_set_new_z_orders_case2(box: SPBox3D, z: number[], central_axis: Box3D.Axis): void {
  const swapped = box3d_XY_axes_are_swapped(box);
  const insidexy = box.VP_lies_in_PL_sector(Proj.Axis.X, 3, 3 ^ A.Z, A.Y);
  const insideyx = box.VP_lies_in_PL_sector(Proj.Axis.Y, 3, 3 ^ A.Z, A.X);
  const insideyz = box.VP_lies_in_PL_sector(Proj.Axis.Y, 3, 3 ^ A.X, A.Z);
  const insidezy = box.VP_lies_in_PL_sector(Proj.Axis.Z, 3, 3 ^ A.X, A.Y);
  const set = (...o: number[]) => box3d_aux_set_z_orders(box, z, ...o);
  switch (central_axis) {
    case A.X:
      if (!swapped) {
        if (insidezy === -1) set(2, 4, 0, 1, 3, 5);
        else if (insidexy === 1) set(2, 4, 0, 5, 1, 3);
        else set(2, 4, 0, 1, 3, 5);
      } else if (insideyz === -1) set(3, 1, 5, 0, 2, 4);
      else if (insidexy === 0) set(3, 5, 1, 0, 2, 4);
      else set(3, 1, 5, 0, 2, 4);
      break;
    case A.Y:
      if (!swapped) {
        if (insideyz === 1) set(2, 3, 1, 0, 5, 4);
        else set(2, 3, 1, 5, 0, 4);
      } else if (insideyx === 1) set(4, 0, 5, 1, 3, 2);
      else set(5, 0, 4, 1, 3, 2);
      break;
    case A.Z:
      if (!swapped) {
        if (insidezy === 1) set(2, 1, 0, 4, 3, 5);
        else if (insidexy === -1) set(2, 1, 0, 5, 4, 3);
        else set(2, 0, 1, 5, 3, 4);
      } else set(3, 4, 5, 1, 0, 2);
      break;
    default:
      if (!swapped) set(2, 3, 4, 1, 0, 5);
      else set(5, 0, 1, 4, 3, 2);
      break;
  }
}

/*
 * It can happen that during dragging the box is everted.
 * In this case the opposite sides in this direction need to be swapped
 */
function box3d_everted_directions(box: SPBox3D): Box3D.Axis {
  let ev = A.NONE;
  box.orig_corner0.normalize();
  box.orig_corner7.normalize();
  const c0 = box.orig_corner0;
  const c7 = box.orig_corner7;
  if (c0.at(Proj.Axis.X) < c7.at(Proj.Axis.X)) ev ^= A.X;
  if (c0.at(Proj.Axis.Y) < c7.at(Proj.Axis.Y)) ev ^= A.Y;
  // FIXME: Remove the need to distinguish signs among the cases
  if (c0.at(Proj.Axis.Z) > c7.at(Proj.Axis.Z)) ev ^= A.Z;
  return ev;
}

function box3d_swap_sides(z_orders: number[], axis: Box3D.Axis): void {
  let pos1 = -1;
  let pos2 = -1;
  for (let i = 0; i < 6; ++i) {
    if (Box3D.int_to_face(z_orders[i]!)[0] !== axis) {
      if (pos1 === -1) pos1 = i;
      else {
        pos2 = i;
        break;
      }
    }
  }
  if (pos1 !== -1 && pos2 !== -1) [z_orders[pos1], z_orders[pos2]] = [z_orders[pos2]!, z_orders[pos1]!];
}

/**
 * A 3D box (upstream SPBox3D, svg:g with sodipodi:type="inkscape:box3d"): six Box3DSide paths
 * drawn from the corners 0 and 7 (inkscape:corner0, inkscape:corner7, points in projective
 * 3-space) through the perspective of inkscape:perspectiveID.
 */
export class SPBox3D extends SPGroup {
  /** z_orders[i] holds the ID of the face at position #i in the group (from top to bottom) */
  z_orders = [0, 0, 0, 0, 0, 0];
  persp_href: string | null = null;
  persp_ref: Persp3DReference | null = null;
  orig_corner0 = new Pt3();
  orig_corner7 = new Pt3();
  save_corner0 = new Pt3();
  save_corner7 = new Pt3();
  /** to indicate which coordinates are swapped during dragging */
  swapped = A.NONE;

  /** Create a SPBox3D and append it to the parent. */
  static createBox3D(parent: SPItem): SPBox3D {
    const repr = parent.document.getReprDoc().createElement('svg:g');
    repr.setAttribute('sodipodi:type', 'inkscape:box3d');
    return parent.appendChildRepr(repr) as SPBox3D;
  }

  protected override build(document: SPDocument, repr: Node): void {
    this.persp_ref = new Persp3DReference(this);
    super.build(document, repr);
    /* we initialize the z-orders to zero so that they are updated during dragging */
    this.z_orders = [0, 0, 0, 0, 0, 0];
    // TODO: Create/link to the correct perspective
    this.persp_ref.changedSignal.connect((old_ref, ref) => {
      // Gets called when (re)attached to another perspective.
      if (old_ref instanceof Persp3D) old_ref.remove_box(this);
      if (ref instanceof Persp3D && ref !== (this as SPObject)) ref.add_box(this);
    });
    this.readAttr(SPAttr.INKSCAPE_BOX3D_PERSPECTIVE_ID);
    this.readAttr(SPAttr.INKSCAPE_BOX3D_CORNER0);
    this.readAttr(SPAttr.INKSCAPE_BOX3D_CORNER7);
  }

  protected override release(): void {
    this.persp_href = null;
    // We have to store this here because the Persp3DReference gets detached below.
    const persp = this.get_perspective();
    this.persp_ref?.detach();
    this.persp_ref = null;
    if (persp) {
      persp.remove_box(this);
      if (persp.perspective_impl.boxes.length === 0) {
        setCurrentPersp3D(this.document, Persp3D.document_first_persp(this.document));
      }
    }
    super.release();
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.INKSCAPE_BOX3D_PERSPECTIVE_ID:
        if (!(value && this.persp_href === value)) {
          this.persp_href = value;
          // Now do the attaching, which emits the changed signal.
          if (value) this.persp_ref?.try_attach(value);
          else this.persp_ref?.detach();
        }
        // FIXME: Is the following update doubled by some call in either persp3d.cpp or vanishing_point_new.cpp?
        this.position_set();
        break;
      case SPAttr.INKSCAPE_BOX3D_CORNER0:
        if (value && value !== '0 : 0 : 0 : 0') {
          this.orig_corner0 = new Pt3(value);
          this.save_corner0 = new Pt3(value);
          this.position_set();
        }
        break;
      case SPAttr.INKSCAPE_BOX3D_CORNER7:
        if (value && value !== '0 : 0 : 0 : 0') {
          this.orig_corner7 = new Pt3(value);
          this.save_corner7 = new Pt3(value);
          this.position_set();
        }
        break;
      default:
        super.set(key, value);
        break;
    }
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) {
      // this is where we end up when saving as plain SVG (also in other circumstances?)
      // thus we don' set "sodipodi:type" so that the box is only saved as an ordinary svg:g
      repr = xmlDoc.createElement('svg:g');
    }
    if (repr && flags & SP_OBJECT_WRITE_EXT) {
      if (this.persp_href) {
        repr.setAttribute('inkscape:perspectiveID', this.persp_href);
      } else {
        /* box is not yet linked to a perspective; use the document's current perspective */
        const uri = this.persp_ref?.getURI();
        const current = getCurrentPersp3D(this.document);
        if (uri) repr.setAttributeOrRemoveIfEmpty('inkscape:perspectiveID', uri);
        else if (current) repr.setAttribute('inkscape:perspectiveID', `#${current.getId()}`);
      }
      repr.setAttribute('inkscape:corner0', this.orig_corner0.coord_string());
      repr.setAttribute('inkscape:corner7', this.orig_corner7.coord_string());
      this.orig_corner0.normalize();
      this.orig_corner7.normalize();
      this.save_corner0 = this.orig_corner0.normalized();
      this.save_corner7 = this.orig_corner7.normalized();
    }
    return super.write(xmlDoc, repr, flags);
  }

  override typeName(): string {
    return 'group';
  }
  override displayName(): string {
    return _('3D Box');
  }
  override description(): string {
    // We could put more details about the 3d box here
    return '';
  }

  position_set(): void {
    /* This draws the curve and calls requestDisplayUpdate() for each side (the latter is done in
       Box3DSide::position_set() to avoid update conflicts with the parent box) */
    for (const side of this.children) if (side instanceof Box3DSide) side.position_set();
  }

  /**
   * We don't apply the transform to the box directly but instead to its perspective (which is
   * done in ObjectSet.applyAffine). Here we only adjust strokes.
   * TODO: adjust_pattern and adjust_gradient.
   */
  override setTransform(xform: Affine): Affine {
    const ret = xform.withoutTranslation();
    const sw = Math.hypot(ret.c0, ret.c1);
    const sh = Math.hypot(ret.c2, ret.c3);
    const scale = Math.sqrt(Math.abs(sw * sh));
    for (const child of this.item_list()) child.adjustStroke(scale);
    this.adjustStroke(scale);
    return Affine.identity();
  }

  /** A corner on the canvas: in item coordinates, or with item_coords false in desktop coordinates. */
  get_corner_screen(id: number, item_coords = true): Point {
    const persp = this.get_perspective();
    if (!persp) return new Point(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    const p = persp.perspective_impl.tmat
      .image(box3d_get_proj_corner(id, this.orig_corner0, this.orig_corner7))
      .affine();
    return item_coords ? p.transformed(this.i2dtAffine().inverse()) : p;
  }

  get_proj_center(): Pt3 {
    this.orig_corner0.normalize();
    this.orig_corner7.normalize();
    const c0 = this.orig_corner0;
    const c7 = this.orig_corner7;
    return new Pt3((c0.at(0) + c7.at(0)) / 2, (c0.at(1) + c7.at(1)) / 2, (c0.at(2) + c7.at(2)) / 2, 1.0);
  }

  get_center_screen(): Point {
    const persp = this.get_perspective();
    if (!persp) return new Point(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    return persp.perspective_impl.tmat
      .image(this.get_proj_center())
      .affine()
      .transformed(this.i2dtAffine().inverse());
  }

  /**
   * Move corner id to new_pos (desktop coordinates) along the given axes; constrained snaps
   * to the edges and diagonals (zoom is the desktop zoom, for the snapping distance).
   */
  set_corner(id: number, new_pos: Point, movement: Box3D.Axis, constrained: boolean, zoom = 1): void {
    if (movement === A.NONE || movement === A.XYZ) return;
    this.orig_corner0.normalize();
    this.orig_corner7.normalize();
    const persp = this.get_perspective();
    if (!persp) return;
    const tmat = persp.perspective_impl.tmat;
    const s0 = this.save_corner0;
    const s7 = this.save_corner7;

    /* update corners 0 and 7 according to which handle was moved and to the axes of movement */
    if (!(movement & A.Z)) {
      let pt_proj = tmat.preimage(
        new_pos,
        id < 4 ? this.orig_corner0.at(Proj.Axis.Z) : this.orig_corner7.at(Proj.Axis.Z),
        Proj.Axis.Z,
      );
      if (constrained) pt_proj = box3d_snap(this, id, pt_proj, box3d_get_proj_corner(id, s0, s7), zoom);
      // normalizing pt_proj is essential because we want to mingle affine coordinates
      pt_proj.normalize();
      this.orig_corner0 = new Pt3(
        id & A.X ? s0.at(0) : pt_proj.at(0),
        id & A.Y ? s0.at(1) : pt_proj.at(1),
        s0.at(2),
        1.0,
      );
      this.orig_corner7 = new Pt3(
        id & A.X ? pt_proj.at(0) : s7.at(0),
        id & A.Y ? pt_proj.at(1) : s7.at(1),
        s7.at(2),
        1.0,
      );
    } else {
      const pl = new PerspectiveLine(
        tmat.image(box3d_get_proj_corner(id, s0, s7)).affine(),
        Proj.Axis.Z,
        persp,
      );
      const new_pos_snapped = pl.closest_to(new_pos);
      const axis = movement & A.Y ? Proj.Axis.X : Proj.Axis.Y;
      const pt_proj = tmat.preimage(
        new_pos_snapped,
        box3d_get_proj_corner(id, this.orig_corner0, this.orig_corner7).at(axis),
        axis,
      );
      const corner0_move_x = !(id & A.X) && !!(movement & A.X);
      const corner0_move_y = !(id & A.Y) && !!(movement & A.Y);
      const corner7_move_x = !!(id & A.X) && !!(movement & A.X);
      const corner7_move_y = !!(id & A.Y) && !!(movement & A.Y);
      // normalizing pt_proj is essential because we want to mingle affine coordinates
      pt_proj.normalize();
      const c0 = this.orig_corner0;
      const c7 = this.orig_corner7;
      this.orig_corner0 = new Pt3(
        corner0_move_x ? pt_proj.at(0) : c0.at(0),
        corner0_move_y ? pt_proj.at(1) : c0.at(1),
        id & A.Z ? c0.at(2) : pt_proj.at(2),
        1.0,
      );
      this.orig_corner7 = new Pt3(
        corner7_move_x ? pt_proj.at(0) : c7.at(0),
        corner7_move_y ? pt_proj.at(1) : c7.at(1),
        id & A.Z ? pt_proj.at(2) : c7.at(2),
        1.0,
      );
    }
    // FIXME: Should we update the box here? If so, how?
  }

  /** Move the box in perspective: the center from old_pos to new_pos (desktop coordinates). */
  set_center(new_pos: Point, old_pos: Point, movement: Box3D.Axis, constrained: boolean, zoom = 1): void {
    if (movement === A.NONE || movement === A.XYZ) return;
    this.orig_corner0.normalize();
    this.orig_corner7.normalize();
    const persp = this.get_perspective();
    if (!persp) return;
    const tmat = persp.perspective_impl.tmat;
    const c0 = this.orig_corner0;
    const c7 = this.orig_corner7;
    if (!(movement & A.Z)) {
      const coord = (c0.at(2) + c7.at(2)) / 2;
      const radx = (c7.at(0) - c0.at(0)) / 2;
      const rady = (c7.at(1) - c0.at(1)) / 2;
      let pt_proj = tmat.preimage(new_pos, coord, Proj.Axis.Z);
      if (constrained) {
        const old_pos_proj = tmat.preimage(old_pos, coord, Proj.Axis.Z);
        old_pos_proj.normalize();
        pt_proj = box3d_snap(this, -1, pt_proj, old_pos_proj, zoom);
      }
      // normalizing pt_proj is essential because we want to mingle affine coordinates
      pt_proj.normalize();
      this.orig_corner0 = new Pt3(
        movement & A.X ? pt_proj.at(0) - radx : c0.at(0),
        movement & A.Y ? pt_proj.at(1) - rady : c0.at(1),
        c0.at(2),
        1.0,
      );
      this.orig_corner7 = new Pt3(
        movement & A.X ? pt_proj.at(0) + radx : c7.at(0),
        movement & A.Y ? pt_proj.at(1) + rady : c7.at(1),
        c7.at(2),
        1.0,
      );
    } else {
      const coord = (c0.at(0) + c7.at(0)) / 2;
      const radz = (c7.at(2) - c0.at(2)) / 2;
      const pl = new PerspectiveLine(old_pos, Proj.Axis.Z, persp);
      const pt_proj = tmat.preimage(pl.closest_to(new_pos), coord, Proj.Axis.X);
      /* normalizing pt_proj is essential because we want to mingle affine coordinates */
      pt_proj.normalize();
      this.orig_corner0 = new Pt3(c0.at(0), c0.at(1), pt_proj.at(2) - radz, 1.0);
      this.orig_corner7 = new Pt3(c7.at(0), c7.at(1), pt_proj.at(2) + radz, 1.0);
    }
  }

  /** The four corners (desktop coordinates) from which the perspective lines in the direction of axis emerge. */
  corners_for_PLs(axis: Proj.Axis): [Point, Point, Point, Point] | null {
    const persp = this.get_perspective();
    if (!persp) return null;
    const c0 = this.orig_corner0;
    const c7 = this.orig_corner7;
    const coord = Math.max(c0.at(axis), c7.at(axis));
    let c: Pt3[];
    // FIXME: This can certainly be done more elegantly/efficiently than by a case-by-case analysis.
    switch (axis) {
      case Proj.Axis.X:
        c = [
          new Pt3(coord, c0.at(1), c0.at(2), 1.0),
          new Pt3(coord, c7.at(1), c0.at(2), 1.0),
          new Pt3(coord, c7.at(1), c7.at(2), 1.0),
          new Pt3(coord, c0.at(1), c7.at(2), 1.0),
        ];
        break;
      case Proj.Axis.Y:
        c = [
          new Pt3(c0.at(0), coord, c0.at(2), 1.0),
          new Pt3(c7.at(0), coord, c0.at(2), 1.0),
          new Pt3(c7.at(0), coord, c7.at(2), 1.0),
          new Pt3(c0.at(0), coord, c7.at(2), 1.0),
        ];
        break;
      case Proj.Axis.Z:
        c = [
          new Pt3(c7.at(0), c7.at(1), coord, 1.0),
          new Pt3(c7.at(0), c0.at(1), coord, 1.0),
          new Pt3(c0.at(0), c0.at(1), coord, 1.0),
          new Pt3(c0.at(0), c7.at(1), coord, 1.0),
        ];
        break;
      default:
        return null;
    }
    const tmat = persp.perspective_impl.tmat;
    return c.map((p) => tmat.image(p).affine()) as [Point, Point, Point, Point];
  }

  /** Compute the order of the faces; returns true if it changed. */
  recompute_z_orders(): boolean {
    const persp = this.get_perspective();
    if (!persp) return false;
    const z_orders = [0, 0, 0, 0, 0, 0];
    const c3 = this.get_corner_screen(3, false);
    // determine directions from corner3 to the VPs
    let num_finite = 0;
    let axis_finite = A.NONE;
    const dirs: Point[] = [];
    for (let i = 0; i < 3; ++i) {
      dirs[i] = persp.get_PL_dir_from_pt(c3, Box3D.toProj(Box3D.axes[i]!));
      if (Persp3D.VP_is_finite(persp.perspective_impl, Proj.axes[i]!)) {
        num_finite++;
        axis_finite = Box3D.axes[i]!;
      }
    }
    // determine the "central" axis (if there is one)
    let central_axis = A.NONE;
    if (lies_in_sector(dirs[0]!, dirs[1]!, dirs[2]!)) central_axis = A.Z;
    else if (lies_in_sector(dirs[1]!, dirs[2]!, dirs[0]!)) central_axis = A.X;
    else if (lies_in_sector(dirs[2]!, dirs[0]!, dirs[1]!)) central_axis = A.Y;

    switch (num_finite) {
      case 0:
        box3d_set_new_z_orders_case0(this, z_orders, central_axis);
        break;
      case 1:
        box3d_set_new_z_orders_case1(this, z_orders, central_axis, axis_finite);
        break;
      default:
        // Upstream treats 2 and 3 finite VPs alike; its default branch for 3 is unreachable.
        box3d_set_new_z_orders_case2(this, z_orders, central_axis);
        break;
    }
    // TODO: If there are still errors in z-orders of everted boxes, we need to choose a variable corner
    //       instead of the hard-coded corner #3 in the computations above
    const ev = box3d_everted_directions(this);
    for (const axe of Box3D.axes) if (ev & axe) box3d_swap_sides(z_orders, axe);

    // Check whether anything actually changed
    if (z_orders.every((z, i) => z === this.z_orders[i])) return false;
    this.z_orders = z_orders;
    return true;
  }

  /** Reorder the sides by their z-orders (upstream set_z_orders). */
  set_z_orders(): void {
    // For efficiency reasons, we only set the new z-orders if something really changed
    if (!this.recompute_z_orders()) return;
    const sides = new Map<number, Box3DSide>();
    for (const obj of this.children) {
      if (obj instanceof Box3DSide) {
        const face = Box3D.face_to_int(obj.getFaceId());
        if (face !== -1) sides.set(face, obj);
      }
    }
    for (const z of this.z_orders) {
      const side = sides.get(z);
      // upstream lowerToBottom(): move the side below its siblings
      if (side) side.getRepr().parent()?.changeOrder(side.getRepr(), null);
    }
  }

  /**
   * Whether pt lies in the sector formed by the two perspective lines from the corners with IDs
   * id1 and id2 to the VP in direction axis (between them, for an infinite VP):
   * 0 if not, 1 if it does and points towards the VP, -1 otherwise.
   */
  pt_lies_in_PL_sector(pt: Point, id1: number, id2: number, axis: Box3D.Axis): number {
    const persp = this.get_perspective();
    if (!persp) return 0;
    // the two corners
    const c1 = this.get_corner_screen(id1, false);
    const c2 = this.get_corner_screen(id2, false);
    if (Persp3D.VP_is_finite(persp.perspective_impl, Box3D.toProj(axis))) {
      const vp = persp.get_VP(Box3D.toProj(axis)).affine();
      return lies_in_sector(c1.sub(vp), c2.sub(vp), pt.sub(vp)) ? 1 : 0;
    }
    const pl1 = new PerspectiveLine(c1, Box3D.toProj(axis), persp);
    const pl2 = new PerspectiveLine(c2, Box3D.toProj(axis), persp);
    if (pl1.lie_on_same_side(pt, c2) && pl2.lie_on_same_side(pt, c1)) {
      // test whether pt lies "towards" or "away from" the VP
      const edge = new Line(c1, c2);
      const c3 = this.get_corner_screen(id1 ^ axis, false);
      return edge.lie_on_same_side(pt, c3) ? 1 : -1;
    }
    return 0;
  }

  VP_lies_in_PL_sector(vpdir: Proj.Axis, id1: number, id2: number, axis: Box3D.Axis): number {
    const persp = this.get_perspective();
    if (!persp || !Persp3D.VP_is_finite(persp.perspective_impl, vpdir)) return 0;
    return this.pt_lies_in_PL_sector(persp.get_VP(vpdir).affine(), id1, id2, axis);
  }

  /* swap the coordinates of corner0 and corner7 along the specified axis */
  #swap_coords(axis: Proj.Axis, smaller = true): void {
    this.orig_corner0.normalize();
    this.orig_corner7.normalize();
    const c0: number[] = this.orig_corner0.pt;
    const c7: number[] = this.orig_corner7.pt;
    if (c0[axis]! < c7[axis]! !== smaller) [c0[axis], c7[axis]] = [c7[axis]!, c0[axis]!];
  }

  /* ensure that the coordinates of corner0 and corner7 are in the correct order (to prevent everted boxes) */
  relabel_corners(): void {
    this.#swap_coords(Proj.Axis.X, false);
    this.#swap_coords(Proj.Axis.Y, false);
    this.#swap_coords(Proj.Axis.Z, true);
  }

  check_for_swapped_coords(): void {
    for (const [axis, smaller] of [
      [Proj.Axis.X, false],
      [Proj.Axis.Y, false],
      [Proj.Axis.Z, true],
    ] as const) {
      this.orig_corner0.normalize();
      this.orig_corner7.normalize();
      if (this.orig_corner0.at(axis) < this.orig_corner7.at(axis) !== smaller) {
        this.swapped |= Proj.toAffine(axis);
      } else {
        this.swapped &= ~Proj.toAffine(axis);
      }
    }
    // upstream box3d_exchange_coords
    for (let i = 0; i < 3; ++i) {
      if (this.swapped & Box3D.axes[i]!) {
        const c0: number[] = this.orig_corner0.pt;
        const c7: number[] = this.orig_corner7.pt;
        [c0[i], c7[i]] = [c7[i]!, c0[i]!];
      }
    }
  }

  /** The boxes in obj: obj itself, or the boxes in a group (recursively). */
  static extract_boxes(obj: SPObject): SPBox3D[] {
    if (obj instanceof SPBox3D) return [obj];
    if (obj instanceof SPGroup) return obj.children.flatMap((c) => SPBox3D.extract_boxes(c));
    return [];
  }

  get_perspective(): Persp3D | null {
    return this.persp_ref?.getObject() ?? null;
  }

  /** Attach the box to new_persp; with recompute_corners keep its place on the canvas. */
  switch_perspectives(old_persp: Persp3D, new_persp: Persp3D, recompute_corners = false): void {
    if (recompute_corners) {
      this.orig_corner0.normalize();
      this.orig_corner7.normalize();
      const z0 = this.orig_corner0.at(Proj.Axis.Z);
      const z7 = this.orig_corner7.at(Proj.Axis.Z);
      const corner0_screen = this.get_corner_screen(0, false);
      const corner7_screen = this.get_corner_screen(7, false);
      this.orig_corner0 = new_persp.perspective_impl.tmat.preimage(corner0_screen, z0, Proj.Axis.Z);
      this.orig_corner7 = new_persp.perspective_impl.tmat.preimage(corner7_screen, z7, Proj.Axis.Z);
    }
    old_persp.remove_box(this);
    new_persp.add_box(this);
    this.setAttribute('inkscape:perspectiveID', `#${new_persp.getId()}`);
  }

  /* Converts the 3D box to an ordinary SPGroup, adds it to the XML tree at the same position as
     the original box and deletes the latter */
  convert_to_group(): SPGroup | null {
    const doc = this.document;
    const xml_doc = doc.getReprDoc();
    // remember position of the box
    const pos = this.getRepr().position();
    // remember important attributes
    const id = this.getAttribute('id');
    const style = this.getAttribute('style');
    const mask = this.getAttribute('mask');
    const clip_path = this.getAttribute('clip-path');
    // create a new group and add the sides (converted to ordinary paths) as its children
    const grepr = xml_doc.createElement('svg:g');
    for (const obj of this.children) {
      if (obj instanceof Box3DSide) grepr.appendChild(obj.convert_to_path());
      else console.warn('Non-side item encountered as child of a 3D box.');
    }
    // add the new group to the box's parent and set remembered position
    const parent = this.parent?.getRepr();
    if (!parent) return null;
    parent.addChildAtPos(grepr, pos);
    grepr.setAttributeOrRemoveIfEmpty('style', style);
    grepr.setAttributeOrRemoveIfEmpty('mask', mask);
    grepr.setAttributeOrRemoveIfEmpty('clip-path', clip_path);
    this.deleteObject(true);
    grepr.setAttribute('id', id);
    const group = doc.getObjectByRepr(grepr);
    return group instanceof SPGroup ? group : null;
  }
}

Box3DSide.isBox = (obj): obj is SPBox3D => obj instanceof SPBox3D;

/** The perspectives of the 3D boxes in set (upstream ObjectSet::perspList). */
export function perspList(set: ObjectSet): Persp3D[] {
  const pl: Persp3D[] = [];
  for (const box of box3DList(set)) {
    const persp = box.get_perspective();
    if (persp && !pl.includes(persp)) pl.push(persp);
  }
  return pl;
}

/** The 3D boxes in set, also inside selected groups; only those of persp if given (upstream ObjectSet::box3DList). */
export function box3DList(set: ObjectSet, persp: Persp3D | null = null): SPBox3D[] {
  const boxes = set.items().flatMap((item) => SPBox3D.extract_boxes(item));
  return persp ? boxes.filter((box) => box.get_perspective() === persp) : boxes;
}

/*
 * For each perspective with a box in selection, check whether all boxes are selected and
 * unlink all non-selected boxes (the end of upstream ObjectSet::applyAffine).
 */
ObjectSet.applyAffineToPerspectives = (set: ObjectSet, affine: Affine) => {
  for (let persp of perspList(set)) {
    if (!persp.has_all_boxes_in_selection(box3DList(set))) {
      // create a new perspective as a copy of the current one
      const transf_persp = Persp3D.create_copy(persp);
      for (const selbox of box3DList(set, persp)) selbox.switch_perspectives(persp, transf_persp);
      persp = transf_persp;
    }
    persp.apply_affine_transformation(affine);
  }
};
