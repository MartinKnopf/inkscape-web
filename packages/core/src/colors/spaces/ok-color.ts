// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/colors/spaces/ok-color.cpp, src/colors/spaces/ok-color.h

// This file has been adopted from https://bottosson.github.io/misc/ok_color.h
// It's been preserved as-is with its formatting intact as much as possible.
// See https://bottosson.github.io/posts/colorpicker/ for more details.
//
// Differences: upstream computes with `float`, this port uses doubles (the results differ
// by less than 1e-6). The gamut_clip_* functions, which nothing in Inkscape calls, are left out.

// Copyright(c) 2021 Björn Ottosson
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of
// this softwareand associated documentation files(the "Software"), to deal in
// the Software without restriction, including without limitation the rights to
// use, copy, modify, merge, publish, distribute, sublicense, and /or sell copies
// of the Software, and to permit persons to whom the Software is furnished to do
// so, subject to the following conditions :
// The above copyright noticeand this permission notice shall be included in all
// copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

export interface Lab {
  L: number;
  a: number;
  b: number;
}
export interface RGB {
  r: number;
  g: number;
  b: number;
}
export interface HSV {
  h: number;
  s: number;
  v: number;
}
export interface HSL {
  h: number;
  s: number;
  l: number;
}
export interface LC {
  L: number;
  C: number;
}

// Alternative representation of (L_cusp, C_cusp)
// Encoded so S = C_cusp/L_cusp and T = C_cusp/(1-L_cusp)
// The maximum value for C in the triangle is then found as fmin(S*L, T*(1-L)), for a given L
interface ST {
  S: number;
  T: number;
}

const pi = Math.PI;

function srgb_transfer_function(a: number): number {
  return 0.0031308 >= a ? 12.92 * a : 1.055 * a ** 0.4166666666666667 - 0.055;
}

function srgb_transfer_function_inv(a: number): number {
  return 0.04045 < a ? ((a + 0.055) / 1.055) ** 2.4 : a / 12.92;
}

