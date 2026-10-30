// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/persp3d.cpp, src/object/persp3d.h
/*
 * Class modelling a 3D perspective as an SPObject
 *
 * Authors:
 *   Maximilian Albert <Anhalter42@gmx.de>
 *   Abhishek Sharma
 *
 * Copyright (C) 2007 authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { type Affine, atan2, Point } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import { Proj } from '../axis-manip.ts';
import type { SPDocument } from '../document.ts';
import { DocumentUndo } from '../document-undo.ts';
import { C_ } from '../i18n.ts';
import { PerspectiveLine } from '../perspective-line.ts';
import { Pt2 } from '../proj_pt.ts';
import { TransfMat3x4 } from '../transf_mat_3x4.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import type { SPBox3D } from './box3d.ts';
import { SP_OBJECT_WRITE_BUILD, SP_OBJECT_WRITE_EXT, SPObject } from './sp-object.ts';

/** The perspective data of a Persp3D (upstream Persp3DImpl). */
export class Persp3DImpl {
  tmat = new TransfMat3x4();
  // Also write the list of boxes into the xml repr and vice versa link boxes to their persp3d?
  boxes: SPBox3D[] = [];
}

/** Apply viewBox and legacy desktop transformation to point loaded from SVG */
function legacy_transform_forward(pt: Pt2, doc: SPDocument): Pt2 {
  const p = new Pt2(...pt.pt);
  // Read values are in 'user units'.
  const root = doc.getRoot();
  if (root.viewBox_set) {
    p.pt[0] *= root.width.computed / root.viewBox.width();
    p.pt[1] *= root.height.computed / root.viewBox.height();
  }
  // <inkscape:perspective> stores inverted y-axis coordinates
  if (doc.yaxisdir() > 0) {
    p.pt[1] *= -1;
    if (p.pt[2]) p.pt[1] += doc.getDimensions().y;
  }
  return p;
}

/** Apply viewBox and legacy desktop transformation to point to be written to SVG */
function legacy_transform_backward(pt: Pt2, doc: SPDocument): Pt2 {
  const p = new Pt2(...pt.pt);
  // <inkscape:perspective> stores inverted y-axis coordinates
  if (doc.yaxisdir() > 0) {
    p.pt[1] *= -1;
    if (p.pt[2]) p.pt[1] += doc.getDimensions().y;
  }
  // Written values are in 'user units'.
  const root = doc.getRoot();
  if (root.viewBox_set) {
    p.pt[0] *= root.viewBox.width() / root.width.computed;
    p.pt[1] *= root.viewBox.height() / root.height.computed;
  }
  return p;
}

const VP_ATTRS: readonly [SPAttr, Proj.Axis, string][] = [
  [SPAttr.INKSCAPE_PERSP3D_VP_X, Proj.Axis.X, 'inkscape:vp_x'],
  [SPAttr.INKSCAPE_PERSP3D_VP_Y, Proj.Axis.Y, 'inkscape:vp_y'],
  [SPAttr.INKSCAPE_PERSP3D_VP_Z, Proj.Axis.Z, 'inkscape:vp_z'],
  [SPAttr.INKSCAPE_PERSP3D_ORIGIN, Proj.Axis.W, 'inkscape:persp3d-origin'],
];

/**
 * A 3D perspective in the defs (upstream Persp3D, inkscape:perspective with
 * sodipodi:type="inkscape:persp3d"): the images of the three vanishing points and the origin,
 * and the 3D boxes that use it.
 */
