// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/colors/cms/profile.cpp, src/colors/cms/profile.h, src/colors/cms/transform-color.cpp
/*
 * Authors: see git history
 *
 * Copyright (C) 2023 Authors
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

// TODO: CMS needs lcms via WASM. This file only has the built-in profiles of upstream
// (sRGB, linear sRGB, XYZ D65, XYZ D50, Lab D50 and gray). Upstream converts between them with
// lcms2 transforms; here a profile knows its conversion to and from CIE XYZ D65 and the
// conversion between two profiles goes through that. ICC files cannot be loaded.

type XYZ = [number, number, number];
type Matrix = readonly [readonly number[], readonly number[], readonly number[]];

// Linear sRGB (Rec. 709 primaries, D65) to XYZ D65, and back.
const LRGB_TO_XYZ: Matrix = [
  [0.4123907992659595, 0.357584339383878, 0.1804807884018343],
  [0.21263900587151036, 0.715168678767756, 0.07219231536073371],
  [0.01933081871559185, 0.11919477979462598, 0.9505321522496607],
];
const XYZ_TO_LRGB: Matrix = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];
// Bradford chromatic adaptation between D65 and D50.
const D65_TO_D50: Matrix = [
  [1.0479297925449969, 0.022946870601609652, -0.05019226628920524],
  [0.02962780877005599, 0.9904344267538799, -0.017073799063418826],
  [-0.009243040646204504, 0.015055191490298152, 0.7518742814281371],
];
const D50_TO_D65: Matrix = [
  [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
  [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
  [0.012314014864481998, -0.020507649298898964, 1.330365926242124],
];

// CIE constants and the D50 white point of CSS Color Module 4 Lab.
const LAB_KAPPA = 24389 / 27;
const LAB_EPSILON = 216 / 24389;
const D50_WHITE: XYZ = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];
// Lab is stored with L in 0..100 and a, b in -128..127, scaled to 0..1 (see Space::Lab).
const LAB_L_SCALE = 100;
const LAB_AB_MIN = -128;
const LAB_AB_MAX = 127;

// Gamma of the gray profile (upstream Profile::create_gray).
const GRAY_GAMMA = 2.158;
const D65_WHITE: XYZ = [0.9504559270516716, 1, 1.0890577507598784];

function mul(m: Matrix, v: ArrayLike<number>): XYZ {
  const a = v[0] ?? 0;
  const b = v[1] ?? 0;
  const c = v[2] ?? 0;
  return [
    m[0]![0]! * a + m[0]![1]! * b + m[0]![2]! * c,
    m[1]![0]! * a + m[1]![1]! * b + m[1]![2]! * c,
    m[2]![0]! * a + m[2]![1]! * b + m[2]![2]! * c,
  ];
}

// sRGB transfer functions, extended to negative values by symmetry.
function srgbToLinear(c: number): number {
  const a = Math.abs(c);
  const l = a <= 0.04045 ? a / 12.92 : ((a + 0.055) / 1.055) ** 2.4;
  return c < 0 ? -l : l;
}
function linearToSrgb(c: number): number {
  const a = Math.abs(c);
  const s = a <= 0.0031308 ? 12.92 * a : 1.055 * a ** (1 / 2.4) - 0.055;
  return c < 0 ? -s : s;
}

function cube(x: number): number {
  return x * x * x;
}

/**
 * A color profile: a number of channels and the conversion to and from CIE XYZ D65.
 * Upstream Inkscape::Colors::CMS::Profile wraps an lcms2 profile.
 */
export class Profile {
  readonly #id: string;
  readonly #name: string;
  readonly #size: number;
  readonly #toXYZ: (v: ArrayLike<number>) => XYZ;
  readonly #fromXYZ: (xyz: XYZ) => number[];

  private constructor(
    id: string,
    name: string,
    size: number,
    toXYZ: (v: ArrayLike<number>) => XYZ,
    fromXYZ: (xyz: XYZ) => number[],
  ) {
    this.#id = id;
    this.#name = name;
    this.#size = size;
    this.#toXYZ = toXYZ;
    this.#fromXYZ = fromXYZ;
  }

  getId(): string {
    return this.#id;
  }
  getName(): string {
    return this.#name;
  }
  /** The number of channels of the profile's color space. */
  getSize(): number {
    return this.#size;
  }

  static #srgb?: Profile;
  static #linearrgb?: Profile;
  static #xyz65?: Profile;
  static #xyz50?: Profile;
  static #lab?: Profile;
  static #gray?: Profile;

