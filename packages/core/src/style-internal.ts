// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/style-internal.cpp, src/style-internal.h, src/util/uri.cpp
/*
 * SVG stylesheets implementation - Classes used by SPStyle class.
 *
 * Authors:
 * C++ conversion:
 *   Tavmjong Bah <tavmjong@free.fr>
 * Legacy C implementation:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Peter Moulder <pmoulder@mail.csse.monash.edu.au>
 *   bulia byak <buliabyak@users.sf.net>
 *   Abhishek Sharma
 *   Kris De Gussem <Kris.DeGussem@gmail.com>
 *
 * Copyright (C) 2001-2002 Lauris Kaplinski
 * Copyright (C) 2001 Ximian, Inc.
 * Copyright (C) 2005 Monash University
 * Copyright (C) 2012 Kris De Gussem
 * Copyright (C) 2014, 2018 Tavmjong Bah
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

/*
 * General comments (from the header of the upstream file):
 *
 * Overview:
 *   Style can be obtained (in order of precedence)
 *     1. "style" property in an element (style="fill:red").
 *     2. Style sheet, internal or external (<style> rect {fill:red;}</style>).
 *     3. Attributes in an element (fill="red").
 *     4. Parent's style.
 *   A later property overrides an earlier property. This is implemented by
 *   reading in the properties backwards. If a property is already set, it
 *   prevents an earlier property from being read.
 *
 *   A declaration with an "!important" rule overrides any other declarations (except those that
 *   also have an "!important" rule). Attributes can not use the "!important" rule and the rule
 *   is not inherited.
 *
 *   In order for cascading to work, each element in the tree must be read in from top to bottom
 *   (parent before child). At each step, if a style property is not explicitly set, the property
 *   value is taken from the parent. Some properties have "computed" values that depend on:
 *      the parent's value (e.g. "font-size:larger"),
 *      another property value ("stroke-width":1em"), or
 *      an external value ("stroke-width:5%").
 *
 * To summarize:
 *
 *   An explicitly set value (including 'inherit') has a 'true' "set" flag.
 *   The "value" is either explicitly set or inherited.
 *   The "computed" value (if present) is calculated from "value" and some other input.
 *
 * Functions:
 *   write():    Write a property and its value to a string.
 *     Flags:
 *       ALWAYS: Always write out property.
 *       IFSET:  Write a property if 'set' flag is true, otherwise return empty string.
 *       IFDIFF: Write a property if computed values are different, otherwise return empty string,
 *               This is only used for text!!
 *       IFSRC   Write a property if the source matches the requested source (style sheet, etc.).
 *
 *   read():     Set a property value from a string.
 *   clear():    Set a property to its default value and set the 'set' flag to false.
 *   cascade():  Cascade the parent's property values to the child if the child's property
 *               is unset (and it allows inheriting) or the value is 'inherit'.
 *               Calculate computed values that depend on parent.
 *               This requires that the parent already be updated.
 *   merge():    Merge the property values of a child and a parent that is being deleted,
 *               attempting to preserve the style of the child.
 *   assign():   Upstream operator=.
 *   equals():   Upstream operator==, true if computed values are equal.
 *
 * TypeScript notes: the template argument of TypedSPI is the `id` constructor argument. SPIEnum
 * gets its keyword table as constructor argument instead of a template specialization. The
 * dynamic_cast checks of upstream are `instanceof` checks.
 */

import { attributeName, SPAttr } from './attributes.ts';
import { Color } from './colors/color.ts';
import { Manager } from './colors/manager.ts';
import type { AnySpace } from './colors/spaces/base.ts';
import type { SPDocument } from './document.ts';
import type { SPObject } from './object/sp-object.ts';
import { SPPaintServerReference } from './object/sp-paint-server-reference.ts';
import {
  cssFontFamilyQuote,
  cssFontFamilyUnquote,
  cssQuote,
  cssUnquote,
  type SPStyle,
  spStyleCssSizePxToUnits,
  spStyleFillPaintServerRefChanged,
  spStyleFilterRefChanged,
  spStyleGetCssUnitString,
  spStyleSetIpaintToUri,
  spStyleSetIpaintToUriString,
  spStyleStrokePaintServerRefChanged,
} from './style.ts';
import {
  enum_baseline_shift,
  enum_font_size,
  enum_font_stretch,
  enum_font_style,
  enum_font_variant,
  enum_font_variant_east_asian,
  enum_font_variant_ligatures,
  enum_font_variant_numeric,
  enum_font_weight,
  SPCSSBaselineShift,
  SPCSSFontSize,
  SPCSSFontStretch,
  SPCSSFontVariantEastAsian,
  SPCSSFontVariantLigatures,
  SPCSSFontVariantNumeric,
  SPCSSFontWeight,
  SPPaintOrderLayer,
  SPPaintOrigin,
  type SPStyleEnum,
} from './style-enums.ts';
import { cssNumber } from './svg/css-ostringstream.ts';
import { convertUnit, readNumberPrefix } from './svg/svg-length.ts';
import { Signal } from './util/signal.ts';

export const SP_STYLE_FLAG_ALWAYS = 1 << 2;
export const SP_STYLE_FLAG_IFSET = 1 << 0;
export const SP_STYLE_FLAG_IFDIFF = 1 << 1;
/** If source matches. */
export const SP_STYLE_FLAG_IFSRC = 1 << 3;

export enum SPStyleSrc {
  UNSET,
  /** fill="red" */
  ATTRIBUTE,
  /** style="fill:red" */
  STYLE_PROP,
  /** .red { fill:red; } */
  STYLE_SHEET,
}

/** Settings that upstream reads from the preferences (/options/font/unitType, /options/font/textOutputPx). */
// TODO: read these from the preferences when the preferences are ported.
export const stylePrefs = {
  fontUnitType: 2 /* SP_CSS_UNIT_PT */,
  fontTextOutputPx: true,
};

/** Like `Inkscape::ustring::format_classic(double)`: C++ ostream default format (printf %g, 6 digits). */
export function formatClassic(d: number): string {
  if (Number.isNaN(d)) return 'nan';
  if (!Number.isFinite(d)) return d < 0 ? '-inf' : 'inf';
  if (d === 0) return Object.is(d, -0) ? '-0' : '0';
  const strip = (s: string) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
  const [mantissa, exp] = d.toExponential(5).split('e') as [string, string];
  const x = Number(exp);
  if (x < -4 || x >= 6) {
    return `${strip(mantissa)}e${x < 0 ? '-' : '+'}${String(Math.abs(x)).padStart(2, '0')}`;
  }
  return strip(d.toFixed(5 - x));
}

const isAsciiSpace = (c: string | undefined): boolean =>
  c === ' ' || c === '\t' || c === '\n' || c === '\v' || c === '\f' || c === '\r';

/**
 * Result of extractUri(): the URI, and the offset after the closing parenthesis. `end` is null if
 * no closing delimiter was found (upstream sets the end pointer to nullptr) and 0 if the input is not
 * an url() (upstream leaves the end pointer unchanged).
 * Upstream: extract_uri in src/util/uri.cpp
 */
export function extractUri(s: string | null): { uri: string; end: number | null } {
  if (s === null || s.length < 4 || !s.startsWith('url')) return { uri: '', end: 0 };
  let sb = 3;
  // This first whitespace technically is not allowed. Just left in for now for legacy behavior.
  while (s[sb] === ' ' || s[sb] === '\t') sb++;
  if (s[sb] !== '(') return { uri: '', end: null };
  sb++;
  while (s[sb] === ' ' || s[sb] === '\t') sb++;
  let delim = ')';
  if (s[sb] === "'" || s[sb] === '"') {
    delim = s[sb]!;
    sb++;
  }
  if (sb >= s.length) return { uri: '', end: null };
  let se = sb;
  while (se < s.length && s[se] !== delim) se++;
  if (se >= s.length) return { uri: '', end: null };
  // we found the delimiter
  if (delim === ')') {
    const end = se + 1;
    // back up for any trailing whitespace
    while (se > sb && isAsciiSpace(s[se - 1])) se--;
    return { uri: s.slice(sb, se), end };
  }
  let tail = se + 1;
  while (s[tail] === ' ' || s[tail] === '\t') tail++;
  if (s[tail] === ')') return { uri: s.slice(sb, se), end: tail + 1 };
  return { uri: '', end: null };
}

// References ------------------------------------------------------------------------------------

export { SPPaintServerReference };

/**
 * Placeholder for the URI references of SPStyle (SPFilterReference, SPMarkerReference,
 * SPShapeReference); SPPaintServerReference is real (object/sp-paint-server-reference.ts).
 * It keeps the URI but does not resolve it: getObject() is always null, like the reference to an
 * id that is not in the document.
 */
// TODO: replace by the real references (object/uri-references.ts and subclasses) when ported.
export class SPStyleReference {
  /** Emitted when the referenced object changes (old, new). */
  readonly changedSignal = new Signal<[SPObject | null, SPObject | null]>();
  #uri: string | null = null;

  constructor(readonly owner: SPObject | SPDocument | null) {}

  getObject(): SPObject | null {
    return null;
  }
  /** The URI as written in the url(): "#id". */
  getURI(): string | null {
    return this.#uri;
  }
  getOwnerDocument(): SPDocument | null {
    return this.owner && 'document' in this.owner ? this.owner.document : (this.owner as SPDocument | null);
  }
  attach(uri: string): void {
    this.#uri = uri;
  }
  tryAttach(uri: string): boolean {
    this.attach(uri);
    return true;
  }
  detach(): void {
    this.#uri = null;
  }
  /** Upstream: Inkscape::URI::cssStr */
  cssStr(): string | null {
    return this.#uri === null ? null : `url(${this.#uri})`;
  }
}
export class SPFilterReference extends SPStyleReference {}
export class SPMarkerReference extends SPStyleReference {}
export class SPShapeReference extends SPStyleReference {}

// SPIBase ---------------------------------------------------------------------------------------

const names = new Map<SPAttr, string>();

/** Strip "!important" from the end of str. Returns null if str does not end with it. */
function stripImportant(str: string): string | null {
  const N = '!important'.length;
  if (str.length >= N && str.endsWith('!important')) {
    let pos = str.length - N;
    // strip whitespace from the right
    while (pos > 0 && isAsciiSpace(str[pos - 1])) --pos;
    return str.slice(0, pos);
  }
  return null;
}

/** Base class for all SPStyle internal classes (one per kind of property). */
export abstract class SPIBase {
  /** Property inherits by default from parent. */
  inherits: boolean;
  /** Property has been explicitly set (vs. inherited). */
  set = false;
  /** Property value set to 'inherit'. */
  inherit = false;
  /** Property rule 'important' has been explicitly set. */
  important = false;
  /** Source (attribute, style attribute, style-sheet). Default to property, see bug 1662285. */
  style_src: SPStyleSrc = SPStyleSrc.STYLE_PROP;
  /** Used by SPIPaint, SPIFilter... to find values of other properties. */
  style: SPStyle | null = null;

  constructor(
    readonly id: SPAttr,
    inherits = true,
  ) {
    this.inherits = inherits;
  }

  /** Set the property value from a string; str is null if there is no value. */
  abstract read(str: string | null): void;

  /** Read the property if it is not set yet, or if the new value is !important and the old not. */
  readIfUnset(str: string | null, source: SPStyleSrc = SPStyleSrc.STYLE_PROP): void {
    if (str === null) return;
    if (source === SPStyleSrc.ATTRIBUTE && this.id === SPAttr.D) return;

    let hasImportant = false;
    // '!important' is invalid on attributes
    if (source !== SPStyleSrc.ATTRIBUTE) {
      const stripped = stripImportant(str);
      if (stripped !== null) {
        hasImportant = true;
        str = stripped;
      }
    }

    if (!this.set || (hasImportant && !this.important)) {
      this.read(str); // clears style_src
      this.style_src = source;
      if (this.set && hasImportant) this.important = true;
    }
  }

  protected importantStr(): string {
    return this.important ? ' !important' : '';
  }

  readAttribute(repr: { attribute(name: string): string | null }): void {
    this.readIfUnset(repr.attribute(this.name()), SPStyleSrc.ATTRIBUTE);
  }

  /** The value as written to CSS. */
  abstract getValue(): string;

  /**
   * Check if this property should be written. This function won't do any writing so can
   * be used as a quick way to check if specific kinds of style attrs have been changed.
   *
   * @param flags Conditions bitmask of `SP_STYLE_FLAG_*` bits
   * @param styleSrcReq For `SP_STYLE_FLAG_IFSRC`
   * @param base Parent node style for `SP_STYLE_FLAG_IFDIFF`, can be null
   */
  shallWrite(
    flags: number = SP_STYLE_FLAG_IFSET,
    styleSrcReq: SPStyleSrc = SPStyleSrc.STYLE_PROP,
    base: SPIBase | null = null,
  ): boolean {
    // flags SP_STYLE_FLAG_IFSET and SP_STYLE_FLAG_IFDIFF are ignored, their
    // information is redundant FIXME remove those flags

    // pointer equality handled in SPStyle::write, not expected here
    if (base === this) throw new Error('SPIBase.shallWrite: base is this');

    if (flags & SP_STYLE_FLAG_ALWAYS) {
      if (flags & SP_STYLE_FLAG_IFSRC || base)
        throw new Error('SPIBase.shallWrite: invalid flags for ALWAYS');
      return true;
    }
    if (!this.set) return false;
    if (flags & SP_STYLE_FLAG_IFSRC && styleSrcReq !== this.style_src) return false;
    if (base && this.inherits && base.equals(this)) return false;
    return true;
  }

  /**
   * Compile this style conditionally into a 'name: value' string suitable for css attrs.
   * See shallWrite for details on conditional flags.
   *
   * @return completed css string or empty string if conditions not met.
   */
  write(
    flags: number = SP_STYLE_FLAG_IFSET,
    styleSrcReq: SPStyleSrc = SPStyleSrc.STYLE_PROP,
    base: SPIBase | null = null,
  ): string {
    if (this.shallWrite(flags, styleSrcReq, base)) {
      const value = this.getValue();
      if (value) return `${this.name()}:${value}${this.importantStr()};`;
    }
    return '';
  }

  clear(): void {
    this.set = false;
    this.inherit = false;
    this.important = false;
    // Attr::D is a special case where the best default for it is actually ATTRIBUTE
    // and not STYLE_PROP, this exception allows us to not have to refactor more.
    if (this.id !== SPAttr.D) this.style_src = SPStyleSrc.STYLE_PROP;
  }

  overwrite(other: SPIBase): void {
    this.clear();
    this.merge(other);
  }

  abstract cascade(parent: SPIBase): void;
  abstract merge(parent: SPIBase): void;

  setStylePointer(style: SPStyle | null): void {
    this.style = style;
  }

  /** The common part of the upstream assignment operators. */
  protected assignBase(rhs: SPIBase): void {
    this.inherits = rhs.inherits;
    this.set = rhs.set;
    this.inherit = rhs.inherit;
    this.important = rhs.important;
    this.style_src = rhs.style_src;
    this.style = rhs.style;
  }

  /** Check apples being compared to apples. */
  equals(rhs: SPIBase): boolean {
    return this.id === rhs.id;
  }

  /** The CSS name of the property. */
  name(): string {
    let name = names.get(this.id);
    if (name === undefined) {
      name = attributeName(this.id) ?? 'anonymous';
      names.set(this.id, name);
    }
    return name;
  }