export class Persp3D extends SPObject {
  perspective_impl = new Persp3DImpl();

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    for (const [key] of VP_ATTRS) this.readAttr(key);
  }

  // FIXME: Currently we only read the finite positions of vanishing points;
  //        should we move VPs into their own repr (as it's done for SPStop, e.g.)?
  override set(key: SPAttr, value: string | null): void {
    const vp = VP_ATTRS.find(([k]) => k === key);
    if (!vp) {
      super.set(key, value);
      return;
    }
    if (value)
      this.perspective_impl.tmat.set_image_pt(vp[1], legacy_transform_forward(new Pt2(value), this.document));
    // Upstream: the node observer of the perspective.
    this.update_box_displays();
  }

  /** Create a default perspective in the defs (upstream create_xml_element). */
  static create_xml_element(document: SPDocument): Persp3D {
    const defs = document.getDefs();
    const repr = document.getReprDoc().createElement('inkscape:perspective');
    repr.setAttribute('sodipodi:type', 'inkscape:persp3d');
    // Use 'user-units'
    const dims = document.getDimensions();
    let width = dims.x;
    let height = dims.y;
    if (document.getRoot().viewBox_set) {
      const vb = document.getRoot().viewBox;
      width = vb.width();
      height = vb.height();
    }
    repr.setAttribute('inkscape:vp_x', new Pt2(0.0, height / 2.0, 1.0).coord_string());
    repr.setAttribute('inkscape:vp_y', new Pt2(0.0, 1000.0, 0.0).coord_string());
    repr.setAttribute('inkscape:vp_z', new Pt2(width, height / 2.0, 1.0).coord_string());
    repr.setAttribute('inkscape:persp3d-origin', new Pt2(width / 2.0, height / 3.0, 1.0).coord_string());
    /* Append the new persp3d to defs */
    defs?.getRepr().addChild(repr, null);
    return document.getObjectByRepr(repr) as Persp3D;
  }

  static create_copy(copy_from: Persp3D): Persp3D {
    const p = Persp3D.create_xml_element(copy_from.document);
    p.perspective_impl.tmat = new TransfMat3x4(copy_from.perspective_impl.tmat);
    return p;
  }

  static document_first_persp(document: SPDocument): Persp3D | null {
    return (document.getDefs()?.children.find((c) => c instanceof Persp3D) as Persp3D | undefined) ?? null;
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && flags & SP_OBJECT_WRITE_EXT && !repr) {
      // this is where we end up when saving as plain SVG (also in other circumstances?);
      // hence we don't set the sodipodi:type attribute
      repr = xmlDoc.createElement('inkscape:perspective');
    }
    if (repr && flags & SP_OBJECT_WRITE_EXT) {
      for (const [, axis, name] of VP_ATTRS) {
        const pt = legacy_transform_backward(this.perspective_impl.tmat.column(axis), this.document);
        repr.setAttribute(name, pt.coord_string());
      }
    }
    return super.write(xmlDoc, repr, flags);
  }

  get_VP(axis: Proj.Axis): Pt2 {
    return this.perspective_impl.tmat.column(axis);
  }

  /* convenience wrapper around get_finite_dir() and get_infinite_dir() */
  get_PL_dir_from_pt(pt: Point, axis: Proj.Axis): Point {
    return Persp3D.VP_is_finite(this.perspective_impl, axis)
      ? this.get_finite_dir(pt, axis)
      : this.get_infinite_dir(axis);
  }

  get_finite_dir(pt: Point, axis: Proj.Axis): Point {
    return new PerspectiveLine(pt, axis, this).direction();
  }

  get_infinite_dir(axis: Proj.Axis): Point {
    const vp = this.get_VP(axis);
    if (vp.at(2) !== 0.0) {
      console.warn(`VP should be infinite but is (${vp.coord_string()})`);
      return new Point(0.0, 0.0);
    }
    return new Point(vp.at(0), vp.at(1));
  }

  get_infinite_angle(axis: Proj.Axis): number {
    return this.perspective_impl.tmat.get_infinite_angle(axis);
  }

  static VP_is_finite(persp_impl: Persp3DImpl, axis: Proj.Axis): boolean {
    return persp_impl.tmat.has_finite_image(axis);
  }

  toggle_VP(axis: Proj.Axis, set_undo = true): void {
    this.perspective_impl.tmat.toggle_finite(axis);
    // FIXME: Remove this repr update and rely on vp_drag_sel_modified() to do this for us
    this.update_box_reprs();
    this.updateRepr(SP_OBJECT_WRITE_EXT);
    if (set_undo) DocumentUndo.done(this.document, C_('Undo', 'Toggle vanishing point'), 'draw-cuboid');
  }

  /* toggle VPs for the same axis in all perspectives of a given list */
  static toggle_VPs(list: readonly Persp3D[], axis: Proj.Axis): void {
    for (const persp of list) persp.toggle_VP(axis, false);
    const doc = list[0]?.document;
    if (doc) DocumentUndo.done(doc, C_('Undo', 'Toggle multiple vanishing points'), 'draw-cuboid');
  }

  set_VP_state(axis: Proj.Axis, state: Proj.VPState): void {
    if (Persp3D.VP_is_finite(this.perspective_impl, axis) !== (state === Proj.VPState.VP_FINITE))
      this.toggle_VP(axis);
  }

  /** Rotate an infinite VP by angle degrees (with alt_pressed by half a degree). */
  rotate_VP(axis: Proj.Axis, angle: number, alt_pressed: boolean): void {
    // FIXME: Most of this functionality should be moved to trans_mat_3x4.(h|cpp)
    // don't rotate anything for finite VPs
    if (this.perspective_impl.tmat.has_finite_image(axis)) return;
    const v_dir_proj = this.perspective_impl.tmat.column(axis);
    let a = (atan2(new Point(v_dir_proj.at(0), v_dir_proj.at(1))) * 180) / Math.PI;
    a += alt_pressed ? 0.5 * Math.sign(angle) : angle; // the r.h.s. yields +/-0.5 or angle
    this.perspective_impl.tmat.set_infinite_direction(axis, a);
    this.update_box_reprs();
    this.updateRepr(SP_OBJECT_WRITE_EXT);
  }

  apply_affine_transformation(xform: Affine): void {
    this.perspective_impl.tmat = this.perspective_impl.tmat.multiply(xform);
    this.update_box_reprs();
    this.updateRepr(SP_OBJECT_WRITE_EXT);
  }

  add_box(box: SPBox3D | null): void {
    if (!box || this.perspective_impl.boxes.includes(box)) return;
    this.perspective_impl.boxes.push(box);
  }

  remove_box(box: SPBox3D): void {
    const boxes = this.perspective_impl.boxes;
    const i = boxes.indexOf(box);
    if (i >= 0) boxes.splice(i, 1);
  }

  has_box(box: SPBox3D): boolean {
    return this.perspective_impl.boxes.includes(box);
  }

  update_box_displays(): void {
    for (const box of this.perspective_impl.boxes) box.position_set();
  }

  update_box_reprs(): void {
    for (const box of this.perspective_impl.boxes) {
      box.updateRepr(SP_OBJECT_WRITE_EXT);
      box.set_z_orders();
    }
  }

  update_z_orders(): void {
    for (const box of this.perspective_impl.boxes) box.set_z_orders();
  }

  num_boxes(): number {
    return this.perspective_impl.boxes.length;
  }

  list_of_boxes(): SPBox3D[] {
    return [...this.perspective_impl.boxes];
  }

  perspectives_coincide(other: Persp3D): boolean {
    return this.perspective_impl.tmat.equals(other.perspective_impl.tmat);
  }

  /** Move the boxes of other (an equal perspective) to this one. */
  absorb(other: Persp3D): void {
    /* double check if we are called in sane situations */
    if (!this.perspectives_coincide(other) || this === other) return;
    // Note: We first need to copy the boxes of other into a separate list;
    //       otherwise the loop below gets confused when perspectives are reattached.
    for (const box of other.list_of_boxes()) {
      box.switch_perspectives(other, this, true);
      box.updateRepr(SP_OBJECT_WRITE_EXT); // so that undo/redo can do its job properly
    }
  }

  /* checks whether all boxes linked to this perspective are currently selected (see box3DList) */
  has_all_boxes_in_selection(selboxes: readonly SPBox3D[]): boolean {
    return this.perspective_impl.boxes.every((box) => selboxes.includes(box));
  }
}
