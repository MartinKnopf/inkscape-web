// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-mesh-array.cpp, src/object/sp-mesh-array.h
/*
   A group of classes and functions for manipulating mesh gradients.

   A mesh is made up of an array of patches. Each patch has four sides and four corners. The sides can
   be shared between two patches and the corners between up to four.

   The order of the points for each side always goes from left to right or top to bottom.
   For sides 2 and 3 the points must be reversed when used (as in calls to cairo functions).

   Two patches: (C=corner, S=side, H=handle, T=tensor)

                         C0   H1  H2 C1 C0 H1  H2  C1
                          + ---------- + ---------- +
                          |     S0     |     S0     |
                       H1 |  T0    T1  |H1 T0   T1  | H1
                          |S3        S1|S3        S1|
                       H2 |  T3    T2  |H2 T3   T2  | H2
                          |     S2     |     S2     |
                          + ---------- + ---------- +
                         C3   H1  H2 C2 C3 H1  H2   C2

   The mesh is stored internally as an array of nodes that includes the tensor nodes.
*/
/*
 * Authors:
 *   Tavmjong Bah <tavmjong@free.fr>
 *
 * Copyright  (C) 2012, 2015 Tavmjong Bah
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { type Affine, CubicBezier, Path, Point, type Rect, Scale, Translate } from '@inkscape-web/geom';
import { Color } from '../colors/color.ts';
import { Preferences } from '../preferences.ts';
import { cssNumber } from '../svg/css-ostringstream.ts';
import { spReprCssAttrNew, spReprCssSet, spReprCssSetProperty } from '../xml/repr-css.ts';
import { SPGenericEllipse } from './sp-ellipse.ts';
import type { SPItem } from './sp-item.ts';
import type { SPMeshGradient } from './sp-mesh-gradient.ts';
import { SPMeshpatch } from './sp-mesh-patch.ts';
import { SPMeshrow } from './sp-mesh-row.ts';
import { SP_OBJECT_MODIFIED_FLAG } from './sp-object.ts';
import { SPStar, SPStarPoint, sp_star_get_xy } from './sp-star.ts';
import { SPStop } from './sp-stop.ts';

export enum SPMeshType {
  SP_MESH_TYPE_COONS,
  SP_MESH_TYPE_BICUBIC,
}

export enum SPMeshGeometry {
  SP_MESH_GEOMETRY_NORMAL,
  SP_MESH_GEOMETRY_CONICAL,
}

export enum NodeType {
  MG_NODE_TYPE_UNKNOWN,
  MG_NODE_TYPE_CORNER,
  MG_NODE_TYPE_HANDLE,
  MG_NODE_TYPE_TENSOR,
}

/** Is a node along an edge? */
export enum NodeEdge {
  MG_NODE_EDGE_NONE = 0,
  MG_NODE_EDGE_TOP = 1,
  MG_NODE_EDGE_LEFT = 2,
  MG_NODE_EDGE_BOTTOM = 4,
  MG_NODE_EDGE_RIGHT = 8,
}

export enum MeshCornerOperation {
  MG_CORNER_SIDE_TOGGLE,
  MG_CORNER_SIDE_ARC,
  MG_CORNER_TENSOR_TOGGLE,
  MG_CORNER_COLOR_SMOOTH,
  MG_CORNER_COLOR_PICK,
  MG_CORNER_INSERT,
}

export enum MeshNodeOperation {
  MG_NODE_NO_SCALE,
  MG_NODE_SCALE,
  MG_NODE_SCALE_HANDLE,
}

export class SPMeshNode {
  node_type = NodeType.MG_NODE_TYPE_UNKNOWN;
  node_edge: number = NodeEdge.MG_NODE_EDGE_NONE;
  set = false;
  p = new Point(0, 0);
  /** index of on-screen node */
  draggable = -1;
  path_type = 'u';
  color: Color | null = null;
  /** Stop corresponding to node. */
  stop: SPStop | null = null;

  copy(): SPMeshNode {
    const n = new SPMeshNode();
    Object.assign(n, this);
    n.color = this.color?.clone() ?? null;
    return n;
  }
}

type Nodes = SPMeshNode[][];

/** A patch of the node array (I for Internal to distinguish it from the object class). */
export class SPMeshPatchI {
  readonly #nodes: Nodes;
  readonly #row: number;
  readonly #col: number;

  /** Adds the nodes of the patch r, c to n if they are missing. */
  constructor(n: Nodes, r: number, c: number) {
    this.#nodes = n;
    const row = r * 3; // Convert from patch array to node array
    const col = c * 3;
    this.#row = row;
    this.#col = col;
    for (let i = row !== 0 ? 1 : 0; i < 4; ++i) {
      if (n.length < row + i + 1) n.push([]);
      for (let j = col !== 0 ? 1 : 0; j < 4; ++j) {
        const r_i = n[row + i] as SPMeshNode[];
        if (r_i.length < col + j + 1) {
          const node = new SPMeshNode();
          // Ensure all nodes know their type.
          node.node_type = NodeType.MG_NODE_TYPE_HANDLE;
          if ((i === 0 || i === 3) && (j === 0 || j === 3)) node.node_type = NodeType.MG_NODE_TYPE_CORNER;
          if ((i === 1 || i === 2) && (j === 1 || j === 2)) node.node_type = NodeType.MG_NODE_TYPE_TENSOR;
          r_i.push(node);
        }
      }
    }
  }

  #node(i: number, j: number): SPMeshNode {
    return (this.#nodes[this.#row + i] as SPMeshNode[])[this.#col + j] as SPMeshNode;
  }

