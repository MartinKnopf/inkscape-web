// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/svg/svg-length.cpp, src/svg/svg-length.h, src/svg/svg.h, src/util/units.cpp, src/util/numeric/converters.h
/*
 * SVG data parser
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Carl Hetherington <inkscape@carlh.net>
 *   bulia byak <buliabyak@users.sf.net>
 *
 * Copyright (C) 1999-2002 Lauris Kaplinski
 * Copyright (C) 2000-2001 Ximian, Inc.
 * Copyright (C) 2018 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

import { formatFixed, svgNumber } from './stringstream.ts';

// ---------------------------------------------------------------------------------------------
// Units
// Upstream reads these from share/ui/units.xml (Inkscape::Util::UnitTable). The factors below
// are copied from that file. Units are looked up by exact abbreviation.
// ---------------------------------------------------------------------------------------------

export enum UnitType {
  DIMENSIONLESS,
  LINEAR,
  LINEAR_SCALED,
  RADIAL,
  TIME,
  FONT_HEIGHT,
  QTY,
  NONE = -1,
}

export interface Unit {
  type: UnitType;
  /** Conversion factor to the primary unit of the same type. */
  factor: number;
  abbr: string;
}

/** Degree abbreviation. Upstream: Inkscape::Util::DEG */
export const DEG = '°';

const UNITS: readonly Unit[] = [
  { type: UnitType.LINEAR, factor: 1.0, abbr: 'px' },
  { type: UnitType.LINEAR, factor: 96.0, abbr: 'in' },
  { type: UnitType.LINEAR, factor: 1152.0, abbr: 'ft' },
  { type: UnitType.LINEAR, factor: 3.779527559055119, abbr: 'mm' },
  { type: UnitType.LINEAR, factor: 37.79527559055119, abbr: 'cm' },
  { type: UnitType.LINEAR, factor: 3779.527559055119, abbr: 'm' },
  { type: UnitType.LINEAR, factor: 1.333333333333333, abbr: 'pt' },
  { type: UnitType.LINEAR, factor: 16.0, abbr: 'pc' },
  { type: UnitType.RADIAL, factor: 1.0, abbr: DEG },
  { type: UnitType.RADIAL, factor: 57.29577951308232, abbr: 'rad' },
  { type: UnitType.RADIAL, factor: 0.9, abbr: 'grad' },
  { type: UnitType.RADIAL, factor: 360, abbr: 'turn' },
  { type: UnitType.FONT_HEIGHT, factor: 1.0, abbr: 'em' },
  { type: UnitType.FONT_HEIGHT, factor: 0.5, abbr: 'ex' },
  { type: UnitType.FONT_HEIGHT, factor: 0.5, abbr: 'en' },
  { type: UnitType.DIMENSIONLESS, factor: 1.0, abbr: '%' },
];

const UNIT_MAP = new Map(UNITS.map((u) => [u.abbr, u]));

/** The unit returned for unknown abbreviations. Upstream: UnitTable::_empty_unit */
const EMPTY_UNIT: Unit = { type: UnitType.DIMENSIONLESS, factor: 1.0, abbr: '' };

/** The units of type, in the order of the unit table (upstream UnitTable::units). */
export function unitsOfType(type: UnitType): readonly Unit[] {
  return UNITS.filter((u) => u.type === type);
}

/** The abbreviation of the primary unit of type: px, degrees or % (upstream UnitTable::primary). */
export function primaryUnit(type: UnitType): string {
  return type === UnitType.LINEAR
    ? 'px'
    : type === UnitType.RADIAL
      ? DEG
      : type === UnitType.DIMENSIONLESS
        ? '%'
        : '';
}

/** Upstream: UnitTable::getUnit(abbr). Unknown abbreviations give the empty unit. */
export function getUnit(abbr: string): Unit {
  return UNIT_MAP.get(abbr) ?? EMPTY_UNIT;
}

/** Upstream: Unit::convert. Incompatible units give -1. */
function convertWith(fromDist: number, from: Unit, to: Unit): number {
  // Percentage
  if (to.type === UnitType.DIMENSIONLESS) return fromDist * to.factor;
  // Incompatible units
  if (from.type !== to.type) return -1;
  return (fromDist * from.factor) / to.factor;
}

/** Upstream: Inkscape::Util::Quantity::convert(from_dist, from, to) with unit abbreviations. */
export function convertUnit(fromDist: number, from: string, to: string): number {
  return convertWith(fromDist, getUnit(from), getUnit(to));
}

/**
 * Format a number with `precision` digits after the decimal point and no trailing zeros.
 * Upstream: Inkscape::Util::format_number
 */
export function formatNumber(val: number, precision = 3): string {
  let ret = formatFixed(val, precision);
  while (ret.includes('.') && (ret.endsWith('0') || ret.endsWith('.'))) ret = ret.slice(0, -1);
  return ret;
}

