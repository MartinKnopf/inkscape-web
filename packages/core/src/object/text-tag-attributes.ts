// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/text-tag-attributes.h, src/object/sp-text.cpp TextTagAttributes
/*
 * Authors: see git history
 *
 * Copyright (C) 2018 Authors
 */
import { type Affine, Point, type Rect } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import {
  emptyOptionalTextTagAttrs,
  LengthAdjust,
  type OptionalTextTagAttrs,
} from '../libnrtype/Layout-TNG.ts';
import type { SPStyle } from '../style.ts';
import { SVGLength, spSvgLengthListRead } from '../svg/svg-length.ts';
import type { Node } from '../xml/node.ts';

function zeroLength(): SVGLength {
  const l = new SVGLength();
  l.assign(0);
  return l;
}

function lengthOf(v: number): SVGLength {
  const l = new SVGLength();
  l.assign(v);
  return l;
}

/**
 * The attributes x, y, dx, dy, rotate, textLength and lengthAdjust that
 * text, tspan, tref and textPath elements have in common (upstream
 * TextTagAttributes).
 */
export class TextTagAttributes {
  /** This holds the actual values. */
  attributes: OptionalTextTagAttrs = emptyOptionalTextTagAttrs();

  /**
   * Process the parameters from the set() function of SPObject.
   * Returns true if key was a recognised attribute.
   */
  readSingleAttribute(
    key: SPAttr,
    value: string | null,
    style: SPStyle | null,
    viewport: Rect | null,
  ): boolean {
    let field: 'x' | 'y' | 'dx' | 'dy' | 'rotate';
    let update_x = false;
    let update_y = false;
    switch (key) {
      case SPAttr.X:
        field = 'x';
        update_x = true;
        break;
      case SPAttr.Y:
        field = 'y';
        update_y = true;
        break;
      case SPAttr.DX:
        field = 'dx';
        update_x = true;
        break;
      case SPAttr.DY:
        field = 'dy';
        update_y = true;
        break;
      case SPAttr.ROTATE:
        field = 'rotate';
        break;
      case SPAttr.TEXTLENGTH:
        this.attributes.textLength.readOrUnset(value);
        return true;
      case SPAttr.LENGTHADJUST:
        this.attributes.lengthAdjust =
          value === 'spacingAndGlyphs'
            ? LengthAdjust.LENGTHADJUST_SPACINGANDGLYPHS
            : LengthAdjust.LENGTHADJUST_SPACING; // default is "spacing"
        return true;
      default:
        return false;
    }

    // FIXME: sp_svg_length_list_read() amalgamates repeated separators. This prevents unset values.
    const list = spSvgLengthListRead(value);
    this.attributes[field] = list;

    if ((update_x || update_y) && style && viewport) {
      const em = style.font_size.computed;
      const ex = em * 0.5;
      for (const it of list) {
        if (update_x) it.update(em, ex, viewport.width());
        if (update_y) it.update(em, ex, viewport.height());
      }
    }
    return true;
  }

  /** Write out all the contents of attributes to the given node. */
  writeTo(node: Node): void {
    writeSingleAttributeVector(node, 'x', this.attributes.x);
    writeSingleAttributeVector(node, 'y', this.attributes.y);
    writeSingleAttributeVector(node, 'dx', this.attributes.dx);
    writeSingleAttributeVector(node, 'dy', this.attributes.dy);
    writeSingleAttributeVector(node, 'rotate', this.attributes.rotate);

    const tl = this.attributes.textLength;
    node.setAttribute('textLength', tl._set ? tl.write() : null);
    if (tl._set) {
      node.setAttribute(
        'lengthAdjust',
        this.attributes.lengthAdjust === LengthAdjust.LENGTHADJUST_SPACINGANDGLYPHS
          ? 'spacingAndGlyphs'
          : 'spacing',
      );
    }
  }

  /** Update relative values. */
  update(em: number, ex: number, w: number, h: number): void {
    for (const it of this.attributes.x) it.update(em, ex, w);
    for (const it of this.attributes.y) it.update(em, ex, h);
    for (const it of this.attributes.dx) it.update(em, ex, w);
    for (const it of this.attributes.dy) it.update(em, ex, h);
  }

  /**
   * For tspan role=line elements we should not use the set x,y coordinates
   * since that would overrule the values calculated by the text layout
   * engine, however if there are more than one element in the x or y
   * vectors we can presume that the user set them and hence they should be
   * copied.
   */
  singleXYCoordinates(): boolean {
    return this.attributes.x.length <= 1 && this.attributes.y.length <= 1;
  }

  /** Returns false if all of the vectors are zero length. */
  anyAttributesSet(): boolean {
    const a = this.attributes;
    return !!(a.x.length || a.y.length || a.dx.length || a.dy.length || a.rotate.length);
  }

