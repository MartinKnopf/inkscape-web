// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/gimpgrad.cpp, src/extension/internal/gimpgrad.h
/*
 * Authors:
 *   Ted Gould <ted@gould.cx>
 *
 * Copyright (C) 2004-2005 Authors
 */
import { Colors, cssNumber, N_, SPDocument } from '@inkscape-web/core';
import { Implementation } from '../implementation/implementation.ts';
import type { Input } from '../input.ts';
import { INKSCAPE_EXTENSION_URI } from '../prefdialog/widget.ts';
import { build_from_mem } from '../system.ts';

/**
 * A function to turn a color into a gradient stop (upstream stop_svg): the text of the
 * svg:stop element.
 */
function stop_svg(in_color: Colors.Color, location: number): string {
  let ret = `<stop stop-color="${in_color.converted(Colors.SpaceType.RGB)?.toString(false)}"`;
  if (in_color.getOpacity() !== 1) ret += ` stop-opacity="${cssNumber(in_color.getOpacity())}"`;
  return `${ret} offset="${cssNumber(location)}"/>\n`;
}

/**
 * The SVG text of a GIMP gradient (upstream GimpGrad::open before it creates the document);
 * null if the text is no GIMP gradient (the old format and invalid files).
 *
 * GIMP gradients have a left, middle and right position per segment, SVG gradients have no
 * middle: the average of the left and the right color goes to the middle position. All
 * segments are taken as linear (the type and color space of the interpolation are ignored).
 * If the right color of a segment equals the left color of the next one, only one stop is made.
 */
export function gimpgrad_to_svg(text: string): string | null {
  const lines = text.split('\n');
  // A line ends with "\n" in the file; a missing newline on the last line makes it invalid, as
  // in upstream.
  const last_line_open = !text.endsWith('\n');
  if (lines.length < 3 || lines[0] !== 'GIMP Gradient') return null;
  if (!lines[1]!.startsWith('Name: ')) return null;
  if (!/^[+-]?\d+$/.test(lines[2]!.trim()) || lines[2] !== lines[2]!.trimStart()) return null;
  const n_segs = Number.parseInt(lines[2]!, 10);
  if (n_segs < 1) return null;
  if (lines.length === 3 && last_line_open) return null;

  let prev_color = new Colors.Color(0x0);
  let outsvg = '<svg><defs><linearGradient>\n';
  let n_segs_found = 0;
  let prev_right = 0.0;
  const segments = lines.slice(3, last_line_open ? lines.length : -1);
  for (const line of segments) {
    // 11 numbers, each followed by white space (the end of the line after the last)
    const tokens = `${line}\n`.match(/\S+/g) ?? [];
    if (tokens.length < 11) return null;
    const dbls: number[] = [];
    for (const t of tokens.slice(0, 11)) {
      if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return null;
      const xi = Number(t);
      if (xi < 0 || xi > 1) return null;
      dbls.push(xi);
    }
    const [left, middle, right] = dbls as [number, number, number];
    if (left !== prev_right) return null;
    if (!(left <= middle)) return null;
    if (!(middle <= right)) return null;

    const leftcolor = new Colors.Color(Colors.SpaceType.RGB, dbls.slice(3, 7));
    const rightcolor = new Colors.Color(Colors.SpaceType.RGB, dbls.slice(7, 11));

    // Interpolation enums: curve shape and colour space. Both are ignored, but a segment
    // without them is skipped.
    if (tokens.length < 13 || !/^-?\d+$/.test(tokens[11]!) || !/^-?\d+$/.test(tokens[12]!)) continue;

    if (!prev_color.equals(leftcolor)) outsvg += stop_svg(leftcolor, left);
    if (Math.abs(middle - 0.5 * (left + right)) > 1e-4)
      outsvg += stop_svg(leftcolor.averaged(rightcolor), middle);
    outsvg += stop_svg(rightcolor, right);

    prev_color = rightcolor;
    prev_right = right;
    ++n_segs_found;
  }
  if (prev_right !== 1.0) return null;
  if (n_segs_found !== n_segs) return null;

  return `${outsvg}</linearGradient></defs></svg>`;
}

/** The input of GIMP gradients (upstream GimpGrad): a document with one linear gradient. */
export class GimpGrad extends Implementation {
  override async open(_module: Input, _name: string, data: Uint8Array): Promise<SPDocument | null> {
    const svg = gimpgrad_to_svg(new TextDecoder().decode(data));
    return svg ? SPDocument.createNewDocFromMem(svg) : null;
  }

  static init(): void {
    build_from_mem(
      `<inkscape-extension xmlns="${INKSCAPE_EXTENSION_URI}">\n` +
        `<name>${N_('GIMP Gradients')}</name>\n` +
        '<id>org.inkscape.input.gimpgrad</id>\n' +
        '<input>\n' +
        '<extension>.ggr</extension>\n' +
        '<mimetype>application/x-gimp-gradient</mimetype>\n' +
        `<filetypename>${N_('GIMP Gradient (*.ggr)')}</filetypename>\n` +
        `<filetypetooltip>${N_('Gradients used in GIMP')}</filetypetooltip>\n` +
        '</input>\n' +
        '</inkscape-extension>\n',
      new GimpGrad(),
    );
  }
}
