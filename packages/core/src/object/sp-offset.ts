// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-offset.cpp, src/object/sp-offset.h
/*
 * Offset objects: a source path and a radius.
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Johan Engelen
 *   Abhishek Sharma
 *
 * Copyright (C) 1999-2008 authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { type Path, type PathVector, Point } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import type { SPDocument } from '../document.ts';
import { _ } from '../i18n.ts';
import { FillRule, pathBoolopBackend } from '../path/path-boolop.ts';
import { Preferences } from '../preferences.ts';
import { SPWindRule } from '../style-enums.ts';
import { parseNumberWithUnit } from '../svg/svg-length.ts';
import { sp_svg_read_pathv, sp_svg_write_path } from '../svg/svg-path.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import type { SPItem } from './sp-item.ts';
import {
  SP_OBJECT_CHILD_MODIFIED_FLAG,
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_STYLE_MODIFIED_FLAG,
  SP_OBJECT_VIEWPORT_MODIFIED_FLAG,
  SP_OBJECT_WRITE_BUILD,
  SP_OBJECT_WRITE_EXT,
  type SPCtx,
} from './sp-object.ts';
import { SP_SHAPE_WRITE_PATH, SPShape } from './sp-shape.ts';
import { SPUseReference } from './sp-use-reference.ts';

/** Values of /options/cloneorphans/value. */
const SP_CLONE_ORPHANS_UNLINK = 0;
const SP_CLONE_ORPHANS_DELETE = 2;

/**
 * An offset (<path sodipodi:type="inkscape:offset">, upstream SPOffset): an original path in the
 * attribute inkscape:original and the radius in inkscape:radius. A linked offset also has an
 * xlink:href to its source object and rebuilds the original when the source changes. The offset is
 * computed in set_shape(). TODO: the clone compensation when the source moves.
 */
export class SPOffset extends SPShape {
  /** SVG description of the source path. */
  original: string | null = null;
  /** The source path. */
  originalPath: PathVector | null = null;
  /** Offset radius. */
  rad = 1.0;
  /** For interactive setting of the radius. */
  knotSet = false;
  knot = new Point(0, 0);
  sourceDirty = false;
  isUpdating = false;
  sourceHref: string | null = null;
  readonly sourceRef: SPUseReference;
  sourceObject: SPItem | null = null;
  #listeners: (() => void)[] = [];

