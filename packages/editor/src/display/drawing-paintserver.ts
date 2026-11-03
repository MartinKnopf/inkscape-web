// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/drawing-paintserver.cpp, src/display/drawing-paintserver.h
/*
 * Representation of paint servers used when rendering.
 *
 * Author: PBS <pbs3141@gmail.com>
 * Copyright (C) 2022 Authors
 */
import {
  type Drawing,
  PaintServerType,
  PatternUnits,
  SP_ITEM_SHOW_DISPLAY,
  type SPGradient,
  type SPGradientPatch,
  SPGradientSpread,
  SPGradientUnits,
  SPItem,
  SPMeshGradient,
  type SPPaintServer,
  SPPattern,
} from '@inkscape-web/core';
import { type Point, Rect } from '@inkscape-web/geom';
import { matrixString, type SvgDrawingItem } from './drawing-item.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

interface Mirror {
  element: SVGElement;
  disconnect: () => void;
  /** Patterns: the display key of the content and the pattern whose children are shown. */
  key?: number | undefined;
  shown?: { root: SPPattern; children: SPItem[] } | undefined;
}

/**
 * The paint servers of one Drawing, as SVG elements in a <defs> of the drawing (upstream
 * DrawingPaintServer, which renders with Cairo). setStyle() of the drawing items asks for the url()
 * of a server; the first request creates the element, and the element follows the changes of
 * the server (modified signal) until the server is released.
 *
 * The elements are built from the SPPaintServer data (getGradientVector() etc.), not copied from
 * the document: the href chain is already resolved, so the element is self-contained. Their ids
 * start with a prefix that is unique per drawing, so that several views of the same document do
 * not clash.
 * A pattern becomes an svg:pattern with the attributes resolved along the href chain; its
 * content is a view (own display key) of the children of the root pattern, which the drawing
 * shows like other items (upstream DrawingPattern renders the tile with Cairo).
 * A mesh gradient becomes an svg:pattern with one image: the patches rasterized by
 * rasterizeMesh() (Chromium has no mesh gradients; upstream renders cairo mesh patterns). The tile
 * is three times the mesh size, with the mesh in the middle, so that the repetition stays outside
 * of the objects that use the mesh.
 * TODO: hatches.
 */
export class DrawingPaintServers {
  readonly defs: SVGDefsElement;
  readonly #prefix: string;
  readonly #mirrors = new Map<SPPaintServer, Mirror>();
  #counter = 0;
  /** The drawing that shows the content of patterns; set by the drawing. */
  drawing: Drawing | null = null;

  constructor(doc: Document, prefix: string) {
    this.defs = doc.createElementNS(SVG_NS, 'defs') as SVGDefsElement;
    this.#prefix = prefix;
  }