  protected incorrectParent(method: string): void {
    console.error(`${this.constructor.name}::${method}(): Incorrect parent type`);
  }
}

// SPIFloat --------------------------------------------------------------------------------------

/** Float type internal to SPStyle. (Only 'stroke-miterlimit') */
export class SPIFloat extends SPIBase {
  value: number;
  #valueDefault: number;

  constructor(id: SPAttr, valueDefault = 0.0) {
    super(id);
    this.value = valueDefault;
    this.#valueDefault = valueDefault;
  }

  read(str: string | null): void {
    if (str === null) return;
    if (str === 'inherit') {
      this.set = true;
      this.inherit = true;
    } else {
      const n = readNumberPrefix(str);
      if (n) {
        this.set = true;
        this.inherit = false;
        this.value = Math.fround(n.value);
      }
    }
  }

  getValue(): string {
    if (this.inherit) return 'inherit';
    return formatClassic(this.value);
  }

  override clear(): void {
    super.clear();
    this.value = this.#valueDefault;
  }

  cascade(parent: SPIBase): void {
    if (!(parent instanceof SPIFloat)) {
      this.incorrectParent('cascade');
      return;
    }
    if ((this.inherits && !this.set) || this.inherit) this.value = parent.value;
  }

  merge(parent: SPIBase): void {
    if (!(parent instanceof SPIFloat)) {
      this.incorrectParent('merge');
      return;
    }
    if (this.inherits && (!this.set || this.inherit) && parent.set && !parent.inherit) {
      this.set = parent.set;
      this.inherit = parent.inherit;
      this.value = parent.value;
    }
  }

  as_double(): number {
    return this.value;
  }

  override equals(rhs: SPIBase): boolean {
    return rhs instanceof SPIFloat && this.value === rhs.value && super.equals(rhs);
  }
}

// SPIScale24 ------------------------------------------------------------------------------------

/**
 * One might think that the best value for SP_SCALE24_MAX would be ((1<<24)-1), which allows the
 * greatest possible precision for fitting [0, 1] fractions into 24 bits. However, in practice
 * that gives a problem with 0.5. The value 0xff0000 can exactly represent all 8-bit alpha
 * channel values, and can exactly represent all multiples of 0.1.
 */
export const SP_SCALE24_MAX = 0xff0000;

/** Returns a scale24 for the product of two scale24 values. */
export const SP_SCALE24_MUL = (v1: number, v2: number): number =>
  Math.trunc((v1 * v2) / SP_SCALE24_MAX + 0.5) >>> 0;

/**
 * 24 bit data type internal to SPStyle. Used only for opacity, fill-opacity, stroke-opacity and
 * the like. Opacity does not inherit but stroke-opacity and fill-opacity do.
 */
export class SPIScale24 extends SPIBase {
  value: number = SP_SCALE24_MAX;

  constructor(id: SPAttr, inherits = true) {
    super(id, inherits);
  }

  as_double(): number {
    return this.value / SP_SCALE24_MAX;
  }

  set_double(other: number): void {
    this.value = Math.trunc(other * SP_SCALE24_MAX + 0.5) & 0xffffff;
    this.set = true;
  }

  read(str: string | null): void {
    if (str === null) return;
    if (str === 'inherit') {
      this.set = true;
      this.inherit = true;
    } else {
      const n = readNumberPrefix(str);
      if (n) {
        this.set = true;
        this.inherit = false;
        this.set_double(Math.min(Math.max(Math.fround(n.value), 0.0), 1.0));
      }
    }
  }

  getValue(): string {
    if (this.inherit) return 'inherit';
    return formatClassic(this.as_double());
  }

  override clear(): void {
    super.clear();
    this.value = SP_SCALE24_MAX;
  }

  cascade(parent: SPIBase): void {
    if (!(parent instanceof SPIScale24)) {
      this.incorrectParent('cascade');
      return;
    }
    if ((this.inherits && !this.set) || this.inherit) this.value = parent.value;
  }

  merge(parent: SPIBase): void {
    if (!(parent instanceof SPIScale24)) {
      this.incorrectParent('merge');
      return;
    }
    if (this.inherits) {
      if ((!this.set || this.inherit) && parent.set && !parent.inherit) {
        this.set = parent.set;
        this.inherit = parent.inherit;
        this.value = parent.value;
      }
    } else {
      // Needed only for 'opacity' and 'stop-opacity' which do not inherit. See comment at bottom of file.
      if (this.id !== SPAttr.OPACITY && this.id !== SPAttr.STOP_OPACITY) {
        console.error(`SPIScale24::merge: unhandled property: ${this.name()}`);
      }
      if (!this.set || (!this.inherit && this.value === SP_SCALE24_MAX)) {
        this.value = parent.value;
        this.set = this.value !== SP_SCALE24_MAX;
      } else {
        if (this.inherit) this.value = parent.value; // Insures child is up-to-date
        this.value = SP_SCALE24_MUL(this.value, parent.value);
        this.inherit =
          this.inherit && parent.inherit && (parent.value === 0 || parent.value === SP_SCALE24_MAX);
        this.set = this.inherit || this.value < SP_SCALE24_MAX;
      }
    }
  }

  override equals(rhs: SPIBase): boolean {
    return rhs instanceof SPIScale24 && this.value === rhs.value && super.equals(rhs);
  }
}

// SPILength -------------------------------------------------------------------------------------

export enum SPCSSUnit {
  SP_CSS_UNIT_NONE,
  SP_CSS_UNIT_PX,
  SP_CSS_UNIT_PT,
  SP_CSS_UNIT_PC,
  SP_CSS_UNIT_MM,
  SP_CSS_UNIT_CM,
  SP_CSS_UNIT_IN,
  SP_CSS_UNIT_EM,
  SP_CSS_UNIT_EX,
  SP_CSS_UNIT_PERCENT,
}

// Array must be same length as SPCSSUnit in style-internal.h
//                                       PX  PT  PC  MM   CM  IN   EM   EX    %
export const font_size_unit_ratios: readonly number[] = [1, 1, 1, 10, 4, 40, 100, 16, 8, 0.16, 0];

/** Default font size, used if no style is available for relative units. */
export const FONT_SIZE_DEFAULT = 12.0;

/**
 * Length type internal to SPStyle. Needs access to 'font-size' and 'font-family' for computed
 * values. Used for 'stroke-width' 'stroke-dash-offset' ('none' not handled), text-indent.
 */
export class SPILength extends SPIBase {
  unit: SPCSSUnit = SPCSSUnit.SP_CSS_UNIT_NONE;
  value: number;
  computed: number;
  #valueDefault: number;

  constructor(id: SPAttr, value = 0) {
    super(id);
    this.value = value;
    this.computed = value;
    this.#valueDefault = value;
  }

  as_double(): number {
    return this.computed;
  }

  read(str: string | null): void {
    if (str === null) return;
    if (str === 'inherit') {
      this.set = true;
      this.inherit = true;
      this.unit = SPCSSUnit.SP_CSS_UNIT_NONE;
      this.value = this.computed = 0.0;
      return;
    }
    const n = readNumberPrefix(str);
    if (!n || !Number.isFinite(n.value)) return; // fix for bug lp:935157
    // TODO: fixme: Move this to standard place (Lauris)
    const e = n.rest;
    this.value = n.value;
    const fontSize = this.style ? this.style.font_size.computed : FONT_SIZE_DEFAULT;
    if (e === '') {
      /* Userspace */
      this.unit = SPCSSUnit.SP_CSS_UNIT_NONE;
      this.computed = this.value;
    } else if (e === 'px') {
      /* Userspace */
      this.unit = SPCSSUnit.SP_CSS_UNIT_PX;
      this.computed = this.value;
    } else if (e === 'pt') {
      /* Userspace / DEVICESCALE */
      this.unit = SPCSSUnit.SP_CSS_UNIT_PT;
      this.computed = convertUnit(this.value, 'pt', 'px');
    } else if (e === 'pc') {
      this.unit = SPCSSUnit.SP_CSS_UNIT_PC;
      this.computed = convertUnit(this.value, 'pc', 'px');
    } else if (e === 'mm') {
      this.unit = SPCSSUnit.SP_CSS_UNIT_MM;
      this.computed = convertUnit(this.value, 'mm', 'px');
    } else if (e === 'cm') {
      this.unit = SPCSSUnit.SP_CSS_UNIT_CM;
      this.computed = convertUnit(this.value, 'cm', 'px');
    } else if (e === 'in') {
      this.unit = SPCSSUnit.SP_CSS_UNIT_IN;
      this.computed = convertUnit(this.value, 'in', 'px');
    } else if (e === 'em') {
      /* EM square */
      this.unit = SPCSSUnit.SP_CSS_UNIT_EM;
      this.computed = this.value * fontSize;
    } else if (e === 'ex') {
      /* ex square */
      this.unit = SPCSSUnit.SP_CSS_UNIT_EX;
      this.computed = this.value * fontSize * 0.5; // FIXME
    } else if (e === '%') {
      /* Percentage */
      this.unit = SPCSSUnit.SP_CSS_UNIT_PERCENT;
      this.value = this.value * 0.01;
      if (this.id === SPAttr.LINE_HEIGHT) {
        // See: http://www.w3.org/TR/CSS2/visudet.html#propdef-line-height
        this.computed = this.value * fontSize;
      }
    } else {
      /* Invalid */
      return;
    }
    this.set = true;
    this.inherit = false;
  }

  getValue(): string {
    if (this.inherit) return 'inherit';
    let value = this.computed;
    let unitOut = '';
    switch (this.unit) {
      case SPCSSUnit.SP_CSS_UNIT_NONE:
        break;
      case SPCSSUnit.SP_CSS_UNIT_PX:
        unitOut = 'px';
        break;
      case SPCSSUnit.SP_CSS_UNIT_PT:
      case SPCSSUnit.SP_CSS_UNIT_PC:
      case SPCSSUnit.SP_CSS_UNIT_MM:
      case SPCSSUnit.SP_CSS_UNIT_CM:
      case SPCSSUnit.SP_CSS_UNIT_IN:
        unitOut = spStyleGetCssUnitString(this.unit);
        value = convertUnit(this.computed, 'px', unitOut);
        break;
      case SPCSSUnit.SP_CSS_UNIT_EM:
      case SPCSSUnit.SP_CSS_UNIT_EX:
        unitOut = spStyleGetCssUnitString(this.unit);
        value = this.value;
        break;
      case SPCSSUnit.SP_CSS_UNIT_PERCENT:
        unitOut = '%';
        value = this.value * 100.0;
        break;
      default:
        /* Invalid */
        break;
    }
    return formatClassic(value) + unitOut;
  }

  override clear(): void {
    super.clear();
    this.unit = SPCSSUnit.SP_CSS_UNIT_NONE;
    this.value = this.#valueDefault;
    this.computed = this.#valueDefault;
  }

  cascade(parent: SPIBase): void {
    if (!(parent instanceof SPILength)) {
      this.incorrectParent('cascade');
      return;
    }
    if ((this.inherits && !this.set) || this.inherit) {
      this.unit = parent.unit;
      this.value = parent.value;
      this.computed = parent.computed;
    } else {
      // Recalculate based on new font-size, font-family inherited from parent
      const em = this.style!.font_size.computed;
      if (this.unit === SPCSSUnit.SP_CSS_UNIT_EM) {
        this.computed = this.value * em;
      } else if (this.unit === SPCSSUnit.SP_CSS_UNIT_EX) {
        // FIXME: Get x height from libnrtype or pango.
        this.computed = this.value * em * 0.5;
      } else if (this.unit === SPCSSUnit.SP_CSS_UNIT_PERCENT && this.id === SPAttr.LINE_HEIGHT) {
        // Special case
        this.computed = this.value * em;
      }
    }
  }

  merge(parent: SPIBase): void {
    if (!(parent instanceof SPILength)) {
      this.incorrectParent('merge');
      return;
    }
    if (this.inherits && (!this.set || this.inherit) && parent.set && !parent.inherit) {
      this.set = parent.set;
      this.inherit = parent.inherit;
      this.unit = parent.unit;
      this.value = parent.value;
      this.computed = parent.computed;

      // Fix up so values are correct
      switch (parent.unit) {
        case SPCSSUnit.SP_CSS_UNIT_EM:
        case SPCSSUnit.SP_CSS_UNIT_EX:
          this.value *= parent.style!.font_size.computed / this.style!.font_size.computed;
          // TODO: FIXME: Have separate ex ratio parameter. Get x height from libnrtype or pango.
          if (!Number.isFinite(this.value)) {
            this.value = this.computed;
            this.unit = SPCSSUnit.SP_CSS_UNIT_NONE;
          }
          break;
        default:
          break;
      }
    }
  }

  setDouble(v: number): void {
    this.unit = SPCSSUnit.SP_CSS_UNIT_NONE;
    this.value = v;
    this.computed = v;
    this.#valueDefault = v;
  }

  /** Generate a string, with the name and the important flag as a declaration if wname. */
  override toString(wname = false): string {
    let os = '';
    if (wname) os += `${this.name()}:`;
    os += this.getValue();
    if (wname) os += `${this.importantStr()};`;
    return os;
  }

  /** Upstream operator=: copies the value, not the default (which is used by clear()). */
  assign(rhs: SPILength): void {
    this.assignBase(rhs);
    this.unit = rhs.unit;
    this.value = rhs.value;
    this.computed = rhs.computed;
    this.#valueDefault = rhs.#valueDefault;
  }

  override equals(rhs: SPIBase): boolean {
    if (!(rhs instanceof SPILength)) return false;
    if (this.unit !== rhs.unit) return false;
    // If length depends on external parameter, lengths cannot be equal.
    if (this.unit === SPCSSUnit.SP_CSS_UNIT_EM) return false;
    if (this.unit === SPCSSUnit.SP_CSS_UNIT_EX) return false;
    if (this.unit === SPCSSUnit.SP_CSS_UNIT_PERCENT) return false;
    if (rhs.unit === SPCSSUnit.SP_CSS_UNIT_EM) return false;
    if (rhs.unit === SPCSSUnit.SP_CSS_UNIT_EX) return false;
    if (rhs.unit === SPCSSUnit.SP_CSS_UNIT_PERCENT) return false;
    return this.computed === rhs.computed;
  }
}

/** Extended length type internal to SPStyle. Used for: line-height, letter-spacing, word-spacing. */
export class SPILengthOrNormal extends SPILength {
  normal = true;

  override read(str: string | null): void {
    if (str === null) return;
    if (str === 'normal') {
      this.set = true;
      this.inherit = false;
      this.unit = SPCSSUnit.SP_CSS_UNIT_NONE;
      this.value = this.computed = 0.0;
      this.normal = true;
    } else {
      super.read(str);
      this.normal = false;
    }
  }

  override getValue(): string {
    if (this.normal) return 'normal';
    return super.getValue();
  }

  override clear(): void {
    super.clear();
    this.normal = true;
  }

  override cascade(parent: SPIBase): void {
    if (!(parent instanceof SPILengthOrNormal)) {
      this.incorrectParent('cascade');
      return;
    }
    if ((this.inherits && !this.set) || this.inherit) this.normal = parent.normal;
    super.cascade(parent);
  }

