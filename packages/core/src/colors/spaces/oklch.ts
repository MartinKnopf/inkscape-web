// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/colors/spaces/oklch.cpp, src/colors/spaces/oklch.h
/** @file
 */ /*
 * Authors:
 *   Rafał Siejakowski <rs@rs-math.net>
 *   Martin Owens <doctormo@geek-2.com>
 *
 * Copyright (C) 2023 Authors
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

import { Angle, lerp } from '@inkscape-web/geom';
import { Parser, type StringStream } from '../parser.ts';
import { CssFuncPrinter } from '../printer.ts';
import { SP_COLOR_F_TO_U } from '../utils.ts';
import { SpaceType } from './enum.ts';
import { LinearRGB } from './linear-rgb.ts';
import { OkLab } from './oklab.ts';
import { RGBBase } from './rgb.ts';

/* Chroma is technically unbounded in the actual calculations but is
 * defined between 0.0 and 0.4 by the CSS Color Module specification
 * as the reasonable upper and lower limits for display. Our internal model
 * always scales from 0 to 1 of this expected range of values.
 */
const CHROMA_SCALE = 0.4;

/**
 * Data needed to compute coefficients in the cubic polynomials which express the lines
 * of constant luminosity and hue (but varying chroma) as curves in the linear RGB space.
 */
interface ChromaLineCoefficients {
  // Variable naming: `c%d` contains coefficients of c^%d in the polynomial, where c is
  // the OKLch chroma. l refers to the luminosity, cos and sin to the cosine and sine of
  // the hue angle. Trailing digits are exponents. For example,
  // c2.lcos2 is the coefficient of (l * cos(hue_angle)^2) in the overall coefficient of c^2.
  c1: { l2cos: number; l2sin: number };
  c2: { lcos2: number; lcossin: number; lsin2: number };
  c3: { cos3: number; cos2sin: number; cossin2: number; sin3: number };
}

const LAB_BOUNDS: readonly ChromaLineCoefficients[] = [
  // Red polynomial
  {
    c1: { l2cos: 5.832795328990806, l2sin: 2.378079127543573 },
    c2: { lcos2: 1.8161412991765207, lcossin: 2.118512589712604, lsin2: 1.6848452736153838 },
    c3: {
      cos3: 0.25753586979762416,
      cos2sin: 0.41449034566788234,
      cossin2: 0.1265965114920026,
      sin3: -0.45570203984404656,
    },
  },
  // Green polynomial
  {
    c1: { l2cos: -2.243030176177044, l2sin: 0.0012944124097785002 },
    c2: { lcos2: -0.5187087369791309, lcossin: -0.7820717390897833, lsin2: -1.8531911425339782 },
    c3: {
      cos3: -0.08179591384956371,
      cos2sin: -0.1239788660641221,
      cossin2: 0.07922153421500773,
      sin3: 0.7218132301017783,
    },
  },
  // Blue polynomial
  {
    c1: { l2cos: -0.24064127809236283, l2sin: -6.4840470197878295 },
    c2: { lcos2: 0.015528352128452045, lcossin: 1.1534669754725904, lsin2: 8.535379923500727 },
    c3: {
      cos3: -0.0006573855374563135,
      cos2sin: -0.05190291798494438,
      cossin2: -0.7639279728852381,
      sin3: -3.6782554150792954,
    },
  },
];

/** Stores powers of luminance, hue cosine and hue sine angles. */
class ConstraintMonomials {
  readonly l: number;
  readonly l2: number;
  readonly l3: number;
  readonly c: number;
  readonly c2: number;
  readonly c3: number;
  readonly s: number;
  readonly s2: number;
  readonly s3: number;

  constructor(l: number, h: number) {
    this.l = l;
    this.l2 = l * l;
    this.l3 = this.l2 * l;
    const rad = h * (Math.PI / 180);
    this.s = Math.sin(rad);
    this.c = Math.cos(rad);
    this.c2 = this.c * this.c;
    this.c3 = this.c2 * this.c;
    this.s2 = 1.0 - this.c2; // Use sin^2 = 1 - cos^2.
    this.s3 = this.s2 * this.s;
  }
}