  /** The CSS url() of the mirror of server, or null if the server cannot be drawn. */
  url(server: SPPaintServer): string | null {
    const type = server.getPaintType();
    if (
      type !== PaintServerType.LINEAR_GRADIENT &&
      type !== PaintServerType.RADIAL_GRADIENT &&
      type !== PaintServerType.PATTERN &&
      type !== PaintServerType.MESH_GRADIENT
    ) {
      return null;
    }
    if (type === PaintServerType.PATTERN && !server.isValid()) return null;
    let mirror = this.#mirrors.get(server);
    if (!mirror) {
      const tag =
        type === PaintServerType.LINEAR_GRADIENT
          ? 'linearGradient'
          : type === PaintServerType.RADIAL_GRADIENT
            ? 'radialGradient'
            : 'pattern'; // patterns and meshes
      const element = this.defs.ownerDocument.createElementNS(SVG_NS, tag) as SVGElement;
      element.id = `${this.#prefix}${++this.#counter}`;
      this.defs.append(element);
      const offModified = server.modifiedSignal.connect(() => this.#render(server, element));
      const offRelease = server.releaseSignal.connect(() => this.#remove(server));
      const m: Mirror = {
        element,
        disconnect: () => {
          offModified();
          offRelease();
          this.#hideContent(m);
        },
      };
      mirror = m;
      this.#mirrors.set(server, mirror);
      this.#render(server, element);
    }
    return `url(#${mirror.element.id})`;
  }

  /** Remove all mirrors (when the drawing is no longer used). */
  clear(): void {
    for (const server of [...this.#mirrors.keys()]) this.#remove(server);
  }

  #remove(server: SPPaintServer): void {
    const mirror = this.#mirrors.get(server);
    if (!mirror) return;
    mirror.disconnect();
    mirror.element.remove();
    this.#mirrors.delete(server);
  }

  /** Write the gradient data of server to element (upstream DrawingLinearGradient / DrawingRadialGradient). */
  #render(server: SPPaintServer, element: SVGElement): void {
    if (server instanceof SPPattern) {
      this.#renderPattern(server, element);
      return;
    }
    if (server instanceof SPMeshGradient) {
      renderMesh(server, element);
      return;
    }
    const gradient = server as SPGradient;
    const vector = gradient.getGradientVector();
    const set = (name: string, value: string | number | null) => {
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, String(value));
    };
    const g = vector.geom;
    if (server.getPaintType() === PaintServerType.LINEAR_GRADIENT) {
      ['x1', 'y1', 'x2', 'y2'].forEach((name, i) => {
        set(name, g[i] ?? 0);
      });
    } else {
      ['cx', 'cy', 'r', 'fx', 'fy', 'fr'].forEach((name, i) => {
        set(name, g[i] ?? 0);
      });
    }
    set(
      'gradientUnits',
      server.getUnits() === SPGradientUnits.SP_GRADIENT_UNITS_USERSPACEONUSE
        ? 'userSpaceOnUse'
        : 'objectBoundingBox',
    );
    set('gradientTransform', matrixString(server.getGradientTransform()));
    const spread = server.getSpread();
    set(
      'spreadMethod',
      spread === SPGradientSpread.SP_GRADIENT_SPREAD_REFLECT
        ? 'reflect'
        : spread === SPGradientSpread.SP_GRADIENT_SPREAD_REPEAT
          ? 'repeat'
          : 'pad',
    );
    const doc = element.ownerDocument;
    element.replaceChildren(
      ...vector.stops.map((stop) => {
        const s = doc.createElementNS(SVG_NS, 'stop');
        s.setAttribute('offset', String(stop.offset));
        // A missing color paints as 'none' (a gradient without stops).
        s.setAttribute('stop-color', stop.color ? stop.color.toString(false) : 'black');
        s.setAttribute('stop-opacity', String(stop.color ? stop.color.getOpacity() : 0));
        return s;
      }),
    );
  }

  /**
   * Write the pattern attributes (resolved along the href chain) and show the children of the
   * root pattern (upstream SPPattern::update_view and attach_view).
   */
  #renderPattern(pattern: SPPattern, element: SVGElement): void {
    const set = (name: string, value: string | number | null) => {
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, String(value));
    };
    const units = (u: PatternUnits) =>
      u === PatternUnits.UNITS_USERSPACEONUSE ? 'userSpaceOnUse' : 'objectBoundingBox';
    set('patternUnits', units(pattern.patternUnits()));
    set('patternContentUnits', units(pattern.patternContentUnits()));
    set('x', pattern.x());
    set('y', pattern.y());
    set('width', pattern.width());
    set('height', pattern.height());
    const vb = pattern.viewbox();
    set('viewBox', vb ? `${vb.left()} ${vb.top()} ${vb.width()} ${vb.height()}` : null);
    set('preserveAspectRatio', pattern.preserveAspectRatio());
    set('patternTransform', matrixString(pattern.getTransform()));
    // The content inherits the style of the root pattern (upstream: the SPStyle cascade), e.g. the
    // fill that the pattern editor sets on content without a fill.
    const fill = [pattern, pattern.rootPattern()].map((p) => p.style.fill).find((f) => f.set && f.isColor());
    set('fill', fill ? fill.getColor().toString(false) : null);