  /** The node of point pt of side s, in the order of the patch. */
  #sideNode(s: number, pt: number): SPMeshNode {
    switch (s) {
      case 0:
        return this.#node(0, pt);
      case 1:
        return this.#node(pt, 3);
      case 2:
        return this.#node(3, 3 - pt);
      default:
        return this.#node(3 - pt, 0);
    }
  }

  /** Returns point for side in proper order for patch. */
  getPoint(s: number, pt: number): Point {
    return this.#sideNode(s, pt).p;
  }

  /** Returns the points of a side in proper order for a patch (clockwise order). */
  getPointsForSide(i: number): Point[] {
    return [0, 1, 2, 3].map((pt) => this.getPoint(i, pt));
  }

  /** Set point for side in proper order for patch. */
  setPoint(s: number, pt: number, p: Point, set = true): void {
    const node = this.#sideNode(s, pt);
    node.p = p;
    node.set = set;
    node.node_type = pt === 1 || pt === 2 ? NodeType.MG_NODE_TYPE_HANDLE : NodeType.MG_NODE_TYPE_CORNER;
  }

  /** Get path type for side (stored in handle nodes). */
  getPathType(s: number): string {
    return this.#sideNode(s, s < 2 ? 1 : 2).path_type;
  }

  /** Set path type for side (stored in handle nodes). */
  setPathType(s: number, t: string): void {
    this.#sideNode(s, 1).path_type = t;
    this.#sideNode(s, 2).path_type = t;
  }

  /** The tensor node of "corner" k. */
  #tensorNode(k: number): SPMeshNode {
    const [i, j] = (
      [
        [1, 1],
        [1, 2],
        [2, 2],
        [2, 1],
      ] as const
    )[k] ?? [1, 1];
    return this.#node(i, j);
  }

  /** Set tensor control point for "corner" i. */
  setTensorPoint(i: number, p: Point): void {
    const node = this.#tensorNode(i);
    node.p = p;
    node.set = true;
    node.node_type = NodeType.MG_NODE_TYPE_TENSOR;
  }

  /** Return if any tensor control point is set, or the one of "corner" i. */
  tensorIsSet(i?: number): boolean {
    if (i === undefined) return [0, 1, 2, 3].some((k) => this.tensorIsSet(k));
    return this.#tensorNode(i).set;
  }

  /** Return tensor control point for "corner" k. If not set, returns calculated (Coons) point. */
  getTensorPoint(k: number): Point {
    const node = this.#tensorNode(k);
    return node.set ? node.p : this.coonsTensorPoint(k);
  }

  /**
   * Find default tensor point (equivalent point to Coons Patch). Formulas defined in PDF spec.
   * Equivalent to 1/3 of side length from corner for square patch.
   */
  coonsTensorPoint(i: number): Point {
    // Points in PDF notation
    const p00 = this.getPoint(0, 0);
    const p01 = this.getPoint(0, 1);
    const p02 = this.getPoint(0, 2);
    const p03 = this.getPoint(0, 3);
    const p10 = this.getPoint(3, 2);
    const p13 = this.getPoint(1, 1);
    const p20 = this.getPoint(3, 1);
    const p23 = this.getPoint(1, 2);
    const p30 = this.getPoint(2, 3);
    const p31 = this.getPoint(2, 2);
    const p32 = this.getPoint(2, 1);
    const p33 = this.getPoint(2, 0);
    const t = (a: Point, b1: Point, b2: Point, c1: Point, c2: Point, d1: Point, d2: Point, e: Point): Point =>
      a
        .mul(-4.0)
        .add(b1.add(b2).mul(6.0))
        .add(c1.add(c2).mul(-2.0))
        .add(d1.add(d2).mul(3.0))
        .add(e.mul(-1.0))
        .div(9.0);
    switch (i) {
      case 0:
        return t(p00, p01, p10, p03, p30, p31, p13, p33);
      case 1:
        return t(p03, p02, p13, p00, p33, p32, p10, p30);
      case 2:
        return t(p33, p32, p23, p30, p03, p02, p20, p00);
      default:
        return t(p30, p31, p20, p33, p00, p01, p23, p03);
    }
  }

  /** Update default values for handle and tensor nodes. */
  updateNodes(): void {
    // Handles first (tensors require update handles).
    for (let i = 0; i < 4; ++i) {
      for (let j = 0; j < 4; ++j) {
        const node = this.#node(i, j);
        if (!node.set && node.node_type === NodeType.MG_NODE_TYPE_HANDLE) {
          // If a handle is not set it is because the side is a line.
          // Set node points 1/3 of the way between corners.
          if (i === 0 || i === 3) {
            const p0 = this.#node(i, 0).p;
            const p3 = this.#node(i, 3).p;
            let dp = p3.sub(p0).div(3.0);
            if (j === 2) dp = dp.mul(2.0);
            node.p = p0.add(dp);
          }
          if (j === 0 || j === 3) {
            const p0 = this.#node(0, j).p;
            const p3 = this.#node(3, j).p;
            let dp = p3.sub(p0).div(3.0);
            if (i === 2) dp = dp.mul(2.0);
            node.p = p0.add(dp);
          }
        }
      }
    }
    // Update tensor nodes
    for (let i = 1; i < 3; ++i) {
      for (let j = 1; j < 3; ++j) {
        const node = this.#node(i, j);
        if (!node.set) {
          node.node_type = NodeType.MG_NODE_TYPE_TENSOR;
          let t = 0;
          if (i === 1 && j === 2) t = 1;
          if (i === 2 && j === 2) t = 2;
          if (i === 2 && j === 1) t = 3;
          node.p = this.coonsTensorPoint(t);
        }
      }
    }
  }

  /** Return color for corner of patch. */
  getColor(i: number): Color | null {
    return this.#sideNode(i, 0).color;
  }

  /** Set color for corner of patch. */
  setColor(i: number, color: Color): void {
    this.#sideNode(i, 0).color = color;
  }

  /** Return stop pointer for corner of patch. */
  getStopPtr(i: number): SPStop | null {
    return this.#sideNode(i, 0).stop;
  }

  /** Set stop pointer for corner of patch. */
  setStopPtr(i: number, stop: SPStop | null): void {
    this.#sideNode(i, 0).stop = stop;
  }
}

/** The numbers of a mesh stop path ("c 1,2 3,4 5,6"): commas count as spaces. */
function pathNumbers(s: string): number[] {
  return s
    .replace(/,/g, ' ')
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((n) => !Number.isNaN(n));
}

/** The crossing of the rays a + t·da and b + u·db (t, u ≥ 0), or null (upstream intersection(Ray, Ray)). */
function rayCrossing(a: Point, da: Point, b: Point, db: Point): Point | null {
  const den = da.x * db.y - da.y * db.x;
  if (Math.abs(den) < 1e-12) return null;
  const d = b.sub(a);
  const t = (d.x * db.y - d.y * db.x) / den;
  const u = (d.x * da.y - d.y * da.x) / den;
  return t >= 0 && u >= 0 ? a.add(da.mul(t)) : null;
}

/** An array of mesh nodes. */
export class SPMeshNodeArray {
  nodes: Nodes = [];
  // Draggables to nodes.
  corners: SPMeshNode[] = [];
  handles: SPMeshNode[] = [];
  tensors: SPMeshNode[] = [];
  built = false;

  /** A deep copy (upstream copy constructor). */
  copy(): SPMeshNodeArray {
    const a = new SPMeshNodeArray();
    a.nodes = this.nodes.map((row) => row.map((n) => n.copy()));
    a.update_node_vectors();
    return a;
  }

  /**
   * Fills in vectors that are used to map draggers to nodes.
   * This matches dragger creation in GrDrag::addDraggersMesh.
   */
  update_node_vectors(): void {
    this.corners = [];
    this.handles = [];
    this.tensors = [];
    for (const row of this.nodes) {
      for (const node of row) {
        switch (node.node_type) {
          case NodeType.MG_NODE_TYPE_CORNER:
            this.corners.push(node);
            break;
          case NodeType.MG_NODE_TYPE_HANDLE:
            this.handles.push(node);
            break;
          case NodeType.MG_NODE_TYPE_TENSOR:
            this.tensors.push(node);
            break;
          default:
            console.error('Bad Mesh draggable type');
        }
      }
    }
  }

