// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-mesh-gradient.cpp, src/object/sp-mesh-gradient.h, src/object/sp-gradient.cpp (array)
/*
 * SPMeshGradient: SVG <meshgradient> implementation.
 *
 * Authors: see git history
 *
 * Copyright (C) 2018 Authors
 */
import { SPAttr } from '../attributes.ts';
import type { SPDocument } from '../document.ts';
import { SVGLength, SVGLengthUnit } from '../svg/svg-length.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import { SPGradient } from './sp-gradient.ts';
import { SPMeshNodeArray, SPMeshPatchI, SPMeshType } from './sp-mesh-array.ts';
import {
  SP_OBJECT_CHILD_MODIFIED_FLAG,
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_STYLE_MODIFIED_FLAG,
  SP_OBJECT_WRITE_ALL,
  SP_OBJECT_WRITE_BUILD,
} from './sp-object.ts';
import { PaintServerType, type SPGradientPatch } from './sp-paint-server-data.ts';

/** Mesh gradient. */
export class SPMeshGradient extends SPGradient {
  /** Start coordinate of mesh */
  readonly x = new SVGLength();
  readonly y = new SVGLength();
  type = SPMeshType.SP_MESH_TYPE_COONS;
  type_set = false;

  // Mesh Gradients (upstream: members of SPGradient)
  /** Composed array (for mesh gradients) */
  readonly array = new SPMeshNodeArray();
  #patches: SPGradientPatch[][] | null = null;

  constructor() {
    super();
    this.x.unset(SVGLengthUnit.NONE, 0.0, 0.0);
    this.y.unset(SVGLengthUnit.NONE, 0.0, 0.0);
  }

  override getPaintType(): PaintServerType {
    return PaintServerType.MESH_GRADIENT;
  }

  /** The mesh gradient at the end of the href chain which has patches (upstream SPGradient::getArray). */
  override getArray(): SPMeshGradient {
    const src = super.getArray();
    return src instanceof SPMeshGradient ? src : this;
  }

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    // Start coordinate of meshgradient
    this.readAttr(SPAttr.X);
    this.readAttr(SPAttr.Y);
    this.readAttr(SPAttr.TYPE);
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.X:
        this.x.readOrUnset(value, SVGLengthUnit.NONE, 0.0, 0.0);
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.Y:
        this.y.readOrUnset(value, SVGLengthUnit.NONE, 0.0, 0.0);
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.TYPE:
        if (value) {
          if (value === 'coons') this.type = SPMeshType.SP_MESH_TYPE_COONS;
          else if (value === 'bicubic') this.type = SPMeshType.SP_MESH_TYPE_BICUBIC;
          else console.error(`SPMeshGradient::set(): invalid value ${value}`);
          this.type_set = true;
        } else {
          this.type = SPMeshType.SP_MESH_TYPE_COONS;
          this.type_set = false;
        }
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      default:
        super.set(key, value);
        break;
    }
  }

  protected override modified(flags: number): void {
    if (flags & SP_OBJECT_CHILD_MODIFIED_FLAG) this.invalidateArray();
    if (flags & SP_OBJECT_STYLE_MODIFIED_FLAG) this.ensureArray();
    super.modified(flags);
  }

  /** Write mesh gradient attributes to associated repr. */
  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) repr = xmlDoc.createElement('svg:meshgradient');
    if (!repr) return null;
    if (flags & SP_OBJECT_WRITE_ALL || this.x._set) repr.setAttributeSvgDouble('x', this.x.computed);
    if (flags & SP_OBJECT_WRITE_ALL || this.y._set) repr.setAttributeSvgDouble('y', this.y.computed);
    if (flags & SP_OBJECT_WRITE_ALL || this.type_set) {
      repr.setAttribute('type', this.type === SPMeshType.SP_MESH_TYPE_BICUBIC ? 'bicubic' : 'coons');
    }
    return super.write(xmlDoc, repr, flags);
  }

  /** Forces the array to be built, if not present (i.e., changed). */
  ensureArray(): void {
    if (!this.array.built) this.rebuildArray();
  }

  /** Return true if change made. */
  invalidateArray(): boolean {
    if (!this.array.built) return false;
    this.array.built = false;
    this.#patches = null; // the mesh depends on the array
    return true;
  }

  /** Creates normalized color mesh patch array. */
  rebuildArray(): void {
    this.array.read(this);
    this.#patches = null;
  }

  /**
   * The patches of the mesh for rendering (upstream getGradientMesh / getGradientPatches).
   * TODO: bicubic smoothing (SPMeshNodeArray::bicubic); bicubic meshes are drawn as Coons patches.
   */
  getGradientPatches(): SPGradientPatch[][] {
    this.ensureArray();
    if (this.#patches) return this.#patches;
    const my_array = this.array;
    const rows = my_array.patch_rows();
    const cols = my_array.patch_columns();
    const patchdata: SPGradientPatch[][] = [];
    for (let i = 0; i < rows; i++) {
      const row: SPGradientPatch[] = [];
      for (let j = 0; j < cols; j++) {
        const patch = new SPMeshPatchI(my_array.nodes, i, j);
        const data: SPGradientPatch = {
          points: [],
          pathtype: [],
          tensorIsSet: [],
          tensorpoints: [],
          color: [],
        };
        for (let x = 0; x < 4; x++) data.points.push([0, 1, 2, 3].map((y) => patch.getPoint(x, y)));
        for (let k = 0; k < 4; k++) {
          data.pathtype.push(patch.getPathType(k));
          data.tensorIsSet.push(patch.tensorIsSet(k));
          data.tensorpoints.push(patch.getTensorPoint(k));
          data.color.push(patch.getColor(k));
        }
        row.push(data);
      }
      patchdata.push(row);
    }
    this.#patches = patchdata;
    return patchdata;
  }
}