    const mirror = this.#mirrors.get(pattern);
    const root = pattern.rootPattern();
    const children = root.children.filter((c): c is SPItem => c instanceof SPItem);
    const shown = mirror?.shown;
    if (!mirror || !this.drawing) return;
    if (
      shown &&
      shown.root === root &&
      shown.children.length === children.length &&
      shown.children.every((c, i) => c === children[i])
    ) {
      return;
    }
    this.#hideContent(mirror);
    const key = SPItem.displayKeyNew(1);
    mirror.key = key;
    mirror.shown = { root, children };
    for (const child of children) {
      const ac = child.invokeShow(this.drawing, key, SP_ITEM_SHOW_DISPLAY) as SvgDrawingItem | null;
      if (ac) element.append(ac.element);
    }
  }

  #hideContent(mirror: Mirror): void {
    if (mirror.shown && mirror.key !== undefined) {
      for (const child of mirror.shown.children) child.invokeHide(mirror.key);
    }
    mirror.shown = undefined;
    mirror.key = undefined;
  }
}

/** The largest side of the image of a mesh, in pixels. */
const MESH_IMAGE_SIZE = 512;

/** Write the mesh mirror: a pattern with the rasterized patches in the middle of the tile. */
function renderMesh(mesh: SPMeshGradient, element: SVGElement): void {
  const patches = mesh.getGradientPatches();
  const bounds = meshBounds(patches);
  const doc = element.ownerDocument;
  element.replaceChildren();
  if (!bounds || bounds.width() <= 0 || bounds.height() <= 0) return;
  const units =
    mesh.getUnits() === SPGradientUnits.SP_GRADIENT_UNITS_USERSPACEONUSE
      ? 'userSpaceOnUse'
      : 'objectBoundingBox';
  const w = bounds.width();
  const h = bounds.height();
  element.setAttribute('patternUnits', units);
  element.setAttribute('patternContentUnits', units);
  element.setAttribute('x', String(bounds.left() - w));
  element.setAttribute('y', String(bounds.top() - h));
  element.setAttribute('width', String(3 * w));
  element.setAttribute('height', String(3 * h));
  const transform = matrixString(mesh.getGradientTransform());
  if (transform) element.setAttribute('patternTransform', transform);
  else element.removeAttribute('patternTransform');
  const scale = MESH_IMAGE_SIZE / Math.max(w, h);
  const pw = Math.max(1, Math.ceil(w * scale));
  const ph = Math.max(1, Math.ceil(h * scale));
  const url = meshImageUrl(doc, rasterizeMesh(patches, bounds, pw, ph), pw, ph);
  if (!url) return;
  const image = doc.createElementNS(SVG_NS, 'image');
  image.setAttribute('href', url);
  // The content of a pattern is relative to the tile origin (x, y): the mesh is in the middle tile.
  image.setAttribute('x', String(w));
  image.setAttribute('y', String(h));
  image.setAttribute('width', String(w));
  image.setAttribute('height', String(h));
  image.setAttribute('preserveAspectRatio', 'none');
  element.append(image);
}

/** The bounding box of the control points of the patches. */
function meshBounds(patches: SPGradientPatch[][]): Rect | null {
  let r: Rect | null = null;
  for (const row of patches) {
    for (const patch of row) {
      for (const side of patch.points) {
        for (const p of side) r = r ? r.expandTo(p) : new Rect(p, p);
      }
    }
  }
  return r;
}

/** A PNG data URL of the pixels, or null without a canvas (e.g. in tests). */
function meshImageUrl(
  doc: Document,
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): string | null {
  const canvas = doc.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return null;
  const data = ctx.createImageData(width, height);
  data.data.set(pixels);
  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL('image/png');
}

/** The cubic Bernstein polynomials at t. */
function bernstein(t: number): [number, number, number, number] {
  const s = 1 - t;
  return [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t];
}

/** The 4 × 4 control points of a patch, P[row][column], row 0 at the top (side 0). */
function controlGrid(patch: SPGradientPatch): Point[][] {
  const [s0, s1, s2, s3] = patch.points as [Point[], Point[], Point[], Point[]];
  const t = patch.tensorpoints as [Point, Point, Point, Point];
  return [
    [s0[0], s0[1], s0[2], s0[3]] as Point[],
    [s3[2], t[0], t[1], s1[1]] as Point[],
    [s3[1], t[3], t[2], s1[2]] as Point[],
    [s2[3], s2[2], s2[1], s2[0]] as Point[],
  ];
}