/** Solve a x^2 + b x + c = 0 (upstream 2geom Geom::solve_quadratic). Roots in ascending order. */
function solve_quadratic(a: number, b: number, c: number): number[] {
  const result: number[] = [];

  if (a === 0) {
    // linear equation
    if (b === 0) return result;
    result.push(-c / b);
    return result;
  }

  const delta = b * b - 4 * a * c;

  if (delta === 0) {
    // one root
    result.push(-b / (2 * a));
  } else if (delta > 0) {
    // two roots
    const delta_sqrt = Math.sqrt(delta);

    // Use different formulas depending on sign of b to preserve
    // numerical stability. See e.g.:
    // http://people.csail.mit.edu/bkph/articles/Quadratics.pdf
    const sign = b >= 0 ? 1 : -1;
    const t = -0.5 * (b + sign * delta_sqrt);
    result.push(t / a);
    result.push(c / t);
  }
  // no roots otherwise

  return result.sort((x, y) => x - y);
}

/** Solve a x^3 + b x^2 + c x + d = 0 (upstream 2geom Geom::solve_cubic). Roots in ascending order. */
function solve_cubic(a: number, b: number, c: number, d: number): number[] {
  // based on:
  // http://mathworld.wolfram.com/CubicFormula.html

  if (a === 0) {
    return solve_quadratic(b, c, d);
  }
  if (d === 0) {
    // divide by x
    const result = solve_quadratic(a, b, c);
    result.push(0);
    return result.sort((x, y) => x - y);
  }

  const result: number[] = [];

  // 1. divide everything by a to bring to canonical form
  b /= a;
  c /= a;
  d /= a;

  // 2. eliminate x^2 term: x^3 + 3Qx - 2R = 0
  const Q = (3 * c - b * b) / 9;
  const R = (-27 * d + b * (9 * c - 2 * b * b)) / 54;

  // 3. compute polynomial discriminant
  const D = Q * Q * Q + R * R;
  const term1 = b / 3;

  if (D > 0) {
    // only one real root
    const S = Math.cbrt(R + Math.sqrt(D));
    const T = Math.cbrt(R - Math.sqrt(D));
    result.push(-b / 3 + S + T);
  } else if (D === 0) {
    // 3 real roots, 2 of which are equal
    const rroot = Math.cbrt(R);
    result.push(-term1 + 2 * rroot);
    result.push(-term1 - rroot);
    result.push(-term1 - rroot);
  } else {
    // 3 distinct real roots
    const theta = Math.acos(R / Math.sqrt(-Q * Q * Q));
    const rroot = 2 * Math.sqrt(-Q);
    result.push(-term1 + rroot * Math.cos(theta / 3));
    result.push(-term1 + rroot * Math.cos((theta + 2 * Math.PI) / 3));
    result.push(-term1 + rroot * Math.cos((theta + 4 * Math.PI) / 3));
  }

  return result.sort((x, y) => x - y);
}

/** Find the coefficients of the cubic polynomial expressing the linear
 * R, G or B component as a function of OKLch chroma.
 *
 * The returned polynomial gives R(c), G(c) or B(c) for all values of c and fixed
 * values of luminance and hue.
 *
 * @param index The index of the component to evaluate (0 for R, 1 for G, 2 for B).
 * @param m The monomials in L, cos(hue) and sin(hue) needed for the calculation.
 * @return an array whose i-th element is the coefficient of c^i in the polynomial.
 */
function component_coefficients(index: number, m: ConstraintMonomials): [number, number, number, number] {
  const coeffs = LAB_BOUNDS[index]!;

  // Multiply the coefficients by the corresponding monomials.
  return [
    m.l3, // The coefficient of l^3 is always 1
    coeffs.c1.l2cos * m.l2 * m.c + coeffs.c1.l2sin * m.l2 * m.s,
    coeffs.c2.lcos2 * m.l * m.c2 + coeffs.c2.lcossin * m.l * m.c * m.s + coeffs.c2.lsin2 * m.l * m.s2,
    coeffs.c3.cos3 * m.c3 +
      coeffs.c3.cos2sin * m.c2 * m.s +
      coeffs.c3.cossin2 * m.c * m.s2 +
      coeffs.c3.sin3 * m.s3,
  ];
}

export class OkLch extends RGBBase {
  static readonly ProfileChannels = 3;
  static readonly OutputChannels = 3;
  static readonly HUE_SCALE = 360;

  constructor() {
    super(SpaceType.OKLCH, 'OkLch', 'OkLch', 'color-selector-oklch', OkLch);
    this._svgNames.push('oklch');
  }

  static spaceToProfile(i: ArrayLike<number>, o: number[]): void {
    // Convert a color from the the OkLch colorspace to the OKLab colorspace.
    // c and h are polar coordinates; convert to Cartesian a, b coords.
    const l = i[0]!;
    const c = i[1]!;
    const h = i[2]!;

    const rad = Angle.from_degrees(h * OkLch.HUE_SCALE).radians0();
    o[0] = l;
    o[1] = Math.cos(rad) * c;
    o[2] = Math.sin(rad) * c;
    OkLab.toLinearRGB(o, o);
    LinearRGB.toRGB(o, o);
  }

