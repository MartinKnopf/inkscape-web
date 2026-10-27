// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-root.cpp, src/object/sp-root.h
/*
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 1999-2002 authors
 * Copyright (C) 2000-2001 Ximian, Inc.
 */
import { Affine, Rect } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import type { Drawing, DrawingGroup, DrawingItem } from '../display/drawing.ts';
import type { SPDocument } from '../document.ts';
import { SVGLength, SVGLengthUnit } from '../svg/svg-length.ts';
import type { Node } from '../xml/node.ts';
import { SPDefs } from './sp-defs.ts';
import type { SPItemCtx } from './sp-item.ts';
import { SPGroup } from './sp-item-group.ts';
import { SP_OBJECT_MODIFIED_FLAG, SP_OBJECT_VIEWPORT_MODIFIED_FLAG, type SPCtx } from './sp-object.ts';
import { SPViewBox } from './viewbox.ts';

const SVG_VERSION = '1.1';

/**
 * The svg:svg root element (upstream SPRoot, with the SPViewBox and
 * SPDimensions parts that the root uses).
 * TODO: versions, onload, write() of the size and viewBox, nested svg, the
 * document display unit (scale_none in update), namedview updateViewPort.
 */
export class SPRoot extends SPGroup {
  /** viewBox, preserveAspectRatio and the child to parent transform (upstream base class SPViewBox). */
  readonly vb = new SPViewBox();
  // Upstream SPDimensions.
  x = new SVGLength();
  y = new SVGLength();
  width = new SVGLength();
  height = new SVGLength();
  /** Primary svg:defs, where new defs (gradients, patterns, …) go: the first defs child. */
  defs: SPDefs | null = null;

  constructor() {
    super();
    this.#unset_x_and_y();
    this.width.unset(SVGLengthUnit.PERCENT, 1.0, 1.0);
    this.height.unset(SVGLengthUnit.PERCENT, 1.0, 1.0);
  }

  /** Child to parent transform (viewBox and x/y), see SPViewBox. */
  get c2p(): Affine {
    return this.vb.c2p;
  }
  get viewBox_set(): boolean {
    return this.vb.viewBox_set;
  }
  get viewBox(): Rect {
    return this.vb.viewBox;
  }

  #unset_x_and_y(): void {
    this.x.unset(SVGLengthUnit.PERCENT, 0.0, 0.0); // Ignored for root SVG element
    this.y.unset(SVGLengthUnit.PERCENT, 0.0, 0.0);
  }

  protected override build(document: SPDocument, repr: Node): void {
    if (!repr.attribute('version')) repr.setAttribute('version', SVG_VERSION);
    // It is important to parse these here, so objects will have viewport build-time
    this.readAttr(SPAttr.X);
    this.readAttr(SPAttr.Y);
    this.readAttr(SPAttr.WIDTH);
    this.readAttr(SPAttr.HEIGHT);
    this.readAttr(SPAttr.VIEWBOX);
    this.readAttr(SPAttr.PRESERVEASPECTRATIO);
    super.build(document, repr);
    this.#findDefs();
    // clear transform, if any was read in - SVG does not allow transform= on <svg>
    this.transform = Affine.identity();
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.X:
        if (!this.x.read(value)) this.x.unset(SVGLengthUnit.PERCENT, 0.0, 0.0);
        break;
      case SPAttr.Y:
        if (!this.y.read(value)) this.y.unset(SVGLengthUnit.PERCENT, 0.0, 0.0);
        break;
      case SPAttr.WIDTH:
        if (!this.width.read(value) || !(this.width.computed > 0.0)) {
          this.width.unset(SVGLengthUnit.PERCENT, 1.0, 1.0);
        }
        break;
      case SPAttr.HEIGHT:
        if (!this.height.read(value) || !(this.height.computed > 0.0)) {
          this.height.unset(SVGLengthUnit.PERCENT, 1.0, 1.0);
        }
        break;
      case SPAttr.VIEWBOX:
        this.vb.set_viewBox(value);
        break;
      case SPAttr.PRESERVEASPECTRATIO:
        this.vb.set_preserveAspectRatio(value);
        break;
      default:
        super.set(key, value);
        return;
    }
    this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_VIEWPORT_MODIFIED_FLAG);
  }

  /**
   * Root size rules: no width/height means 100%; percentages are of the
   * viewBox size; without viewBox and size, 300×150 px. x and y are ignored.
   */
  setRootDimensions(): void {
    const { viewBox } = this.vb;
    if (this.vb.viewBox_set) {
      if (this.width._set) {
        if (this.width.unit === SVGLengthUnit.PERCENT)
          this.width.computed = this.width.value * viewBox.width();
      } else {
        this.width.set(SVGLengthUnit.PX, viewBox.width(), viewBox.width());
      }
      if (this.height._set) {
        if (this.height.unit === SVGLengthUnit.PERCENT) {
          this.height.computed = this.height.value * viewBox.height();
        }
      } else {
        this.height.set(SVGLengthUnit.PX, viewBox.height(), viewBox.height());
      }
    } else {
      if (!this.width._set || this.width.unit === SVGLengthUnit.PERCENT) {
        this.width.set(SVGLengthUnit.PX, 300, 300); // CSS/SVG default
      }
      if (!this.height._set || this.height.unit === SVGLengthUnit.PERCENT) {
        this.height.set(SVGLengthUnit.PX, 150, 150); // CSS/SVG default
      }
    }
    this.#unset_x_and_y();
  }

  protected override update(ctx: SPCtx, flags: number): void {
    const ictx = ctx as SPItemCtx;
    if (!this.parent) this.setRootDimensions();
    // Calculate x, y, width, height from parent/initial viewport (upstream calcDimsFromParentViewport)
    for (const [len, size] of [
      [this.x, ictx.viewport.width()],
      [this.y, ictx.viewport.height()],
      [this.width, ictx.viewport.width()],
      [this.height, ictx.viewport.height()],
    ] as const) {
      if (len.unit === SVGLengthUnit.PERCENT) len.computed = len.value * size;
    }
    // Calculate new viewport
    let rctx: SPItemCtx = {
      ...ictx,
      viewport: Rect.fromXywh(this.x.computed, this.y.computed, this.width.computed, this.height.computed),
    };
    // TODO: scale_none is Quantity::convert(1, document display unit, "px").
    rctx = this.vb.get_rctx(rctx, 1);
    super.update(rctx, flags);
    // As last step set additional transform of drawing group
    for (const v of this.views) (v.drawingitem as DrawingGroup).setChildTransform(this.c2p);
  }

  protected override show(drawing: Drawing, key: number, flags: number): DrawingItem {
    const ai = super.show(drawing, key, flags) as DrawingGroup;
    ai.setChildTransform(this.c2p);
    return ai;
  }

  protected override childAdded(child: Node, ref: Node | null): void {
    super.childAdded(child, ref);
    if (this.document.getObjectByRepr(child) instanceof SPDefs) this.#findDefs();
  }

  protected override removeChild(child: Node): void {
    const removed = this.getChildByRepr(child);
    super.removeChild(child);
    if (removed === this.defs) this.#findDefs();
  }

  #findDefs(): void {
    this.defs = (this.children.find((c) => c instanceof SPDefs) as SPDefs | undefined) ?? null;
  }
}