  constructor() {
    super();
    this.sourceRef = new SPUseReference(this);
    this.sourceRef.changedSignal.connect(() => this.#hrefChanged());
  }

  override typeName(): string {
    return 'offset';
  }
  override displayName(): string {
    return this.sourceHref ? _('Linked Offset') : _('Dynamic Offset');
  }
  override description(): string {
    // TRANSLATORS COMMENT: %s is either "outset" or "inset" depending on sign
    return _('%s by %f pt')
      .replace('%s', this.rad >= 0 ? _('outset') : _('inset'))
      .replace('%f', Math.abs(this.rad).toFixed(6));
  }

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    // Old files had sodipodi:radius, sodipodi:original and inkscape:href.
    if (repr.attribute('inkscape:radius') === null) {
      this.setAttribute('inkscape:radius', repr.attribute('sodipodi:radius'));
      this.removeAttribute('sodipodi:radius');
    }
    this.readAttr(SPAttr.INKSCAPE_RADIUS);
    if (repr.attribute('inkscape:original') === null) {
      this.setAttribute('inkscape:original', repr.attribute('sodipodi:original'));
      this.removeAttribute('sodipodi:original');
    }
    this.readAttr(SPAttr.INKSCAPE_ORIGINAL);
    if (repr.attribute('xlink:href') === null) {
      const old = repr.attribute('inkscape:href');
      if (old) {
        this.setAttribute('xlink:href', `#${old}`);
        this.removeAttribute('inkscape:href');
      }
    }
    this.readAttr(SPAttr.XLINK_HREF);
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) repr = xmlDoc.createElement('svg:path');
    if (!repr) return null;
    if (flags & SP_OBJECT_WRITE_EXT) {
      repr.setAttribute('sodipodi:type', 'inkscape:offset');
      repr.setAttributeSvgDouble('inkscape:radius', this.rad);
      repr.setAttribute('inkscape:original', this.original);
      repr.setAttribute('inkscape:href', this.sourceHref);
    }
    // Make sure the offset has curve
    if (!this._curve) this.set_shape();
    // write that curve to "d"
    if (this._curve) repr.setAttribute('d', sp_svg_write_path(this._curve));
    return super.write(xmlDoc, repr, flags | SP_SHAPE_WRITE_PATH);
  }

  protected override release(): void {
    this.original = null;
    this.originalPath = null;
    this.#quitListening();
    this.sourceHref = null;
    this.sourceRef.detach();
    super.release();
  }

  override set(key: SPAttr, value: string | null): void {
    if (this.sourceDirty) this.#refreshSource();
    switch (key) {
      case SPAttr.INKSCAPE_ORIGINAL:
      case SPAttr.SODIPODI_ORIGINAL:
        if (value !== null) {
          this.original = value;
          this.originalPath = sp_svg_read_pathv(value);
          this.knotSet = false;
          if (!this.isUpdating) this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        }
        break;
      case SPAttr.INKSCAPE_RADIUS:
      case SPAttr.SODIPODI_RADIUS: {
        const v = parseNumberWithUnit(value, true);
        if (v) this.rad = v.computed;
        else if (Math.abs(this.rad) < 0.01) this.rad = this.rad < 0 ? -0.01 : 0.01;
        this.knotSet = false; // knotset=false because it's not set from the context
        if (!this.isUpdating) this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      }
      case SPAttr.INKSCAPE_HREF:
      case SPAttr.XLINK_HREF:
        if (value === null) {
          this.#quitListening();
          this.sourceHref = null;
          this.sourceRef.detach();
        } else if (value !== this.sourceHref) {
          this.sourceHref = value;
          try {
            this.sourceRef.attach(value);
          } catch (e) {
            console.warn(String(e));
            this.sourceRef.detach();
          }
        }
        break;
      default:
        super.set(key, value);
        break;
    }
  }

  protected override update(ctx: SPCtx, flags: number): void {
    this.isUpdating = true; // prevent set() from requesting updates
    if (this.sourceDirty) this.#refreshSource();
    if (
      flags &
      (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_STYLE_MODIFIED_FLAG | SP_OBJECT_VIEWPORT_MODIFIED_FLAG)
    ) {
      this.set_shape();
    }
    this.isUpdating = false;
    super.update(ctx, flags);
  }

  /** Compute the offset of the original by the radius. */
  override set_shape(): void {
    if (!this.originalPath) return; // oops : no path?! (the offset object should do harakiri)
    if (Math.abs(this.rad) < 0.01) {
      // grosso modo: 0: the source is the offset, no one will notice
      const res_d = this.getRepr().attribute('inkscape:original');
      if (res_d) {
        this.setCurveInsync(sp_svg_read_pathv(res_d));
        this.setCurveBeforeLPE(this.curve());
      }
      return;
    }
    if (Math.abs(this.rad) < 0.01) this.rad = this.rad < 0 ? -0.01 : 0.01;

    let size = 0;
    const bbox = this.documentVisualBounds();
    if (bbox) {
      size = Math.hypot(bbox.width(), bbox.height());
      const exp = this.transform.descrim();
      if (exp !== 0) size /= exp;
    }
    const d = pathBoolopBackend().offsetOriginal(sp_svg_write_path(this.originalPath), this.rad, size);
    // Nothing left: a point.
    const result = d ? sp_svg_read_pathv(d) : sp_svg_read_pathv('M 0 0 L 0 0 z');
    this.setCurveInsync(
      result.length && result.some((p: Path) => p.size() > 0) ? result : sp_svg_read_pathv('M 0 0 L 0 0 z'),
    );
    this.setCurveBeforeLPE(this.curve());
  }

  #startListening(to: SPItem | null): void {
    if (!to) return;
    this.sourceObject = to;
    const dirty = (flags: number) => {
      this.sourceDirty = true;
      if (flags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG)) {
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
      }
    };
    this.#listeners = [
      to.deleteSignal.connect(() => this.#deleteSelf()),
      to.transformedSignal.connect(() => {
        this.sourceDirty = true;
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
      }),
      to.modifiedSignal.connect((_o, flags) => dirty(flags)),
    ];
  }

  #quitListening(): void {
    if (!this.sourceObject) return;
    for (const f of this.#listeners) f();
    this.#listeners = [];
    this.sourceObject = null;
  }

  #hrefChanged(): void {
    this.#quitListening();
    this.#startListening(this.sourceRef.getObject());
    this.sourceDirty = true;
    this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
  }

  /** The source was deleted: forget it (/options/cloneorphans/value) or delete the offset. */
  #deleteSelf(): void {
    const mode = Preferences.get().getInt('/options/cloneorphans/value', SP_CLONE_ORPHANS_UNLINK);
    if (mode === SP_CLONE_ORPHANS_UNLINK) {
      // leave it be. just forget about the source
      this.#quitListening();
      this.sourceHref = null;
      this.sourceRef.detach();
    } else if (mode === SP_CLONE_ORPHANS_DELETE) {
      this.deleteObject();
    }
  }

  /** Rebuild the original from the source object: its outline with its transform (upstream refresh_offset_source). */
  #refreshSource(): void {
    this.sourceDirty = false;
    const item = this.sourceObject;
    if (!item || !(item instanceof SPShape)) return;
    const curve = item.curve();
    if (!curve) return;
    const transformed = item.transform.isIdentity() ? curve : curve.map((p) => p.transformed(item.transform));
    const rule =
      item.style.fill_rule.computed === SPWindRule.SP_WIND_RULE_EVENODD
        ? FillRule.fill_oddEven
        : FillRule.fill_nonZero;
    const d = pathBoolopBackend().normalizeShape(sp_svg_write_path(transformed), rule);
    this.setAttribute('inkscape:original', d);
  }
}