  /** Fill array with data from mesh objects. Returns true if array's dimensions unchanged. */
  read(mg: SPMeshGradient): boolean {
    const mg_array = mg.getArray();
    // Count rows and columns, if unchanged reuse array to keep draggers valid.
    let cols = 0;
    let rows = 0;
    for (const ro of mg_array.children) {
      if (ro instanceof SPMeshrow) {
        ++rows;
        if (rows === 1) for (const po of ro.children) if (po instanceof SPMeshpatch) ++cols;
      }
    }
    let same_size = true;
    if (cols !== this.patch_columns() || rows !== this.patch_rows()) {
      same_size = false;
      this.clear();
    }

    let current_p = new Point(mg.x.computed, mg.y.computed);
    let max_column = 0;
    let irow = 0; // Corresponds to top of patch being read in.
    for (const ro of mg_array.children) {
      if (!(ro instanceof SPMeshrow)) continue;
      let icolumn = 0; // Corresponds to left of patch being read in.
      for (const po of ro.children) {
        if (!(po instanceof SPMeshpatch)) continue;
        const new_patch = new SPMeshPatchI(this.nodes, irow, icolumn); // Adds new nodes.
        let istop = 0;
        // Only 'top' side defined for first row.
        if (irow !== 0) ++istop;
        for (const so of po.children) {
          if (!(so instanceof SPStop)) continue;
          if (istop > 3) break;
          const stop = so;
          // Handle top of first row.
          if (istop === 0 && icolumn === 0) {
            // First patch in mesh.
            new_patch.setPoint(0, 0, current_p);
          }
          // First point is always already defined by previous side (stop).
          current_p = new_patch.getPoint(istop, 0);
          // If side closes patch, then we read one less point.
          let closed = false;
          if (icolumn === 0 && istop === 3) closed = true;
          if (icolumn > 0 && istop === 2) closed = true;
          // Determine type of path
          const path_string = stop.path_string.trim();
          const path_type = path_string.charAt(0);
          const v = pathNumbers(path_string.slice(1));
          new_patch.setPathType(istop, path_type);
          switch (path_type) {
            case 'l':
            case 'L': {
              if (!closed) {
                if (v.length >= 2) {
                  const p = new Point(v[0] as number, v[1] as number);
                  new_patch.setPoint(istop, 3, path_type === 'l' ? current_p.add(p) : p);
                } else {
                  console.error(`Failed to read ${path_type}`);
                }
              }
              // To facilitate some side operations, set handles to 1/3 and
              // 2/3 distance between corner points but flag as unset.
              const p = new_patch.getPoint(istop, 3);
              const dp = p.sub(current_p).div(3.0); // Calculate since may not be set if closed.
              new_patch.setPoint(istop, 1, current_p.add(dp), false);
              new_patch.setPoint(istop, 2, current_p.add(dp.mul(2.0)), false);
              break;
            }
            case 'c':
            case 'C': {
              const max = closed ? 3 : 4;
              for (let i = 1; i < max; ++i) {
                const x = v[2 * (i - 1)];
                const y = v[2 * (i - 1) + 1];
                if (x !== undefined && y !== undefined) {
                  const p = new Point(x, y);
                  new_patch.setPoint(istop, i, path_type === 'c' ? p.add(current_p) : p);
                } else {
                  console.error(`Failed to read ${path_type}: ${i}`);
                }
              }
              break;
            }
            default:
              // should not reach
              console.error(`Path Error: unhandled path type: ${path_type}`);
          }
          current_p = new_patch.getPoint(istop, 3);
          // Color
          if ((istop === 0 && irow === 0 && icolumn > 0) || (istop === 1 && irow > 0)) {
            // skip
          } else {
            new_patch.setColor(istop, stop.getColor());
            new_patch.setStopPtr(istop, stop);
          }
          ++istop;
        } // Loop over stops

        // Read in tensor string after stops since tensor nodes defined relative to corner nodes.
        if (po.tensor_string) {
          const v = pathNumbers(po.tensor_string);
          for (let i = 0; i < 4; ++i) {
            const x = v[2 * i];
            const y = v[2 * i + 1];
            if (x === undefined || y === undefined) {
              console.error(`Failed to read p: ${i}`);
              break;
            }
            new_patch.setTensorPoint(i, new_patch.getPoint(i, 0).add(new Point(x, y)));
          }
        }
        ++icolumn;
        if (max_column < icolumn) max_column = icolumn;
      }
      ++irow;
    }

    // Insure we have a true array.
    for (const row of this.nodes) {
      while (row.length < max_column * 3 + 1) row.push(new SPMeshNode());
      row.length = max_column * 3 + 1;
    }

    // Set node edge.
    for (let i = 0; i < this.nodes.length; ++i) {
      const row = this.nodes[i] as SPMeshNode[];
      for (let j = 0; j < row.length; ++j) {
        const node = row[j] as SPMeshNode;
        node.node_edge = NodeEdge.MG_NODE_EDGE_NONE;
        if (i === 0) node.node_edge |= NodeEdge.MG_NODE_EDGE_TOP;
        if (i === this.nodes.length - 1) node.node_edge |= NodeEdge.MG_NODE_EDGE_BOTTOM;
        if (j === 0) node.node_edge |= NodeEdge.MG_NODE_EDGE_RIGHT;
        if (j === row.length - 1) node.node_edge |= NodeEdge.MG_NODE_EDGE_LEFT;
      }
    }

    this.update_node_vectors();
    this.built = true;
    return same_size;
  }

  /** Write repr using our array. */
  write(mg: SPMeshGradient): void {
    let mg_array: SPMeshGradient = mg.getArray();
    if (!mg_array.array) mg_array = mg;

    // First we must delete reprs for old mesh rows and patches.
    for (const row of [...mg_array.children]) row.deleteObject();

    // Now we build new reprs
    const mesh = mg.getRepr();
    const mesh_array = mg_array.getRepr();
    const array = mg_array.array;

    const patch0 = new SPMeshPatchI(array.nodes, 0, 0);
    let current_p = patch0.getPoint(0, 0); // Side 0, point 0
    mesh.setAttributeSvgDouble('x', current_p.x);
    mesh.setAttributeSvgDouble('y', current_p.y);

    const xml_doc = mesh.document();
    const rows = array.patch_rows();
    const n = (v: number) => cssNumber(v);
    for (let i = 0; i < rows; ++i) {
      // Write row
      const row = xml_doc.createElement('svg:meshrow');
      mesh_array.appendChild(row); // No attributes

      const columns = array.patch_columns();
      for (let j = 0; j < columns; ++j) {
        // Write patch
        const patch = xml_doc.createElement('svg:meshpatch');
        const patchi = new SPMeshPatchI(array.nodes, i, j);

        // Add tensor
        if (patchi.tensorIsSet()) {
          const parts: string[] = [];
          for (let k = 0; k < 4; ++k) {
            const p = patchi.getTensorPoint(k).sub(patchi.getPoint(k, 0));
            parts.push(`${n(p.x)},${n(p.y)}`);
          }
          patch.setAttribute('tensor', parts.join(' '));
        }
        row.appendChild(patch);

        // Write sides
        for (let k = 0; k < 4; ++k) {
          // Only first row has top stop
          if (k === 0 && i !== 0) continue;
          // Only first column has left stop
          if (k === 3 && j !== 0) continue;

          const stop = xml_doc.createElement('svg:stop');

          // Add path
          const path_type = patchi.getPathType(k);
          const p = patchi.getPointsForSide(k) as [Point, Point, Point, Point];
          current_p = patchi.getPoint(k, 0);
          const rel = (q: Point) => `${n(q.x - current_p.x)},${n(q.y - current_p.y)}`;
          const abs = (q: Point) => `${n(q.x)},${n(q.y)}`;
          let is = path_type;
          switch (path_type) {
            case 'l':
              is += ` ${rel(p[3])}`;
              break;
            case 'L':
              is += ` ${abs(p[3])}`;
              break;
            case 'c':
              is += ` ${rel(p[1])}  ${rel(p[2])}  ${rel(p[3])}`;
              break;
            case 'C':
              is += ` ${abs(p[1])}  ${abs(p[2])}  ${abs(p[3])}`;
              break;
            default:
              console.error(`SPMeshNodeArray::write(): unhandled path type${path_type}`);
          }
          stop.setAttribute('path', is);

          // Add stop-color
          if ((k === 0 && i === 0 && j === 0) || (k === 1 && i === 0) || k === 2 || (k === 3 && j === 0)) {
            const color = patchi.getColor(k) ?? new Color(0x000000ff);
            const color_css = spReprCssAttrNew();
            spReprCssSetProperty(color_css, 'stop-color', color.toString(false));
            spReprCssSetProperty(color_css, 'stop-opacity', cssNumber(color.getOpacity()));
            spReprCssSet(stop, color_css, 'style');
          }
          patch.appendChild(stop);
        }
      }
    }
  }