// ---------------------------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------------------------

// What g_ascii_strtod accepts, except hex, "inf" and "nan" (those never give a finite length
// that Inkscape would accept in these callers, and hex floats do not occur in SVG).
const NUMBER_RE = /^[ \t\n\v\f\r]*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/;

/** Read a number prefix, like g_ascii_strtod. Returns the value and the rest of the string. */
export function readNumberPrefix(str: string): { value: number; rest: string } | null {
  const m = NUMBER_RE.exec(str);
  if (!m) return null;
  return { value: Number(m[1]), rest: str.slice(m[0].length) };
}

/** Upstream: sp_svg_number_read_d. Returns null when `str` does not start with a number. */
export function spSvgNumberReadD(str: string | null | undefined): number | null {
  if (str == null) return null;
  return readNumberPrefix(str)?.value ?? null;
}

/** Upstream: sp_svg_number_write_d (static) */
function spSvgNumberWriteD(val: number, tprec: number, fprec: number): string {
  let buf = '';
  // Process sign
  if (val < 0.0) {
    buf += '-';
    val = Math.abs(val);
  }
  // Determine number of integral digits
  let idigits = 0;
  if (val >= 1.0) idigits = Math.floor(Math.log10(val)) + 1;
  // Determine the actual number of fractional digits
  fprec = Math.max(fprec, tprec - idigits);
  // Round value
  val += 0.5 / 10.0 ** fprec;
  // Extract integral and fractional parts
  let dival = Math.floor(val);
  let fval = val - dival;
  // Write integral part
  if (idigits > tprec) {
    buf += String(Math.floor(dival / 10.0 ** (idigits - tprec) + 0.5));
    buf += '0'.repeat(idigits - tprec);
  } else {
    buf += String(dival);
  }
  if (fprec > 0 && fval > 0.0) {
    let s = '.';
    do {
      fval *= 10.0;
      dival = Math.floor(fval);
      fval -= dival;
      s += String(dival);
      if (dival !== 0) {
        buf += s;
        s = '';
      }
      fprec -= 1;
    } while (fprec > 0 && fval > 0.0);
  }
  return buf;
}

/**
 * Write a number with `tprec` significant digits, using `e` notation when that is shorter.
 * Values with an exponent below `minExp` are written as "0".
 * Upstream: sp_svg_number_write_de
 */
export function spSvgNumberWriteDe(val: number, tprec: number, minExp: number): string {
  const evalue = Math.floor(Math.log10(Math.abs(val)));
  if (val === 0.0 || evalue < minExp) return '0';
  // This doesn't include the sign because it is included in either representation
  const maxNumDigitsWithoutExp =
    evalue < 0 ? tprec + -evalue + 1 : evalue + 1 < tprec ? tprec + 1 : evalue + 1;
  // It's not necessary to take larger exponents into account, because then
  // maxNumDigitsWithoutExp is DEFINITELY larger
  const maxNumDigitsWithExp = tprec + (evalue < 0 ? 4 : 3);
  if (maxNumDigitsWithoutExp <= maxNumDigitsWithExp) {
    return spSvgNumberWriteD(val, tprec, 0);
  }
  val = evalue < 0 ? val * 10.0 ** -evalue : val / 10.0 ** evalue;
  return `${spSvgNumberWriteD(val, tprec, 0)}e${evalue}`;
}

// ---------------------------------------------------------------------------------------------
// SVGLength
// ---------------------------------------------------------------------------------------------

/** Upstream: SVGLength::Unit. The values index the SVG length units. */
export enum SVGLengthUnit {
  NONE,
  PX,
  PT,
  PC,
  MM,
  CM,
  INCH,
  EM,
  EX,
  PERCENT,
  LAST_UNIT = PERCENT,
}

/** Unit abbreviations by SVGLengthUnit. Upstream: svg_length_lookup in units.cpp */
const SVG_LENGTH_ABBR = ['', 'px', 'pt', 'pc', 'mm', 'cm', 'in', 'em', 'ex', '%'] as const;

/** The abbreviation of an SVG length unit; px for none (upstream SPDocument::getWidth().unit->abbr). */
export function svgLengthUnitAbbr(u: SVGLengthUnit): string {
  return SVG_LENGTH_ABBR[u] || 'px';
}

/** Upstream: Unit::svgUnit. Units without an SVG length unit (ft, m, ...) give NONE. */
export function svgUnitOf(abbr: string): SVGLengthUnit {
  const i = SVG_LENGTH_ABBR.indexOf(abbr as (typeof SVG_LENGTH_ABBR)[number]);
  return i === -1 ? SVGLengthUnit.NONE : i;
}