  override merge(parent: SPIBase): void {
    if (!(parent instanceof SPILengthOrNormal)) return;
    if (this.inherits && (!this.set || this.inherit) && parent.set && !parent.inherit) {
      this.normal = parent.normal;
      super.merge(parent);
    }
  }

  override equals(rhs: SPIBase): boolean {
    if (!(rhs instanceof SPILengthOrNormal)) return false;
    if (this.normal && rhs.normal) return true;
    if (this.normal !== rhs.normal) return false;
    return super.equals(rhs);
  }
}

// SPIFontVariationSettings ----------------------------------------------------------------------

/** Used for: font-variation-settings. */
export class SPIFontVariationSettings extends SPIBase {
  normal = true;
  /** Axis tag and value; upstream uses a std::map, which is sorted by tag. */
  axes = new Map<string, number>();

  constructor(id: SPAttr) {
    super(id);
  }

  read(str: string | null): void {
    if (str === null) return;
    if (str === 'normal') {
      this.set = true;
      this.inherit = false;
      this.normal = true;
      this.axes.clear();
      return;
    }
    // Match a pattern of a CSS <string> of length 4, whitespace, CSS <number>.
    const regex = /["'](\w{4})["']\s+([-+]?\d*\.?\d+([eE][-+]?\d+)?)/;
    for (const token of str.split(',')) {
      const m = regex.exec(token);
      if (m && !this.axes.has(m[1]!)) this.axes.set(m[1]!, Math.fround(Number(m[2])));
    }
    if (this.axes.size > 0) {
      this.set = true;
      this.inherit = false;
      this.normal = false;
    }
  }

  /** The axes sorted by tag, like std::map. */
  #sortedAxes(): [string, number][] {
    return [...this.axes].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  }

  getValue(): string {
    if (this.normal) return 'normal';
    return this.#sortedAxes()
      .map(([tag, v]) => `'${tag}' ${formatClassic(v)}`)
      .join(', ');
  }

  override clear(): void {
    super.clear();
    this.axes.clear();
    this.normal = true;
  }

  cascade(parent: SPIBase): void {
    if (!(parent instanceof SPIFontVariationSettings)) {
      this.incorrectParent('cascade');
      return;
    }
    if (!this.set || this.inherit) {
      // Always inherits
      this.normal = parent.normal;
      this.axes = new Map(parent.axes);
    }
  }

  merge(parent: SPIBase): void {
    if (!(parent instanceof SPIFontVariationSettings)) return;
    // 'font-variation-settings' always inherits.
    if ((!this.set || this.inherit) && parent.set && !parent.inherit) {
      this.set = parent.set;
      this.inherit = parent.inherit;
      this.normal = parent.normal;
      this.axes = new Map(parent.axes);
    }
  }

  override equals(rhs: SPIBase): boolean {
    if (!(rhs instanceof SPIFontVariationSettings)) return false;
    if (this.normal && rhs.normal) return true;
    if (this.normal !== rhs.normal) return false;
    if (this.axes.size !== rhs.axes.size) return false;
    for (const [k, v] of this.axes) if (rhs.axes.get(k) !== v) return false;
    return true;
  }

  /** Generate a string useful for passing to Pango, etc. */
  override toString(): string {
    return this.#sortedAxes()
      .map(([tag, v]) => `${tag}=${cssNumber(v)}`)
      .join(',');
  }
}

// SPIEnum ---------------------------------------------------------------------------------------

/**
 * Enum type internal to SPStyle. Used for many properties. 'font-stretch' and 'font-weight' are
 * special cases (SPIEnumFontWeight and SPIEnumFontStretch).
 */
export class SPIEnum<T extends number = number> extends SPIBase {
  value: T;
  computed!: T;
  protected valueDefault: T;

  constructor(
    id: SPAttr,
    readonly enums: readonly SPStyleEnum[],
    value: T,
    inherits = true,
  ) {
    super(id, inherits);
    this.value = value;
    this.valueDefault = value;
    this.updateComputed();
  }

  as_enum(): T {
    return this.computed;
  }

  /** Update computed from value. */
  protected updateComputed(): void {
    this.computed = this.value;
  }

  /** Update computed from parent computed. */
  protected updateComputedCascade(_parentComputed: T): void {}

  /** Update value from parent. Precondition: computed is up to date. */
  protected updateValueMerge(_parent: SPIEnum<T>): void {}

  protected updateValueMergeRelative(parent: SPIEnum<T>, smaller: T, larger: T): void {
    if (!this.set) throw new Error('updateValueMerge: not set');
    if (this.value === parent.value) {
      // Leave as is, what does applying "wider" twice do?
    } else if (
      (this.value === smaller && parent.value === larger) ||
      (this.value === larger && parent.value === smaller)
    ) {
      // Values cancel, unset
      this.set = false;
    } else if (this.value === smaller || this.value === larger) {
      this.value = this.computed;
      this.inherit = false;
    }
  }

  read(str: string | null): void {
    if (str === null) return;
    if (str === 'inherit') {
      this.set = true;
      this.inherit = true;
    } else {
      for (const e of this.enums) {
        if (str === e.key) {
          this.set = true;
          this.inherit = false;
          this.value = e.value as T;
          break;
        }
      }
      // type-specialized subroutine
      this.updateComputed();
    }
  }

  getValue(): string {
    if (this.inherit) return 'inherit';
    for (const e of this.enums) if (e.value === this.value) return e.key;
    return '';
  }

  override clear(): void {
    super.clear();
    this.value = this.valueDefault;
    this.updateComputed();
  }

  cascade(parent: SPIBase): void {
    if (!(parent instanceof SPIEnum)) {
      this.incorrectParent('cascade');
      return;
    }
    if (this.inherits && (!this.set || this.inherit)) {
      this.computed = parent.computed as T;
    } else {
      // type-specialized subroutine
      this.updateComputedCascade(parent.computed as T);
    }
  }

  merge(parent: SPIBase): void {
    if (!(parent instanceof SPIEnum)) return;
    if (this.inherits && parent.set && !parent.inherit) {
      if (!this.set || this.inherit) {
        this.set = parent.set;
        this.inherit = parent.inherit;
        this.value = parent.value as T;
        this.computed = parent.computed as T; // Different from value for font-weight and font-stretch
      } else {
        // type-specialized subroutine
        this.updateValueMerge(parent as SPIEnum<T>);
      }
    }
  }

  assign(rhs: SPIEnum<T>): void {
    this.assignBase(rhs);
    this.value = rhs.value;
    this.computed = rhs.computed;
    this.valueDefault = rhs.valueDefault;
  }

  override equals(rhs: SPIBase): boolean {
    return rhs instanceof SPIEnum && this.computed === rhs.computed && super.equals(rhs);
  }
}

/** The 'font-weight' property. */
export class SPIEnumFontWeight extends SPIEnum<SPCSSFontWeight> {
  constructor(id: SPAttr, value: SPCSSFontWeight, inherits = true) {
    super(id, enum_font_weight, value, inherits);
  }

  protected override updateComputed(): void {
    // The following is defined in CSS 2.1
    if (this.value === SPCSSFontWeight.SP_CSS_FONT_WEIGHT_NORMAL) {
      this.computed = SPCSSFontWeight.SP_CSS_FONT_WEIGHT_400;
    } else if (this.value === SPCSSFontWeight.SP_CSS_FONT_WEIGHT_BOLD) {
      this.computed = SPCSSFontWeight.SP_CSS_FONT_WEIGHT_700;
    } else {
      this.computed = this.value;
    }
  }

  /**
   * Special read() version for the font-weight attribute to handle numerical values, values which
   * Pango supports and some fonts require.
   */
  override read(str: string | null): void {
    if (str === null) return;
    if (str === 'inherit') {
      this.set = true;
      this.inherit = true;
    } else {
      let translated = false;
      for (const e of this.enums) {
        if (str === e.key) {
          this.set = true;
          this.inherit = false;
          this.value = e.value;
          translated = true;
          break;
        }
      }
      // translate numbers only; no leading spaces or trailing characters accepted
      // to make it as strict as key matching above
      if (!translated && /^\d/.test(str)) {
        const m = /^\d+/.exec(str)!;
        const end = str[m[0].length];
        const weight = Number(m[0]);
        if ((end === undefined || end === ' ') && weight > 0 && weight <= 1000) {
          this.set = true;
          this.inherit = false;
          this.value = weight;
        }
      }
      // type-specialized subroutine
      this.updateComputed();
    }
  }

  override getValue(): string {
    if (this.inherit) return 'inherit';
    for (const e of this.enums) if (e.value === this.value) return e.key;
    if (this.value > 0 && this.value <= 1000) return String(this.value);
    return '';
  }

  protected override updateComputedCascade(parentComputed: SPCSSFontWeight): void {
    // strictly, 'bolder' and 'lighter' should go to the next weight
    // expressible in the current font family, but that's difficult to
    // find out, so jumping by 3 seems an appropriate approximation
    if (this.value === SPCSSFontWeight.SP_CSS_FONT_WEIGHT_LIGHTER) {
      this.computed = Math.max(SPCSSFontWeight.SP_CSS_FONT_WEIGHT_100, parentComputed - 3 * 100);
    } else if (this.value === SPCSSFontWeight.SP_CSS_FONT_WEIGHT_BOLDER) {
      this.computed = Math.min(SPCSSFontWeight.SP_CSS_FONT_WEIGHT_900, parentComputed + 3 * 100);
    }
  }

  protected override updateValueMerge(parent: SPIEnum<SPCSSFontWeight>): void {
    this.updateValueMergeRelative(
      parent,
      SPCSSFontWeight.SP_CSS_FONT_WEIGHT_LIGHTER,
      SPCSSFontWeight.SP_CSS_FONT_WEIGHT_BOLDER,
    );
  }
}

/** The 'font-stretch' property. */
export class SPIEnumFontStretch extends SPIEnum<SPCSSFontStretch> {
  constructor(id: SPAttr, value: SPCSSFontStretch, inherits = true) {
    super(id, enum_font_stretch, value, inherits);
  }

  protected override updateComputedCascade(parentComputed: SPCSSFontStretch): void {
    if (this.value === SPCSSFontStretch.SP_CSS_FONT_STRETCH_NARROWER) {
      this.computed = Math.max(SPCSSFontStretch.SP_CSS_FONT_STRETCH_ULTRA_CONDENSED, parentComputed - 1);
    } else if (this.value === SPCSSFontStretch.SP_CSS_FONT_STRETCH_WIDER) {
      this.computed = Math.min(SPCSSFontStretch.SP_CSS_FONT_STRETCH_ULTRA_EXPANDED, parentComputed + 1);
    }
  }

  protected override updateValueMerge(parent: SPIEnum<SPCSSFontStretch>): void {
    this.updateValueMergeRelative(
      parent,
      SPCSSFontStretch.SP_CSS_FONT_STRETCH_NARROWER,
      SPCSSFontStretch.SP_CSS_FONT_STRETCH_WIDER,
    );
  }
}

/**
 * SPIEnum w/ extra bits. The 'font-variants-ligatures' property is a complete mess that needs
 * special handling. For OpenType fonts the values 'common-ligatures', 'contextual',
 * 'no-discretionary-ligatures', and 'no-historical-ligatures' are not useful but we still must be
 * able to parse them.
 */
export class SPILigatures extends SPIEnum<number> {
  constructor(id: SPAttr) {
    super(id, enum_font_variant_ligatures, SPCSSFontVariantLigatures.SP_CSS_FONT_VARIANT_LIGATURES_NORMAL);
  }

  override read(str: string | null): void {
    if (str === null) return;
    this.value = SPCSSFontVariantLigatures.SP_CSS_FONT_VARIANT_LIGATURES_NORMAL;
    if (str === 'inherit') {
      this.set = true;
      this.inherit = true;
    } else if (str === 'normal') {
      // Defaults for TrueType
      this.inherit = false;
      this.set = true;
    } else if (str === 'none') {
      this.value = SPCSSFontVariantLigatures.SP_CSS_FONT_VARIANT_LIGATURES_NONE;
      this.inherit = false;
      this.set = true;
    } else {
      // We need to parse in order
      for (const token of str.split(/\s+/)) {
        for (const e of enum_font_variant_ligatures) {
          if (token === e.key) {
            this.set = true;
            this.inherit = false;
            if (e.value < SPCSSFontVariantLigatures.SP_CSS_FONT_VARIANT_LIGATURES_NOCOMMON) {
              // Turn on
              this.value |= e.value;
            } else {
              // Turn off
              this.value &= ~(e.value >> 4);
            }
          }
        }
      }
    }
    this.computed = this.value;
  }

  /* FIXME:: This whole class is bogus and should be an SPIBitEnum TODO */
  override getValue(): string {
    if (this.inherit) return 'inherit';
    if (this.value === SPCSSFontVariantLigatures.SP_CSS_FONT_VARIANT_LIGATURES_NONE) return 'none';
    if (this.value === SPCSSFontVariantLigatures.SP_CSS_FONT_VARIANT_LIGATURES_NORMAL) return 'normal';
    let ret = '';
    if (!(this.value & SPCSSFontVariantLigatures.SP_CSS_FONT_VARIANT_LIGATURES_COMMON))
      ret += 'no-common-ligatures ';
    if (this.value & SPCSSFontVariantLigatures.SP_CSS_FONT_VARIANT_LIGATURES_DISCRETIONARY) {
      ret += 'discretionary-ligatures ';
    }
    if (this.value & SPCSSFontVariantLigatures.SP_CSS_FONT_VARIANT_LIGATURES_HISTORICAL) {
      ret += 'historical-ligatures ';
    }
    if (!(this.value & SPCSSFontVariantLigatures.SP_CSS_FONT_VARIANT_LIGATURES_CONTEXTUAL))
      ret += 'no-contextual ';
    return ret.slice(0, -1);
  }
}

/**
 * SPIEnum w/ extra bits. The 'font-variants-numeric' property is a complete mess that needs
 * special handling. Multiple key words can be specified, some exclusive of others.
 */
export class SPINumeric extends SPIEnum<number> {
  constructor(id: SPAttr) {
    super(id, enum_font_variant_numeric, SPCSSFontVariantNumeric.SP_CSS_FONT_VARIANT_NUMERIC_NORMAL);
  }

