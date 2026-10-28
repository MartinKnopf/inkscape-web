// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-guide.cpp, src/object/sp-guide.h
/*
 * Inkscape guideline implementation
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Peter Moulder <pmoulder@mail.csse.monash.edu.au>
 *   Johan Engelen
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2000-2002 authors
 * Copyright (C) 2004 Monash University
 * Copyright (C) 2007 Johan Engelen
 */
import { are_near, Point, rot90 } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import { Color } from '../colors/color.ts';
import type { SPDocument } from '../document.ts';
import { DocumentUndo } from '../document-undo.ts';
import { _, C_ } from '../i18n.ts';
import { svgNumber } from '../svg/stringstream.ts';
import { convertUnit, formatNumber, spSvgNumberReadD } from '../svg/svg-length.ts';
import type { Node } from '../xml/node.ts';
import { SPObject } from './sp-object.ts';

/**
 * A view of a guide on a canvas (upstream CanvasItemGuideLine, which lives in
 * the editor). SPGuide forwards its state to its views.
 */
export interface GuideView {
  set_origin(origin: Point): void;
  set_normal(normal: Point): void;
  set_stroke(rgba: number): void;
  set_locked(locked: boolean): void;
  set_label(label: string): void;
  set_visible(visible: boolean): void;
}

/** Write a point attribute like upstream Node::setAttributePoint ("x,y"). */
function setAttributePoint(repr: Node, name: string, p: Point): void {
  repr.setAttribute(name, `${svgNumber(p.x)},${svgNumber(p.y)}`);
}

/** Read "x,y" (upstream g_strsplit + sp_svg_number_read_d); the numbers that could be read. */
function readPair(value: string): number[] {
  return value
    .split(',', 2)
    .map((s) => spSvgNumberReadD(s))
    .filter((v): v is number => v !== null);
}

/**
 * A guide line (sodipodi:guide in the namedview): a line through
 * point_on_line, perpendicular to normal_to_line, in desktop coordinates.
 * The file stores the position in viewBox units with the y axis pointing up
 * (upstream "<sodipodi:guide> stores inverted y-axis coordinates").
 */
export class SPGuide extends SPObject {
  locked = false;
  normal_to_line = new Point(0, 1);
  point_on_line = new Point(0, 0);
  color = 0x0086e599;
  hicolor = 0xff00007f;
  /** The canvas items that show this guide (one per desktop). */
  views: GuideView[] = [];