/** Upstream: svg_length_absolute_unit */
export function svgLengthAbsoluteUnit(u: SVGLengthUnit): boolean {
  return u !== SVGLengthUnit.EM && u !== SVGLengthUnit.EX && u !== SVGLengthUnit.PERCENT;
}

interface ParsedLength {
  unit: SVGLengthUnit;
  value: number;
  computed: number;
  /** The text after the number, unit and trailing white space. */
  rest: string;
}

/**
 * Parse a number with an optional unit.
 *
 * For absolute units `computed` is the value in px. For em and ex `computed` is -1 (callers use
 * {@link SVGLength.update}). A percentage is divided by 100 (100% is 1.0) and `computed` is the
 * same. No white space is allowed between the number and the unit.
 *
 * @param abs If true, only absolute units are accepted.
 * @param more If true, text may follow (used for lists), otherwise it is a failure.
 * Upstream: parse_number_with_unit
 */
export function parseNumberWithUnit(
  str: string | null | undefined,
  abs: boolean,
  more = false,
): ParsedLength | null {
  if (str == null) return null;
  const num = readNumberPrefix(str);
  if (!num || !Number.isFinite(num.value)) return null;
  const { value } = num;

  // Collect the unit, no spaces are allowed after the number
  const unitMatch = /^[%a-zA-Z]*/.exec(num.rest);
  const unitStr = unitMatch ? unitMatch[0] : '';
  // Trim the remaining spaces
  const rest = num.rest.slice(unitStr.length).replace(/^[ \n\r\t]+/, '');

  const u = getUnit(unitStr);
  if (unitStr !== u.abbr) return null;
  if (abs && !(u.type !== UnitType.DIMENSIONLESS && u.type !== UnitType.FONT_HEIGHT) && unitStr.length) {
    return null;
  }
  // If we expect to parse more, return the rest. Otherwise fail.
  if (!more && rest.length) return null;

  const unit = svgUnitOf(u.abbr);
  // Percent is handled as its own computed value (FIXME upstream!)
  if (unit === SVGLengthUnit.PERCENT) {
    return { unit, value: value / 100.0, computed: value / 100.0, rest };
  }
  return { unit, value, computed: unit ? convertWith(value, u, getUnit('px')) : value, rest };
}

/** Upstream: sp_svg_length_list_read */
export function spSvgLengthListRead(str: string | null | undefined): SVGLength[] {
  if (str == null) return [];
  const list: SVGLength[] = [];
  let next = str;
  for (;;) {
    const p = parseNumberWithUnit(next, false, true);
    if (!p) break;
    const length = new SVGLength();
    length.set(p.unit, p.value, p.computed);
    list.push(length);
    next = p.rest;
    // Allow for a single comma in the number list between values
    if (next.startsWith(',')) next = next.slice(1);
  }
  return list;
}

/** Upstream: sp_svg_read_percentage */
export function spSvgReadPercentage(str: string | null | undefined, def: number): number {
  const p = parseNumberWithUnit(str, false);
  if (p && (p.unit === SVGLengthUnit.NONE || p.unit === SVGLengthUnit.PERCENT)) return p.value;
  return def;
}

/** Upstream: Inkscape::refX_named_to_percent */
export function refXNamedToPercent<T extends string | null | undefined>(str: T): T | '0%' | '50%' | '100%' {
  if (str === 'left') return '0%';
  if (str === 'center') return '50%';
  if (str === 'right') return '100%';
  return str;
}

/** Upstream: Inkscape::refY_named_to_percent */
export function refYNamedToPercent<T extends string | null | undefined>(str: T): T | '0%' | '50%' | '100%' {
  if (str === 'top') return '0%';
  if (str === 'center') return '50%';
  if (str === 'bottom') return '100%';
  return str;
}

/** SVG length type */
export class SVGLength {
  /** The object's value is valid / exists in SVG. */
  _set = false;
  /** If this was found through chaining hrefs (in gradients). */
  _found = false;
  /** The unit of value. */
  unit: SVGLengthUnit = SVGLengthUnit.NONE;
  /** The value of this SVGLength as found in the SVG. */
  value = 0;
  /** The value in pixels (value * pixels/unit). */
  computed = 0;

  /** Upstream: SVGLength::operator= (double). Sets a unitless value. */
  assign(v: number): number {
    this._set = true;
    this.unit = SVGLengthUnit.NONE;
    this.value = this.computed = v;
    return v;
  }

  /** Upstream: SVGLength::operator==. Percentages compare by value, others by computed value. */
  equals(rhs: SVGLength): boolean {
    if (rhs.unit !== this.unit) return false;
    if (this.unit === SVGLengthUnit.PERCENT) return this.value === rhs.value;
    return this.computed === rhs.computed;
  }