  static profileToSpace(i: ArrayLike<number>, o: number[]): void {
    LinearRGB.fromRGB(i, o);
    OkLab.fromLinearRGB(o, o);

    // Convert a, b to polar coordinates c, h.
    const c = Math.hypot(o[1]!, o[2]!);
    if (c > 0.001) {
      const hue_angle = new Angle(Math.atan2(o[2]!, o[1]!));
      o[2] = (hue_angle.radians0() * (180 / Math.PI)) / OkLch.HUE_SCALE;
    } else {
      o[2] = 0;
    }
    o[1] = c;
  }

  /**
   * Compute the maximum Lch chroma for the given luminosity and hue.
   *
   * Implementation notes:
   * The space of Lch colors is a complicated solid with curved faces in the
   * (L, c, h)-space. So it is not easy to find the maximum chroma for the given
   * luminosity and hue. (By maximum chroma, we mean the maximum value of c such
   * that the color oklch(L c h) still fits in the sRGB gamut.)
   *
   * We consider an abstract ray (L, c, h) where L and h are fixed and c varies
   * from 0 to infinity. Conceptually, we transform this ray to the linear RGB space,
   * which is the unit cube. The ray thus becomes a 3D cubic curve in the RGB cube
   * and the coordinates R(c), G(c) and B(c) are degree 3 polynomials in the chroma
   * variable c. The coefficients of c^i in those polynomials will depend on L and h.
   *
   * To find the smallest positive value of c for which the curve leaves the unit
   * cube, we must solve the equations R(c) = 0, R(c) = 1 and similarly for G(c)
   * and B(c). The desired value is the smallest positive solution among those 6
   * equations.
   *
   * The case of very small or very large luminosity is handled separately.
   */
  static max_chroma(l: number, h: number): number {
    const EPS = 1e-7;
    if (l < EPS || l > 1.0 - EPS) {
      // Black or white allow no chroma.
      return 0;
    }

    let chroma_bound = Number.POSITIVE_INFINITY;
    const process_root = (root: number): boolean => {
      if (root < EPS) {
        // Ignore roots less than epsilon
        return false;
      }
      if (chroma_bound > root) {
        chroma_bound = root;
      }
      return true;
    };

    // Check relevant chroma constraints for all three coordinates R, G, B.
    const monomials = new ConstraintMonomials(l, h);
    for (let i = 0; i < 3; i++) {
      const coeffs = component_coefficients(i, monomials);
      // The cubic polynomial is coeffs[3]*c^3 + coeffs[2]*c^2 + coeffs[1]*c + coeffs[0]

      // First we solve for the R/G/B component equal to zero.
      for (const root of solve_cubic(coeffs[3], coeffs[2], coeffs[1], coeffs[0])) {
        if (process_root(root)) {
          break;
        }
      }

      // Now solve for the component equal to 1 by subtracting 1.0 from coeffs[0].
      for (const root of solve_cubic(coeffs[3], coeffs[2], coeffs[1], coeffs[0] - 1.0)) {
        if (process_root(root)) {
          break;
        }
      }
    }

    if (chroma_bound === Number.POSITIVE_INFINITY) {
      // No bound was found, so everything was < EPS
      return 0;
    }
    return chroma_bound;
  }

  /**
   * Print the Lab color to a CSS string.
   *
   * @arg values - A vector of doubles for each channel in the Lch space
   * @arg opacity - True if the opacity should be included in the output.
   */
  toString(values: readonly number[], opacity = true): string {
    const os = new CssFuncPrinter(3, 'oklch');
    os.add(values[0]!) // Luminance
      .add(values[1]! * CHROMA_SCALE) // Chroma
      .add(values[2]! * OkLch.HUE_SCALE); // Hue
    if (opacity && values.length === 4) os.add(values[3]!); // Optional opacity
    return os.toString();
  }

  static Parser = class OkLchParser extends Parser {
    constructor() {
      super('oklch', SpaceType.OKLCH);
    }

    override parse(ss: StringStream, output: number[]): boolean {
      const state = { end: false };
      return (
        Parser.append_css_value(ss, output, state, ',') && // Luminance
        Parser.append_css_value(ss, output, state, ',', CHROMA_SCALE) && // Chroma
        Parser.append_css_value(ss, output, state, '/', OkLch.HUE_SCALE) && // Hue
        (Parser.append_css_value(ss, output, state) || true) && // Optional opacity
        state.end
      );
    }
  };
}