  /** The sRGB profile. */
  static createSrgb(): Profile {
    Profile.#srgb ??= new Profile(
      'srgb',
      'sRGB',
      3,
      (v) => mul(LRGB_TO_XYZ, [srgbToLinear(v[0] ?? 0), srgbToLinear(v[1] ?? 0), srgbToLinear(v[2] ?? 0)]),
      (xyz) => mul(XYZ_TO_LRGB, xyz).map(linearToSrgb),
    );
    return Profile.#srgb;
  }

  /** Linear light sRGB, D65. */
  static createLinearrgb(): Profile {
    Profile.#linearrgb ??= new Profile(
      'linearrgb',
      'linearRGB identity with D65',
      3,
      (v) => mul(LRGB_TO_XYZ, v),
      (xyz) => mul(XYZ_TO_LRGB, xyz),
    );
    return Profile.#linearrgb;
  }

  /** CIE XYZ with a D65 white point. */
  static createXyz65(): Profile {
    Profile.#xyz65 ??= new Profile(
      'xyz65',
      'D65 XYZ profile',
      3,
      (v) => [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0],
      (xyz) => [...xyz],
    );
    return Profile.#xyz65;
  }

  /** CIE XYZ with a D50 white point. */
  static createXyz50(): Profile {
    Profile.#xyz50 ??= new Profile(
      'xyz50',
      'D50 XYZ profile',
      3,
      (v) => mul(D50_TO_D65, v),
      (xyz) => mul(D65_TO_D50, xyz),
    );
    return Profile.#xyz50;
  }

  /** CIE Lab with a D50 white point, as in CSS Color Module 4. Channels are scaled to 0..1. */
  static createLab(): Profile {
    Profile.#lab ??= new Profile(
      'lab',
      'Lab D50',
      3,
      (v) => {
        const l = (v[0] ?? 0) * LAB_L_SCALE;
        const a = (v[1] ?? 0) * (LAB_AB_MAX - LAB_AB_MIN) + LAB_AB_MIN;
        const b = (v[2] ?? 0) * (LAB_AB_MAX - LAB_AB_MIN) + LAB_AB_MIN;
        const f1 = (l + 16) / 116;
        const f0 = a / 500 + f1;
        const f2 = f1 - b / 200;
        const xyz50: XYZ = [
          (cube(f0) > LAB_EPSILON ? cube(f0) : (116 * f0 - 16) / LAB_KAPPA) * D50_WHITE[0],
          (l > LAB_KAPPA * LAB_EPSILON ? cube(f1) : l / LAB_KAPPA) * D50_WHITE[1],
          (cube(f2) > LAB_EPSILON ? cube(f2) : (116 * f2 - 16) / LAB_KAPPA) * D50_WHITE[2],
        ];
        return mul(D50_TO_D65, xyz50);
      },
      (xyz) => {
        const xyz50 = mul(D65_TO_D50, xyz);
        const f = xyz50.map((t, i) => {
          const r = t / D50_WHITE[i]!;
          return r > LAB_EPSILON ? Math.cbrt(r) : (LAB_KAPPA * r + 16) / 116;
        });
        const l = 116 * f[1]! - 16;
        const a = 500 * (f[0]! - f[1]!);
        const b = 200 * (f[1]! - f[2]!);
        return [
          l / LAB_L_SCALE,
          (a - LAB_AB_MIN) / (LAB_AB_MAX - LAB_AB_MIN),
          (b - LAB_AB_MIN) / (LAB_AB_MAX - LAB_AB_MIN),
        ];
      },
    );
    return Profile.#lab;
  }

  /** A D65 gray profile with gamma 2.158. Has one channel. */
  static createGray(): Profile {
    Profile.#gray ??= new Profile(
      'gray',
      'Gray D65',
      1,
      (v) => {
        const y = Math.max(0, v[0] ?? 0) ** GRAY_GAMMA;
        return [D65_WHITE[0] * y, y, D65_WHITE[2] * y];
      },
      (xyz) => [Math.max(0, xyz[1]) ** (1 / GRAY_GAMMA)],
    );
    return Profile.#gray;
  }

  /**
   * Convert the channels of `io` from the profile `from` to the profile `to`, in place. A last
   * channel that is beyond the channels of `from` is an opacity and is kept at the end.
   */
  static convert(io: number[], from: Profile, to: Profile): boolean {
    if (from === to) return true;
    const hasAlpha = io.length === from.#size + 1;
    const alpha = hasAlpha ? io[io.length - 1]! : 0;
    const out = to.#fromXYZ(from.#toXYZ(io));
    io.length = 0;
    io.push(...out);
    if (hasAlpha) io.push(alpha);
    return true;
  }
}