/** The source of a linked offset, or null. */
export function sp_offset_get_source(offset: SPOffset): SPItem | null {
  return offset.sourceRef.getObject();
}

/**
 * Distance of the point (item coordinates) to the original path; the sign is the radius that an
 * offset to the point would have (outset positive, inset negative; upstream
 * sp_offset_distance_to_original). 1 if there is no original.
 */
export function sp_offset_distance_to_original(offset: SPOffset, px: Point): number {
  const original = offset.originalPath;
  if (!original?.some((p) => p.size() > 0)) return 1.0;
  // The distance to the polygon of the original; the winding says if the point is inside.
  let dist = Number.POSITIVE_INFINITY;
  let winding = 0;
  for (const path of original) {
    const n = 64;
    const points: Point[] = [];
    for (const curve of path.curves()) for (let i = 0; i < n; i++) points.push(curve.pointAt(i / n));
    if (!points.length) continue;
    for (let i = 0; i < points.length; i++) {
      const a = points[i] as Point;
      const b = points[(i + 1) % points.length] as Point;
      const ab = b.sub(a);
      const len2 = ab.x * ab.x + ab.y * ab.y;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px.sub(a).x * ab.x + px.sub(a).y * ab.y) / len2));
      dist = Math.min(dist, px.sub(a.add(ab.mul(t))).length());
      // crossing number for the winding of a point
      if (a.y <= px.y) {
        if (b.y > px.y && ab.x * (px.y - a.y) - ab.y * (px.x - a.x) > 0) winding++;
      } else if (b.y <= px.y && ab.x * (px.y - a.y) - ab.y * (px.x - a.x) < 0) winding--;
    }
  }
  return winding !== 0 ? -dist : dist;
}

/** The top point of the offset: where its knot sits (upstream sp_offset_top_point). */
export function sp_offset_top_point(offset: SPOffset): Point | null {
  if (offset.knotSet) return offset.knot;
  const curve = offset.curve();
  if (!curve) return null;
  let top: Point | null = null;
  for (const path of curve) {
    for (const curveSegment of path.curves()) {
      for (let i = 0; i <= 16; i++) {
        const p = curveSegment.pointAt(i / 16);
        if (!top || p.y < top.y || (p.y === top.y && p.x < top.x)) top = p;
      }
    }
  }
  return top;
}