  /**
   * Overlay these attributes (the child's) on parent_attrs from
   * parent_attrs_offset per SVG 1.1 section 10.5 and write the result to
   * output. textLength is never merged with the parent.
   */
  mergeInto(
    output: OptionalTextTagAttrs,
    parent_attrs: OptionalTextTagAttrs,
    parent_attrs_offset: number,
    copy_xy: boolean,
    copy_dxdyrotate: boolean,
  ): void {
    const a = this.attributes;
    output.x = mergeSingleAttribute(parent_attrs.x, parent_attrs_offset, copy_xy ? a.x : null);
    output.y = mergeSingleAttribute(parent_attrs.y, parent_attrs_offset, copy_xy ? a.y : null);
    output.dx = mergeSingleAttribute(parent_attrs.dx, parent_attrs_offset, copy_dxdyrotate ? a.dx : null);
    output.dy = mergeSingleAttribute(parent_attrs.dy, parent_attrs_offset, copy_dxdyrotate ? a.dy : null);
    output.rotate = mergeSingleAttribute(
      parent_attrs.rotate,
      parent_attrs_offset,
      copy_dxdyrotate ? a.rotate : null,
    );
    if (a.textLength._set) {
      // only from current node, this is not inherited from parent
      output.textLength = a.textLength.copy();
      output.lengthAdjust = a.lengthAdjust;
    }
  }

  /** Delete n values from start_index (when deleting characters from the text). */
  erase(start_index: number, n: number): void {
    if (n === 0) return;
    const a = this.attributes;
    if (!this.singleXYCoordinates()) {
      eraseSingleAttribute(a.x, start_index, n);
      eraseSingleAttribute(a.y, start_index, n);
    }
    eraseSingleAttribute(a.dx, start_index, n);
    eraseSingleAttribute(a.dy, start_index, n);
    eraseSingleAttribute(a.rotate, start_index, n);
  }

  /**
   * Insert n new values at start_index (when inserting characters). Vectors
   * shorter than start_index are not extended. dx, dy and rotate get zeros,
   * x and y linearly interpolated values.
   */
  insert(start_index: number, n: number): void {
    if (n === 0) return;
    const a = this.attributes;
    if (!this.singleXYCoordinates()) {
      insertSingleAttribute(a.x, start_index, n, true);
      insertSingleAttribute(a.y, start_index, n, true);
    }
    insertSingleAttribute(a.dx, start_index, n, false);
    insertSingleAttribute(a.dy, start_index, n, false);
    insertSingleAttribute(a.rotate, start_index, n, false);
  }

  /** Divide the attributes at index: index..end go to second (when breaking lines). */
  split(index: number, second: TextTagAttributes): void {
    const a = this.attributes;
    const b = second.attributes;
    if (!this.singleXYCoordinates()) {
      b.x = splitSingleAttribute(a.x, index, false);
      b.y = splitSingleAttribute(a.y, index, false);
    }
    b.dx = splitSingleAttribute(a.dx, index, true);
    b.dy = splitSingleAttribute(a.dy, index, true);
    b.rotate = splitSingleAttribute(a.rotate, index, true);
  }

  /** Overwrite the attributes with first, then second from second_index. */
  join(first: TextTagAttributes, second: TextTagAttributes, second_index: number): void {
    const a = this.attributes;
    const f = first.attributes;
    const s = second.attributes;
    if (second.singleXYCoordinates()) {
      a.x = [...f.x];
      a.y = [...f.y];
    } else {
      a.x = joinSingleAttribute(f.x, s.x, second_index);
      a.y = joinSingleAttribute(f.y, s.y, second_index);
    }
    a.dx = joinSingleAttribute(f.dx, s.dx, second_index);
    a.dy = joinSingleAttribute(f.dy, s.dy, second_index);
    a.rotate = joinSingleAttribute(f.rotate, s.rotate, second_index);
  }

  /**
   * Apply matrix to the pairs of x and y coordinates and scale dx and dy.
   * With extend_zero_length, empty x or y vectors get one value to store the new position.
   */
  transform(matrix: Affine, scale_x: number, scale_y: number, extend_zero_length = false): void {
    const a = this.attributes;
    // Edge testcases for this code:
    // 1) moving text elements whose position is done entirely with transform="...", no x,y attributes
    // 2) unflowing multi-line flowtext then moving it (it has x but not y)
    let points_count = Math.max(a.x.length, a.y.length);
    if (extend_zero_length && points_count < 1) points_count = 1;
    for (let i = 0; i < points_count; i++) {
      const point = new Point(a.x[i]?.computed ?? 0, a.y[i]?.computed ?? 0).transformed(matrix);
      if (i < a.x.length) a.x[i] = lengthOf(point.x);
      else if (point.x !== 0 && extend_zero_length) {
        while (a.x.length < i + 1) a.x.push(zeroLength());
        a.x[i] = lengthOf(point.x);
      }
      if (i < a.y.length) a.y[i] = lengthOf(point.y);
      else if (point.y !== 0 && extend_zero_length) {
        while (a.y.length < i + 1) a.y.push(zeroLength());
        a.y[i] = lengthOf(point.y);
      }
    }
    a.dx = a.dx.map((it) => lengthOf(it.computed * scale_x));
    a.dy = a.dy.map((it) => lengthOf(it.computed * scale_y));
  }

