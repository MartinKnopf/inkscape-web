// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-polygon.cpp, src/object/sp-polygon.h
/*
 * SVG <polygon> implementation
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Abhishek Sharma
 *   Jon A. Cruz <jon@joncruz.org>
 *
 * Copyright (C) 1999-2002 Lauris Kaplinski
 * Copyright (C) 2000-2001 Ximian, Inc.
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { LineSegment, Path, type PathVector, Point } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import type { SPDocument } from '../document.ts';
import { _ } from '../i18n.ts';
import { svgNumber } from '../svg/stringstream.ts';
import { readNumberPrefix } from '../svg/svg-length.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import { SP_OBJECT_WRITE_BUILD } from './sp-object.ts';
import { SPShape } from './sp-shape.ts';

export enum SPPolyParseError {
  POLY_OK,
  POLY_END_OF_STRING,
  POLY_INVALID_NUMBER,
  POLY_NOT_A_NUMBER,
  POLY_INFINITE_VALUE,
}

/**
 * Write the points attribute for a polygon tag.
 * pathv may only contain paths with only straight line segments.
 */
function sp_svg_write_polygon(pathv: PathVector): string {
  let os = '';
  for (const pit of pathv) {
    for (const cit of pit.curves()) {
      if (!cit.isLineSegment()) {
        throw new Error('sp_svg_write_polygon: polygon path contains non-straight line segments');
      }
      os += `${svgNumber(cit.finalPoint().x)},${svgNumber(cit.finalPoint().y)} `;
    }
  }
  return os;
}

/**
 * Parse a double from the start of `p.s` and advance `p.s` past it.
 * `value` is only valid when `error` is POLY_OK.
 */
export function sp_poly_get_value(p: { s: string }): { error: SPPolyParseError; value: number } {
  p.s = p.s.replace(/^[, \t\r\n]+/, '');
  if (p.s === '') return { error: SPPolyParseError.POLY_END_OF_STRING, value: 0 };
  const num = readNumberPrefix(p.s);
  // TODO: g_ascii_strtod also reads "nan" and "inf"; they are an invalid number here.
  if (!num) return { error: SPPolyParseError.POLY_INVALID_NUMBER, value: 0 };
  if (Number.isNaN(num.value)) return { error: SPPolyParseError.POLY_NOT_A_NUMBER, value: 0 };
  if (!Number.isFinite(num.value)) return { error: SPPolyParseError.POLY_INFINITE_VALUE, value: 0 };
  p.s = num.rest;
  return { error: SPPolyParseError.POLY_OK, value: num.value };
}

/** Print a warning message related to the parsing of a 'points' attribute. */
function sp_poly_print_warning(points: string, errorLocation: string, error: SPPolyParseError): void {
  switch (error) {
    case SPPolyParseError.POLY_END_OF_STRING: {
      const MAX_DISPLAY_SIZE = 64;
      const s =
        points.length > MAX_DISPLAY_SIZE ? `... ${points.slice(points.length - MAX_DISPLAY_SIZE)}` : points;
      console.warn(`Error parsing a 'points' attribute: string ended unexpectedly!\n\t"${s}"`);
      break;
    }
    case SPPolyParseError.POLY_INVALID_NUMBER:
      console.warn(`Invalid number in the 'points' attribute:\n\t"(...) ${errorLocation}"`);
      break;
    case SPPolyParseError.POLY_INFINITE_VALUE:
      console.warn(`Infinity is not allowed in the 'points' attribute:\n\t"(...) ${errorLocation}"`);
      break;
    case SPPolyParseError.POLY_NOT_A_NUMBER:
      console.warn(`NaN-value is not allowed in the 'points' attribute:\n\t"(...) ${errorLocation}"`);
      break;
    default:
      break;
  }
}

/**
 * Parse a 'points' attribute, printing a warning when an error occurs.
 * Returns the open polyline, or null when there is not a single point.
 */
export function sp_poly_parse_curve(points: string): Path | null {
  let result: Path | null = null;
  const cptr = { s: points };
  for (;;) {
    const x = sp_poly_get_value(cptr);
    if (x.error) {
      // If the error is something other than end of input, we must report it.
      // End of input is allowed when scanning for the next x coordinate: it
      // simply means that we have reached the end of the coordinate list.
      if (x.error !== SPPolyParseError.POLY_END_OF_STRING) sp_poly_print_warning(points, cptr.s, x.error);
      break;
    }
    const y = sp_poly_get_value(cptr);
    if (y.error) {
      // End of input is not allowed when scanning for y.
      sp_poly_print_warning(points, cptr.s, y.error);
      break;
    }
    const p = new Point(x.value, y.value);
    if (result) result.appendCurve(new LineSegment(result.finalPoint(), p));
    else result = new Path(p);
  }
  return result;
}

/** svg:polygon (upstream SPPolygon). */
export class SPPolygon extends SPShape {
  override typeName(): string {
    return 'path';
  }
  override description(): string {
    return _('<b>Polygon</b>');
  }

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.POINTS);
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    // Tolerable workaround: we need to update the object's curve before we set points=
    // because it's out of sync when e.g. some extension attrs of the polygon are changed in XML editor
    this.set_shape();

    if (flags & SP_OBJECT_WRITE_BUILD && !repr) repr = xmlDoc.createElement('svg:polygon');
    if (!repr) return null;

    /* We can safely write points here, because all subclasses require it too (Lauris) */
    /* While saving polygon element without points attribute _curve is NULL (see bug 1202753) */
    if (this._curve) repr.setAttribute('points', sp_svg_write_polygon(this._curve));

    return super.write(xmlDoc, repr, flags);
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.POINTS: {
        if (value === null) {
          /* fixme: The points attribute is required.  We should handle its absence as per
           * http://www.w3.org/TR/SVG11/implnote.html#ErrorProcessing. */
          break;
        }
        const curve = sp_poly_parse_curve(value) ?? new Path();
        curve.close();
        this.setCurve([curve]);
        break;
      }
      default:
        super.set(key, value);
        break;
    }
  }
}
