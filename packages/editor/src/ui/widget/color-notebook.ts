// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/widget/color-notebook.cpp, src/ui/widget/color-notebook.h, src/ui/widget/color-entry.cpp
/*
 * Color editor logic: the conversions between the colors of the document and the values that
 * the sliders, the picker area and the hex entry show.
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Tomasz Boczkowski <penginsbacon@gmail.com>
 *
 * Copyright (C) 2001-2014 Authors
 */
import { Colors } from '@inkscape-web/core';

/** A color as hue, saturation, value and opacity, all from 0 to 1. */
export interface Hsva {
  h: number;
  s: number;
  v: number;
  a: number;
}

/** A color as red, green, blue and opacity, each from 0 to 255. */
export type Rgba8 = [r: number, g: number, b: number, a: number];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** The sRGB color of the components, with opacity. */
export function colorFromRgba8([r, g, b, a]: Rgba8): Colors.Color {
  return new Colors.Color(Colors.SpaceType.RGB, [r / 255, g / 255, b / 255, a / 255].map(clamp01));
}

/** The red, green, blue and opacity of color in sRGB, each rounded to 0..255. */
export function colorToRgba8(color: Colors.Color): Rgba8 {
  const rgba = color.toRGBA();
  return [(rgba >>> 24) & 0xff, (rgba >>> 16) & 0xff, (rgba >>> 8) & 0xff, rgba & 0xff];
}

/** The hue, saturation, value and opacity of color. Hue and saturation are 0 for grays. */
export function colorToHsva(color: Colors.Color): Hsva {
  const hsv = color.converted(Colors.SpaceType.HSV);
  const [h = 0, s = 0, v = 0, a = 1] = hsv?.getValues() ?? [];
  return { h, s, v, a };
}

/** The sRGB color for hsva, with opacity. */
export function colorFromHsva({ h, s, v, a }: Hsva): Colors.Color {
  const hsv = new Colors.Color(Colors.SpaceType.HSV, [clamp01(h), clamp01(s), clamp01(v), clamp01(a)]);
  return hsv.converted(Colors.SpaceType.RGB) ?? new Colors.Color(0x000000ff);
}

/** The color as hex digits "rrggbbaa", without "#". */
export function colorToHex(color: Colors.Color): string {
  return color.toRGBA().toString(16).padStart(8, '0');
}

/**
 * The color for text of the hex entry: "rgb", "rgba", "rrggbb" or "rrggbbaa" digits, with or
 * without "#". Colors without alpha digits are opaque. Returns undefined for other text.
 */
export function parseHexColor(text: string): Colors.Color | undefined {
  const digits = text.trim().replace(/^#/, '');
  if (!/^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(digits)) return undefined;
  const color = Colors.Color.parse(`#${digits}`);
  if (!color) return undefined;
  color.enableOpacity(true);
  return color;
}

/** A CSS linear-gradient from the sRGB color from to the color to (both opaque), left to right. */
function gradient(...stops: Colors.Color[]): string {
  return `linear-gradient(to right, ${stops.map((c) => c.toString(false)).join(', ')})`;
}

/**
 * The CSS background of the slider for a channel of color: it shows the color for each value of
 * the channel. Channels are "r", "g", "b", "a" (with a checkerboard under it), "h", "s", "v".
 */
export function sliderBackground(
  channel: 'r' | 'g' | 'b' | 'a' | 'h' | 's' | 'v',
  color: Colors.Color,
): string {
  const [r, g, b] = colorToRgba8(color);
  const hsva = colorToHsva(color);
  const rgb = (r: number, g: number, bl: number) => colorFromRgba8([r, g, bl, 255]);
  const hsv = (p: Partial<Hsva>) => colorFromHsva({ ...hsva, a: 1, ...p });
  switch (channel) {
    case 'r':
      return gradient(rgb(0, g, b), rgb(255, g, b));
    case 'g':
      return gradient(rgb(r, 0, b), rgb(r, 255, b));
    case 'b':
      return gradient(rgb(r, g, 0), rgb(r, g, 255));
    case 'a':
      return `linear-gradient(to right, rgb(${r} ${g} ${b} / 0), rgb(${r} ${g} ${b} / 1))`;
    case 'h':
      return gradient(
        ...[0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1].map((h) => colorFromHsva({ h, s: 1, v: 1, a: 1 })),
      );
    case 's':
      return gradient(hsv({ s: 0 }), hsv({ s: 1 }));
    case 'v':
      return gradient(hsv({ v: 0 }), hsv({ v: 1 }));
  }
}