  setColor(color: number): void {
    this.color = color;
    for (const view of this.views) view.set_stroke(color);
  }
  setHiColor(color: number): void {
    this.hicolor = color;
  }
  getColor(): number {
    return this.color;
  }
  getHiColor(): number {
    return this.hicolor;
  }

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.INKSCAPE_COLOR);
    this.readAttr(SPAttr.INKSCAPE_LABEL);
    this.readAttr(SPAttr.INKSCAPE_LOCKED);
    this.readAttr(SPAttr.ORIENTATION);
    this.readAttr(SPAttr.POSITION);
  }

  protected override release(): void {
    this.views = [];
    super.release();
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.INKSCAPE_COLOR: {
        const c = Color.parse(value);
        if (c) {
          if (!c.hasOpacity()) c.addOpacity(0.5);
          this.setColor(c.toRGBA());
        }
        break;
      }
      case SPAttr.INKSCAPE_LABEL:
        super.set(key, value); // label()
        this.set_label(value, false);
        break;
      case SPAttr.INKSCAPE_LOCKED:
        if (value) this.set_locked(/^(true|yes|y|[1-9])/i.test(value), false);
        break;
      case SPAttr.ORIENTATION: {
        if (value === 'horizontal') {
          /* Visual representation of a horizontal line, constrain vertically (y coordinate). */
          this.normal_to_line = new Point(0, 1);
        } else if (value === 'vertical') {
          this.normal_to_line = new Point(1, 0);
        } else if (value) {
          const v = readPair(value);
          const [newx, newy] = v;
          if (
            v.length === 2 &&
            newx !== undefined &&
            newy !== undefined &&
            (Math.abs(newx) > 1e-6 || Math.abs(newy) > 1e-6)
          ) {
            let direction = new Point(newx, newy);
            // <sodipodi:guide> stores inverted y-axis coordinates
            if (this.#yaxisdown()) direction = new Point(-direction.x, direction.y);
            this.normal_to_line = direction.normalized();
          } else {
            // default to vertical line for bad arguments
            this.normal_to_line = new Point(1, 0);
          }
        } else {
          // default to vertical line for bad arguments
          this.normal_to_line = new Point(1, 0);
        }
        this.set_normal(this.normal_to_line, false);
        break;
      }
      case SPAttr.POSITION: {
        if (value) {
          const v = readPair(value);
          let [newx = 0, newy = 0] = v;
          if (v.length === 2) {
            // If root viewBox set, interpret guides in terms of viewBox (90/96)
            const root = this.document.getRoot();
            if (root.viewBox_set && root.width.computed && root.height.computed) {
              const vb = root.viewBox;
              if (are_near((root.width.computed * vb.height()) / (vb.width() * root.height.computed), 1.0)) {
                // for uniform scaling, try to reduce numerical error
                const vbunit2px =
                  (root.width.computed / vb.width() + root.height.computed / vb.height()) / 2.0;
                newx *= vbunit2px;
                newy *= vbunit2px;
              } else {
                newx *= root.width.computed / vb.width();
                newy *= root.height.computed / vb.height();
              }
            }
            this.point_on_line = new Point(newx, newy);
          } else if (v.length === 1) {
            // before 0.46 style guideline definition.
            this.point_on_line =
              this.repr.attribute('orientation') === 'horizontal' ? new Point(0, newx) : new Point(newx, 0);
          }
          // <sodipodi:guide> stores inverted y-axis coordinates
          if (this.#yaxisdown()) {
            this.point_on_line = new Point(
              this.point_on_line.x,
              this.document.getDimensions().y - this.point_on_line.y,
            );
          }
        } else {
          // default to (0,0) for bad arguments
          this.point_on_line = new Point(0, 0);
        }
        // update position in non-committing way
        this.moveto(this.point_on_line, false);
        break;
      }
      default:
        super.set(key, value);
        break;
    }
  }

  #yaxisdown(): boolean {
    return this.document.yaxisdir() > 0;
  }

  /**
   * Create a guide through pt1 and pt2 (desktop coordinates) in the namedview
   * of doc and return it.
   */
  static createSPGuide(doc: SPDocument, pt1: Point, pt2: Point): SPGuide | null {
    const repr = doc.getReprDoc().createElement('sodipodi:guide');
    let n = rot90(pt2.sub(pt1));
    // If root viewBox set, interpret guides in terms of viewBox (90/96)
    let newx = pt1.x;
    let newy = pt1.y;
    const root = doc.getRoot();
    // <sodipodi:guide> stores inverted y-axis coordinates
    if (doc.yaxisdir() > 0) {
      newy = doc.getDimensions().y - newy;
      n = new Point(-n.x, n.y);
    }
    if (root.viewBox_set) {
      const vb = root.viewBox;
      // check to see if scaling is uniform
      if (are_near((vb.width() * root.height.computed) / (root.width.computed * vb.height()), 1.0)) {
        const px2vbunit = (vb.width() / root.width.computed + vb.height() / root.height.computed) / 2.0;
        newx *= px2vbunit;
        newy *= px2vbunit;
      } else {
        newx *= vb.width() / root.width.computed;
        newy *= vb.height() / root.height.computed;
      }
    }
    setAttributePoint(repr, 'position', new Point(newx, newy));
    setAttributePoint(repr, 'orientation', n);
    const namedview = doc.getNamedView();
    if (namedview.lockguides.value) repr.setAttribute('inkscape:locked', 'true');
    namedview.getRepr().appendChild(repr);
    const guide = doc.getObjectByRepr(repr);
    return guide instanceof SPGuide ? guide : null;
  }

  /** A new guide at the same place. */
  duplicate(): SPGuide | null {
    return SPGuide.createSPGuide(
      this.document,
      this.point_on_line,
      new Point(this.point_on_line.x + this.normal_to_line.y, this.point_on_line.y - this.normal_to_line.x),
    );
  }

  getPoint(): Point {
    return this.point_on_line;
  }
  getNormal(): Point {
    return this.normal_to_line;
  }
  getLocked(): boolean {
    return this.locked;
  }
  /** The angle of the line (the direction perpendicular to the normal), in radians. */
  angle(): number {
    return Math.atan2(-this.normal_to_line.x, this.normal_to_line.y);
  }
  isHorizontal(): boolean {
    return this.normal_to_line.x === 0;
  }
  isVertical(): boolean {
    return this.normal_to_line.y === 0;
  }

  /**
   * Move the guide. commit false: a temporary move while dragging (only the
   * views follow); true: write the position to the repr.
   */
  moveto(point_on_line: Point, commit: boolean): void {
    if (this.locked) return;
    for (const view of this.views) view.set_origin(point_on_line);
    if (commit) {
      let newx = point_on_line.x;
      let newy = point_on_line.y;
      // <sodipodi:guide> stores inverted y-axis coordinates
      if (this.#yaxisdown()) newy = this.document.getDimensions().y - newy;
      // If root viewBox set, interpret guides in terms of viewBox (90/96)
      const root = this.document.getRoot();
      if (root.viewBox_set) {
        const vb = root.viewBox;
        // check to see if scaling is uniform
        if (are_near((vb.width() * root.height.computed) / (root.width.computed * vb.height()), 1.0)) {
          const px2vbunit = (vb.width() / root.width.computed + vb.height() / root.height.computed) / 2.0;
          newx *= px2vbunit;
          newy *= px2vbunit;
        } else {
          newx *= vb.width() / root.width.computed;
          newy *= vb.height() / root.height.computed;
        }
      }
      setAttributePoint(this.repr, 'position', new Point(newx, newy));
    }
  }

  /** Set the normal; commit as for moveto(). */
  set_normal(normal_to_line: Point, commit: boolean): void {
    if (this.locked) return;
    for (const view of this.views) view.set_normal(normal_to_line);
    if (commit) {
      // <sodipodi:guide> stores inverted y-axis coordinates
      const normal = this.#yaxisdown() ? new Point(-normal_to_line.x, normal_to_line.y) : normal_to_line;
      setAttributePoint(this.repr, 'orientation', normal);
    }
  }

  set_color(r: number, g: number, b: number, commit: boolean): void {
    this.color = ((r << 24) | (g << 16) | (b << 8) | 0x7f) >>> 0;
    this.views[0]?.set_stroke(this.color);
    if (commit) this.setAttribute('inkscape:color', `rgb(${r},${g},${b})`);
  }

  set_locked(locked: boolean, commit: boolean): void {
    this.locked = locked;
    this.views[0]?.set_locked(locked);
    if (commit) this.setAttribute('inkscape:locked', locked ? 'true' : 'false');
  }

  set_label(label: string | null, commit: boolean): void {
    this.views[0]?.set_label(label ?? '');
    if (commit) this.setAttribute('inkscape:label', label);
  }

  /**
   * A human-readable description of the guideline for use in dialog boxes and status bar.
   * If verbose is false, only positioning information is included (useful for dialogs).
   */
  description(verbose = true): string {
    if (!this.document) return _('Deleted');
    const units = this.document.getNamedView().getDisplayUnit();
    const quantity = (px: number) => `${formatNumber(convertUnit(px, 'px', units), 2)} ${units}`;
    const position_string_x = quantity(this.point_on_line.x);
    const position_string_y = quantity(this.point_on_line.y);
    const shortcuts = `; ${_(
      "<b>Shift+drag</b> to rotate, <b>Ctrl+drag</b> to move origin, <b>Del</b> to delete; <b>double-click</b> to edit this guide's properties",
    )}`;
    const n = this.normal_to_line;
    let descr: string;
    if (are_near(n, new Point(1, 0)) || are_near(n, new Point(-1, 0))) {
      descr = _('vertical, at %s').replace('%s', position_string_x);
    } else if (are_near(n, new Point(0, 1)) || are_near(n, new Point(0, -1))) {
      descr = _('horizontal, at %s').replace('%s', position_string_y);
    } else {
      const degrees_int = Math.round((this.angle() * 180) / Math.PI);
      descr = _('at %d degrees, through (%s,%s)')
        .replace('%d', String(degrees_int))
        .replace('%s', position_string_x)
        .replace('%s', position_string_y);
    }
    return verbose ? descr + shortcuts : descr;
  }

  /** Remove the guide from the document (not if locked, unless force). */
  remove(force = false): boolean {
    if (this.locked && !force) return false;
    this.repr.parent()?.removeChild(this.repr);
    return true;
  }
}

/** Create guides along the borders of the page (upstream sp_guide_create_guides_around_page). */
export function sp_guide_create_guides_around_page(doc: SPDocument): void {
  const bounds = doc.pageBounds();
  for (let i = 0; i < 4; i++) SPGuide.createSPGuide(doc, bounds.corner(i), bounds.corner((i + 1) % 4));
  DocumentUndo.done(doc, C_('Undo', 'Create Guides Around the Current Page'), '');
}

/** Delete all guides of the document (upstream sp_guide_delete_all_guides). */
export function sp_guide_delete_all_guides(doc: SPDocument): void {
  for (const guide of [...doc.getNamedView().guides]) guide.remove(true);
  DocumentUndo.done(doc, C_('Undo', 'Delete All Guides'), '');
}