function linear_srgb_to_oklab(c: RGB): Lab {
  const l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  const m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  const s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

function oklab_to_linear_srgb(c: Lab): RGB {
  const l_ = c.L + 0.3963377774 * c.a + 0.2158037573 * c.b;
  const m_ = c.L - 0.1055613458 * c.a - 0.0638541728 * c.b;
  const s_ = c.L - 0.0894841775 * c.a - 1.291485548 * c.b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return {
    r: +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

// Finds the maximum saturation possible for a given hue that fits in sRGB
// Saturation here is defined as S = C/L
// a and b must be normalized so a^2 + b^2 == 1
function compute_max_saturation(a: number, b: number): number {
  // Max saturation will be when one of r, g or b goes below zero.

  // Select different coefficients depending on which component goes below zero first
  let k0: number;
  let k1: number;
  let k2: number;
  let k3: number;
  let k4: number;
  let wl: number;
  let wm: number;
  let ws: number;

  if (-1.88170328 * a - 0.80936493 * b > 1) {
    // Red component
    k0 = +1.19086277;
    k1 = +1.76576728;
    k2 = +0.59662641;
    k3 = +0.75515197;
    k4 = +0.56771245;
    wl = +4.0767416621;
    wm = -3.3077115913;
    ws = +0.2309699292;
  } else if (1.81444104 * a - 1.19445276 * b > 1) {
    // Green component
    k0 = +0.73956515;
    k1 = -0.45954404;
    k2 = +0.08285427;
    k3 = +0.1254107;
    k4 = +0.14503204;
    wl = -1.2684380046;
    wm = +2.6097574011;
    ws = -0.3413193965;
  } else {
    // Blue component
    k0 = +1.35733652;
    k1 = -0.00915799;
    k2 = -1.1513021;
    k3 = -0.50559606;
    k4 = +0.00692167;
    wl = -0.0041960863;
    wm = -0.7034186147;
    ws = +1.707614701;
  }

  // Approximate max saturation using a polynomial:
  let S = k0 + k1 * a + k2 * b + k3 * a * a + k4 * a * b;

  // Do one step Halley's method to get closer
  // this gives an error less than 10e6, except for some blue hues where the dS/dh is close to infinite
  // this should be sufficient for most applications, otherwise do two/three steps

  const k_l = +0.3963377774 * a + 0.2158037573 * b;
  const k_m = -0.1055613458 * a - 0.0638541728 * b;
  const k_s = -0.0894841775 * a - 1.291485548 * b;

  {
    const l_ = 1 + S * k_l;
    const m_ = 1 + S * k_m;
    const s_ = 1 + S * k_s;

    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;

    const l_dS = 3 * k_l * l_ * l_;
    const m_dS = 3 * k_m * m_ * m_;
    const s_dS = 3 * k_s * s_ * s_;

    const l_dS2 = 6 * k_l * k_l * l_;
    const m_dS2 = 6 * k_m * k_m * m_;
    const s_dS2 = 6 * k_s * k_s * s_;

    const f = wl * l + wm * m + ws * s;
    const f1 = wl * l_dS + wm * m_dS + ws * s_dS;
    const f2 = wl * l_dS2 + wm * m_dS2 + ws * s_dS2;

    S = S - (f * f1) / (f1 * f1 - 0.5 * f * f2);
  }

  return S;
}

// finds L_cusp and C_cusp for a given hue
// a and b must be normalized so a^2 + b^2 == 1
function find_cusp(a: number, b: number): LC {
  // First, find the maximum saturation (saturation S = C/L)
  const S_cusp = compute_max_saturation(a, b);

  // Convert to linear sRGB to find the first point where at least one of r,g or b >= 1:
  const rgb_at_max = oklab_to_linear_srgb({ L: 1, a: S_cusp * a, b: S_cusp * b });
  const L_cusp = Math.cbrt(1 / Math.max(Math.max(rgb_at_max.r, rgb_at_max.g), rgb_at_max.b));
  const C_cusp = L_cusp * S_cusp;

  return { L: L_cusp, C: C_cusp };
}

// Finds intersection of the line defined by
// L = L0 * (1 - t) + t * L1;
// C = t * C1;
// a and b must be normalized so a^2 + b^2 == 1
function find_gamut_intersection(
  a: number,
  b: number,
  L1: number,
  C1: number,
  L0: number,
  cusp?: LC,
): number {
  // Find the cusp of the gamut triangle
  cusp ??= find_cusp(a, b);

  // Find the intersection for upper and lower half separately
  let t: number;
  if ((L1 - L0) * cusp.C - (cusp.L - L0) * C1 <= 0) {
    // Lower half

    t = (cusp.C * L0) / (C1 * cusp.L + cusp.C * (L0 - L1));
  } else {
    // Upper half

    // First intersect with triangle
    t = (cusp.C * (L0 - 1)) / (C1 * (cusp.L - 1) + cusp.C * (L0 - L1));

    // Then one step Halley's method
    {
      const dL = L1 - L0;
      const dC = C1;

      const k_l = +0.3963377774 * a + 0.2158037573 * b;
      const k_m = -0.1055613458 * a - 0.0638541728 * b;
      const k_s = -0.0894841775 * a - 1.291485548 * b;

      const l_dt = dL + dC * k_l;
      const m_dt = dL + dC * k_m;
      const s_dt = dL + dC * k_s;

      // If higher accuracy is required, 2 or 3 iterations of the following block can be used:
      {
        const L = L0 * (1 - t) + t * L1;
        const C = t * C1;

        const l_ = L + C * k_l;
        const m_ = L + C * k_m;
        const s_ = L + C * k_s;

        const l = l_ * l_ * l_;
        const m = m_ * m_ * m_;
        const s = s_ * s_ * s_;

        const ldt = 3 * l_dt * l_ * l_;
        const mdt = 3 * m_dt * m_ * m_;
        const sdt = 3 * s_dt * s_ * s_;

        const ldt2 = 6 * l_dt * l_dt * l_;
        const mdt2 = 6 * m_dt * m_dt * m_;
        const sdt2 = 6 * s_dt * s_dt * s_;

        const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s - 1;
        const r1 = 4.0767416621 * ldt - 3.3077115913 * mdt + 0.2309699292 * sdt;
        const r2 = 4.0767416621 * ldt2 - 3.3077115913 * mdt2 + 0.2309699292 * sdt2;

        const u_r = r1 / (r1 * r1 - 0.5 * r * r2);
        let t_r = -r * u_r;

        const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s - 1;
        const g1 = -1.2684380046 * ldt + 2.6097574011 * mdt - 0.3413193965 * sdt;
        const g2 = -1.2684380046 * ldt2 + 2.6097574011 * mdt2 - 0.3413193965 * sdt2;

        const u_g = g1 / (g1 * g1 - 0.5 * g * g2);
        let t_g = -g * u_g;

        const bb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s - 1;
        const b1 = -0.0041960863 * ldt - 0.7034186147 * mdt + 1.707614701 * sdt;
        const b2 = -0.0041960863 * ldt2 - 0.7034186147 * mdt2 + 1.707614701 * sdt2;

        const u_b = b1 / (b1 * b1 - 0.5 * bb * b2);
        let t_b = -bb * u_b;

        // FLT_MAX
        const FLT_MAX = 3.4028234663852886e38;
        t_r = u_r >= 0 ? t_r : FLT_MAX;
        t_g = u_g >= 0 ? t_g : FLT_MAX;
        t_b = u_b >= 0 ? t_b : FLT_MAX;

        t += Math.min(t_r, Math.min(t_g, t_b));
      }
    }
  }

  return t;
}

function toe(x: number): number {
  const k_1 = 0.206;
  const k_2 = 0.03;
  const k_3 = (1 + k_1) / (1 + k_2);
  return 0.5 * (k_3 * x - k_1 + Math.sqrt((k_3 * x - k_1) * (k_3 * x - k_1) + 4 * k_2 * k_3 * x));
}

function toe_inv(x: number): number {
  const k_1 = 0.206;
  const k_2 = 0.03;
  const k_3 = (1 + k_1) / (1 + k_2);
  return (x * x + k_1 * x) / (k_3 * (x + k_2));
}

function to_ST(cusp: LC): ST {
  const L = cusp.L;
  const C = cusp.C;
  return { S: C / L, T: C / (1 - L) };
}

// Returns a smooth approximation of the location of the cusp
// This polynomial was created by an optimization process
// It has been designed so that S_mid < S_max and T_mid < T_max
function get_ST_mid(a_: number, b_: number): ST {
  const S =
    0.11516993 +
    1 /
      (+7.4477897 +
        4.1590124 * b_ +
        a_ *
          (-2.19557347 +
            1.75198401 * b_ +
            a_ * (-2.13704948 - 10.02301043 * b_ + a_ * (-4.24894561 + 5.38770819 * b_ + 4.69891013 * a_))));

  const T =
    0.11239642 +
    1 /
      (+1.6132032 -
        0.68124379 * b_ +
        a_ *
          (+0.40370612 +
            0.90148123 * b_ +
            a_ * (-0.27087943 + 0.6122399 * b_ + a_ * (+0.00299215 - 0.45399568 * b_ - 0.14661872 * a_))));

  return { S, T };
}

interface Cs {
  C_0: number;
  C_mid: number;
  C_max: number;
}

function get_Cs(L: number, a_: number, b_: number): Cs {
  const cusp = find_cusp(a_, b_);

  const C_max = find_gamut_intersection(a_, b_, L, 1, L, cusp);
  const ST_max = to_ST(cusp);

  // Scale factor to compensate for the curved part of gamut shape:
  const k = C_max / Math.min(L * ST_max.S, (1 - L) * ST_max.T);

  let C_mid: number;
  {
    const ST_mid = get_ST_mid(a_, b_);

    // Use a soft minimum function, instead of a sharp triangle shape to get a smooth value for chroma.
    const C_a = L * ST_mid.S;
    const C_b = (1 - L) * ST_mid.T;
    C_mid = 0.9 * k * Math.sqrt(Math.sqrt(1 / (1 / (C_a * C_a * C_a * C_a) + 1 / (C_b * C_b * C_b * C_b))));
  }

  let C_0: number;
  {
    // for C_0, the shape is independent of hue, so ST are constant. Values picked to roughly be the average values of ST.
    const C_a = L * 0.4;
    const C_b = (1 - L) * 0.8;

    // Use a soft minimum function, instead of a sharp triangle shape to get a smooth value for chroma.
    C_0 = Math.sqrt(1 / (1 / (C_a * C_a) + 1 / (C_b * C_b)));
  }

  return { C_0, C_mid, C_max };
}

function to_srgb(rgb: RGB): RGB {
  return {
    r: srgb_transfer_function(rgb.r),
    g: srgb_transfer_function(rgb.g),
    b: srgb_transfer_function(rgb.b),
  };
}

export function okhsl_to_srgb(hsl: HSL): RGB {
  const h = hsl.h;
  const s = hsl.s;
  const l = hsl.l;

  if (l === 1.0) {
    return { r: 1, g: 1, b: 1 };
  }
  if (l === 0) {
    return { r: 0, g: 0, b: 0 };
  }

  const a_ = Math.cos(2 * pi * h);
  const b_ = Math.sin(2 * pi * h);
  const L = toe_inv(l);

  const cs = get_Cs(L, a_, b_);
  const C_0 = cs.C_0;
  const C_mid = cs.C_mid;
  const C_max = cs.C_max;

  const mid = 0.8;
  const mid_inv = 1.25;

  let C: number;
  if (s < mid) {
    const t = mid_inv * s;

    const k_1 = mid * C_0;
    const k_2 = 1 - k_1 / C_mid;

    C = (t * k_1) / (1 - k_2 * t);
  } else {
    const t = (s - mid) / (1 - mid);

    const k_0 = C_mid;
    const k_1 = ((1 - mid) * C_mid * C_mid * mid_inv * mid_inv) / C_0;
    const k_2 = 1 - k_1 / (C_max - C_mid);

    C = k_0 + (t * k_1) / (1 - k_2 * t);
  }

  return to_srgb(oklab_to_linear_srgb({ L, a: C * a_, b: C * b_ }));
}

export function srgb_to_okhsl(rgb: RGB): HSL {
  const lab = linear_srgb_to_oklab({
    r: srgb_transfer_function_inv(rgb.r),
    g: srgb_transfer_function_inv(rgb.g),
    b: srgb_transfer_function_inv(rgb.b),
  });

  const C = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
  if (C === 0) {
    return { h: 0, s: 0, l: lab.L };
  }

  const a_ = lab.a / C;
  const b_ = lab.b / C;

  const L = lab.L;
  const h = 0.5 + (0.5 * Math.atan2(-lab.b, -lab.a)) / pi;

  const cs = get_Cs(L, a_, b_);
  const C_0 = cs.C_0;
  const C_mid = cs.C_mid;
  const C_max = cs.C_max;

  // Inverse of the interpolation in okhsl_to_srgb:

  const mid = 0.8;
  const mid_inv = 1.25;

  let s: number;
  if (C < C_mid) {
    const k_1 = mid * C_0;
    const k_2 = 1 - k_1 / C_mid;

    const t = C / (k_1 + k_2 * C);
    s = t * mid;
  } else {
    const k_0 = C_mid;
    const k_1 = ((1 - mid) * C_mid * C_mid * mid_inv * mid_inv) / C_0;
    const k_2 = 1 - k_1 / (C_max - C_mid);

    const t = (C - k_0) / (k_1 + k_2 * (C - k_0));
    s = mid + (1 - mid) * t;
  }

  const l = toe(L);
  return { h, s, l };
}

export function okhsv_to_srgb(hsv: HSV): RGB {
  const h = hsv.h;
  const s = hsv.s;
  const v = hsv.v;

  const a_ = Math.cos(2 * pi * h);
  const b_ = Math.sin(2 * pi * h);

  const cusp = find_cusp(a_, b_);
  const ST_max = to_ST(cusp);
  const S_max = ST_max.S;
  const T_max = ST_max.T;
  const S_0 = 0.5;
  const k = 1 - S_0 / S_max;

  // first we compute L and V as if the gamut is a perfect triangle:

  // L, C when v==1:
  const L_v = 1 - (s * S_0) / (S_0 + T_max - T_max * k * s);
  const C_v = (s * T_max * S_0) / (S_0 + T_max - T_max * k * s);

  let L = v * L_v;
  let C = v * C_v;

  // then we compensate for both toe and the curved top part of the triangle:
  const L_vt = toe_inv(L_v);
  const C_vt = (C_v * L_vt) / L_v;

  const L_new = toe_inv(L);
  // this is a fix and a hack: don't blow up on L==0 (a fix), keep C>0 when L==0 to preserve hue (a hack)
  C = L > 0 && L_new > 0 ? (C * L_new) / L : 0.002;
  L = L_new;

  const rgb_scale = oklab_to_linear_srgb({ L: L_vt, a: a_ * C_vt, b: b_ * C_vt });
  const scale_L = Math.cbrt(1 / Math.max(Math.max(rgb_scale.r, rgb_scale.g), Math.max(rgb_scale.b, 0)));

  L = L * scale_L;
  C = C * scale_L;

  return to_srgb(oklab_to_linear_srgb({ L, a: C * a_, b: C * b_ }));
}

export function srgb_to_okhsv(rgb: RGB): HSV {
  const lab = linear_srgb_to_oklab({
    r: srgb_transfer_function_inv(rgb.r),
    g: srgb_transfer_function_inv(rgb.g),
    b: srgb_transfer_function_inv(rgb.b),
  });

  let C = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
  if (C === 0) {
    return { h: 0, s: 0, v: lab.L };
  }

  const a_ = lab.a / C;
  const b_ = lab.b / C;

  let L = lab.L;
  const h = 0.5 + (0.5 * Math.atan2(-lab.b, -lab.a)) / pi;

  const cusp = find_cusp(a_, b_);
  const ST_max = to_ST(cusp);
  const S_max = ST_max.S;
  const T_max = ST_max.T;
  const S_0 = 0.5;
  const k = 1 - S_0 / S_max;

  // first we find L_v, C_v, L_vt and C_vt

  const t = T_max / (C + L * T_max);
  const L_v = t * L;
  const C_v = t * C;

  const L_vt = toe_inv(L_v);
  const C_vt = (C_v * L_vt) / L_v;

  // we can then use these to invert the step that compensates for the toe and the curved top part of the triangle:
  const rgb_scale = oklab_to_linear_srgb({ L: L_vt, a: a_ * C_vt, b: b_ * C_vt });
  const scale_L = Math.cbrt(1 / Math.max(Math.max(rgb_scale.r, rgb_scale.g), Math.max(rgb_scale.b, 0)));

  L = L / scale_L;
  C = C / scale_L;

  C = (C * toe(L)) / L;
  L = toe(L);

  // we can now compute v and s:

  const v = L / L_v;
  const s = ((S_0 + T_max) * C_v) / (T_max * S_0 + T_max * k * C_v);

  return { h, s, v };
}