  /** Upstream: SVGLength::operator bool */
  isSet(): boolean {
    return this._set;
  }

  /** A new SVGLength with the same fields. Upstream: copy construction */
  copy(): SVGLength {
    const c = new SVGLength();
    c._set = this._set;
    c._found = this._found;
    c.unit = this.unit;
    c.value = this.value;
    c.computed = this.computed;
    return c;
  }

  read(str: string | null | undefined): boolean {
    return this.#readParsed(parseNumberWithUnit(str, false));
  }

  readAbsolute(str: string | null | undefined): boolean {
    return this.#readParsed(parseNumberWithUnit(str, true));
  }

  #readParsed(p: ParsedLength | null): boolean {
    // Like upstream, the fields stay as they are when parsing fails.
    this._set = p !== null;
    if (p) {
      this.unit = p.unit;
      this.value = p.value;
      this.computed = p.computed;
    }
    return this._set;
  }

  readOrUnset(str: string | null | undefined, u = SVGLengthUnit.NONE, v = 0, c = 0): void {
    if (!this.read(str)) this.unset(u, v, c);
  }

  /** The unit as a unit table entry. Upstream: SVGLength::getUnit */
  getUnit(): Unit {
    return getUnit(SVG_LENGTH_ABBR[this.unit]);
  }

  /** True if the unit is set and is not a relative unit (em, ex, percent). */
  isAbsolute(): boolean {
    return this.unit !== SVGLengthUnit.NONE && svgLengthAbsoluteUnit(this.unit);
  }

  /**
   * Write the length with its unit as in an SVG file. Percentages are written as such, px is
   * left out. May use `e` notation, so it is not suitable for CSS.
   * Upstream: SVGLength::write, sp_svg_length_write_with_units
   */
  write(): string {
    const abbr = this.getUnit().abbr;
    if (this.unit === SVGLengthUnit.PERCENT) return svgNumber(100 * this.value) + abbr;
    if (this.unit === SVGLengthUnit.PX) return svgNumber(this.value);
    return svgNumber(this.value) + abbr;
  }

  /**
   * Write out the length in a user unit, for the user to see.
   *
   * @param outUnit The unit to convert the computed px into
   * @param docScale The document scale
   * @param precision Number of digits after the decimal point, default is the SVG output precision
   * @param addUnit Append the unit
   */
  toString(outUnit = 'px', docScale = 1, precision?: number, addUnit = true): string {
    if (this.unit === SVGLengthUnit.PERCENT) return this.write();
    const v = this.toValue(outUnit) * docScale;
    return (precision === undefined ? svgNumber(v) : formatNumber(v, precision)) + (addUnit ? outUnit : '');
  }

  /** The computed length converted to a unit. */
  toValue(outUnit: string): number {
    return convertUnit(this.computed, 'px', outUnit);
  }

  /**
   * Read from user input, any non-unitised value is converted internally.
   *
   * @param input The string input
   * @param defaultUnit The unit used by the display. Use an empty string for xml reading.
   * @param docScale The scale values with units should apply to make those units correct for this document.
   */
  fromString(input: string, defaultUnit: string, docScale?: number): boolean {
    if (!this.read(input + defaultUnit) && !this.read(input)) return false;
    // Rescale real units to document, since user input is not scaled
    if (docScale !== undefined && this.unit !== SVGLengthUnit.PERCENT && this.unit !== SVGLengthUnit.NONE) {
      this.value = this.computed;
      this.unit = SVGLengthUnit.NONE;
      this.scale(1 / docScale);
    }
    return true;
  }

  /** Sets the computed value from the unit and value, or all three values. */
  set(u: SVGLengthUnit, v: number, c?: number): void {
    this._set = true;
    this.unit = u;
    this.value = v;
    this.computed = c ?? convertWith(v, this.getUnit(), getUnit('px'));
  }

  /** Mark as unset and store the given values, or the values of another length. */
  unset(u: SVGLengthUnit | SVGLength = SVGLengthUnit.NONE, v = 0, c = 0): void {
    if (u instanceof SVGLength) {
      this._set = false;
      this._found = u._found;
      this.unit = u.unit;
      this.value = u.value;
      this.computed = u.computed;
      return;
    }
    this._set = false;
    this.unit = u;
    this.value = v;
    this.computed = c;
  }

  /** Scales value and computed, leaving the unit alone. */
  scale(scale: number): void {
    this.value *= scale;
    this.computed *= scale;
  }

  /** Updates the computed value of relative units. */
  update(em: number, ex: number, scale: number): void {
    if (this.unit === SVGLengthUnit.EM) this.computed = this.value * em;
    else if (this.unit === SVGLengthUnit.EX) this.computed = this.value * ex;
    else if (this.unit === SVGLengthUnit.PERCENT) this.computed = this.value * scale;
  }
}