  /** Create a default mesh. */
  create(mg: SPMeshGradient, item: SPItem, bbox: Rect | null): void {
    if (!bbox) {
      // Set default size to bounding box if size not given.
      bbox = item.geometricBounds();
      if (!bbox) {
        console.error('SPMeshNodeArray::create: ERROR: No bounding box!');
        return;
      }
    }
    const width = bbox.width();
    const height = bbox.height();
    let center = bbox.midpoint();

    // Must keep repr and array in sync. We construct the array and then "write" it.
    // We get called twice when a new mesh is created...WHY?
    //  return if we've already constructed the mesh.
    if (this.nodes.length) return;

    // Set 'gradientUnits'. Our calculations assume "userSpaceOnUse".
    const repr = mg.getRepr();
    repr.setAttribute('gradientUnits', 'userSpaceOnUse');

    // Get default color
    const color = default_color(item);
    // Set some corners to white so we can see the mesh.
    let white = new Color(0xffffffff);
    if (color.equals(white)) {
      // If default color is white, set other color to black.
      white = new Color(0x000000ff);
    }

    // Get preferences
    const prefs = Preferences.get();
    const prows = prefs.getInt('/tools/mesh/mesh_rows', 1);
    const pcols = prefs.getInt('/tools/mesh/mesh_cols', 1);
    const mesh_type: SPMeshGeometry = prefs.getInt(
      '/tools/mesh/mesh_geometry',
      SPMeshGeometry.SP_MESH_GEOMETRY_NORMAL,
    );

    if (mesh_type === SPMeshGeometry.SP_MESH_GEOMETRY_CONICAL) {
      // Conical gradient.. for any shape/path using geometric bounding box.
      let rx = width / 2.0;
      let ry = height / 2.0;
      // Start and end angles
      let start = 0.0;
      let end = 2.0 * Math.PI;
      if (item instanceof SPStar) {
        // But if it is a star... use star parameters!
        center = item.center;
        rx = item.r[0];
        ry = item.r[0];
        start = item.arg[0];
        end = start + 2.0 * Math.PI;
      }
      if (item instanceof SPGenericEllipse) {
        // For arcs use set start/stop
        center = new Point(item.cx.computed, item.cy.computed);
        rx = item.rx.computed;
        ry = item.ry.computed;
        start = item.start;
        end = item.end;
        if (end <= start) end += 2.0 * Math.PI;
      }
      repr.setAttributeSvgDouble('x', center.x + rx * Math.cos(start));
      repr.setAttributeSvgDouble('y', center.y + ry * Math.sin(start));

      // If less sections, arc approximation error too great. (Check!)
      const sections = Math.max(pcols, 4);
      const arc = (end - start) / sections;
      // See: http://en.wikipedia.org/wiki/B%C3%A9zier_curve
      const kappa = (4.0 / 3.0) * Math.tan(arc / 4.0);
      const lenx = rx * kappa;
      const leny = ry * kappa;
      let s = start;
      for (let i = 0; i < sections; ++i) {
        const patch = new SPMeshPatchI(this.nodes, 0, i);
        const x0 = center.x + rx * Math.cos(s);
        const y0 = center.y + ry * Math.sin(s);
        const x1 = x0 - lenx * Math.sin(s);
        const y1 = y0 + leny * Math.cos(s);
        s += arc;
        const x3 = center.x + rx * Math.cos(s);
        const y3 = center.y + ry * Math.sin(s);
        const x2 = x3 + lenx * Math.sin(s);
        const y2 = y3 - leny * Math.cos(s);
        patch.setPoint(0, 0, new Point(x0, y0));
        patch.setPoint(0, 1, new Point(x1, y1));
        patch.setPoint(0, 2, new Point(x2, y2));
        patch.setPoint(0, 3, new Point(x3, y3));
        patch.setPoint(2, 0, center);
        patch.setPoint(3, 0, center);
        for (let k = 0; k < 4; ++k) {
          patch.setPathType(k, 'l');
          patch.setColor(k, ((i + k) % 2 ? color : white).clone());
        }
        patch.setPathType(0, 'c');
        // Set handle and tensor nodes.
        patch.updateNodes();
      }
      this.split_row(0, prows);
    } else if (item instanceof SPGenericEllipse) {
      // Normal grid meshes
      center = new Point(item.cx.computed, item.cy.computed);
      const rx = item.rx.computed;
      const ry = item.ry.computed;
      let s = (-3.0 / 2.0) * (Math.PI / 2);
      repr.setAttributeSvgDouble('x', center.x + rx * Math.cos(s));
      repr.setAttributeSvgDouble('y', center.y + ry * Math.sin(s));
      const lenx = (rx * 4 * Math.tan(Math.PI / 2 / 4)) / 3;
      const leny = (ry * 4 * Math.tan(Math.PI / 2 / 4)) / 3;
      const patch = new SPMeshPatchI(this.nodes, 0, 0);
      for (let i = 0; i < 4; ++i) {
        const x0 = center.x + rx * Math.cos(s);
        const y0 = center.y + ry * Math.sin(s);
        const x1 = x0 + lenx * Math.cos(s + Math.PI / 2);
        const y1 = y0 + leny * Math.sin(s + Math.PI / 2);
        s += Math.PI / 2;
        const x3 = center.x + rx * Math.cos(s);
        const y3 = center.y + ry * Math.sin(s);
        const x2 = x3 + lenx * Math.cos(s - Math.PI / 2);
        const y2 = y3 + leny * Math.sin(s - Math.PI / 2);
        patch.setPoint(i, 1, new Point(x1, y1));
        patch.setPoint(i, 2, new Point(x2, y2));
        patch.setPoint(i, 3, new Point(x3, y3));
        patch.setPathType(i, 'c');
        patch.setColor(i, (i % 2 ? color : white).clone());
      }
      // Fill out tensor points
      patch.updateNodes();
      this.split_row(0, prows);
      this.split_column(0, pcols);
    } else if (item instanceof SPStar) {
      // Do simplest thing... assume star is not rounded or randomized.
      const star = item;
      const sides = star.sides;
      const xy = (point: SPStarPoint, i: number) => sp_star_get_xy(star, point, i);
      const KNOT1 = SPStarPoint.SP_STAR_POINT_KNOT1;
      const KNOT2 = SPStarPoint.SP_STAR_POINT_KNOT2;
      const p0 = xy(KNOT1, 0);
      repr.setAttributeSvgDouble('x', p0.x);
      repr.setAttributeSvgDouble('y', p0.y);
      for (let i = 0; i < sides; ++i) {
        const ii = i + 1 === sides ? 0 : i + 1;
        if (star.flatsided) {
          const patch = new SPMeshPatchI(this.nodes, 0, i);
          patch.setPoint(0, 0, xy(KNOT1, i));
          patch.setPoint(1, 0, xy(KNOT1, ii));
          patch.setPoint(2, 0, star.center);
          patch.setPoint(3, 0, star.center);
          for (let s = 0; s < 4; ++s) {
            patch.setPathType(s, 'l');
            patch.setColor(s, ((i + s) % 2 ? color : white).clone());
          }
          // Set handle and tensor nodes.
          patch.updateNodes();
        } else {
          const patch0 = new SPMeshPatchI(this.nodes, 0, 2 * i);
          patch0.setPoint(0, 0, xy(KNOT1, i));
          patch0.setPoint(1, 0, xy(KNOT2, i));
          patch0.setPoint(2, 0, star.center);
          patch0.setPoint(3, 0, star.center);
          const patch1 = new SPMeshPatchI(this.nodes, 0, 2 * i + 1);
          patch1.setPoint(0, 0, xy(KNOT2, i));
          patch1.setPoint(1, 0, xy(KNOT1, ii));
          patch1.setPoint(2, 0, star.center);
          patch1.setPoint(3, 0, star.center);
          for (let s = 0; s < 4; ++s) {
            patch0.setPathType(s, 'l');
            patch0.setColor(s, (s % 2 ? color : white).clone());
            patch1.setPathType(s, 'l');
            patch1.setColor(s, (s % 2 ? white : color).clone());
          }
          // Set handle and tensor nodes.
          patch0.updateNodes();
          patch1.updateNodes();
        }
      }
      this.split_row(0, prows);
    } else {
      // Generic
      repr.setAttributeSvgDouble('x', bbox.min().x);
      repr.setAttributeSvgDouble('y', bbox.min().y);
      // Get node array size
      const nrows = prows * 3 + 1;
      const ncols = pcols * 3 + 1;
      const dx = width / (ncols - 1.0);
      const dy = height / (nrows - 1.0);
      const p0 = bbox.min();
      for (let i = 0; i < nrows; ++i) {
        const row: SPMeshNode[] = [];
        for (let j = 0; j < ncols; ++j) {
          const node = new SPMeshNode();
          node.p = p0.add(new Point(j * dx, i * dy));
          node.node_edge = NodeEdge.MG_NODE_EDGE_NONE;
          if (i === 0) node.node_edge |= NodeEdge.MG_NODE_EDGE_TOP;
          if (i === nrows - 1) node.node_edge |= NodeEdge.MG_NODE_EDGE_BOTTOM;
          if (j === 0) node.node_edge |= NodeEdge.MG_NODE_EDGE_LEFT;
          if (j === ncols - 1) node.node_edge |= NodeEdge.MG_NODE_EDGE_RIGHT;
          if (i % 3 === 0) {
            if (j % 3 === 0) {
              // Corner
              node.node_type = NodeType.MG_NODE_TYPE_CORNER;
              node.set = true;
              node.color = ((i + j) % 2 ? color : white).clone();
            } else {
              // Side
              node.node_type = NodeType.MG_NODE_TYPE_HANDLE;
              node.set = true;
              node.path_type = 'c';
            }
          } else if (j % 3 === 0) {
            // Side
            node.node_type = NodeType.MG_NODE_TYPE_HANDLE;
            node.set = true;
            node.path_type = 'c';
          } else {
            // Tensor
            node.node_type = NodeType.MG_NODE_TYPE_TENSOR;
            node.set = false;
          }
          row.push(node);
        }
        this.nodes.push(row);
      }
    }
    // Write repr
    this.write(mg);
  }