/**
 * How many intervals a color scale should be subdivided into for the chroma bounds probing.
 *
 * The reason this constant exists is because probing chroma bounds requires solving 6 cubic equations,
 * which would not be feasible for all 1024 pixels on a scale without slowing down the UI.
 * To speed things up, we subdivide the scale into COLOR_SCALE_INTERVALS intervals and linearly
 * interpolate the chroma bound on each interval. Note that the actual color interpolation is still
 * done in the OKLab space, but the computed absolute chroma may be slightly off in the middle of
 * each interval (hopefully, in an imperceptible way).
 */
const COLOR_SCALE_INTERVALS = 32; // Must be a power of 2 and less than 1024.

/** Write the sRGB pixel of the OkLch color (l, c, h with h in 0..1) at `pos` of `map`. */
function put_pixel(map: Uint8ClampedArray, pos: number, l: number, c: number, h: number): void {
  const rgb = [0, 0, 0];
  OkLch.spaceToProfile([l, c, h], rgb);
  map[pos] = SP_COLOR_F_TO_U(rgb[0]!);
  map[pos + 1] = SP_COLOR_F_TO_U(rgb[1]!);
  map[pos + 2] = SP_COLOR_F_TO_U(rgb[2]!);
  map[pos + 3] = 0xff;
}

/** Render a hue scale as 1024 RGBA pixels into `map` (4 * 1024 bytes). */
export function render_hue_scale(s: number, l: number, map: Uint8ClampedArray): Uint8ClampedArray {
  let pos = 0;
  const interval_length = 1024 / COLOR_SCALE_INTERVALS;
  let h = 0; // Variable hue
  let chroma_bound = OkLch.max_chroma(l, h);
  const step = 360.0 / 1024.0;
  const interpolation_step = 360.0 / COLOR_SCALE_INTERVALS;
  for (let i = 0; i < COLOR_SCALE_INTERVALS; i++) {
    const initial_chroma = chroma_bound * s;
    const next_chroma_bound = OkLch.max_chroma(l, h + interpolation_step);
    const final_chroma = next_chroma_bound * s;
    for (let j = 0; j < interval_length; j++) {
      const c = lerp(j / interval_length, initial_chroma, final_chroma);
      put_pixel(map, pos, l, c, h / 360);
      pos += 4;
      h += step;
    }
    chroma_bound = next_chroma_bound;
  }
  return map;
}

/** Render a saturation scale as 1024 RGBA pixels into `map` (4 * 1024 bytes). */
export function render_saturation_scale(h: number, l: number, map: Uint8ClampedArray): Uint8ClampedArray {
  let pos = 0;
  const chromax = OkLch.max_chroma(l, h);
  if (chromax === 0.0) {
    // Render black or white strip.
    const bw = l > 0.9 ? 0xff : 0x00;
    for (let i = 0; i < 1024; i++) {
      map[pos++] = bw; // red
      map[pos++] = bw; // green
      map[pos++] = bw; // blue
      map[pos++] = 0xff; // alpha
    }
  } else {
    // Render strip of varying chroma.
    const chroma_step = chromax / 1024.0;
    let c = 0.0;
    for (let i = 0; i < 1024; i++) {
      put_pixel(map, pos, l, c, h);
      pos += 4;
      c += chroma_step;
    }
  }
  return map;
}

/** Render a lightness scale as 1024 RGBA pixels into `map` (4 * 1024 bytes). */
export function render_lightness_scale(h: number, s: number, map: Uint8ClampedArray): Uint8ClampedArray {
  let pos = 0;
  const interval_length = 1024 / COLOR_SCALE_INTERVALS;
  let l = 0; // Variable lightness
  let chroma_bound = OkLch.max_chroma(l, h);
  const step = 1.0 / 1024.0;
  const interpolation_step = 1.0 / COLOR_SCALE_INTERVALS;
  for (let i = 0; i < COLOR_SCALE_INTERVALS; i++) {
    const initial_chroma = chroma_bound * s;
    const next_chroma_bound = OkLch.max_chroma(l + interpolation_step, h);
    const final_chroma = next_chroma_bound * s;
    for (let j = 0; j < interval_length; j++) {
      const c = lerp(j / interval_length, initial_chroma, final_chroma);
      put_pixel(map, pos, l, c, h);
      pos += 4;
      l += step;
    }
    chroma_bound = next_chroma_bound;
  }
  return map;
}