  override read(str: string | null): void {
    if (str === null) return;
    const N = SPCSSFontVariantNumeric;
    this.value = N.SP_CSS_FONT_VARIANT_NUMERIC_NORMAL;
    if (str === 'inherit') {
      this.set = true;
      this.inherit = true;
    } else if (str === 'normal') {
      // Defaults for TrueType
      this.inherit = false;
      this.set = true;
    } else {
      // We need to parse in order
      for (const token of str.split(/\s+/)) {
        for (const e of enum_font_variant_numeric) {
          if (token === e.key) {
            this.set = true;
            this.inherit = false;
            this.value |= e.value;

            // Must switch off incompatible value
            switch (e.value) {
              case N.SP_CSS_FONT_VARIANT_NUMERIC_LINING_NUMS:
                this.value &= ~N.SP_CSS_FONT_VARIANT_NUMERIC_OLDSTYLE_NUMS;
                break;
              case N.SP_CSS_FONT_VARIANT_NUMERIC_OLDSTYLE_NUMS:
                this.value &= ~N.SP_CSS_FONT_VARIANT_NUMERIC_LINING_NUMS;
                break;
              case N.SP_CSS_FONT_VARIANT_NUMERIC_PROPORTIONAL_NUMS:
                this.value &= ~N.SP_CSS_FONT_VARIANT_NUMERIC_TABULAR_NUMS;
                break;
              case N.SP_CSS_FONT_VARIANT_NUMERIC_TABULAR_NUMS:
                this.value &= ~N.SP_CSS_FONT_VARIANT_NUMERIC_PROPORTIONAL_NUMS;
                break;
              case N.SP_CSS_FONT_VARIANT_NUMERIC_DIAGONAL_FRACTIONS:
                this.value &= ~N.SP_CSS_FONT_VARIANT_NUMERIC_STACKED_FRACTIONS;
                break;
              case N.SP_CSS_FONT_VARIANT_NUMERIC_STACKED_FRACTIONS:
                this.value &= ~N.SP_CSS_FONT_VARIANT_NUMERIC_DIAGONAL_FRACTIONS;
                break;
              case N.SP_CSS_FONT_VARIANT_NUMERIC_NORMAL:
              case N.SP_CSS_FONT_VARIANT_NUMERIC_ORDINAL:
              case N.SP_CSS_FONT_VARIANT_NUMERIC_SLASHED_ZERO:
                // Do nothing
                break;
              default:
                console.error('SPINumeric::read(): Invalid value.');
                break;
            }
          }
        }
      }
    }
    this.computed = this.value;
  }

  /* FIXME:: This whole class is bogus and should be an SPIBitEnum TODO */
  override getValue(): string {
    if (this.inherit) return 'inherit';
    if (this.value === 0) return 'normal';
    const ret: string[] = [];
    for (let i = 1; i < enum_font_variant_numeric.length; ++i) {
      // Bitmap is shifted by 1 because normal is zero
      if (this.value & (1 << (i - 1))) ret.push(enum_font_variant_numeric[i]!.key);
    }
    return ret.join(' ');
  }
}

/**
 * SPIEnum w/ extra bits. The 'font-variants-east-asian' property is a complete mess that needs
 * special handling. Multiple key words can be specified, some exclusive of others.
 */
export class SPIEastAsian extends SPIEnum<number> {
  constructor(id: SPAttr) {
    super(id, enum_font_variant_east_asian, SPCSSFontVariantEastAsian.SP_CSS_FONT_VARIANT_EAST_ASIAN_NORMAL);
  }

  override read(str: string | null): void {
    if (str === null) return;
    const E = SPCSSFontVariantEastAsian;
    this.value = E.SP_CSS_FONT_VARIANT_EAST_ASIAN_NORMAL;
    if (str === 'inherit') {
      this.set = true;
      this.inherit = true;
    } else if (str === 'normal') {
      // Defaults for TrueType
      this.inherit = false;
      this.set = true;
    } else {
      // We need to parse in order
      for (const token of str.split(/\s+/)) {
        for (const e of enum_font_variant_east_asian) {
          if (token === e.key) {
            this.set = true;
            this.inherit = false;

            // Must switch off incompatible value (turn on correct one below)
            switch (e.value) {
              case E.SP_CSS_FONT_VARIANT_EAST_ASIAN_JIS78:
              case E.SP_CSS_FONT_VARIANT_EAST_ASIAN_JIS83:
              case E.SP_CSS_FONT_VARIANT_EAST_ASIAN_JIS90:
              case E.SP_CSS_FONT_VARIANT_EAST_ASIAN_JIS04:
              case E.SP_CSS_FONT_VARIANT_EAST_ASIAN_SIMPLIFIED:
              case E.SP_CSS_FONT_VARIANT_EAST_ASIAN_TRADITIONAL:
                this.value &= ~E.SP_CSS_FONT_VARIANT_EAST_ASIAN_JIS78;
                this.value &= ~E.SP_CSS_FONT_VARIANT_EAST_ASIAN_JIS83;
                this.value &= ~E.SP_CSS_FONT_VARIANT_EAST_ASIAN_JIS90;
                this.value &= ~E.SP_CSS_FONT_VARIANT_EAST_ASIAN_JIS04;
                this.value &= ~E.SP_CSS_FONT_VARIANT_EAST_ASIAN_SIMPLIFIED;
                this.value &= ~E.SP_CSS_FONT_VARIANT_EAST_ASIAN_TRADITIONAL;
                break;
              case E.SP_CSS_FONT_VARIANT_EAST_ASIAN_FULL_WIDTH:
                this.value &= ~E.SP_CSS_FONT_VARIANT_EAST_ASIAN_PROPORTIONAL_WIDTH;
                break;
              case E.SP_CSS_FONT_VARIANT_EAST_ASIAN_PROPORTIONAL_WIDTH:
                this.value &= ~E.SP_CSS_FONT_VARIANT_EAST_ASIAN_FULL_WIDTH;
                break;
              case E.SP_CSS_FONT_VARIANT_EAST_ASIAN_NORMAL:
              case E.SP_CSS_FONT_VARIANT_EAST_ASIAN_RUBY:
                // Do nothing
                break;
              default:
                console.error('SPIEastasian::read(): Invalid value.');
                break;
            }
            this.value |= e.value;
          }
        }
      }
    }
    this.computed = this.value;
  }

  // Like upstream, this pairs the bit (1 << i) with the key of index i. The table starts with
  // 'normal', so the keys are shifted by one against the bits.
  override getValue(): string {
    if (this.inherit) return 'inherit';
    if (this.value === 0) return 'normal';
    const ret: string[] = [];
    for (let i = 0; i < enum_font_variant_east_asian.length; ++i) {
      if (this.value & (1 << i)) ret.push(enum_font_variant_east_asian[i]!.key);
    }
    return ret.join(' ');
  }
}

// SPIString -------------------------------------------------------------------------------------

/** String type internal to SPStyle. Used for 'marker', ..., 'font', 'font-family', 'inkscape-font-specification'. */
export class SPIString extends SPIBase {
  protected _value: string | null = null;

  read(str: string | null): void {
    if (str === null) return;
    this.clear();
    if (str === 'inherit') {
      this.set = true;
      this.inherit = true;
    } else if (str === this.getDefaultValue()) {
      // no need to copy string
      this.set = true;
    } else {
      if (this.id === SPAttr.FONT_FAMILY) {
        // Family names may be quoted in CSS, internally we use unquoted names.
        str = cssFontFamilyUnquote(str);
      } else if (this.id === SPAttr.INKSCAPE_FONT_SPEC) {
        str = cssUnquote(str);
      }
      this.set = true;
      this._value = str;
    }
  }

  /** Value as it should be written to CSS representation, including quotes if needed. */
  getValue(): string {
    let val = '';
    if (this.set && this.inherit) {
      val = 'inherit';
    } else {
      const v = this.value();
      if (v !== null) {
        val = v;
        if (this.id === SPAttr.FONT_FAMILY) val = cssFontFamilyQuote(val);
        else if (this.id === SPAttr.INKSCAPE_FONT_SPEC) val = cssQuote(val);
      }
    }
    return val;
  }

  /** Get value if set, or inherited value, or default value (may be null). */
  value(): string | null {
    return this._value ?? this.getDefaultValue();
  }

  protected getDefaultValue(): string | null {
    switch (this.id) {
      case SPAttr.FONT_FAMILY:
        return 'sans-serif';
      case SPAttr.FONT_FEATURE_SETTINGS:
        return 'normal';
      default:
        return null;
    }
  }

  override clear(): void {
    super.clear();
    this._value = null;
  }

  cascade(parent: SPIBase): void {
    if (!(parent instanceof SPIString)) {
      this.incorrectParent('cascade');
      return;
    }
    if (this.inherits && (!this.set || this.inherit)) this._value = parent._value;
  }

  merge(parent: SPIBase): void {
    if (!(parent instanceof SPIString)) return;
    if (this.inherits && (!this.set || this.inherit) && parent.set && !parent.inherit) {
      this.set = parent.set;
      this.inherit = parent.inherit;
      this._value = parent._value;
    }
  }

  assign(rhs: SPIString): void {
    if (this === rhs) return;
    this.assignBase(rhs);
    this._value = rhs._value;
  }

  override equals(rhs: SPIBase): boolean {
    return rhs instanceof SPIString && this._value === rhs._value && super.equals(rhs);
  }
}

// SPIShapes -------------------------------------------------------------------------------------

/**
 * Shapes type internal to SPStyle. Used for 'shape-inside', shape-subtract'. Differs from
 * SPIString by creating/deleting listeners on referenced shapes.
 */
export class SPIShapes extends SPIString {
  hrefs: SPShapeReference[] = [];

  constructor(id: SPAttr) {
    super(id, false);
  }

  /** Check if a shape object exists in the selection (ObjectSet). */
  containsAnyShape(set: { includes(object: SPObject | null): boolean }): boolean {
    return this.hrefs.some((ref) => set.includes(ref.getObject()));
  }

  // Used to add/remove listeners for text wrapped in shapes.
  // Note: this is done differently than for patterns, etc. where presentation attributes can be used.
  // 'shape-inside' and 'shape-subtract' are only properties.
  override read(str: string | null): void {
    if (!this.style) {
      console.error('SPIShapes::read: no style!');
      return;
    }
    if (str === null) return;

    super.read(str);

    // The object/repr this property is connected to..
    const object = this.style.object;
    if (!object) {
      console.error('  No object');
      return;
    }

    // clear(); // Already cleared! (In SPStyle::read.)

    // Add new listeners
    for (const shapeUrl of str.split(' ')) {
      if (!shapeUrl.startsWith('url(#') || !shapeUrl.endsWith(')')) {
        console.error(`SPIShapes::read: Invalid shape value: ${shapeUrl}`);
      } else {
        const { uri } = extractUri(shapeUrl); // Do before we erase "url(#"
        // TODO: This ups the href count of the shape, so that vacuuming a document does not
        // delete shapes stored in <defs>. Needs the real SPShapeReference.
        const href = new SPShapeReference(object);
        if (href.tryAttach(uri)) this.hrefs.push(href);
      }
    }
  }

  override clear(): void {
    SPIBase.prototype.clear.call(this);
    this.hrefsClear();
  }

  protected hrefsClear(): void {
    for (const href of this.hrefs) href.detach();
    this.hrefs = [];
  }
}

// SPIColor --------------------------------------------------------------------------------------

/** The default color of SPIColor and SPIPaint: transparent RGB black. */
const defaultColor = (): Color => new Color(0x0);

/**
 * Color type internal to SPStyle. Used for 'color', 'text-decoration-color', 'flood-color',
 * 'lighting-color', and 'stop-color'. CSS3: 'currentcolor' is allowed value and is equal to
 * inherit for the 'color' property.
 */
export class SPIColor extends SPIBase {
  currentcolor = false;
  #color: Color | undefined;

  // TODO: the color of a document with CMS profiles (icc-color) needs DocumentCMS, which is not ported.

  read(str: string | null): void {
    if (str === null) return;
    this.set = false;
    this.inherit = false;
    this.currentcolor = false;
    if (str === 'inherit') {
      this.set = true;
      this.inherit = true;
    } else if (str === 'currentColor') {
      this.set = true;
      this.currentcolor = true;
      if (this.id === SPAttr.COLOR) {
        this.inherit = true; // CSS3
      } else if (this.style) {
        this.#color = this.style.color.#color?.clone();
      } else {
        console.error("SPIColor::read(): value is 'currentColor' but 'color' not available.");
      }
    } else {
      this.#color = Color.parse(str);
      this.set = this.#color !== undefined;
    }
  }

  getValue(): string {
    // currentcolor goes first to handle special case for 'color' property
    if (this.currentcolor) return 'currentColor';
    if (this.inherit) return 'inherit';
    return this.#color ? this.#color.toString() : '';
  }

  override clear(): void {
    super.clear();
    this.#color = undefined;
  }

  cascade(parent: SPIBase): void {
    if (!(parent instanceof SPIColor)) {
      this.incorrectParent('cascade');
      return;
    }
    if ((this.inherits && !this.set) || this.inherit) {
      // FIXME verify for 'color'
      if (!(this.inherit && this.currentcolor)) this.currentcolor = parent.currentcolor;
      this.#color = parent.#color?.clone();
    }
    // Add CSS4 Color: Lighter, Darker
  }

  merge(parent: SPIBase): void {
    if (!(parent instanceof SPIColor)) return;
    if (this.inherits && (!this.set || this.inherit) && parent.set && !parent.inherit) {
      this.set = parent.set;
      this.inherit = parent.inherit;
      this.currentcolor = parent.currentcolor;
      this.#color = parent.#color?.clone();
    }
  }

  /** Upstream operator=(SPIColor) */
  assign(rhs: SPIColor): void {
    this.assignBase(rhs);
    this.currentcolor = rhs.currentcolor;
    this.#color = rhs.#color?.clone();
  }

  setColor(other: Color): void {
    this.currentcolor = false;
    this.#color = other.clone();
    this.set = true;
  }

  getColor(): Color {
    return this.#color ?? defaultColor();
  }

  /** True if a color is stored (upstream: the optional has a value). */
  hasColor(): boolean {
    return this.#color !== undefined;
  }