  getDx(index: number): number {
    return this.attributes.dx[index]?.computed ?? 0;
  }

  getDy(index: number): number {
    return this.attributes.dy[index]?.computed ?? 0;
  }

  /** Add delta to dx at index, extending the vector if needed. */
  addToDx(index: number, delta: number): void {
    const dx = this.attributes.dx;
    while (dx.length < index + 1) dx.push(zeroLength());
    dx[index] = lengthOf(dx[index]!.computed + delta);
  }

  addToDy(index: number, delta: number): void {
    const dy = this.attributes.dy;
    while (dy.length < index + 1) dy.push(zeroLength());
    dy[index] = lengthOf(dy[index]!.computed + delta);
  }

  /** Rotation at index in degrees (the last value applies to the following characters). */
  getRotate(index: number): number {
    const r = this.attributes.rotate;
    if (!r.length) return 0;
    return (r[index] ?? r.at(-1)!).computed;
  }

  /** The first x and y values; 0 for an empty vector. */
  firstXY(): Point {
    return new Point(this.attributes.x[0]?.computed ?? 0, this.attributes.y[0]?.computed ?? 0);
  }

  /** Set the first x and y values. */
  setFirstXY(point: Point): void {
    const a = this.attributes;
    if (!a.x.length) a.x.push(zeroLength());
    if (!a.y.length) a.y.push(zeroLength());
    a.x[0] = lengthOf(point.x);
    a.y[0] = lengthOf(point.y);
  }

  getFirstXLength(): SVGLength | null {
    return this.attributes.x[0] ?? null;
  }

  getFirstYLength(): SVGLength | null {
    return this.attributes.y[0] ?? null;
  }

  getTextLength(): SVGLength {
    return this.attributes.textLength;
  }

  getLengthAdjust(): LengthAdjust {
    return this.attributes.lengthAdjust;
  }
}

function writeSingleAttributeVector(node: Node, key: string, attr_vector: SVGLength[]): void {
  if (!attr_vector.length) {
    node.removeAttribute(key);
  } else {
    // FIXME: this has no concept of unset values because sp_svg_length_list_read() can't read them back in
    node.setAttributeOrRemoveIfEmpty(key, attr_vector.map((it) => it.write()).join(' '));
  }
}

/** mergeInto() for one vector: the overlay values, then the parent values (upstream mergeSingleAttribute). */
function mergeSingleAttribute(
  parent_list: SVGLength[],
  parent_offset: number,
  overlay_list: SVGLength[] | null,
): SVGLength[] {
  if (!overlay_list) return parent_list.slice(parent_offset);
  const output: SVGLength[] = [];
  let overlay_offset = 0;
  while (parent_offset < parent_list.length || overlay_offset < overlay_list.length) {
    if (overlay_offset < overlay_list.length) {
      output.push(overlay_list[overlay_offset]!);
      overlay_offset++;
      parent_offset++;
    } else {
      output.push(parent_list[parent_offset]!);
      parent_offset++;
    }
  }
  return output;
}

function eraseSingleAttribute(attr_vector: SVGLength[], start_index: number, n: number): void {
  if (attr_vector.length <= start_index) return;
  attr_vector.splice(start_index, n);
}

function insertSingleAttribute(
  attr_vector: SVGLength[],
  start_index: number,
  n: number,
  is_xy: boolean,
): void {
  if (attr_vector.length <= start_index) return;
  attr_vector.splice(start_index, 0, ...Array.from({ length: n }, zeroLength));
  if (is_xy) {
    const begin =
      start_index === 0 ? attr_vector[start_index + n]!.computed : attr_vector[start_index - 1]!.computed;
    const diff = (attr_vector[start_index + n]!.computed - begin) / n; // n tested for nonzero in insert()
    for (let i = 0; i < n; i++) attr_vector[start_index + i] = lengthOf(begin + diff * i);
  }
}

/** Remove the values from index on and return them; with trimZeros, trailing zeros of the first part go. */
function splitSingleAttribute(first_vector: SVGLength[], index: number, trimZeros: boolean): SVGLength[] {
  if (first_vector.length <= index) return [];
  const second = first_vector.splice(index);
  if (trimZeros) {
    while (first_vector.length && (!first_vector.at(-1)!._set || first_vector.at(-1)!.value === 0)) {
      first_vector.pop();
    }
  }
  return second;
}

function joinSingleAttribute(
  first_vector: SVGLength[],
  second_vector: SVGLength[],
  second_index: number,
): SVGLength[] {
  if (!second_vector.length) return [...first_vector];
  const dest = first_vector.slice(0, second_index);
  while (dest.length < second_index) dest.push(zeroLength());
  return dest.concat(second_vector);
}
