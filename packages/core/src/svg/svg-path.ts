// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/svg/svg-path.cpp
/*
 * svg-path.cpp: Parse SVG path element data into bezier path.
 * Authors:
 *   Johan Engelen
 *   (old nartbpath code that has been deleted: Raph Levien <raph@artofcode.com>)
 *   (old nartbpath code that has been deleted: Lauris Kaplinski <lauris@ximian.com>)
 *
 * Copyright (C) 2000 Eazel, Inc.
 * Copyright (C) 2000 Lauris Kaplinski
 * Copyright (C) 2001 Ximian, Inc.
 * Copyright (C) 2008 Johan Engelen
 *
 * Copyright (C) 2000-2008 authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

import {
  CubicBezier,
  type Curve,
  deg_from_rad,
  EllipticalArc,
  EPSILON,
  LineSegment,
  type Path,
  type PathVector,
  type Point,
  parse_svg_path,
  QuadraticBezier,
  SVGPathParseError,
} from '@inkscape-web/geom';
import { PATHSTRING_FORMAT, PathString, type PathStringOptions } from './path-string.ts';

/**
 * Parses the path in str. When an error is found in the pathstring, this method
 * returns a truncated path up to where the error was found in the pathstring.
 * Returns an empty PathVector when str is null or undefined.
 */
export function sp_svg_read_pathv(str: string | null | undefined): PathVector {
  if (str == null) return []; // return empty pathvector when str == NULL

  try {
    return parse_svg_path(str, { zSnapThreshold: EPSILON });
  } catch (e) {
    if (!(e instanceof SVGPathParseError)) throw e;
    console.warn(
      `Malformed SVG path, truncated path up to where error was found.\n Input path="${str}"\n Parsed path="${sp_svg_write_path(e.partial)}"`,
    );
    return e.partial;
  }
}

function sp_svg_write_curve(str: PathString, c: Curve, normalize = false): void {
  if (c instanceof LineSegment) {
    const [p0, p1] = [c.initialPoint(), c.finalPoint()];
    if (!normalize && p0.x === p1.x) {
      str.verticalLineTo(p1.y);
    } else if (!normalize && p0.y === p1.y) {
      str.horizontalLineTo(p1.x);
    } else {
      str.lineTo(p1);
    }
  } else if (c instanceof QuadraticBezier) {
    const [p0, p1, p2] = c.controlPoints() as [Point, Point, Point];
    if (normalize) {
      // Convert to bezier curve
      const x1 = (1.0 / 3) * p0.x + (2.0 / 3) * p1.x;
      const x2 = (2.0 / 3) * p1.x + (1.0 / 3) * p2.x;
      const y1 = (1.0 / 3) * p0.y + (2.0 / 3) * p1.y;
      const y2 = (2.0 / 3) * p1.y + (1.0 / 3) * p2.y;
      str.curveTo(x1, y1, x2, y2, p2.x, p2.y);
    } else {
      str.quadTo(p1.x, p1.y, p2.x, p2.y);
    }
  } else if (c instanceof CubicBezier) {
    const [, p1, p2, p3] = c.controlPoints() as [Point, Point, Point, Point];
    str.curveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
  } else if (c instanceof EllipticalArc) {
    str.arcTo(
      c.ray(0),
      c.ray(1),
      deg_from_rad(c.rotationAngle().radians()),
      c.largeArc(),
      c.sweep(),
      c.finalPoint(),
    );
  } else {
    // Upstream converts other curve types (SBasis) to cubic Beziers; there are none in the TS port.
    throw new Error('sp_svg_write_curve: unsupported curve type');
  }
}

function write_path(str: PathString, p: Path, normalize = false): void {
  str.moveTo(p.initialPoint());

  for (const c of p.openCurves()) {
    sp_svg_write_curve(str, c, normalize);
  }

  if (p.closed()) {
    str.closePath();
  }
}

/** Settings of sp_svg_write_path. */
export interface SvgWritePathOptions {
  /**
   * Write absolute coordinates with 4 digits, only cubic Beziers and no H/V commands
   * (only for a PathVector). The `pathString` options are ignored.
   */
  normalize?: boolean;
  /** Options of the PathString; the defaults are those of Inkscape's preferences. */
  pathString?: PathStringOptions;
}

/** Write path data of a PathVector or a single Path. */
export function sp_svg_write_path(p: PathVector | Path, options: SvgWritePathOptions = {}): string {
  if (!Array.isArray(p)) {
    const str = new PathString(options.pathString);
    write_path(str, p);
    return str.string();
  }
  const normalize = options.normalize ?? false;
  const str = normalize
    ? new PathString({
        format: PATHSTRING_FORMAT.PATHSTRING_ABSOLUTE,
        precision: 4,
        minexp: -2,
        forceRepeatCommands: true,
      })
    : new PathString(options.pathString);

  for (const pit of p) {
    write_path(str, pit, normalize);
  }
  return str.string();
}