/** The RGBA channels (0..255) of a corner color; black for a missing one. */
function channels(c: SPGradientPatch['color'][number]): [number, number, number, number] {
  const rgba = c ? c.toRGBA() >>> 0 : 0x000000ff;
  return [(rgba >>> 24) & 0xff, (rgba >>> 16) & 0xff, (rgba >>> 8) & 0xff, rgba & 0xff];
}

/**
 * Rasterize the patches of a mesh into width × height RGBA pixels that cover bounds (upstream:
 * cairo mesh patterns). Each patch is a tensor-product Bézier surface; it is cut into a grid of
 * small quads whose triangles are filled with the bilinear corner colors (Gouraud shading).
 */
export function rasterizeMesh(
  patches: SPGradientPatch[][],
  bounds: Rect,
  width: number,
  height: number,
  subdivisions = 24,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  const sx = width / bounds.width();
  const sy = height / bounds.height();
  const n = subdivisions;
  for (const row of patches) {
    for (const patch of row) {
      const P = controlGrid(patch);
      const c = patch.color.map(channels) as [number, number, number, number][];
      // The surface points and colors on an (n+1) × (n+1) grid of (u, v).
      const pts: { x: number; y: number; c: number[] }[] = [];
      for (let iv = 0; iv <= n; iv++) {
        const v = iv / n;
        const bv = bernstein(v);
        for (let iu = 0; iu <= n; iu++) {
          const u = iu / n;
          const bu = bernstein(u);
          let x = 0;
          let y = 0;
          for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
              const w = (bv[i] as number) * (bu[j] as number);
              const p = (P[i] as Point[])[j] as Point;
              x += w * p.x;
              y += w * p.y;
            }
          }
          // corners: 0 (u=0,v=0), 1 (1,0), 2 (1,1), 3 (0,1)
          const color = [0, 1, 2, 3].map(
            (k) =>
              (1 - u) * (1 - v) * (c[0] as number[])[k]! +
              u * (1 - v) * (c[1] as number[])[k]! +
              u * v * (c[2] as number[])[k]! +
              (1 - u) * v * (c[3] as number[])[k]!,
          );
          pts.push({ x: (x - bounds.left()) * sx, y: (y - bounds.top()) * sy, c: color });
        }
      }
      for (let iv = 0; iv < n; iv++) {
        for (let iu = 0; iu < n; iu++) {
          const a = pts[iv * (n + 1) + iu]!;
          const b = pts[iv * (n + 1) + iu + 1]!;
          const d = pts[(iv + 1) * (n + 1) + iu]!;
          const e = pts[(iv + 1) * (n + 1) + iu + 1]!;
          fillTriangle(out, width, height, a, b, e);
          fillTriangle(out, width, height, a, e, d);
        }
      }
    }
  }
  return out;
}

/** Fill a triangle with interpolated colors; pixels are hit at their centers (with a small tolerance against seams). */
function fillTriangle(
  out: Uint8ClampedArray,
  width: number,
  height: number,
  a: { x: number; y: number; c: number[] },
  b: { x: number; y: number; c: number[] },
  c: { x: number; y: number; c: number[] },
): void {
  const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  if (Math.abs(area) < 1e-12) return;
  const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
  const x1 = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
  const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
  const y1 = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
  const eps = -1e-3;
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const x = px + 0.5;
      const y = py + 0.5;
      const w0 = ((b.x - x) * (c.y - y) - (c.x - x) * (b.y - y)) / area;
      const w1 = ((c.x - x) * (a.y - y) - (a.x - x) * (c.y - y)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < eps || w1 < eps || w2 < eps) continue;
      const o = (py * width + px) * 4;
      for (let k = 0; k < 4; k++) out[o + k] = w0 * a.c[k]! + w1 * b.c[k]! + w2 * c.c[k]!;
    }
  }
}
