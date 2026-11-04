// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-hatch-path.cpp, src/object/sp-hatch-path.h
/*
 * SVG <hatchPath> implementation
 *
 * Authors:
 *   Tomasz Boczkowski <penginsbacon@gmail.com>
 *   Jon A. Cruz <jon@joncruz.org>
 *
 * Copyright (C) 2014 Tomasz Boczkowski
 */
import { Interval, LineSegment, Path, type PathVector, Point, Translate } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import type { SPDocument } from '../document.ts';
import { pathvector_append, pathvector_append_continuous } from '../path/path-curve.ts';
import { SVGLength } from '../svg/svg-length.ts';
import { sp_svg_read_pathv } from '../svg/svg-path.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import { SP_OBJECT_MODIFIED_FLAG, SP_OBJECT_WRITE_BUILD, SPObject } from './sp-object.ts';

/**
 * svg:hatchpath (upstream SPHatchPath): one path of a hatch, repeated along the strip.
 * Upstream keeps a drawing item per view with the strip extents; here the renderers pass the
 * extents to calculateRenderCurve().
 */
export class SPHatchPath extends SPObject {
  readonly offset = new SVGLength();

  #curve: PathVector | null = null;
  #continuous = false;

  protected override build(doc: SPDocument, repr: Node): void {
    super.build(doc, repr);
    this.readAttr(SPAttr.D);
    this.readAttr(SPAttr.OFFSET);
    this.style.fill.setNone();
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.D:
        if (value) {
          const { pathv, continuous } = SPHatchPath._readHatchPathVector(value);
          this.#curve = pathv;
          this.#continuous = continuous;
        } else {
          this.#curve = null;
        }
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.OFFSET:
        this.offset.readOrUnset(value);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      default:
        super.set(key, value);
        break;
    }
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) repr = xmlDoc.createElement('svg:hatchpath');
    return super.write(xmlDoc, repr, flags);
  }

  /** The path as read from d (null without d: a vertical line). */
  curve(): PathVector | null {
    return this.#curve;
  }

  isValid(): boolean {
    return !this.#curve || this._repeatLength() > 0;
  }

  /** The horizontal extent of the path with its stroke, in hatch content units. */
  bounds(): Interval {
    const transform = Translate(this.offset.computed, 0);
    let left: number;
    let right: number;
    if (!this.#curve) {
      const test_curve = new LineSegment(new Point(0, 0), new Point(0, 1)).transformed(transform);
      const bbox = test_curve.boundsExact();
      left = bbox.left();
      right = bbox.right();
    } else {
      left = Number.POSITIVE_INFINITY;
      right = Number.NEGATIVE_INFINITY;
      for (const p of this.#curve) {
        const b = p.transformed(transform).boundsExact();
        if (b) {
          left = Math.min(left, b.left());
          right = Math.max(right, b.right());
        }
      }
    }
    const stroke_width = this.style.stroke_width.computed;
    return new Interval(left - stroke_width / 2, right + stroke_width / 2);
  }

  /**
   * The path repeated over the strip extents (upstream _calculateRenderCurve of the view with
   * these extents), without the offset translation.
   */
  calculateRenderCurve(extents: Interval | null): PathVector {
    if (!extents) return [];
    const calculated_curve: PathVector = [];
    if (!this.#curve) {
      const path = new Path(new Point(0, extents.min()));
      path.appendCurve(new LineSegment(new Point(0, extents.min()), new Point(0, extents.max())));
      calculated_curve.push(path);
      //TODO: if hatch has a dasharray defined, adjust line ends
    } else {
      const repeatLength = this._repeatLength();
      if (repeatLength > 0) {
        const initial_y = Math.floor(extents.min() / repeatLength) * repeatLength;
        const segment_cnt = Math.ceil(extents.extent() / repeatLength) + 1;

        let segment = this.#curve.map((p) => p.transformed(Translate(0, initial_y)));
        const step_transform = Translate(0, repeatLength);
        for (let i = 0; i < segment_cnt; ++i) {
          if (this.#continuous) pathvector_append_continuous(calculated_curve, segment);
          else pathvector_append(calculated_curve, segment);
          segment = segment.map((p) => p.transformed(step_transform));
        }
      }
    }
    return calculated_curve;
  }

  _repeatLength(): number {
    const last = this.#curve?.at(-1);
    return last && this.#curve!.length > 0 ? last.finalPoint().y : 0;
  }

  /** Read d: a path starting with M/m is not continuous; else it continues the previous repetition. */
  static _readHatchPathVector(str: string): { pathv: PathVector; continuous: boolean } {
    const s = str.replace(/^ +/, '');
    if (s.startsWith('M') || s.startsWith('m')) {
      // Hatch path is not continuous.
      return { pathv: sp_svg_read_pathv(str), continuous: false };
    }
    let pathv = sp_svg_read_pathv(`M0,0 ${str}`);
    if (pathv.length === 0) return { pathv, continuous: true };

    const last_point_x = pathv.at(-1)!.finalPoint().x;
    const pathv3 = sp_svg_read_pathv(`M${last_point_x},0 ${str}`);

    //Path can be composed of relative commands only. In this case final point
    //coordinates would depend on first point position. If this happens, fall
    //back to using 0,0 as first path point
    if (pathv3.length && pathv3.at(-1)!.finalPoint().y === pathv.at(-1)!.finalPoint().y) pathv = pathv3;
    return { pathv, continuous: true };
  }
}