  override equals(rhs: SPIBase): boolean {
    if (!(rhs instanceof SPIColor)) return false;
    if (this.currentcolor !== rhs.currentcolor) return false;
    if (!this.#color !== !rhs.#color) return false;
    if (this.#color && rhs.#color && !this.#color.equals(rhs.#color)) return false;
    return super.equals(rhs);
  }
}

// SPIColorInterpolation -------------------------------------------------------------------------

/** Used for 'color-interpolation' and 'color-interpolation-filters'. */
export class SPIColorInterpolation extends SPIBase {
  #colorSpace: AnySpace | undefined;

  read(str: string | null): void {
    this.set = str !== null;
    if (str !== null) {
      // Required for profile name containing a period (e.g., "CASIO-COMPUTER-CO.-LTD")
      // TODO: look up the CMS color spaces of the document (DocumentCMS).
      this.#colorSpace = Manager.get().findSvgColorSpace(cssUnquote(str));
    }
  }

  getValue(): string {
    return this.#colorSpace ? this.#colorSpace.getSvgName() : '';
  }

  override clear(): void {
    super.clear();
    this.#colorSpace = undefined;
  }

  cascade(parent: SPIBase): void {
    if (!(parent instanceof SPIColorInterpolation)) return;
    if (!this.set || this.inherit) this.#colorSpace = parent.#colorSpace;
  }

  merge(parent: SPIBase): void {
    if (!(parent instanceof SPIColorInterpolation)) return;
    this.set = parent.set;
    this.inherit = parent.inherit;
    this.#colorSpace = parent.#colorSpace;
  }

  getInterpolationSpace(): AnySpace | undefined {
    return this.#colorSpace;
  }
  setInterpolationSpace(space: AnySpace | undefined): void {
    this.#colorSpace = space;
  }
}

// SPIPaint --------------------------------------------------------------------------------------

/**
 * Paint type internal to SPStyle, used for 'fill', 'stroke' and 'text-decoration-fill/stroke'.
 * `style` is set in the SPStyle constructor. It is needed for the computed value when the value is
 * 'currentColor', and to find the object for creating an href.
 */
export class SPIPaint extends SPIBase {
  /** Inherited value (from cascade) */
  paintOrigin: SPPaintOrigin = SPPaintOrigin.SP_CSS_PAINT_ORIGIN_NORMAL;
  /** Set value (from XML) */
  paintSource: SPPaintOrigin = SPPaintOrigin.SP_CSS_PAINT_ORIGIN_NORMAL;
  noneSet = false;
  /** Value from XML: true if paint is set to 'inherit' (with a keyword) */
  inheritSource = false;
  href: SPPaintServerReference | null = null;
  tag: SPObject | null = null;
  #color: Color | undefined;

  constructor(id: SPAttr) {
    super(id);
    this.clear();
  }

  /** Set SPIPaint object from string. Precondition: this is style.fill or style.stroke. */
  read(str: string | null): void {
    if (str === null) return;

    this.reset(false); // Do not init

    // Is this necessary?
    let i = 0;
    while (isAsciiSpace(str[i])) ++i;
    str = str.slice(i);

    if (str === 'inherit') {
      this.set = true;
      this.inherit = true;
      this.inheritSource = true;
      return;
    }

    // Read any URL first. The other values can be stand-alone or backup to the URL.
    if (str.startsWith('url')) {
      const { uri, end } = extractUri(str);
      if (end === null) {
        if (uri === '') {
          console.error('SPIPaint::read: url is invalid');
          return;
        }
      } else {
        str = str.slice(end);
      }
      if (uri === '') {
        console.error('SPIPaint::read: url is empty');
      } else if (!this.style) {
        console.error('SPIPaint::read: url with empty SPStyle pointer');
      } else {
        this.set = true;

        // Create href if not done already
        if (!this.href) {
          const owner = this.style.object ?? this.style.document;
          if (!owner) {
            console.error('SPIPaint::read: No valid object or document!');
            return;
          }
          this.href = new SPPaintServerReference(owner);
          if (this === this.style.fill) {
            const style = this.style;
            style.fill_ps_changed_connection = this.href.changedSignal.connect((old, ref) =>
              spStyleFillPaintServerRefChanged(old, ref, style),
            );
          } else {
            const style = this.style;
            style.stroke_ps_changed_connection = this.href.changedSignal.connect((old, ref) =>
              spStyleStrokePaintServerRefChanged(old, ref, style),
            );
          }
        }

        spStyleSetIpaintToUriString(this.style, this, uri);
      }
    }

    // Continue to parse after url for fallback colors.
    let j = 0;
    while (isAsciiSpace(str[j])) ++j;
    str = str.slice(j);

    if (str === 'currentColor') {
      this.set = true;
      this.paintOrigin = SPPaintOrigin.SP_CSS_PAINT_ORIGIN_CURRENT_COLOR;
      this.paintSource = this.paintOrigin;
      if (this.style) {
        this.setColor(this.style.color.getColor());
      } else {
        // Normally an SPIPaint is part of an SPStyle and the value of 'color' is available. SPIPaint
        // can be used 'stand-alone' (e.g. to parse color values) in which case a value of
        // 'currentColor' is meaningless, thus we shouldn't reach here.
        console.error("SPIPaint::read(): value is 'currentColor' but 'color' not available.");
        this.setColor(new Color(0x000000ff));
      }
    } else if (str === 'context-fill') {
      this.set = true;
      this.paintOrigin = SPPaintOrigin.SP_CSS_PAINT_ORIGIN_CONTEXT_FILL;
      this.paintSource = this.paintOrigin;
    } else if (str === 'context-stroke') {
      this.set = true;
      this.paintOrigin = SPPaintOrigin.SP_CSS_PAINT_ORIGIN_CONTEXT_STROKE;
      this.paintSource = this.paintOrigin;
    } else if (str === 'none') {
      this.set = true;
      this.noneSet = true;
    } else {
      // TODO: parse with the CMS spaces of the document (DocumentCMS).
      const color = Color.parse(str);
      if (color) {
        this.set = true;
        this.#color = color;
      }
    }
  }

  getValue(): string {
    if (this.inherit) return 'inherit';
    if (this.noneSet) return 'none';
    // url must go first as other values can serve as fallbacks
    let ret = '';
    const css = this.href?.cssStr();
    if (css) ret += css;
    switch (this.paintSource) {
      case SPPaintOrigin.SP_CSS_PAINT_ORIGIN_CURRENT_COLOR:
        if (ret) ret += ' ';
        ret += 'currentColor';
        break;
      case SPPaintOrigin.SP_CSS_PAINT_ORIGIN_CONTEXT_FILL:
        if (ret) ret += ' ';
        ret += 'context-fill';
        break;
      case SPPaintOrigin.SP_CSS_PAINT_ORIGIN_CONTEXT_STROKE:
        if (ret) ret += ' ';
        ret += 'context-stroke';
        break;
      case SPPaintOrigin.SP_CSS_PAINT_ORIGIN_NORMAL:
        if (this.#color) {
          if (ret) ret += ' ';
          ret += this.#color.toString();
        }
        break;
    }
    return ret;
  }

  setColor(other: Color): void {
    this.#color = other.clone();
    this.set = true;
  }

  getColor(): Color {
    return this.#color ?? defaultColor();
  }

  override clear(): void {
    this.reset(true); // Reset and Init
  }

  /** Used internally when reading or cascading. */
  reset(init: boolean): void {
    super.clear();
    this.inheritSource = this.inherit;
    this.paintOrigin = SPPaintOrigin.SP_CSS_PAINT_ORIGIN_NORMAL;
    this.paintSource = this.paintOrigin;
    this.noneSet = false;
    this.#color = undefined;
    this.tag = null;
    this.dropHref();

    if (init && this.id === SPAttr.FILL) {
      this.#color = new Color(0x000000ff); // 'black' is default for 'fill'
    }
  }

  cascade(parent: SPIBase): void {
    if (!(parent instanceof SPIPaint)) {
      this.incorrectParent('cascade');
      return;
    }
    if (!this.set || this.inherit) {
      // Always inherits
      const inheritKeyword = this.inherit;
      this.reset(false); // Do not init

      this.inheritSource = inheritKeyword;

      if (parent.isPaintserver()) {
        if (parent.href) {
          // Why can we use p->document ?
          spStyleSetIpaintToUri(this.style!, this, parent.href.getURI(), parent.href.getOwnerDocument());
        } else {
          console.error('SPIPaint::cascade: Expected paint server not found.');
        }
      } else if (parent.isColor()) {
        this.#color = parent.#color?.clone();
      } else if (parent.isNoneSet()) {
        this.noneSet = true;
      } else if (parent.paintOrigin === SPPaintOrigin.SP_CSS_PAINT_ORIGIN_CURRENT_COLOR) {
        this.paintOrigin = SPPaintOrigin.SP_CSS_PAINT_ORIGIN_CURRENT_COLOR;
        this.#color = this.style!.color.getColor();
      } else if (parent.paintOrigin !== SPPaintOrigin.SP_CSS_PAINT_ORIGIN_NORMAL) {
        this.paintOrigin = parent.paintOrigin; // context fill/stroke
      } else if (this.isNone()) {
        //
      } else {
        throw new Error('SPIPaint::cascade: unreachable');
      }
    } else if (this.paintOrigin === SPPaintOrigin.SP_CSS_PAINT_ORIGIN_CURRENT_COLOR) {
      // Update in case color value changed.
      this.#color = this.style!.color.getColor();
    }
  }

  merge(parent: SPIBase): void {
    if (!(parent instanceof SPIPaint)) return;
    // if( inherits ) {  Paint always inherits
    if ((!this.set || this.inherit) && parent.set && !parent.inherit) {
      this.cascade(parent); // Must call before setting 'set'
      this.set = parent.set;
      this.inherit = parent.inherit;
    }
  }

  assign(rhs: SPIPaint): void {
    this.assignBase(rhs);
    this.paintOrigin = rhs.paintOrigin;
    this.paintSource = rhs.paintSource;
    this.noneSet = rhs.noneSet;
    this.inheritSource = rhs.inheritSource;
    this.#color = rhs.#color?.clone();
    if (rhs.href !== this.href) {
      this.dropHref();
      this.href = rhs.href;
      if (this.href) this.href._shares++;
    }
  }

  /**
   * Release the reference: detach it when no other SPIPaint shares it (upstream: href.reset()
   * on the shared_ptr, whose destructor detaches).
   */
  dropHref(): void {
    const href = this.href;
    this.href = null;
    if (href && --href._shares === 0) href.detach();
  }

  isSameType(other: SPIPaint): boolean {
    return (
      this.isPaintserver() === other.isPaintserver() &&
      this.isColor() === other.isColor() &&
      this.paintOrigin === other.paintOrigin &&
      this.paintSource === other.paintSource &&
      this.inheritSource === other.inheritSource
    );
  }

  isNoneSet(): boolean {
    return this.noneSet;
  }

  isNone(): boolean {
    return (
      this.paintOrigin === SPPaintOrigin.SP_CSS_PAINT_ORIGIN_NORMAL && !this.#color && !this.isPaintserver()
    );
  }

  isColor(): boolean {
    // TODO: consider paintOrigin too?
    return this.#color !== undefined && !this.isPaintserver();
  }

  isPaintserver(): boolean {
    return this.href !== null && this.href.getObject() !== null;
  }

  isContext(): boolean {
    return (
      this.paintOrigin === SPPaintOrigin.SP_CSS_PAINT_ORIGIN_CONTEXT_FILL ||
      this.paintOrigin === SPPaintOrigin.SP_CSS_PAINT_ORIGIN_CONTEXT_STROKE
    );
  }

  isDerived(): boolean {
    return !this.set || this.inheritSource || this.paintSource !== SPPaintOrigin.SP_CSS_PAINT_ORIGIN_NORMAL;
  }

  setNone(): void {
    this.noneSet = true;
    this.#color = undefined;
  }

  setTag(tag: SPObject | null): void {
    this.tag = tag;
  }
  getTag(): SPObject | null {
    return this.tag;
  }

  override equals(rhs: SPIBase): boolean {
    if (!(rhs instanceof SPIPaint)) return false;
    if (
      this.isColor() !== rhs.isColor() ||
      this.isPaintserver() !== rhs.isPaintserver() ||
      this.paintOrigin !== rhs.paintOrigin ||
      this.paintSource !== rhs.paintSource
    ) {
      return false;
    }
    if (this.isPaintserver()) {
      if (this.href === null || rhs.href === null || this.href.getObject() !== rhs.href.getObject()) {
        return false;
      }
    }
    if (this.isColor() && !this.#color!.equals(rhs.#color!)) return false;
    return super.equals(rhs);
  }
}

// SPIPaintOrder ---------------------------------------------------------------------------------

/** Each layer represents a layer of paint which can be a fill, a stroke, or markers. */
export const PAINT_ORDER_LAYERS = 3;

/** Paint order type internal to SPStyle. */
export class SPIPaintOrder extends SPIBase {
  layer: SPPaintOrderLayer[] = [];
  layer_set: boolean[] = [];
  /** Raw string */
  value: string | null = null;

  constructor(id: SPAttr) {
    super(id);
    this.clear();
  }

  read(str: string | null): void {
    if (str === null) return;
    this.value = null;
    this.set = false;
    this.inherit = false;

    if (str === 'inherit') {
      this.set = true;
      this.inherit = true;
    } else {
      this.set = true;
      this.value = str;

      if (str === 'normal') {
        this.layer[0] = SPPaintOrderLayer.SP_CSS_PAINT_ORDER_NORMAL;
        this.layer_set[0] = true;
      } else {
        const c = str === '' ? [] : str.split(' ');
        const used = [false, false, false];
        let i = 0;
        for (; i < PAINT_ORDER_LAYERS; ++i) {
          const token = c[i];
          if (token === undefined) break;
          this.layer_set[i] = false;
          if (token === 'fill') {
            this.layer[i] = SPPaintOrderLayer.SP_CSS_PAINT_ORDER_FILL;
            this.layer_set[i] = true;
            used[0] = true;
          } else if (token === 'stroke') {
            this.layer[i] = SPPaintOrderLayer.SP_CSS_PAINT_ORDER_STROKE;
            this.layer_set[i] = true;
            used[1] = true;
          } else if (token === 'markers') {
            this.layer[i] = SPPaintOrderLayer.SP_CSS_PAINT_ORDER_MARKER;
            this.layer_set[i] = true;
            used[2] = true;
          } else {
            console.error(`sp_style_read_ipaintorder: illegal value: ${token}`);
            break;
          }
        }

        // Fill out rest of the layers using the default order
        if (!used[0] && i < PAINT_ORDER_LAYERS) {
          this.layer[i] = SPPaintOrderLayer.SP_CSS_PAINT_ORDER_FILL;
          this.layer_set[i] = false;
          ++i;
        }
        if (!used[1] && i < PAINT_ORDER_LAYERS) {
          this.layer[i] = SPPaintOrderLayer.SP_CSS_PAINT_ORDER_STROKE;
          this.layer_set[i] = false;
          ++i;
        }
        if (!used[2] && i < PAINT_ORDER_LAYERS) {
          this.layer[i] = SPPaintOrderLayer.SP_CSS_PAINT_ORDER_MARKER;
          this.layer_set[i] = false;
        }
      }
    }
  }

  /** Return the index of the given paint order. */
  get_order(paintOrder: SPPaintOrderLayer): number {
    for (let i = 0; i < PAINT_ORDER_LAYERS; ++i) {
      if (this.layer[i] === paintOrder) return i;
    }
    // Default/normal (see SPIPaintOrder::read for expected state)
    return paintOrder - 1;
  }

  /** Get the actual layer order, converting "normal" to layers. */
  get_layers(): SPPaintOrderLayer[] {
    const ret = [
      SPPaintOrderLayer.SP_CSS_PAINT_ORDER_FILL,
      SPPaintOrderLayer.SP_CSS_PAINT_ORDER_STROKE,
      SPPaintOrderLayer.SP_CSS_PAINT_ORDER_MARKER,
    ];
    for (let i = 0; i < 3; i++) {
      if (this.layer[i] !== SPPaintOrderLayer.SP_CSS_PAINT_ORDER_NORMAL) ret[i] = this.layer[i]!;
    }
    return ret;
  }

  getValue(): string {
    if (this.inherit) return 'inherit';
    const ret: string[] = [];
    for (let i = 0; i < PAINT_ORDER_LAYERS; ++i) {
      if (!this.layer_set[i]) break;
      switch (this.layer[i]) {
        case SPPaintOrderLayer.SP_CSS_PAINT_ORDER_NORMAL:
          ret.push('normal');
          break;
        case SPPaintOrderLayer.SP_CSS_PAINT_ORDER_FILL:
          ret.push('fill');
          break;
        case SPPaintOrderLayer.SP_CSS_PAINT_ORDER_STROKE:
          ret.push('stroke');
          break;
        case SPPaintOrderLayer.SP_CSS_PAINT_ORDER_MARKER:
          ret.push('markers');
          break;
      }
    }
    return ret.join(' ');
  }

  override clear(): void {
    super.clear();
    for (let i = 0; i < PAINT_ORDER_LAYERS; ++i) {
      this.layer[i] = SPPaintOrderLayer.SP_CSS_PAINT_ORDER_NORMAL;
      this.layer_set[i] = false;
    }
    this.value = null;
  }

  cascade(parent: SPIBase): void {
    if (!(parent instanceof SPIPaintOrder)) {
      this.incorrectParent('cascade');
      return;
    }
    if (!this.set || this.inherit) {
      // Always inherits
      for (let i = 0; i < PAINT_ORDER_LAYERS; ++i) {
        this.layer[i] = parent.layer[i]!;
        this.layer_set[i] = parent.layer_set[i]!;
      }
      this.value = parent.value;
    }
  }

  merge(parent: SPIBase): void {
    if (!(parent instanceof SPIPaintOrder)) return;
    // PaintOrder always inherits
    if ((!this.set || this.inherit) && parent.set && !parent.inherit) {
      this.cascade(parent); // Must call before setting 'set'
      this.set = parent.set;
      this.inherit = parent.inherit;
    }
  }

  assign(rhs: SPIPaintOrder): void {
    if (this === rhs) return;
    this.assignBase(rhs);
    this.layer = [...rhs.layer];
    this.layer_set = [...rhs.layer_set];
    this.value = rhs.value;
  }

  override equals(rhs: SPIBase): boolean {
    if (!(rhs instanceof SPIPaintOrder)) return false;
    if (
      this.layer[0] === SPPaintOrderLayer.SP_CSS_PAINT_ORDER_NORMAL &&
      rhs.layer[0] === SPPaintOrderLayer.SP_CSS_PAINT_ORDER_NORMAL
    ) {
      return super.equals(rhs);
    }
    for (let i = 0; i < PAINT_ORDER_LAYERS; ++i) {
      if (this.layer[i] !== rhs.layer[i]) return false;
    }
    return super.equals(rhs);
  }
}

// SPIFilter -------------------------------------------------------------------------------------

/** Filter type internal to SPStyle. */
export class SPIFilter extends SPIBase {
  href: SPFilterReference | null = null;

  constructor(id: SPAttr) {
    super(id, false);
  }

  read(str: string | null): void {
    if (str === null) return;
    this.clear();

    if (str === 'inherit') {
      this.set = true;
      this.inherit = true;
    } else if (str === 'none') {
      this.set = true;
    } else if (str.startsWith('url')) {
      const { uri } = extractUri(str);
      if (uri === '') {
        console.error('SPIFilter::read: url is empty or invalid');
        return;
      }
      if (!this.style) {
        console.error('SPIFilter::read: url with empty SPStyle pointer');
        return;
      }
      this.set = true;

      // Create href if not already done.
      if (!this.href) {
        if (this.style.object) {
          this.href = new SPFilterReference(this.style.object);
        }
        // Do we have href now?
        if (this.href) {
          const style = this.style;
          style.filter_changed_connection = this.href.changedSignal.connect((old, ref) =>
            spStyleFilterRefChanged(old, ref, style),
          );
        } else {
          console.error("SPIFilter::read(): Could not allocate 'href'");
          return;
        }
      }

      // We have href
      this.href.attach(uri);
    } else {
      console.error(`SPIFilter::read(): malformed value: ${str}`);
    }
  }

  getValue(): string {
    if (this.inherit) return 'inherit';
    return this.href?.cssStr() ?? '';
  }

  override clear(): void {
    super.clear();
    if (this.href?.getObject()) this.href.detach();
  }

  cascade(parent: SPIBase): void {
    if (!(parent instanceof SPIFilter)) {
      this.incorrectParent('cascade');
      return;
    }
    if (this.inherit) {
      // Only inherits if 'inherit' true/
      // FIXME: This is rather unlikely so ignore for now.
      console.error("SPIFilter::cascade: value 'inherit' not supported.");
    }
  }

  merge(parent: SPIBase): void {
    if (!(parent instanceof SPIFilter)) return;
    // The "correct" thing to do is to combine the filter primitives.
    // The next best thing is to keep any filter on this object. If there
    // is no filter on this object, then use any filter on the parent.
    // TODO: parent.href.getObject() is always null until the filter references are ported, so a
    // parent's filter is never merged.
    if ((!this.set || this.inherit) && parent.href?.getObject()) {
      this.set = parent.set;
      this.inherit = parent.inherit;
      if (this.href) {
        // If we already have an href, use it (unlikely but heck...)
        if (this.href.getObject()) this.href.detach();
      } else if (this.style?.object) {
        // If we don't have an href, create it
        this.href = new SPFilterReference(this.style.object);
      } else if (this.style?.document) {
        this.href = new SPFilterReference(this.style.document);
      }
      // If we now have an href, try to attach parent filter
      const uri = parent.href.getURI();
      if (this.href && uri !== null) this.href.attach(uri);
    }
  }

  // FIXME
  override equals(rhs: SPIBase): boolean {
    return rhs instanceof SPIFilter;
  }
}

// SPIMarker -------------------------------------------------------------------------------------

/** Marker type internal to SPStyle. */
export class SPIMarker extends SPIString {
  #href: SPMarkerReference | null = null;

  override read(str: string | null): void {
    super.read(str);
    if (str === null || !str.startsWith('url')) return;

    const { uri } = extractUri(str);
    if (uri === '') {
      console.error('SPIMarker::read: url is empty or invalid');
      return;
    }
    if (!this.style) {
      console.error('SPIMarker::read: url with empty SPStyle pointer');
      return;
    }
    const target = this.style.object ?? this.style.document;
    if (!target) {
      console.error('SPIMarker::read: style without object or document');
      return;
    }
    this.#href = new SPMarkerReference(target);
    this.#href.attach(uri);
  }

  // Like upstream, this does not clear the string value (it skips SPIString::clear).
  override clear(): void {
    SPIBase.prototype.clear.call(this);
    this.#href = null;
  }

  get href(): SPMarkerReference | null {
    return this.#href;
  }
}

// SPIDashArray ----------------------------------------------------------------------------------

/** Dash array type internal to SPStyle. */
export class SPIDashArray extends SPIBase {
  // TODO: change double to SVGLength
  values: SPILength[] = [];

  read(str: string | null): void {
    if (str === null) return;
    this.set = true;
    if (str === 'inherit') {
      this.inherit = true;
      return;
    }
    this.values = [];
    if (str === 'none') return;

    // Upstream: the character class [(,\s|\s)]+
    const tokens = str.split(/[(,\s|)]+/);
    let lineSolid = true;
    for (const token of tokens) {
      const length = new SPILength(SPAttr.INVALID);
      length.read(token);
      if (length.value > 0.00000001) lineSolid = false;
      this.values.push(length);
    }
    if (lineSolid) this.values = [];
  }

  getValue(): string {
    if (this.inherit) return 'inherit';
    if (this.values.length === 0) return 'none';
    return this.values.map((v) => v.toString()).join(', ');
  }

  override clear(): void {
    super.clear();
    this.values = [];
  }

  cascade(parent: SPIBase): void {
    if (!(parent instanceof SPIDashArray)) {
      this.incorrectParent('cascade');
      return;
    }
    if (!this.set || this.inherit) this.values = parent.values.map(copyLength); // Always inherits
  }

  merge(parent: SPIBase): void {
    if (!(parent instanceof SPIDashArray)) {
      this.incorrectParent('merge');
      return;
    }
    if (this.inherits && (!this.set || this.inherit) && parent.set && !parent.inherit) {
      this.set = parent.set;
      this.inherit = parent.inherit;
      this.values = parent.values.map(copyLength);
    }
  }

  override equals(rhs: SPIBase): boolean {
    if (rhs instanceof SPIDashArray) {
      if (this.values.length !== rhs.values.length) return false;
      for (let i = 0; i < this.values.length; i++) {
        if (!this.values[i]!.equals(rhs.values[i]!)) return false;
      }
    }
    return super.equals(rhs);
  }

  isValid(): boolean {
    // If any value in the list is negative, the <dasharray> value is invalid.
    // https://svgwg.org/svg2-draft/painting.html#StrokeDashing
    return !this.values.some((len) => len.value < 0 || !Number.isFinite(len.value));
  }

  getComputed(): number[] {
    return this.values.map((v) => v.computed);
  }
}

function copyLength(length: SPILength): SPILength {
  const copy = new SPILength(length.id);
  copy.assign(length);
  return copy;
}

// SPIFontSize -----------------------------------------------------------------------------------

export enum SPFontSizeType {
  SP_FONT_SIZE_LITERAL,
  SP_FONT_SIZE_LENGTH,
  SP_FONT_SIZE_PERCENTAGE,
}

/** Indexed by SP_CSS_FONT_SIZE_blah. These seem a bit small. */
const font_size_table = [6.0, 8.0, 10.0, 12.0, 14.0, 18.0, 24.0];

/** Fontsize type internal to SPStyle (also used by libnrtype/Layout-TNG-Input.cpp). */
export class SPIFontSize extends SPIBase {
  static readonly font_size_default = 12.0;

  type = SPFontSizeType.SP_FONT_SIZE_LITERAL;
  unit = SPCSSUnit.SP_CSS_UNIT_NONE;
  literal: number = SPCSSFontSize.SP_CSS_FONT_SIZE_MEDIUM;
  value = 12.0;
  computed = 12.0;

  constructor(id: SPAttr) {
    super(id);
    this.clear();
  }

  read(str: string | null): void {
    if (str === null) return;
    if (str === 'inherit') {
      this.set = true;
      this.inherit = true;
    } else if (str[0] === 'x' || str[0] === 's' || str[0] === 'm' || str[0] === 'l') {
      // xx-small, x-small, etc.
      for (const e of enum_font_size) {
        if (str === e.key) {
          this.set = true;
          this.inherit = false;
          this.type = SPFontSizeType.SP_FONT_SIZE_LITERAL;
          this.literal = e.value;
          return;
        }
      }
      /* Invalid */
    } else {
      const length = new SPILength(SPAttr.INVALID);
      length.set = false;
      length.read(str);
      if (length.set) {
        this.set = true;
        this.inherit = length.inherit;
        this.unit = length.unit;
        this.value = length.value;
        this.computed = length.computed;
        /* Set a minimum font size to something much smaller than should ever (ever!) be
           encountered in a real file. If a bad SVG file is encountered and this is zero odd things
           might happen because the inverse is used in some scaling actions. */
        if (this.computed <= 1.0e-32) this.computed = 1.0e-32;
        this.type =
          this.unit === SPCSSUnit.SP_CSS_UNIT_PERCENT
            ? SPFontSizeType.SP_FONT_SIZE_PERCENTAGE
            : SPFontSizeType.SP_FONT_SIZE_LENGTH;
      }
    }
  }

  getValue(): string {
    if (this.inherit) return 'inherit';
    let unit = stylePrefs.fontUnitType;
    let ret = '';
    switch (this.type) {
      case SPFontSizeType.SP_FONT_SIZE_LITERAL:
        for (const e of enum_font_size) {
          if (e.value === this.literal) {
            if (ret) ret += ' ';
            ret += e.key;
          }
        }
        break;
      case SPFontSizeType.SP_FONT_SIZE_LENGTH:
        if (stylePrefs.fontTextOutputPx) unit = SPCSSUnit.SP_CSS_UNIT_PX;
        ret += formatClassic(spStyleCssSizePxToUnits(this.computed, unit));
        ret += spStyleGetCssUnitString(unit);
        break;
      case SPFontSizeType.SP_FONT_SIZE_PERCENTAGE:
        return `${formatClassic(this.value * 100.0)}%`;
      default:
        throw new Error('Invalid FontSize value, not writing it.');
    }
    return ret;
  }

  override clear(): void {
    super.clear();
    this.type = SPFontSizeType.SP_FONT_SIZE_LITERAL;
    this.unit = SPCSSUnit.SP_CSS_UNIT_NONE;
    this.literal = SPCSSFontSize.SP_CSS_FONT_SIZE_MEDIUM;
    this.value = 12.0;
    this.computed = 12.0;
  }

  cascade(parent: SPIBase): void {
    if (!(parent instanceof SPIFontSize)) {
      this.incorrectParent('cascade');
      return;
    }
    if (!this.set || this.inherit) {
      // Always inherits
      this.computed = parent.computed;
      this.value = parent.value;
      // Calculate computed based on parent as needed
    } else if (this.type === SPFontSizeType.SP_FONT_SIZE_LITERAL) {
      if (this.literal < SPCSSFontSize.SP_CSS_FONT_SIZE_SMALLER) {
        this.computed = font_size_table[this.literal]!;
      } else if (this.literal === SPCSSFontSize.SP_CSS_FONT_SIZE_SMALLER) {
        this.computed = parent.computed / 1.2;
      } else if (this.literal === SPCSSFontSize.SP_CSS_FONT_SIZE_LARGER) {
        this.computed = parent.computed * 1.2;
      } else {
        console.error('SPIFontSize::cascade: Illegal literal value');
      }
    } else if (this.type === SPFontSizeType.SP_FONT_SIZE_PERCENTAGE) {
      // Percentage for font size is relative to parent computed (rather than viewport)
      this.computed = parent.computed * this.value;
    } else if (this.type === SPFontSizeType.SP_FONT_SIZE_LENGTH) {
      switch (this.unit) {
        case SPCSSUnit.SP_CSS_UNIT_EM:
          /* Relative to parent font size */
          this.computed = parent.computed * this.value;
          break;
        case SPCSSUnit.SP_CSS_UNIT_EX:
          /* Relative to parent font size */
          this.computed = parent.computed * this.value * 0.5; /* Hack FIXME */
          break;
        default:
          /* No change */
          break;
      }
    }
    /* Set a minimum font size to something much smaller than should ever (ever!) be encountered in
       a real file. If a bad SVG file is encountered and this is zero odd things might happen
       because the inverse is used in some scaling actions. */
    if (this.computed <= 1.0e-32) this.computed = 1.0e-32;
  }

  #relativeFraction(): number {
    switch (this.type) {
      case SPFontSizeType.SP_FONT_SIZE_LITERAL:
        switch (this.literal) {
          case SPCSSFontSize.SP_CSS_FONT_SIZE_SMALLER:
            return 5.0 / 6.0;
          case SPCSSFontSize.SP_CSS_FONT_SIZE_LARGER:
            return 6.0 / 5.0;
          default:
            throw new Error('SPIFontSize: unreachable literal');
        }
      case SPFontSizeType.SP_FONT_SIZE_PERCENTAGE:
        return this.value;
      case SPFontSizeType.SP_FONT_SIZE_LENGTH:
        switch (this.unit) {
          case SPCSSUnit.SP_CSS_UNIT_EM:
            return this.value;
          case SPCSSUnit.SP_CSS_UNIT_EX:
            return this.value * 0.5;
          default:
            throw new Error('SPIFontSize: unreachable unit');
        }
    }
  }

  merge(parent: SPIBase): void {
    if (!(parent instanceof SPIFontSize)) {
      this.incorrectParent('merge');
      return;
    }
    if (parent.set && !parent.inherit) {
      // Parent has definined font-size
      if (!this.set || this.inherit) {
        // Computed value same as parent
        this.set = parent.set;
        this.inherit = parent.inherit;
        this.type = parent.type;
        this.unit = parent.unit;
        this.literal = parent.literal;
        this.value = parent.value;
        this.computed = parent.computed; // Just to be sure
      } else if (
        this.type === SPFontSizeType.SP_FONT_SIZE_LENGTH &&
        this.unit !== SPCSSUnit.SP_CSS_UNIT_EM &&
        this.unit !== SPCSSUnit.SP_CSS_UNIT_EX
      ) {
        // Absolute size, computed value already set
      } else if (
        this.type === SPFontSizeType.SP_FONT_SIZE_LITERAL &&
        this.literal < SPCSSFontSize.SP_CSS_FONT_SIZE_SMALLER
      ) {
        // Absolute size, computed value already set
      } else {
        // Relative size
        const childFrac = this.#relativeFraction();
        this.set = true;
        this.inherit = false;
        this.computed = parent.computed * childFrac;

        if (
          (parent.type === SPFontSizeType.SP_FONT_SIZE_LITERAL &&
            parent.literal < SPCSSFontSize.SP_CSS_FONT_SIZE_SMALLER) ||
          (parent.type === SPFontSizeType.SP_FONT_SIZE_LENGTH &&
            parent.unit !== SPCSSUnit.SP_CSS_UNIT_EM &&
            parent.unit !== SPCSSUnit.SP_CSS_UNIT_EX)
        ) {
          // Parent absolute size
          this.type = SPFontSizeType.SP_FONT_SIZE_LENGTH;
        } else {
          // Parent relative size
          const parentFrac = parent.#relativeFraction();
          if (this.type === SPFontSizeType.SP_FONT_SIZE_LENGTH) {
            // ex/em
            this.value *= parentFrac;
          } else {
            this.value = parentFrac * childFrac;
            this.type = SPFontSizeType.SP_FONT_SIZE_PERCENTAGE;
          }
        }
      } // Relative size
      /* Set a minimum font size to something much smaller than should ever (ever!) be encountered
         in a real file. */
      if (this.computed <= 1.0e-32) this.computed = 1.0e-32;
    } // Parent set and not inherit
  }

  assign(rhs: SPIFontSize): void {
    this.assignBase(rhs);
    this.type = rhs.type;
    this.unit = rhs.unit;
    this.literal = rhs.literal;
    this.value = rhs.value;
    this.computed = rhs.computed;
  }

  // What about different SVG units?
  override equals(rhs: SPIBase): boolean {
    if (!(rhs instanceof SPIFontSize)) return false;
    if (this.type !== rhs.type) return false;
    if (this.type === SPFontSizeType.SP_FONT_SIZE_LENGTH) {
      if (this.computed !== rhs.computed) return false;
    } else if (this.type === SPFontSizeType.SP_FONT_SIZE_LITERAL) {
      if (this.literal !== rhs.literal) return false;
    } else if (this.value !== rhs.value) {
      return false;
    }
    return super.equals(rhs);
  }
}

// SPIFont ---------------------------------------------------------------------------------------

/** Font type internal to SPStyle ('font' shorthand). */
export class SPIFont extends SPIBase {
  read(str: string | null): void {
    if (str === null) return;
    const style = this.style;
    if (!style) {
      console.error('SPIFont::read(): style is void');
      return;
    }

    if (str === 'inherit') {
      this.set = true;
      this.inherit = true;
      return;
    }

    // Break string into white space separated tokens
    const tokens = str.split(/[ \t\n\v\f\r]+/).filter((t) => t !== '');
    let param = '';
    let exhausted = true;
    for (let i = 0; i < tokens.length; ) {
      param = tokens[i++]!;

      // CSS is case insensitive but we're comparing against lowercase strings
      let lparam = param.toLowerCase();

      if (lparam === '/') {
        // line_height follows... note: font-size already read
        param = tokens[i++] ?? '';
        lparam = param.toLowerCase();
        style.line_height.readIfUnset(lparam);
      } else {
        // Try to parse each property in turn
        const testStyle = new SPIEnum(SPAttr.FONT_STYLE, enum_font_style, 0);
        testStyle.read(lparam);
        if (testStyle.set) {
          style.font_style.assign(testStyle);
          continue;
        }

        // font-variant (Note: only CSS2.1 value small-caps is valid in shortcut.)
        const testVariant = new SPIEnum(SPAttr.FONT_VARIANT, enum_font_variant, 0);
        testVariant.read(lparam);
        if (testVariant.set) {
          style.font_variant.assign(testVariant);
          continue;
        }

        // font-weight
        const testWeight = new SPIEnumFontWeight(
          SPAttr.FONT_WEIGHT,
          SPCSSFontWeight.SP_CSS_FONT_WEIGHT_NORMAL,
        );
        testWeight.read(lparam);
        if (testWeight.set) {
          style.font_weight.assign(testWeight);
          continue;
        }

        // font-stretch (added in CSS 3 Fonts)
        const testStretch = new SPIEnumFontStretch(SPAttr.FONT_STRETCH, 0);
        testStretch.read(lparam);
        if (testStretch.set) {
          style.font_stretch.assign(testStretch);
          continue;
        }

        // font-size
        const testSize = new SPIFontSize(SPAttr.FONT_SIZE);
        testSize.read(lparam);
        if (testSize.set) {
          style.font_size.assign(testSize);
          continue;
        }

        // No valid property value found.
        exhausted = false;
        break;
      }
    }
    // Like the failed extraction of a string from a stream, an exhausted token list gives an empty param.
    if (exhausted) param = '';

    // The rest must be font-family...
    const family = str.slice(Math.max(str.indexOf(param), 0));
    style.font_family.readIfUnset(family);

    // Everything in shorthand is set per CSS rules, this works since
    // properties are read backwards from end to start.
    style.font_style.set = true;
    style.font_variant.set = true;
    style.font_weight.set = true;
    style.font_stretch.set = true;
    style.font_size.set = true;
    style.line_height.set = true;
    style.font_family.set = true;
    // style.font_size_adjust.set = true;
    // style.font_kerning.set = true;
    // style.font_language_override.set = true;;
  }

  /** The 'font' shorthand is not written; the longhand properties are. */
  getValue(): string {
    if (this.inherit) return 'inherit';
    // At the moment, do nothing. We could add a preference to write out
    // 'font' shorthand rather than longhand properties.
    return '';
  }

  // Done in dependent properties
  cascade(_parent: SPIBase): void {}
  merge(_parent: SPIBase): void {}

  // Does nothing...
  override equals(rhs: SPIBase): boolean {
    return rhs instanceof SPIFont && super.equals(rhs);
  }
}

// SPIBaselineShift ------------------------------------------------------------------------------

export enum SPBaselineShiftType {
  SP_BASELINE_SHIFT_LITERAL,
  SP_BASELINE_SHIFT_LENGTH,
  SP_BASELINE_SHIFT_PERCENTAGE,
}

/** Baseline shift type internal to SPStyle. (This is actually just like SPIFontSize) */
export class SPIBaselineShift extends SPIBase {
  type = SPBaselineShiftType.SP_BASELINE_SHIFT_LITERAL;
  unit = SPCSSUnit.SP_CSS_UNIT_NONE;
  literal: number = SPCSSBaselineShift.SP_CSS_BASELINE_SHIFT_BASELINE;
  /** Can be negative. */
  value = 0.0;
  computed = 0.0;

  constructor(id: SPAttr) {
    super(id, false);
    this.clear();
  }

  read(str: string | null): void {
    if (str === null) return;
    if (str === 'inherit') {
      this.set = true;
      this.inherit = true;
    } else if (str[0] === 'b' || str[0] === 's') {
      // baseline or sub or super
      for (const e of enum_baseline_shift) {
        if (str === e.key) {
          this.set = true;
          this.inherit = false;
          this.type = SPBaselineShiftType.SP_BASELINE_SHIFT_LITERAL;
          this.literal = e.value;
          return;
        }
      }
      /* Invalid */
    } else {
      const length = new SPILength(SPAttr.INVALID);
      length.read(str);
      this.set = length.set;
      this.inherit = length.inherit;
      this.unit = length.unit;
      this.value = length.value;
      this.computed = length.computed;
      this.type =
        this.unit === SPCSSUnit.SP_CSS_UNIT_PERCENT
          ? SPBaselineShiftType.SP_BASELINE_SHIFT_PERCENTAGE
          : SPBaselineShiftType.SP_BASELINE_SHIFT_LENGTH;
    }
  }

  getValue(): string {
    if (this.inherit) return 'inherit';
    let ret = '';
    switch (this.type) {
      case SPBaselineShiftType.SP_BASELINE_SHIFT_LITERAL:
        for (const e of enum_baseline_shift) {
          if (e.value === this.literal) {
            if (ret) ret += ' ';
            ret += e.key;
          }
        }
        break;
      case SPBaselineShiftType.SP_BASELINE_SHIFT_LENGTH:
        if (this.unit === SPCSSUnit.SP_CSS_UNIT_EM || this.unit === SPCSSUnit.SP_CSS_UNIT_EX) {
          ret += formatClassic(this.value);
          ret += this.unit === SPCSSUnit.SP_CSS_UNIT_EM ? 'em' : 'ex';
        } else {
          // must specify px, see inkscape bug 1221626, mozilla bug 234789
          ret += `${formatClassic(this.computed)}px`;
        }
        break;
      case SPBaselineShiftType.SP_BASELINE_SHIFT_PERCENTAGE:
        return `${formatClassic(this.value * 100.0)}%`;
    }
    return ret;
  }

  override clear(): void {
    super.clear();
    this.type = SPBaselineShiftType.SP_BASELINE_SHIFT_LITERAL;
    this.unit = SPCSSUnit.SP_CSS_UNIT_NONE;
    this.literal = SPCSSBaselineShift.SP_CSS_BASELINE_SHIFT_BASELINE;
    this.value = 0.0;
    this.computed = 0.0;
  }

  cascade(parent: SPIBase): void {
    if (!(parent instanceof SPIBaselineShift)) {
      this.incorrectParent('cascade');
      return;
    }
    const pfontSize = parent.style!.font_size;

    if (!this.set || this.inherit) {
      this.computed = parent.computed; // Shift relative to parent shift, corrected below
    } else if (this.type === SPBaselineShiftType.SP_BASELINE_SHIFT_LITERAL) {
      if (this.literal === SPCSSBaselineShift.SP_CSS_BASELINE_SHIFT_BASELINE) {
        this.computed = 0; // No change
      } else if (this.literal === SPCSSBaselineShift.SP_CSS_BASELINE_SHIFT_SUB) {
        // Should use subscript position from font relative to alphabetic baseline
        // OpenOffice, Adobe: -0.33, Word -0.14, LaTex about -0.2.
        this.computed = -0.2 * pfontSize.computed;
      } else if (this.literal === SPCSSBaselineShift.SP_CSS_BASELINE_SHIFT_SUPER) {
        // Should use superscript position from font relative to alphabetic baseline
        // OpenOffice, Adobe: 0.33, Word 0.35, LaTex about 0.45.
        this.computed = 0.4 * pfontSize.computed;
      }
      // Illegal value otherwise
    } else if (this.type === SPBaselineShiftType.SP_BASELINE_SHIFT_PERCENTAGE) {
      // Percentage for baseline shift is relative to computed "line-height"
      // which is just font-size (see SVG1.1 'font').
      this.computed = pfontSize.computed * this.value;
    } else if (this.type === SPBaselineShiftType.SP_BASELINE_SHIFT_LENGTH) {
      switch (this.unit) {
        case SPCSSUnit.SP_CSS_UNIT_EM:
          this.computed = this.value * pfontSize.computed;
          break;
        case SPCSSUnit.SP_CSS_UNIT_EX:
          this.computed = this.value * 0.5 * pfontSize.computed;
          break;
        default:
          /* No change */
          break;
      }
    }
    // baseline-shifts are relative to parent baseline
    this.computed += parent.computed;
  }

  // This was not defined in the legacy C code, it needs some serious thinking (but is low priority).
  // FIX ME
  merge(parent: SPIBase): void {
    if (!(parent instanceof SPIBaselineShift)) {
      this.incorrectParent('merge');
      return;
    }
    if ((!this.set || this.inherit) && parent.set && !parent.inherit) {
      this.set = parent.set;
      this.inherit = parent.inherit;
      this.value = parent.value;
    }
  }

  // This is not used but we have it for completeness, it has not been tested.
  override equals(rhs: SPIBase): boolean {
    if (!(rhs instanceof SPIBaselineShift)) return false;
    if (this.type !== rhs.type) return false;
    if (this.type === SPBaselineShiftType.SP_BASELINE_SHIFT_LENGTH) {
      if (this.computed !== rhs.computed) return false;
    } else if (this.type === SPBaselineShiftType.SP_BASELINE_SHIFT_LITERAL) {
      if (this.literal !== rhs.literal) return false;
    } else if (this.value !== rhs.value) {
      return false;
    }
    return super.equals(rhs);
  }

  isZero(): boolean {
    if (this.type === SPBaselineShiftType.SP_BASELINE_SHIFT_LITERAL) {
      if (this.literal === SPCSSBaselineShift.SP_CSS_BASELINE_SHIFT_BASELINE) return true;
    } else if (this.value === 0.0) {
      return true;
    }
    return false;
  }
}

// Text decoration -------------------------------------------------------------------------------

/** Split at spaces and commas, like the scanning loops of the text decoration properties. */
const splitDecoration = (str: string): string[] => str.split(/[ ,]/);

/**
 * Text decoration line type internal to SPStyle (CSS3 2.2). THIS SHOULD BE A GENERIC CLASS.
 * Used for 'text-decoration-line'.
 */
export class SPITextDecorationLine extends SPIBase {
  underline = false;
  overline = false;
  line_through = false;
  /** "Conforming user agents are not required to support this value." yay! */
  blink = false;

  constructor(id: SPAttr) {
    super(id);
    this.clear();
  }

  read(str: string | null): void {
    if (str === null) return;
    if (str === 'inherit') {
      this.set = true;
      this.inherit = true;
    } else if (str === 'none') {
      this.set = true;
      this.inherit = false;
      this.underline = false;
      this.overline = false;
      this.line_through = false;
      this.blink = false;
    } else {
      let foundOne = false;
      // CSS 2 keywords
      let foundUnderline = false;
      let foundOverline = false;
      let foundLineThrough = false;
      let foundBlink = false;

      // This method ignores invalid keys and extra delimiters, so " ,,, blink hello" will set
      // blink and ignore hello
      for (const word of splitDecoration(str)) {
        let hit = true; // most likely we will
        if (word === 'underline') foundUnderline = true;
        else if (word === 'overline') foundOverline = true;
        else if (word === 'line-through') foundLineThrough = true;
        else if (word === 'blink') foundBlink = true;
        else if (word === 'none') {
          // recognized, no flag
        } else hit = false; // whatever this thing is, we do not recognize it
        foundOne ||= hit;
      }
      if (foundOne) {
        this.set = true;
        this.inherit = false;
        this.underline = foundUnderline;
        this.overline = foundOverline;
        this.line_through = foundLineThrough;
        this.blink = foundBlink;
      } else {
        this.set = false;
        this.inherit = false;
      }
    }
  }

  getValue(): string {
    if (this.inherit) return 'inherit';
    let ret = '';
    if (this.underline) ret += 'underline ';
    if (this.overline) ret += 'overline ';
    if (this.line_through) ret += 'line-through ';
    if (this.blink) ret += 'blink '; // Deprecated
    return ret === '' ? 'none' : ret.slice(0, -1);
  }

  override clear(): void {
    super.clear();
    this.underline = false;
    this.overline = false;
    this.line_through = false;
    this.blink = false;
  }

  cascade(parent: SPIBase): void {
    if (!(parent instanceof SPITextDecorationLine)) {
      this.incorrectParent('cascade');
      return;
    }
    if (this.inherits && (!this.set || this.inherit)) {
      this.underline = parent.underline;
      this.overline = parent.overline;
      this.line_through = parent.line_through;
      this.blink = parent.blink;
    }
  }

  merge(parent: SPIBase): void {
    if (!(parent instanceof SPITextDecorationLine)) return;
    // Always inherits... but special rules?
    if (this.inherits && (!this.set || this.inherit) && parent.set && !parent.inherit) {
      this.set = parent.set;
      this.inherit = parent.inherit;
      this.underline = parent.underline;
      this.overline = parent.overline;
      this.line_through = parent.line_through;
      this.blink = parent.blink;
    }
  }

  assign(rhs: SPITextDecorationLine): void {
    this.assignBase(rhs);
    this.underline = rhs.underline;
    this.overline = rhs.overline;
    this.line_through = rhs.line_through;
    this.blink = rhs.blink;
  }

  override equals(rhs: SPIBase): boolean {
    return (
      rhs instanceof SPITextDecorationLine &&
      this.underline === rhs.underline &&
      this.overline === rhs.overline &&
      this.line_through === rhs.line_through &&
      this.blink === rhs.blink &&
      super.equals(rhs)
    );
  }
}

/** Text decoration style type internal to SPStyle (CSS3 2.2). THIS SHOULD JUST BE SPIEnum! */
export class SPITextDecorationStyle extends SPIBase {
  solid = true;
  /** cannot use "double" as it is a reserved keyword */
  isdouble = false;
  dotted = false;
  dashed = false;
  wavy = false;

  constructor(id: SPAttr) {
    super(id);
    this.clear();
  }

  read(str: string | null): void {
    if (str === null) return;
    this.set = false;
    this.inherit = false;

    this.solid = true; // Default
    this.isdouble = false;
    this.dotted = false;
    this.dashed = false;
    this.wavy = false;

    if (str === 'inherit') {
      this.set = true;
      this.inherit = true;
      this.solid = false;
    } else {
      // note, these are CSS 3 keywords
      let foundSolid = false;
      let foundDouble = false;
      let foundDotted = false;
      let foundDashed = false;
      let foundWavy = false;
      let foundOne = false;

      // this method ignores invalid keys and extra delimiters, so " ,,, style hello" will set style and ignore hello
      // if more than one style is present, the first is used
      for (const word of splitDecoration(str)) {
        if (word === 'solid') foundSolid = foundOne = true;
        else if (word === 'double') foundDouble = foundOne = true;
        else if (word === 'dotted') foundDotted = foundOne = true;
        else if (word === 'dashed') foundDashed = foundOne = true;
        else if (word === 'wavy') foundWavy = foundOne = true;
        if (foundOne) break;
      }
      if (foundOne) {
        this.set = true;
        this.solid = foundSolid;
        this.isdouble = foundDouble;
        this.dotted = foundDotted;
        this.dashed = foundDashed;
        this.wavy = foundWavy;
      } else {
        this.set = false;
        this.inherit = false;
      }
    }
  }

  getValue(): string {
    if (this.inherit) return 'inherit';
    if (this.solid) return 'solid';
    if (this.isdouble) return 'double';
    if (this.dotted) return 'dotted';
    if (this.dashed) return 'dashed';
    if (this.wavy) return 'wavy';
    throw new Error('SPITextDecorationStyle::write(): No valid value for property');
  }

  override clear(): void {
    super.clear();
    this.solid = true;
    this.isdouble = false;
    this.dotted = false;
    this.dashed = false;
    this.wavy = false;
  }

  cascade(parent: SPIBase): void {
    if (!(parent instanceof SPITextDecorationStyle)) {
      this.incorrectParent('cascade');
      return;
    }
    if (this.inherits && (!this.set || this.inherit)) {
      this.solid = parent.solid;
      this.isdouble = parent.isdouble;
      this.dotted = parent.dotted;
      this.dashed = parent.dashed;
      this.wavy = parent.wavy;
    }
  }

  merge(parent: SPIBase): void {
    if (!(parent instanceof SPITextDecorationStyle)) return;
    // Always inherits... but special rules?
    if (this.inherits && (!this.set || this.inherit) && parent.set && !parent.inherit) {
      this.set = parent.set;
      this.inherit = parent.inherit;
      this.solid = parent.solid;
      this.isdouble = parent.isdouble;
      this.dotted = parent.dotted;
      this.dashed = parent.dashed;
      this.wavy = parent.wavy;
    }
  }

  assign(rhs: SPITextDecorationStyle): void {
    this.assignBase(rhs);
    this.solid = rhs.solid;
    this.isdouble = rhs.isdouble;
    this.dotted = rhs.dotted;
    this.dashed = rhs.dashed;
    this.wavy = rhs.wavy;
  }

  override equals(rhs: SPIBase): boolean {
    return (
      rhs instanceof SPITextDecorationStyle &&
      this.solid === rhs.solid &&
      this.isdouble === rhs.isdouble &&
      this.dotted === rhs.dotted &&
      this.dashed === rhs.dashed &&
      this.wavy === rhs.wavy &&
      super.equals(rhs)
    );
  }
}

// TextDecorationColor is handled by SPIColor, default value is "currentColor".

/**
 * Text decoration type internal to SPStyle. This class reads in both CSS2 and CSS3
 * 'text-decoration' property. It passes the line, style, and color parts to the appropriate CSS3
 * long-hand classes for reading and storing values. When writing out data, we write all four
 * properties, with 'text-decoration' being written out with the CSS2 format. This allows
 * CSS1/CSS2 renderers to at least render lines, even if they are not the right style. (See
 * http://www.w3.org/TR/css-text-decor-3/#text-decoration-property)
 */
export class SPITextDecoration extends SPIBase {
  /** Style to be used for drawing CSS2 text decorations. */
  style_td: SPStyle | null = null;

  read(str: string | null): void {
    if (str === null) return;
    const style = this.style!;
    let isCss3 = false;

    const testLine = new SPITextDecorationLine(SPAttr.TEXT_DECORATION_LINE);
    testLine.read(str);
    if (testLine.set) {
      if (!style.text_decoration_line.set) style.text_decoration_line.assign(testLine);
      this.set = true;
    }

    const testStyle = new SPITextDecorationStyle(SPAttr.TEXT_DECORATION_STYLE);
    testStyle.read(str);
    if (testStyle.set) {
      style.text_decoration_style.assign(testStyle);
      isCss3 = true;
    }

    // the color routine must be fed one token at a time - if multiple colors are found the LAST
    // one is used  ???? then why break on set?

    // This could certainly be designed better
    const testColor = new SPIColor(SPAttr.TEXT_DECORATION_COLOR);
    testColor.setStylePointer(style);
    testColor.read('currentColor'); // Default value
    testColor.set = false;
    let hstr = 0;
    for (let i = 0; ; i++) {
      const c = str[i];
      if (c === ' ' || c === ',' || c === undefined) {
        // only send one piece at a time, since keywords may be intermixed (the piece includes the delimiter)
        const frag = str.slice(hstr, i + 1);
        if (frag !== 'none') testColor.read(frag); // 'none' not allowed
        if (testColor.set) {
          style.text_decoration_color.assign(testColor);
          isCss3 = true;
          break;
        }
        testColor.read('currentColor'); // Default value
        testColor.set = false;
        if (c === undefined) break;
        hstr = i + 1;
      }
    }

    // If we read a style or color then we have CSS3 which require any non-set values to be
    // set to their default values.
    if (isCss3) {
      style.text_decoration_line.set = true;
      style.text_decoration_style.set = true;
      style.text_decoration_color.set = true;
      this.set = true;
    }

    // If we set text_decoration_line, then update style_td (for CSS2 text-decoration)
    if (style.text_decoration_line.set) this.style_td = style;
  }

  // Returns CSS2 'text-decoration' (using settings in SPTextDecorationLine)
  // This is required until all SVG renderers support CSS3 'text-decoration'
  getValue(): string {
    if (this.inherit) return 'inherit';
    return this.style!.text_decoration_line.getValue();
  }

  override write(
    flags: number = SP_STYLE_FLAG_IFSET,
    styleSrcReq: SPStyleSrc = SPStyleSrc.STYLE_PROP,
    base: SPIBase | null = null,
  ): string {
    const myBase = base instanceof SPITextDecoration ? base : null;
    if (base && !myBase) throw new Error('SPITextDecoration::write: wrong base type');
    // proxy for text-decoration-line, but only if set
    if (
      this.set &&
      this.style?.text_decoration_line.shallWrite(
        flags,
        styleSrcReq,
        myBase ? myBase.style!.text_decoration_line : null,
      )
    ) {
      return `${this.name()}:${this.getValue()}${this.importantStr()};`;
    }
    return '';
  }

  override clear(): void {
    super.clear();
    this.style_td = null;
  }

  cascade(parent: SPIBase): void {
    if (!(parent instanceof SPITextDecoration)) {
      this.incorrectParent('cascade');
      return;
    }
    if (this.style_td === null) this.style_td = parent.style_td;
  }

  merge(parent: SPIBase): void {
    if (!(parent instanceof SPITextDecoration)) {
      this.incorrectParent('merge');
      return;
    }
    if (this.style_td === null) this.style_td = parent.style_td;
  }

  // Use CSS2 value
  override equals(rhs: SPIBase): boolean {
    return (
      rhs instanceof SPITextDecoration &&
      this.style!.text_decoration_line.equals(rhs.style!.text_decoration_line) &&
      super.equals(rhs)
    );
  }
}

/** These are used to implement text_decoration. The values are not saved to or read from SVG file. */
export interface SPITextDecorationData {
  /** length along text line, used for phase for dot/dash/wavy */
  phase_length: number;
  /** is first span on a line */
  tspan_line_start: boolean;
  /** is last span on a line */
  tspan_line_end: boolean;
  /** from libnrtype, when it calculates spans */
  tspan_width: number;
  /** the rest from tspan's font */
  ascender: number;
  descender: number;
  underline_thickness: number;
  underline_position: number;
  line_through_thickness: number;
  line_through_position: number;
}

// Vector effect and stroke extensions -----------------------------------------------------------

/** Vector Effects. THIS SHOULD BE A GENERIC CLASS. */
export class SPIVectorEffect extends SPIBase {
  stroke = false;
  size = false;
  rotate = false;
  fixed = false;

  constructor(id: SPAttr) {
    super(id, false);
    this.clear();
  }

  read(str: string | null): void {
    if (str === null) return;
    if (str === 'none') {
      this.set = true;
      this.stroke = false;
      this.size = false;
      this.rotate = false;
      this.fixed = false;
    } else {
      let foundOne = false;
      let foundStroke = false;
      let foundSize = false;
      let foundRotate = false;
      let foundFixed = false;

      for (const word of splitDecoration(str)) {
        let hit = true; // most likely we will
        if (word === 'non-scaling-stroke') foundStroke = true;
        else if (word === 'non-scaling-size') foundSize = true;
        else if (word === 'non-rotation') foundRotate = true;
        else if (word === 'fixed-position') foundFixed = true;
        else if (word === 'none') {
          // recognized, no flag
        } else hit = false; // whatever this thing is, we do not recognize it
        foundOne ||= hit;
      }
      if (foundOne) {
        this.set = true;
        this.stroke = foundStroke;
        this.size = foundSize;
        this.rotate = foundRotate;
        this.fixed = foundFixed;
      } else {
        this.set = false;
      }
    }
  }

  getValue(): string {
    if (this.inherit) return 'inherit';
    let ret = '';
    if (this.stroke) ret += ' non-scaling-stroke';
    if (this.size) ret += ' non-scaling-size';
    if (this.rotate) ret += ' non-rotation';
    if (this.fixed) ret += ' fixed-position';
    return ret === '' ? 'none' : ret.slice(1);
  }

  override clear(): void {
    super.clear();
    this.stroke = false;
    this.size = false;
    this.rotate = false;
    this.fixed = false;
  }

  // Does not inherit
  cascade(_parent: SPIBase): void {}
  merge(_parent: SPIBase): void {}

  override equals(rhs: SPIBase): boolean {
    return (
      rhs instanceof SPIVectorEffect &&
      this.stroke === rhs.stroke &&
      this.size === rhs.size &&
      this.rotate === rhs.rotate &&
      this.fixed === rhs.fixed &&
      super.equals(rhs)
    );
  }
}

/** Custom stroke properties. Only used for -inkscape-stroke: hairline. */
export class SPIStrokeExtensions extends SPIBase {
  hairline = false;

  read(str: string | null): void {
    if (str === null) return;
    this.set = false;
    this.hairline = false;
    if (str === 'none') {
      this.set = true;
    } else if (str === 'hairline') {
      this.set = true;
      this.hairline = true;
    }
  }

  getValue(): string {
    if (this.inherit) return 'inherit';
    if (this.hairline) return 'hairline';
    return 'none';
  }

  override clear(): void {
    super.clear();
    this.hairline = false;
  }

  // Does not inherit
  cascade(_parent: SPIBase): void {}
  merge(_parent: SPIBase): void {}

  override equals(rhs: SPIBase): boolean {
    return rhs instanceof SPIStrokeExtensions && this.hairline === rhs.hairline && super.equals(rhs);
  }
}

/*
 * NOTES
 *
 * opacity's effect is cumulative; we set the new value to the combined effect. The default value
 * for opacity is 1.0, not inherit. stop-opacity also does not inherit. (Note that stroke-opacity
 * and fill-opacity are quite different from opacity, and don't need any special handling.)
 *
 * Cases:
 * - parent & child were each previously unset, in which case the effective
 *   opacity value is 1.0, and style should remain unset.
 * - parent was previously unset (so computed opacity value of 1.0)
 *   and child was set to inherit. The merged child should
 *   get a value of 1.0, and shouldn't inherit (lest the new parent
 *   has a different opacity value). Given that opacity's default
 *   value is 1.0 (rather than inherit), we might as well have the
 *   merged child's opacity be unset.
 * - parent was previously unset (so opacity 1.0), and child was set to a number.
 *   The merged child should retain its existing settings (though it doesn't matter
 *   if we make it unset if that number was 1.0).
 * - parent was inherit and child was unset. Merged child should be set to inherit.
 * - parent was inherit and child was inherit. (We can't in general reproduce this
 *   effect (short of introducing a new group), but setting opacity to inherit is rare.)
 *   If the inherited value was strictly between 0.0 and 1.0 (exclusive) then the merged
 *   child's value should be set to the product of the two, i.e. the square of the
 *   inherited value, and should not be marked as inherit. If the inherited value was 0.0 or
 *   1.0, then marking the merged child as inherit comes closer to maintaining the effect.
 * - parent was inherit and child was set to a numerical value. If the child's value
 *   was 1.0, then the merged child should have the same settings as the parent.
 *   If the child's value was 0, then the merged child should also be set to 0.
 *   If the child's value was anything else, then we do the same as for the inherit/inherit
 *   case above: have the merged child set to the product of the two opacities and not
 *   marked as inherit, for the same reasons as for that case.
 * - parent was set to a value, and child was unset. The merged child should have
 *   parent's settings.
 * - parent was set to a value, and child was inherit. The merged child should
 *   be set to the product, i.e. the square of the parent's value.
 * - parent & child are each set to a value. The merged child should be set to the
 *   product.
 */
