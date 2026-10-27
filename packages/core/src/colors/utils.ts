// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/colors/utils.cpp, src/colors/utils.h
/*
 * Copyright (C) 2023 AUTHORS
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

import type { Color } from './color.ts';
import { ColorError } from './forward.ts';
import { SpaceType } from './spaces/enum.ts';
import type { NamedColor } from './spaces/named.ts';

/* Useful composition macros. Packed colors are unsigned 32 bit numbers, 0xRRGGBBAA. */

export function SP_COLOR_U_TO_F(v: number): number {
  return v / 255.0;
}
export function SP_COLOR_F_TO_U(v: number): number {
  const clamped = Math.min(Math.max(v, 0.0), 1.0);
  return Math.trunc(clamped * 255 + 0.5) || 0;
}
export function SP_RGBA32_R_U(v: number): number {
  return (v >>> 24) & 0xff;
}
export function SP_RGBA32_G_U(v: number): number {
  return (v >>> 16) & 0xff;
}
export function SP_RGBA32_B_U(v: number): number {
  return (v >>> 8) & 0xff;
}
export function SP_RGBA32_A_U(v: number): number {
  return v & 0xff;
}
export function SP_RGBA32_R_F(v: number): number {
  return SP_COLOR_U_TO_F(SP_RGBA32_R_U(v));
}
export function SP_RGBA32_G_F(v: number): number {
  return SP_COLOR_U_TO_F(SP_RGBA32_G_U(v));
}
export function SP_RGBA32_B_F(v: number): number {
  return SP_COLOR_U_TO_F(SP_RGBA32_B_U(v));
}
export function SP_RGBA32_A_F(v: number): number {
  return SP_COLOR_U_TO_F(SP_RGBA32_A_U(v));
}
export function SP_RGBA32_U_COMPOSE(r: number, g: number, b: number, a: number): number {
  return (((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | (a & 0xff)) >>> 0;
}
export function SP_RGBA32_F_COMPOSE(r: number, g: number, b: number, a: number): number {
  return SP_RGBA32_U_COMPOSE(SP_COLOR_F_TO_U(r), SP_COLOR_F_TO_U(g), SP_COLOR_F_TO_U(b), SP_COLOR_F_TO_U(a));
}
export function SP_RGBA32_C_COMPOSE(c: number, o: number): number {
  return SP_RGBA32_U_COMPOSE(SP_RGBA32_R_U(c), SP_RGBA32_G_U(c), SP_RGBA32_B_U(c), SP_COLOR_F_TO_U(o));
}
export function compose_argb32(a: number, r: number, g: number, b: number): number {
  return SP_RGBA32_U_COMPOSE(SP_COLOR_F_TO_U(a), SP_COLOR_F_TO_U(r), SP_COLOR_F_TO_U(g), SP_COLOR_F_TO_U(b));
}

/**
 * Parse a color directly without any CSS or CMS support. This function is ONLY
 * intended to parse values stored in inkscape specific screen-attributes and
 * preferences.
 *
 * DO NOT use this as a common color parser, it does not support any other format
 * other than RRGGBBAA and anything else will cause an error.
 *
 * @arg value - Must be in format #RRGGBBAA only or an empty string.
 */
export function hex_to_rgba(value: string): number {
  if (value === '') return 0x0;
  if (!/^#[0-9a-fA-F]{8}$/.test(value)) {
    throw new ColorError('Baddly formatted color, it must be in #RRGGBBAA format');
  }
  return Number.parseInt(value.slice(1), 16) >>> 0;
}

/**
 * Convert a 32bit unsigned int into a set of 3 or 4 double values for rgba.
 *
 * @arg rgba - The integer in the format 0xRRGGBBAA
 * @arg opacity - Include the opacity channel, if false throws opacity away.
 *
 * @returns the values of the rgba channels between 0.0 and 1.0
 */
export function rgba_to_values(rgba: number, opacity: boolean): number[] {
  const values = [SP_RGBA32_R_F(rgba), SP_RGBA32_G_F(rgba), SP_RGBA32_B_F(rgba)];
  if (opacity) values.push(SP_RGBA32_A_F(rgba));
  return values;
}

/**
 * Output the RGBA value as a #RRGGBB hex color, if alpha is true
 * then the output will be #RRGGBBAA instead.
 */
export function rgba_to_hex(value: number, alpha = false, uppercase = false): string {
  const hex = (alpha ? value >>> 0 : value >>> 8).toString(16).padStart(alpha ? 8 : 6, '0');
  return `#${uppercase ? hex.toUpperCase() : hex}`;
}

/**
 * Create a somewhat unique id for the given color used for palette identification.
 */
export function color_to_id(color: Color | undefined): string {
  if (!color) return 'none';
  const name = color.getName();
  if (name !== '' && name[0] !== '#') return desc_to_id(name);
  // Special case cssname
  const space = color.getSpace();
  if (space.getType() === SpaceType.CSSNAME && (space as NamedColor).getNameFor(color.toRGBA()) !== '') {
    return `css-${color.toString()}`;
  }
  let ret = `${space.getName()}-`;
  for (const value of color.getValues()) {
    // (unsigned int)(value * 0xff), printed as hex with at least two digits
    ret += (Math.trunc(value * 0xff) >>> 0).toString(16).padStart(2, '0');
  }
  return ret.toLowerCase();
}

/**
 * Transform a color name or description into an id used for palette identification.
 */
export function desc_to_id(desc: string): string {
  // Convert description to ascii, strip out symbols, remove duplicate dashes and prefixes
  let name = desc.replace(/[^a-zA-Z0-9]/g, '-');
  name = name.replace(/-{2,}/g, '-');
  name = name.replace(/(^-|-$)/g, '');
  // Move important numbers from the start where they are invalid xml, to the end.
  name = name.replace(/^(\d+)(-?)([^\d]*)/, '$3$2$1');
  return name.toLowerCase();
}

/**
 * Make a darker or lighter version of the color, useful for making checkerboards.
 */
export function make_contrasted_color(orig: Color, amount: number): Color {
  const color = orig.converted(SpaceType.HSL);
  if (color) {
    const lightness = color.get(2);
    color.set(2, lightness + (lightness < 0.08 ? 0.08 : -0.08) * amount);
    color.convert(orig.getSpace());
    return color;
  }
  return orig;
}

/**
 * Make a themed dark or light color based on a previous shade, returns RGB color.
 */
export function make_theme_color(orig: Color, dark: boolean): Color {
  // color of the image strip to HSL, so we can manipulate its lightness
  const color = orig.converted(SpaceType.HSLUV)!;
  if (dark) {
    // limit saturation to improve contrast with some artwork
    color.set(1, Math.min(color.get(1), 0.8));
    // make a darker shade and limit to remove extremes
    color.set(2, Math.min(color.get(2) * 0.7, 0.3));
  } else {
    // make a lighter shade and limit to remove extremes
    color.set(2, Math.max(color.get(2) + (1.0 - color.get(2)) * 0.5, 0.8));
  }
  return color.converted(SpaceType.RGB)!;
}

/**
 * Make a disabled color, a desaturated version of the given color.
 */
export function make_disabled_color(orig: Color, dark: boolean): Color {
  const hsl = orig.converted(SpaceType.HSLUV)!;
  // reduce saturation and lightness/darkness (on dark/light theme)
  const lf = 0.35; // lightness factor - 35% of lightness
  const sf = 0.3; // saturation factor - 30% of saturation
  // for both light and dark themes the idea it to compress full range of color lightness (0..1)
  // to a narrower range to convey subdued look of disabled widget (that's the lf * l part);
  // then we move the lightness floor to 0.70 for light theme and 0.20 for dark theme:
  const saturation = hsl.get(1) * sf;
  const lightness = lf * hsl.get(2) + (dark ? 0.2 : 0.7); // new lightness in 0..1 range
  hsl.set(1, saturation);
  hsl.set(2, lightness);
  return hsl.converted(SpaceType.RGB)!;
}

export function perceptual_lightness(l: number): number {
  return l <= 0.885645168 ? l * 0.09032962963 : Math.cbrt(l) * 0.249914424 - 0.16;
}

/**
 * Return a value for how the light the color appears to be using HSLUV
 */
export function get_perceptual_lightness(color: Color): number {
  return perceptual_lightness(color.converted(SpaceType.HSLUV)!.get(2) * 100);
}

export function get_contrasting_color(l: number): [number, number] {
  const l_threshold = 0.85;
  if (l > l_threshold) {
    // Draw dark over light.
    const t = (l - l_threshold) / (1.0 - l_threshold);
    return [0.0, 0.4 - 0.1 * t];
  }
  // Draw light over dark.
  const t = (l_threshold - l) / l_threshold;
  return [1.0, 0.6 + 0.1 * t];
}

/** Premultiply a vector of colour channels in place, assuming alpha is last. */
export function premultiply(vec: number[]): void {
  const alpha = vec[vec.length - 1]!;
  for (let i = 0; i < vec.length - 1; i++) {
    vec[i]! *= alpha;
  }
}

export function premultiplied(vec: readonly number[]): number[] {
  const copy = [...vec];
  premultiply(copy);
  return copy;
}

/** Unpremultiply a vector of colour channels in place, assuming alpha is last. */
export function unpremultiply(vec: number[]): void {
  const alpha = vec[vec.length - 1]!;
  if (alpha === 0) return;
  for (let i = 0; i < vec.length - 1; i++) {
    vec[i]! /= alpha;
  }
}

export function unpremultiplied(vec: readonly number[]): number[] {
  const copy = [...vec];
  unpremultiply(copy);
  return copy;
}
