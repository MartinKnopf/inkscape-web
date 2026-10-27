// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/svg/svg-box.cpp, src/svg/svg-box.h
/*
 * Authors:
 *   Martin Owens <doctormo@geek-2.com>
 *
 * Copyright (C) 2022 Martin Owens
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

import { SVGLength, SVGLengthUnit } from './svg-length.ts';

// TODO: switch to Rect and Scale from @inkscape-web/geom when they exist there.
/** Minimal stand-in for Geom::Rect (x0,y0 is the top left corner, y grows downwards). */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Minimal stand-in for Geom::Scale. */
export interface Scale {
  x: number;
  y: number;
}

export enum BoxSide {
  TOP,
  RIGHT,
  BOTTOM,
  LEFT,
}

// Match a side to its fallback index: top->bottom, top->right, right->left
const fallback = (i: number): number => Math.max(i - 2, 0);

/** The axis of docScale that applies to a side. Upstream: SVGBox::get_scale_axis */
function scaleOf(docScale: Scale, side: BoxSide): number {
  return side & 1 ? docScale.x : docScale.y;
}

/**
 * An svg box is a type of css/html type which contains up to 4 svg lengths.
 * Usually representing widths, margins, padding of the html box model.
 */
export class SVGBox {
  #isSet = false;
  readonly #value: [SVGLength, SVGLength, SVGLength, SVGLength] = [
    new SVGLength(),
    new SVGLength(),
    new SVGLength(),
    new SVGLength(),
  ];

  constructor(box?: Rect | null) {
    this.setRect(box);
  }

  /** Upstream: operator bool */
  isSet(): boolean {
    return this.#isSet;
  }

  /** Read in the value, may be an array of four. */
  read(value: string, docScale: Scale): boolean {
    return this.fromString(value, '', docScale);
  }

  /** Update the box with em, ex and percentage scaling. */
  update(em: number, ex: number, width: number, height: number): void {
    this.#value[0].update(em, ex, height);
    this.#value[1].update(em, ex, width);
    this.#value[2].update(em, ex, height);
    this.#value[3].update(em, ex, width);
  }

  /** Write out the values into a compact form. */
  write(): string {
    return this.toString('', { x: 1, y: 1 });
  }

  /** Write as a specific unit for user display. An empty unit writes the SVG form. */
  toString(unit: string, docScale: Scale, precision?: number, addUnit = true): string {
    let ret = '';
    let write = false;
    for (let i = 3; i >= 0; i--) {
      const val = this.#value[i]!;
      const fb = this.#value[fallback(i)]!;
      if (i === BoxSide.TOP || !val.equals(fb) || write) {
        const part = unit.length ? val.toString(unit, scaleOf(docScale, i), precision, addUnit) : val.write();
        ret = `${part} ${ret}`;
        write = true;
      }
    }
    return ret.slice(0, -1);
  }

  /** Set the svg box from user input, with a default unit. */
  fromString(value: string, unit: string, docScale: Scale): boolean {
    if (!value.length) return false;
    // Split by commas and/or white space.
    const elements = value.split(/\s*[,\s]\s*/);
    for (let i = 0; i < 4; i++) {
      const element = elements[i];
      if (element !== undefined && element.length > 0) {
        if (!this.fromStringSide(i, element, unit, docScale)) return false; // One position failed.
      } else {
        this.#value[i] = this.#value[fallback(i)]!.copy();
      }
    }
    this.#isSet = true;
    return true;
  }

  /**
   * Parse a single side from a string and unit combo (pass through to SVGLength.fromString).
   *
   * @param side The side of the box to set
   * @param value The string value entered by the user
   * @param unit The default unit the context is using
   * @param docScale The document scale factor, for when units are being parsed
   */
  fromStringSide(side: BoxSide, value: string, unit: string, docScale: Scale): boolean {
    return this.#value[side].fromString(value, unit, scaleOf(docScale, side));
  }

  /**
   * True if the box is set and all values are zero.
   * (Upstream compares the SVGLengths with 0.0 through their bool conversion, which tests
   * "is set" instead of the value. This follows the documented intent.)
   */
  isZero(): boolean {
    return this.#isSet && this.#value.every((v) => v.computed === 0);
  }

  /**
   * Set values into this box model, like CSS padding:
   * (size), (vertical, horizontal), (top, horizontal, bottom) or (top, right, bottom, left).
   */
  set(...v: [number] | [number, number] | [number, number, number] | [number, number, number, number]): void {
    const [top, a, b, c] = v;
    const [right, bottom, left] =
      v.length === 1
        ? [top, top, top]
        : v.length === 2
          ? [a!, top, a!]
          : v.length === 3
            ? [a!, b!, a!]
            : [a!, b!, c!];
    this.setSide(BoxSide.TOP, top);
    this.setSide(BoxSide.RIGHT, right);
    this.setSide(BoxSide.BOTTOM, bottom);
    this.setSide(BoxSide.LEFT, left);
  }

  /** Set the box from a rectangle, or unset it. */
  setRect(box: Rect | null | undefined): void {
    this.unset();
    if (box) this.set(box.y0, box.x1, box.y1, box.x0);
  }

  /**
   * Set the value of a side in px. The original unit is dropped (units are not valid in the
   * SVG).
   *
   * @param confine If true, also set any other sides that have the same length.
   */
  setSide(side: BoxSide, px: number, confine = false): void {
    const original = this.#value[side].copy();
    for (let i = 0; i < 4; i++) {
      if (i === side || (confine && this.#value[i]!.equals(original))) {
        this.#value[i]!.set(SVGLengthUnit.PX, px, px);
      }
    }
    this.#isSet = true;
  }

  unset(): void {
    this.#isSet = false;
  }

  readOrUnset(value: string | null | undefined, docScale: Scale): void {
    if (value == null || !this.read(value, docScale)) this.unset();
  }

  /** The computed value of a side in px. */
  get(side: BoxSide): number {
    return this.#value[side].computed;
  }

  top(): SVGLength {
    return this.#value[BoxSide.TOP].copy();
  }

  right(): SVGLength {
    return this.#value[BoxSide.RIGHT].isSet() ? this.#value[BoxSide.RIGHT].copy() : this.top();
  }

  bottom(): SVGLength {
    return this.#value[BoxSide.BOTTOM].isSet() ? this.#value[BoxSide.BOTTOM].copy() : this.top();
  }

  left(): SVGLength {
    return this.#value[BoxSide.LEFT].isSet() ? this.#value[BoxSide.LEFT].copy() : this.right();
  }
}