  /** Clear mesh gradient. */
  clear(): void {
    this.nodes = [];
  }

  /** Number of patch rows. */
  patch_rows(): number {
    return Math.floor(this.nodes.length / 3);
  }

  /** Number of patch columns. */
  patch_columns(): number {
    if (!this.nodes.length) return 0;
    return Math.floor((this.nodes[0] as SPMeshNode[]).length / 3);
  }

  node(i: number, j: number): SPMeshNode {
    return (this.nodes[i] as SPMeshNode[])[j] as SPMeshNode;
  }

  /**
   * i, j: Corner draggable indices. Returns the nodes of the side between them in top/bottom or
   * left/right order if the corners are adjacent, else null.
   */
  adjacent_corners(i: number, j: number): [SPMeshNode, SPMeshNode, SPMeshNode, SPMeshNode] | null {
    // This works as all corners have indices and they are numbered in order by row and column
    // (and the node array is rectangular).
    const c1 = Math.min(i, j);
    const c2 = Math.max(i, j);
    // Number of corners in a row of patches.
    const ncorners = this.patch_columns() + 1;
    const crow1 = Math.floor(c1 / ncorners);
    const crow2 = Math.floor(c2 / ncorners);
    const ccol1 = c1 % ncorners;
    const ccol2 = c2 % ncorners;
    const nrow = crow1 * 3;
    const ncol = ccol1 * 3;
    // Check for horizontal neighbors
    if (crow1 === crow2 && ccol2 - ccol1 === 1) {
      return [0, 1, 2, 3].map((k) => this.node(nrow, ncol + k)) as [
        SPMeshNode,
        SPMeshNode,
        SPMeshNode,
        SPMeshNode,
      ];
    }
    // Check for vertical neighbors
    if (ccol1 === ccol2 && crow2 - crow1 === 1) {
      return [0, 1, 2, 3].map((k) => this.node(nrow + k, ncol)) as [
        SPMeshNode,
        SPMeshNode,
        SPMeshNode,
        SPMeshNode,
      ];
    }
    return null;
  }

