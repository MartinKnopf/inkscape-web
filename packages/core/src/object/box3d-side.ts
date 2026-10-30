// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/box3d-side.cpp, src/object/box3d-side.h
/*
 * 3D box face implementation
 *
 * Authors:
 *   Maximilian Albert <Anhalter42@gmx.de>
 *   Abhishek Sharma
 *
 * Copyright (C) 2007  Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { LineSegment, Path } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import { Box3D } from '../axis-manip.ts';
import type { SPDocument } from '../document.ts';
import { sp_svg_write_path } from '../svg/svg-path.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import type { SPBox3D } from './box3d.ts';
import type { Persp3D } from './persp3d.ts';
import {
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_STYLE_MODIFIED_FLAG,
  SP_OBJECT_USER_MODIFIED_FLAG_B,
  SP_OBJECT_VIEWPORT_MODIFIED_FLAG,
  SP_OBJECT_WRITE_BUILD,
  SP_OBJECT_WRITE_EXT,
  type SPCtx,
} from './sp-object.ts';
import { SPPolygon } from './sp-polygon.ts';

/** The SVG face names of a side, e.g. "XYfront" (upstream axis_string). */
function axis_string(dirs: Box3D.Axis, rear: boolean): string {
  let result = Box3D.string_from_axes(dirs);
  switch (dirs) {
    case Box3D.Axis.XY:
      result += !rear ? 'front' : 'rear';
      break;
    case Box3D.Axis.XZ:
      result += !rear ? 'top' : 'bottom';
      break;
    case Box3D.Axis.YZ:
      result += !rear ? 'right' : 'left';
      break;
  }
  return result;
}

/**
 * A face of a 3D box (upstream Box3DSide, svg:path with sodipodi:type="inkscape:box3dside"):
 * its plane (dir1, dir2) and front or rear (inkscape:box3dsidetype); the path follows from the
 * corners of the parent box.
 */
export class Box3DSide extends SPPolygon {
  dir1 = Box3D.Axis.NONE;
  dir2 = Box3D.Axis.NONE;
  front_or_rear = Box3D.FrontOrRear.FRONT;

  /** The parent box; set by box3d.ts (it imports this module, so no import back). */
  static isBox: (obj: unknown) => obj is SPBox3D = (_obj): _obj is SPBox3D => false;

  /* Create a new Box3DSide and append it to the parent box */
  static createBox3DSide(box: SPBox3D): Box3DSide {
    const repr = box.document.getReprDoc().createElement('svg:path');
    repr.setAttribute('sodipodi:type', 'inkscape:box3dside');
    return box.appendChildRepr(repr) as Box3DSide;
  }

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.INKSCAPE_BOX3D_SIDE_TYPE);
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) {
      // this is where we end up when saving as plain SVG (also in other circumstances?)
      // thus we don' set "sodipodi:type" so that the box is only saved as an ordinary svg:path
      repr = xmlDoc.createElement('svg:path');
    }
    if (!repr) return null;
    if (flags & SP_OBJECT_WRITE_EXT) {
      repr.setAttributeInt('inkscape:box3dsidetype', this.dir1 ^ this.dir2 ^ this.front_or_rear);
    }
    this.set_shape();
    // Nulls might be possible if this called iteratively
    if (!this._curve) return null;
    repr.setAttribute('d', sp_svg_write_path(this._curve));
    return super.write(xmlDoc, repr, flags);
  }

  override set(key: SPAttr, value: string | null): void {
    // TODO: In case the box was recreated (by undo, e.g.) we need to recreate the path
    //       (along with other info?) from the parent box.
    if (key !== SPAttr.INKSCAPE_BOX3D_SIDE_TYPE) {
      super.set(key, value);
      return;
    }
    if (!value) return;
    const desc = Number.parseInt(value, 10);
    if (!Box3D.is_face_id(desc)) {
      console.warn(`desc is not a face id: =${value}=`);
      return;
    }
    let plane = (desc & 0x7) as Box3D.Axis;
    plane = Box3D.is_plane(plane) ? plane : Box3D.orth_plane_or_axis(plane);
    this.dir1 = Box3D.extract_first_axis_direction(plane);
    this.dir2 = Box3D.extract_second_axis_direction(plane);
    this.front_or_rear = (desc & 0x8) as Box3D.FrontOrRear;
    this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
  }

  protected override update(ctx: SPCtx, flags: number): void {
    if (
      flags &
      (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_STYLE_MODIFIED_FLAG | SP_OBJECT_VIEWPORT_MODIFIED_FLAG)
    ) {
      flags &= ~SP_OBJECT_USER_MODIFIED_FLAG_B; // since we change the description, it's not a "just translation" anymore
      this.set_shape();
    }
    super.update(ctx, flags);
  }

  /** The face id (inkscape:box3dsidetype), or -1. */
  getFaceId(): number {
    const v = Number.parseInt(this.getAttribute('inkscape:box3dsidetype') ?? '', 10);
    return Number.isNaN(v) ? -1 : v;
  }

  position_set(): void {
    this.set_shape();
    // This call is responsible for live update of the sides during the initial drag
    this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
  }

  /** The quadrangle of the face from the corners of the parent box. TODO: path effects. */
  override set_shape(): void {
    const box = this.parent;
    if (!Box3DSide.isBox(box)) {
      super.set_shape();
      return;
    }
    if (!this.perspective()) return;
    const corners = this.#corner_ids();
    const pts = corners.map((id) => box.get_corner_screen(id));
    if (!pts.every((p) => p.isFinite())) {
      console.warn('Trying to draw a 3D box side with invalid coordinates.');
      return;
    }
    const c = new Path(pts[0]!);
    for (let i = 1; i < 4; i++) c.appendCurve(new LineSegment(pts[i - 1]!, pts[i]!));
    c.close();
    this.setCurveInsync([c]);
  }

  /** The name of the face for the tool styles, e.g. "XYfront" (upstream axes_string). */
  axes_string(): string {
    return axis_string(this.dir1 ^ this.dir2, !!this.front_or_rear);
  }

  #corner_ids(): [number, number, number, number] {
    const orth = Box3D.third_axis_direction(this.dir1, this.dir2);
    const c0 = this.front_or_rear ? orth : 0;
    return [c0, c0 ^ this.dir1, c0 ^ this.dir1 ^ this.dir2, c0 ^ this.dir2];
  }

  perspective(): Persp3D | null {
    const box = this.parent;
    return Box3DSide.isBox(box) ? box.get_perspective() : null;
  }

  /** A plain svg:path with the path and style of the side. */
  convert_to_path(): Node {
    // TODO: Copy over all important attributes (see sp_selected_item_to_curved_repr() for an example)
    const repr = this.document.getReprDoc().createElement('svg:path');
    repr.setAttribute('d', this.getAttribute('d'));
    repr.setAttribute('style', this.getAttribute('style'));
    return repr;
  }
}