  /** The side nodes of each pair of adjacent corners among the selected corner draggable indices. */
  #adjacentSides(corners: readonly number[]): [SPMeshNode, SPMeshNode, SPMeshNode, SPMeshNode][] {
    const sides: [SPMeshNode, SPMeshNode, SPMeshNode, SPMeshNode][] = [];
    for (let i = 0; i < corners.length - 1; ++i) {
      for (let j = i + 1; j < corners.length; ++j) {
        const n = this.adjacent_corners(corners[i] as number, corners[j] as number);
        if (n) sides.push(n);
      }
    }
    return sides;
  }

  /** Toggle sides between lineto and curve to if both corners selected. */
  side_toggle(corners: readonly number[]): number {
    let toggled = 0;
    if (corners.length < 2) return 0;
    for (const n of this.#adjacentSides(corners)) {
      const path_type = n[1].path_type;
      switch (path_type) {
        case 'L':
        case 'l':
          n[1].path_type = n[2].path_type = path_type === 'L' ? 'C' : 'c';
          n[1].set = true;
          n[2].set = true;
          break;
        case 'C':
        case 'c': {
          n[1].path_type = n[2].path_type = path_type === 'C' ? 'L' : 'l';
          n[1].set = false;
          n[2].set = false;
          // 'L' acts as if handles are 1/3 of path length from corners.
          const dp = n[3].p.sub(n[0].p).div(3.0);
          n[1].p = n[0].p.add(dp);
          n[2].p = n[3].p.sub(dp);
          break;
        }
        default:
          console.error(`Toggle sides: Invalid path type: ${path_type}`);
      }
      ++toggled;
    }
    if (toggled > 0) this.built = false;
    return toggled;
  }

  /**
   * Converts generic Beziers to Beziers approximating elliptical arcs, preserving handle direction.
   * The solution chosen here is to generate a section of an ellipse that is centered on the
   * intersection of the two lines passing through the two nodes but parallel to the other node's
   * handle direction.
   */
  side_arc(corners: readonly number[]): number {
    if (corners.length < 2) return 0;
    let arced = 0;
    for (const n of this.#adjacentSides(corners)) {
      const path_type = n[1].path_type;
      if (path_type === 'L' || path_type === 'l') {
        console.error("SPMeshNodeArray::side_arc: Can't convert straight lines to arcs.");
        continue;
      }
      const intersection = rayCrossing(n[0].p, n[1].p.sub(n[0].p), n[3].p, n[2].p.sub(n[3].p));
      if (!intersection) {
        console.error("SPMeshNodeArray::side_arc: No crossing, can't turn into arc.");
        continue;
      }
      const f = (4.0 / 3.0) * Math.tan(Math.PI / 2.0 / 4.0);
      const h1 = intersection.sub(n[0].p);
      const h2 = intersection.sub(n[3].p);
      n[1].p = n[0].p.add(h1.mul(f));
      n[2].p = n[3].p.add(h2.mul(f));
      ++arced;
    }
    if (arced > 0) this.built = false;
    return arced;
  }

  /** Toggle the tensor points of each patch whose four corners are selected. */
  tensor_toggle(corners: readonly number[]): number {
    if (corners.length < 4) return 0;
    let toggled = 0;
    // Number of corners in a row of patches.
    const ncorners = this.patch_columns() + 1;
    const set = new Set(corners);
    for (const c0 of set) {
      // Check we have four corners of one patch selected
      if (
        c0 % ncorners < ncorners - 1 &&
        set.has(c0 + 1) &&
        set.has(c0 + ncorners) &&
        set.has(c0 + ncorners + 1)
      ) {
        // Patch
        const prow = Math.floor(c0 / ncorners);
        const pcol = c0 % ncorners;
        // Upper left node of patch
        const irow = prow * 3;
        const jcol = pcol * 3;
        const patch = new SPMeshPatchI(this.nodes, prow, pcol);
        patch.updateNodes();
        const value = !patch.tensorIsSet();
        for (const [di, dj] of [
          [1, 1],
          [1, 2],
          [2, 1],
          [2, 2],
        ] as const) {
          this.node(irow + di, jcol + dj).set = value;
        }
        ++toggled;
      }
    }
    if (toggled > 0) this.built = false;
    return toggled;
  }

  /** Attempts to smooth color transitions across corners. */
  color_smooth(corners: readonly number[]): number {
    let smoothed = 0;
    // Number of corners in a row of patches.
    const ncorners = this.patch_columns() + 1;
    // Number of node rows and columns
    const ncols = this.patch_columns() * 3 + 1;
    const nrows = this.patch_rows() * 3 + 1;
    for (const corner of corners) {
      // Node row & col
      const nrow = Math.floor(corner / ncorners) * 3;
      const ncol = (corner % ncorners) * 3;
      for (let s = 0; s < 2; ++s) {
        // Find neighboring nodes
        let n: SPMeshNode[] | null = null;
        if (s === 0) {
          // Horizontal
          if (ncol > 2 && ncol + 3 < ncols)
            n = [0, 1, 2, 3, 4, 5, 6].map((j) => this.node(nrow, ncol - 3 + j));
        } else if (nrow > 2 && nrow + 3 < nrows) {
          // Vertical
          n = [0, 1, 2, 3, 4, 5, 6].map((j) => this.node(nrow - 3 + j, ncol));
        }
        if (!n) continue;
        const nn = n as [SPMeshNode, SPMeshNode, SPMeshNode, SPMeshNode, SPMeshNode, SPMeshNode, SPMeshNode];
        // Let the smoothing begin. Get initial slopes using closest handles.
        const color0 = nn[0].color;
        const color3 = nn[3].color;
        const color6 = nn[6].color;
        if (!color0 || !color3 || !color6) continue;
        // Distance nodes from selected corner
        const d = nn.map((node) => node.p.sub(nn[3].p)) as Point[];
        const len = (k: number) => (d[k] as Point).length();
        const slope: [number[], number[]] = [
          [0, 0, 0],
          [0, 0, 0],
        ];
        const slope_ave = [0, 0, 0];
        let sdm = -1.0; // Slope Diff Max
        let cdm = 0; // Color Diff Max (Which color has the maximum difference in slopes)
        for (let c = 0; c < 3; ++c) {
          if (len(2) !== 0.0) slope[0][c] = (color3.get(c) - color0.get(c)) / len(2);
          if (len(4) !== 0.0) slope[1][c] = (color6.get(c) - color3.get(c)) / len(4);
          slope_ave[c] = ((slope[0][c] as number) + (slope[1][c] as number)) / 2.0;
          const slope_diff = (slope[0][c] as number) - (slope[1][c] as number);
          // Find color with maximum difference
          if (Math.abs(slope_diff) > sdm) {
            sdm = Math.abs(slope_diff);
            cdm = c;
          }
        }
        // Find new handle positions:
        let length_left = len(0);
        let length_right = len(6);
        const ave = slope_ave[cdm] as number;
        if (ave !== 0.0) {
          length_left = Math.abs((color3.get(cdm) - color0.get(cdm)) / ave);
          length_right = Math.abs((color6.get(cdm) - color3.get(cdm)) / ave);
        }
        // Move closest handle a maximum of mid point... but don't shorten
        const max = 0.8;
        if (length_left > max * len(0) && length_left > len(2)) {
          length_left = Math.max(max * len(0), len(2));
        }
        if (length_right > max * len(6) && length_right > len(4)) {
          length_right = Math.max(max * len(6), len(4));
        }
        let d2 = d[2] as Point;
        let d4 = d[4] as Point;
        if (len(2) !== 0.0) d2 = d2.mul(length_left / len(2));
        if (len(4) !== 0.0) d4 = d4.mul(length_right / len(4));
        nn[2].p = nn[3].p.add(d2);
        nn[4].p = nn[3].p.add(d4);
        ++smoothed;
      }
    }
    if (smoothed > 0) this.built = false;
    return smoothed;
  }

  /** Splits selected rows and/or columns in half (according to the path 't' parameter). */
  insert(corners: readonly number[]): number {
    let inserted = 0;
    if (corners.length < 2) return 0;
    const columns = new Set<number>();
    const rows = new Set<number>();
    const ncorners = this.patch_columns() + 1;
    for (let i = 0; i < corners.length - 1; ++i) {
      for (let j = i + 1; j < corners.length; ++j) {
        const c1 = Math.min(corners[i] as number, corners[j] as number);
        const c2 = Math.max(corners[i] as number, corners[j] as number);
        const crow1 = Math.floor(c1 / ncorners);
        const crow2 = Math.floor(c2 / ncorners);
        const ccol1 = c1 % ncorners;
        const ccol2 = c2 % ncorners;
        // Check for horizontal neighbors
        if (crow1 === crow2 && ccol2 - ccol1 === 1) columns.add(ccol1);
        // Check for vertical neighbors
        if (ccol1 === ccol2 && crow2 - crow1 === 1) rows.add(crow1);
      }
    }
    // Iterate backwards so column/row numbers are not invalidated.
    for (const c of [...columns].sort((a, b) => b - a)) {
      this.split_column_at(c, 0.5);
      ++inserted;
    }
    for (const r of [...rows].sort((a, b) => b - a)) {
      this.split_row_at(r, 0.5);
      ++inserted;
    }
    if (inserted > 0) this.built = false;
    return inserted;
  }

  /**
   * Moves handles in response to a corner node move.
   * corner: the corner node moved (draggable index, i.e. point_i). p_old: original position of
   * moved corner node. Corner node must already have been moved!
   */
  update_handles(
    corner: number,
    _selected: readonly number[],
    p_old: Point,
    _op: MeshNodeOperation = MeshNodeOperation.MG_NODE_NO_SCALE,
  ): void {
    // Find number of patch rows and columns
    const mrow = this.patch_rows();
    const mcol = this.patch_columns();
    // Number of corners in a row of patches.
    const ncorners = mcol + 1;
    // Find corner row/column
    const crow = Math.floor(corner / ncorners);
    const ccol = corner % ncorners;
    // Find node row/column
    const nrow = crow * 3;
    const ncol = ccol * 3;
    const N = (i: number, j: number) => this.node(i, j);

    // New corner mesh coordinate.
    const p_new = N(nrow, ncol).p;
    // Corner point move dpg in mesh coordinate system.
    const dp = p_new.sub(p_old);

    // STEP 1: ONLY DO DIRECT MOVE
    const patch = [
      ccol > 0 && crow > 0,
      ccol < mcol && crow > 0,
      ccol < mcol && crow < mrow,
      ccol > 0 && crow < mrow,
    ];

    // Move handles: the handle next to the corner in direction (di, dj).
    const moveHandle = (di: number, dj: number) => {
      const h1 = N(nrow + di, ncol + dj);
      if (h1.path_type === 'l' || h1.path_type === 'L') {
        const far = N(nrow + 3 * di, ncol + 3 * dj).p;
        const s = far.sub(N(nrow, ncol).p).div(3.0);
        h1.p = N(nrow, ncol).p.add(s);
        N(nrow + 2 * di, ncol + 2 * dj).p = far.sub(s);
      } else {
        h1.p = h1.p.add(dp);
      }
    };
    if (patch[0] || patch[1]) moveHandle(-1, 0);
    if (patch[1] || patch[2]) moveHandle(0, 1);
    if (patch[2] || patch[3]) moveHandle(1, 0);
    if (patch[3] || patch[0]) moveHandle(0, -1);

    // Move tensors
    if (patch[0]) N(nrow - 1, ncol - 1).p = N(nrow - 1, ncol - 1).p.add(dp);
    if (patch[1]) N(nrow - 1, ncol + 1).p = N(nrow - 1, ncol + 1).p.add(dp);
    if (patch[2]) N(nrow + 1, ncol + 1).p = N(nrow + 1, ncol + 1).p.add(dp);
    if (patch[3]) N(nrow + 1, ncol - 1).p = N(nrow + 1, ncol - 1).p.add(dp);
  }

  /** Return outline path. */
  outline_path(): Path | null {
    if (!this.nodes.length) {
      console.error('SPMeshNodeArray::outline_path: empty array!');
      return null;
    }
    const N = (i: number, j: number) => this.node(i, j).p;
    const ncol = (this.nodes[0] as SPMeshNode[]).length;
    const nrow = this.nodes.length;
    const outline = new Path(N(0, 0));
    const cubic = (p1: Point, p2: Point, p3: Point) =>
      outline.appendCurve(new CubicBezier(outline.finalPoint(), p1, p2, p3));
    // Top
    for (let i = 1; i < ncol; i += 3) cubic(N(0, i), N(0, i + 1), N(0, i + 2));
    // Right
    for (let i = 1; i < nrow; i += 3) cubic(N(i, ncol - 1), N(i + 1, ncol - 1), N(i + 2, ncol - 1));
    // Bottom (right to left)
    for (let i = 1; i < ncol; i += 3)
      cubic(N(nrow - 1, ncol - i - 1), N(nrow - 1, ncol - i - 2), N(nrow - 1, ncol - i - 3));
    // Left (bottom to top)
    for (let i = 1; i < nrow; i += 3) cubic(N(nrow - i - 1, 0), N(nrow - i - 2, 0), N(nrow - i - 3, 0));
    outline.close();
    return outline;
  }

  /** Transform array. */
  transform(m: Affine): void {
    for (const row of this.nodes) for (const node of row) node.p = node.p.transformed(m);
  }

  /** Transform mesh to fill box. Return true if mesh transformed. */
  fill_box(mg: SPMeshGradient, box: Rect): boolean {
    // If gradientTransform is set (as happens when an object is transformed
    // with the "optimized" preferences set true), we need to remove it.
    if (mg.gradientTransform_set) {
      this.transform(mg.gradientTransform);
      mg.gradientTransform_set = false;
      mg.gradientTransform = Scale(1);
    }
    const mesh_bbox = this.outline_path()?.boundsExact();
    if (!mesh_bbox || mesh_bbox.width() === 0 || mesh_bbox.height() === 0) return false;
    const scale_x = box.width() / mesh_bbox.width();
    const scale_y = box.height() / mesh_bbox.height();
    const trans = Translate(mesh_bbox.min().neg())
      .multiply(Scale(scale_x, scale_y))
      .multiply(Translate(box.min()));
    if (!trans.isIdentity()) {
      this.transform(trans);
      this.write(mg);
      mg.requestModified(SP_OBJECT_MODIFIED_FLAG);
      return true;
    }
    return false;
  }

  /** Split a row into n equal parts. */
  split_row(row: number, n: number): void {
    if (n > 1) this.split_row_at(row, (n - 1) / n);
    if (n > 2) this.split_row(row, n - 1);
  }

  /** Split a column into n equal parts. */
  split_column(col: number, n: number): void {
    if (n > 1) this.split_column_at(col, (n - 1) / n);
    if (n > 2) this.split_column(col, n - 1);
  }

  /** Split a row into two rows at coord (fraction of row height) (upstream split_row(unsigned, double)). */
  split_row_at(row: number, coord: number): void {
    this.built = false;
    // First step is to ensure that handle and tensor points are up-to-date if they are not set.
    // (We can't do this on the fly as we overwrite the necessary points to do the calculation
    //  during the update.)
    for (let j = 0; j < this.patch_columns(); ++j) new SPMeshPatchI(this.nodes, row, j).updateNodes();

    // Add three new rows of empty nodes
    const width = (this.nodes[0] as SPMeshNode[]).length;
    for (let i = 0; i < 3; ++i) {
      this.nodes.splice(
        3 * (row + 1),
        0,
        Array.from({ length: width }, () => new SPMeshNode()),
      );
    }

    const i = 3 * row; // Convert from patch row to node row
    const N = (a: number, b: number) => this.node(a, b);
    for (let j = 0; j < width; ++j) {
      // Bottom patch row has been shifted by new rows
      const b = new CubicBezier(N(i, j).p, N(i + 1, j).p, N(i + 2, j).p, N(i + 6, j).p);
      const [first, second] = b.subdivide(coord);
      // Update points
      for (let n = 0; n < 4; ++n) {
        N(i + n, j).p = first.controlPoint(n);
        N(i + n + 3, j).p = second.controlPoint(n);
      }
      if (N(i, j).node_type === NodeType.MG_NODE_TYPE_CORNER) {
        // We are splitting a side. Path type stored in handles.
        const path_type = N(i + 1, j).path_type;
        N(i + 4, j).path_type = path_type;
        N(i + 5, j).path_type = path_type;
        const set = N(i + 1, j).set;
        N(i + 4, j).set = set;
        N(i + 5, j).set = set;
        N(i + 4, j).node_type = NodeType.MG_NODE_TYPE_HANDLE;
        N(i + 5, j).node_type = NodeType.MG_NODE_TYPE_HANDLE;
        // Color stored in corners
        const c0 = N(i, j).color;
        const c6 = N(i + 6, j).color;
        N(i + 3, j).color = c0 && c6 ? c0.averaged(c6, coord) : (c0?.clone() ?? null);
        N(i + 3, j).node_type = NodeType.MG_NODE_TYPE_CORNER;
        N(i + 3, j).set = true;
      } else {
        // We are splitting a middle
        const set = N(i + 1, j).set || N(i + 2, j).set;
        N(i + 4, j).set = set;
        N(i + 5, j).set = set;
        N(i + 4, j).node_type = NodeType.MG_NODE_TYPE_TENSOR;
        N(i + 5, j).node_type = NodeType.MG_NODE_TYPE_TENSOR;
        // Path type, if different, choose l -> L -> c -> C.
        const path_type = mergedPathType(N(i, j).path_type, N(i + 6, j).path_type);
        N(i + 3, j).path_type = path_type;
        N(i + 3, j).node_type = NodeType.MG_NODE_TYPE_HANDLE;
        if (path_type === 'c' || path_type === 'C') N(i + 3, j).set = true;
      }
      for (const k of [3, 4, 5]) {
        const node = N(i + k, j);
        node.node_edge = NodeEdge.MG_NODE_EDGE_NONE;
        if (j === 0) node.node_edge |= NodeEdge.MG_NODE_EDGE_LEFT;
        if (j === width - 1) node.node_edge |= NodeEdge.MG_NODE_EDGE_RIGHT;
      }
    }
  }

  /** Split a column into two columns at coord (fraction of column width) (upstream split_column(unsigned, double)). */
  split_column_at(col: number, coord: number): void {
    this.built = false;
    // First step is to ensure that handle and tensor points are up-to-date if they are not set.
    for (let i = 0; i < this.patch_rows(); ++i) new SPMeshPatchI(this.nodes, i, col).updateNodes();

    const j = 3 * col; // Convert from patch column to node column
    const N = (a: number, b: number) => this.node(a, b);
    for (let i = 0; i < this.nodes.length; ++i) {
      const row = this.nodes[i] as SPMeshNode[];
      const b = new CubicBezier(N(i, j).p, N(i, j + 1).p, N(i, j + 2).p, N(i, j + 3).p);
      const [first, second] = b.subdivide(coord);
      // Add three new nodes
      row.splice(j + 3, 0, new SPMeshNode(), new SPMeshNode(), new SPMeshNode());
      // Update points
      for (let n = 0; n < 4; ++n) {
        N(i, j + n).p = first.controlPoint(n);
        N(i, j + n + 3).p = second.controlPoint(n);
      }
      if (N(i, j).node_type === NodeType.MG_NODE_TYPE_CORNER) {
        // We are splitting a side. Path type stored in handles.
        const path_type = N(i, j + 1).path_type;
        N(i, j + 4).path_type = path_type;
        N(i, j + 5).path_type = path_type;
        const set = N(i, j + 1).set;
        N(i, j + 4).set = set;
        N(i, j + 5).set = set;
        N(i, j + 4).node_type = NodeType.MG_NODE_TYPE_HANDLE;
        N(i, j + 5).node_type = NodeType.MG_NODE_TYPE_HANDLE;
        // Color stored in corners
        const c0 = N(i, j).color;
        const c6 = N(i, j + 6).color;
        N(i, j + 3).color = c0 && c6 ? c0.averaged(c6, coord) : (c0?.clone() ?? null);
        N(i, j + 3).node_type = NodeType.MG_NODE_TYPE_CORNER;
        N(i, j + 3).set = true;
      } else {
        // We are splitting a middle
        const set = N(i, j + 1).set || N(i, j + 2).set;
        N(i, j + 4).set = set;
        N(i, j + 5).set = set;
        N(i, j + 4).node_type = NodeType.MG_NODE_TYPE_TENSOR;
        N(i, j + 5).node_type = NodeType.MG_NODE_TYPE_TENSOR;
        // Path type, if different, choose l -> L -> c -> C.
        const path_type = mergedPathType(N(i, j).path_type, N(i, j + 6).path_type);
        N(i, j + 3).path_type = path_type;
        N(i, j + 3).node_type = NodeType.MG_NODE_TYPE_HANDLE;
        if (path_type === 'c' || path_type === 'C') N(i, j + 3).set = true;
      }
      for (const k of [3, 4, 5]) {
        const node = N(i, j + k);
        node.node_edge = NodeEdge.MG_NODE_EDGE_NONE;
        if (i === 0) node.node_edge |= NodeEdge.MG_NODE_EDGE_TOP;
        if (i === this.nodes.length - 1) node.node_edge |= NodeEdge.MG_NODE_EDGE_BOTTOM;
      }
    }
  }
}

/** Path type, if different, choose l -> L -> c -> C. */
function mergedPathType(path_type0: string, path_type1: string): string {
  let path_type = 'l';
  if (path_type0 === 'L' || path_type1 === 'L') path_type = 'L';
  if (path_type0 === 'c' || path_type1 === 'c') path_type = 'c';
  if (path_type0 === 'C' || path_type1 === 'C') path_type = 'C';
  return path_type;
}

/** Find default color based on colors in existing fill. */
function default_color(item: SPItem): Color {
  const paint = item.style.fill; // Could pick between style.fill/style.stroke
  if (paint.isColor()) return paint.getColor().clone();
  if (paint.isPaintserver()) {
    const server = item.style.getFillPaintServer() as {
      getVector?: () => { getFirstStop(): SPStop | null };
    } | null;
    const firstStop = server?.getVector?.().getFirstStop();
    if (firstStop) return firstStop.getColor();
  }
  return new Color(0x800080ff);
}
