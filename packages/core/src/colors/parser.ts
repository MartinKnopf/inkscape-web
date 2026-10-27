// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/colors/parser.cpp, src/colors/parser.h
/*
 * Copyright (C) 2023 AUTHORS
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

import { SpaceType } from './spaces/enum.ts';
import { SP_RGBA32_A_F, SP_RGBA32_B_F, SP_RGBA32_G_F, SP_RGBA32_R_F } from './utils.ts';

const WHITESPACE = ' \t\n\v\f\r';

function isSpace(c: string): boolean {
  return WHITESPACE.includes(c);
}

function isDigit(c: string | null): boolean {
  return c !== null && c >= '0' && c <= '9';
}

function isHexDigit(c: string): boolean {
  return /^[0-9a-fA-F]$/.test(c);
}

/**
 * The part of std::istringstream that the color parsers use, with its state bits: reading at
 * the end of the string sets `eof`, a failed read sets `fail`, and once one of them is set all
 * reads fail until `clear()` or `seekg()`.
 */
export class StringStream {
  readonly #s: string;
  #pos = 0;
  #eof = false;
  #fail = false;

  constructor(s: string) {
    this.#s = s;
  }

  str(): string {
    return this.#s;
  }

  /** True while the stream has no failure (upstream `operator bool`). */
  ok(): boolean {
    return !this.#fail;
  }
  eof(): boolean {
    return this.#eof;
  }

  /** Every input operation starts with this check. */
  #sentry(): boolean {
    if (this.#eof || this.#fail) {
      this.#fail = true;
      return false;
    }
    return true;
  }

  /** The current position, or -1 if the stream is not usable. */
  tellg(): number {
    return this.#sentry() ? this.#pos : -1;
  }

  /** Move to `pos`, clearing the eof state. */
  seekg(pos: number): void {
    this.#eof = false;
    if (this.#fail || pos < 0) {
      if (pos < 0) this.#fail = true;
      return;
    }
    this.#pos = pos;
  }

  clear(): void {
    this.#eof = false;
    this.#fail = false;
  }

  /** The next character, or null at the end. */
  peek(): string | null {
    if (!this.#sentry()) return null;
    if (this.#pos >= this.#s.length) {
      this.#eof = true;
      return null;
    }
    return this.#s[this.#pos]!;
  }

  /** Consume the next character, or null at the end. */
  get(): string | null {
    if (!this.#sentry()) return null;
    if (this.#pos >= this.#s.length) {
      this.#eof = true;
      this.#fail = true;
      return null;
    }
    return this.#s[this.#pos++]!;
  }

  /** `ss >> std::ws` */
  ws(): void {
    if (!this.#sentry()) return;
    while (this.#pos < this.#s.length && isSpace(this.#s[this.#pos]!)) this.#pos++;
    if (this.#pos >= this.#s.length) this.#eof = true;
  }

  /** `ss >> string`: skip whitespace, then read up to the next whitespace. */
  readToken(): string {
    if (!this.#sentry()) return '';
    while (this.#pos < this.#s.length && isSpace(this.#s[this.#pos]!)) this.#pos++;
    const start = this.#pos;
    while (this.#pos < this.#s.length && !isSpace(this.#s[this.#pos]!)) this.#pos++;
    if (this.#pos >= this.#s.length) this.#eof = true;
    if (this.#pos === start) this.#fail = true;
    return this.#s.slice(start, this.#pos);
  }

  /** `std::getline(ss, token, delim)`. Returns null if nothing was read. */
  getline(delim: string): string | null {
    if (!this.#sentry()) return null;
    const start = this.#pos;
    const end = this.#s.indexOf(delim, start);
    if (end === -1) {
      this.#pos = this.#s.length;
      this.#eof = true;
      if (this.#pos === start) {
        this.#fail = true;
        return null;
      }
      return this.#s.slice(start);
    }
    this.#pos = end + 1;
    return this.#s.slice(start, end);
  }

  /**
   * `ss >> double`: skip whitespace, then read a decimal number like `-1.5`, `.5` or `2e-3`.
   * Returns null (and fails) if there is no number.
   */
  readDouble(): number | null {
    if (!this.#sentry()) return null;
    while (this.#pos < this.#s.length && isSpace(this.#s[this.#pos]!)) this.#pos++;
    const m = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(this.#s.slice(this.#pos));
    if (!m) {
      if (this.#pos >= this.#s.length) this.#eof = true;
      this.#fail = true;
      return null;
    }
    this.#pos += m[0].length;
    if (this.#pos >= this.#s.length) this.#eof = true;
    return Number.parseFloat(m[0]);
  }

  /**
   * `ss >> std::hex >> unsigned`: skip whitespace, then read hexadecimal digits. Returns the
   * value and the position after the digits. Fails if there are no digits or the value does
   * not fit in 32 bits.
   */
  readHex(): number | null {
    if (!this.#sentry()) return null;
    while (this.#pos < this.#s.length && isSpace(this.#s[this.#pos]!)) this.#pos++;
    const start = this.#pos;
    while (this.#pos < this.#s.length && isHexDigit(this.#s[this.#pos]!)) this.#pos++;
    if (this.#pos >= this.#s.length) this.#eof = true;
    const digits = this.#s.slice(start, this.#pos);
    const value = digits === '' ? Number.NaN : Number.parseInt(digits, 16);
    if (Number.isNaN(value) || value > 0xffffffff) {
      this.#fail = true;
      return null;
    }
    return value;
  }
}

/** Out parameter of the parsers: set when the string goes on after the color. */
export interface ParseMore {
  more: boolean;
}

/** Out parameter of the css value parsers: set when the closing parenthesis was read. */
export interface ParseEnd {
  end: boolean;
}

/** A number read by `Parser.css_number`. */
export interface CssNumber {
  value: number;
  unit: string;
  end: boolean;
}

/** Parses the arguments of one kind of color, for example `rgb(...)`, found by its prefix. */
export class Parser {
  readonly #prefix: string;
  readonly #type: SpaceType;

  constructor(prefix: string, type: SpaceType) {
    this.#prefix = prefix;
    this.#type = type;
  }

  getType(): SpaceType {
    return this.#type;
  }

  getPrefix(): string {
    return this.#prefix;
  }

  /**
   * Parse CSS color numbers after the function name
   *
   * @arg ss - The string stream to read
   *
   * @returns - The color prefix or color name detected in this color function.
   *            either the first part of the function, for example rgb or hsla
   *            or the first variable in the case of color(), icc-color() and var()
   */
  static getCssPrefix(ss: StringStream): string {
    ss.ws();
    if (ss.peek() === '#') {
      return ss.get()!;
    }
    const pos = ss.tellg();
    let token = ss.getline('(');
    if (token === null || ss.eof()) {
      ss.seekg(pos);
      return ''; // No paren
    }
    if (token === 'color') {
      // CSS Color module 4 color() function
      token = ss.readToken();
    }
    // CSS is case insensitive.
    return token.toLowerCase();
  }

  /**
   * Parse a CSS color number after the function name
   *
   * @arg ss - The string stream to read
   * @arg sep - An optional separator argument
   *
   * @returns the value read in without adjustment, its unit (usually an empty string) and
   *          whether this is the end of the css function. Undefined if no number was parsed.
   */
  static css_number(ss: StringStream, sep = ''): CssNumber | undefined {
    const value = ss.readDouble();
    if (value === null) {
      ss.clear();
      return undefined;
    }
    let unit = '';
    let end = false;
    const first = ss.peek();
    if (first === '.' || isDigit(first)) {
      return { value, unit, end };
    }
    while (ss.ok()) {
      const c = ss.get();
      if (c === ')') {
        end = true;
        break;
      }
      if (c !== null && c === sep) {
        break;
      }
      if (c === ' ') {
        const p = ss.peek();
        if (p !== ' ' && p !== sep && p !== ')') {
          break;
        }
      } else {
        // Reading past the end of the string appends the end-of-file marker, like upstream.
        unit += c ?? 'ÿ';
      }
    }
    return { value, unit, end };
  }

  /**
   * Parse a CSS color number and format it according to it's unit.
   *
   * @arg ss - The string stream set at the location of the next number.
   * @arg output - The vector to append the new number to.
   * @arg state - `end` is set to true if this number is the last one.
   * @arg sep - The separator to expect after this number (consumed)
   * @arg scale - The default scale of the number of no unit is detected.
   * @arg pc_scale - Scale of a percent if different from actual scale.
   *
   * @returns True if a number was found and appended.
   */
  static append_css_value(
    ss: StringStream,
    output: number[],
    state: ParseEnd,
    sep = '',
    scale = 1.0,
    pc_scale = 100.0,
  ): boolean {
    if (state.end) return false;
    const num = Parser.css_number(ss, sep);
    if (!num) return false;
    let value = num.value;
    if (num.end) state.end = true;
    if (num.unit === '%') {
      value /= pc_scale;
    } else if (num.unit === 'deg') {
      value /= 360;
    } else if (num.unit === 'turn') {
      // no need to modify
    } else if (num.unit !== '') {
      console.error(`Unknown unit in css color parsing '${num.unit}'`);
      return false;
    } else {
      value /= scale;
    }
    output.push(value);
    return true;
  }

  // TODO message: return reason for parsing failure. Otherwise we cannot tell the user why we reject certain colors.
  /** Parse the color arguments, appending the values to `output`. Returns true on success. */
  parse(_ss: StringStream, _output: number[], _more?: ParseMore): boolean {
    return false;
  }

  /**
   * Parse this specific color format into output values
   *
   * @arg ss - The stream stream to parse
   * @arg output - The returned list of values
   * @arg more - Indicates if there is more string to parse.
   *
   * @returns The name of the cms profile, if this is an icc-color; otherwise an empty string.
   */
  parseColor(ss: StringStream, output: number[], more: ParseMore): string {
    if (!this.parse(ss, output, more)) {
      output.length = 0;
    }
    return '';
  }
}

export class LegacyParser extends Parser {
  protected _alpha: boolean;

  constructor(prefix: string, type: SpaceType, alpha: boolean) {
    super(alpha ? `${prefix}a` : prefix, type);
    this._alpha = alpha;
  }
}

export class HueParser extends LegacyParser {
  protected _scale: number;

  constructor(prefix: string, type: SpaceType, alpha: boolean, scale = 1.0) {
    super(prefix, type, alpha);
    this._scale = scale;
  }

  override parse(ss: StringStream, output: number[]): boolean {
    // Modern CSS syntax
    let sep0 = '';
    let sep1 = '/'; // alpha separator
    let max_count = 4;
    // Legacy CSS syntax (only allowed for HSL)
    if (ss.str().includes(',') && this.getPrefix().startsWith('hsl')) {
      sep0 = ',';
      sep1 = ',';
      max_count = this._alpha ? 4 : 3; // hsl() must have 3 and hsla() 4
    }
    const state = { end: false };
    while (!state.end && output.length < max_count) {
      let scale = this._scale;
      if (output.length === 0) scale = 360.0;
      if (output.length === 3) scale = 1.0;
      if (!Parser.append_css_value(ss, output, state, output.length === 2 ? sep1 : sep0, scale)) break;
    }
    return state.end;
  }
}

/** Parse a hex code, `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`. */
export class HexParser extends Parser {
  constructor() {
    super('#', SpaceType.RGB);
  }

  override parse(ss: StringStream, output: number[], more?: ParseMore): boolean {
    const start = ss.tellg();
    let hex = ss.readHex();
    // The size is the length of what was read, also when reading failed.
    const size = (ss.tellg() === -1 ? ss.str().length : ss.tellg()) - start;
    if (hex === null) hex = 0;
    if (size === 3 || size === 4) {
      // #rgb(a)
      for (let p = 4 * (size - 1); p >= 0; p -= 4) {
        const val = (hex >>> p) & 0xf;
        output.push((val + (val << 4)) / 255.0);
      }
    } else if (size === 6 || size === 8) {
      // #rrggbb(aa)
      if (size === 6) hex = (hex << 8) >>> 0;
      output.push(SP_RGBA32_R_F(hex), SP_RGBA32_G_F(hex), SP_RGBA32_B_F(hex));
      if (size === 8) output.push(SP_RGBA32_A_F(hex));
    }
    ss.ws();
    if (more) more.more = ss.peek() === 'i'; // icc-color is next
    return output.length > 0;
  }
}

/** Parse the given string stream as a CSS Color Module Level 4/5 string. */
export class CssParser extends Parser {
  readonly #channels: number;

  constructor(prefix: string, type: SpaceType, channels: number) {
    super(prefix, type);
    this.#channels = channels;
  }

  override parse(ss: StringStream, output: number[]): boolean {
    const state = { end: false };
    while (!state.end && output.length < this.#channels + 1) {
      if (!Parser.append_css_value(ss, output, state, output.length === this.#channels - 1 ? '/' : '')) break;
    }
    return state.end;
  }
}

/** The result of `Parsers.parse`. */
export interface ParsedColor {
  /** The type of the space to understand the values */
  type: SpaceType;
  /** The name of the cms color space to understand the values (empty if not an icc-color). */
  cms: string;
  /** The values for the color space. */
  values: number[];
  /** The values of the fallback (sRGB) color of an icc-color; empty otherwise. */
  fallback: number[];
}

/** The registry of all parsers, found by prefix. */
export class Parsers {
  readonly #parsers = new Map<string, Parser[]>();

  static #instance?: Parsers;

  /**
   * The registry. The parsers of all color spaces are added when manager.ts is loaded (upstream
   * does this in the constructor, which would make this file depend on all color spaces).
   */
  static get(): Parsers {
    Parsers.#instance ??= new Parsers();
    return Parsers.#instance;
  }

  /** Add a parser to the list of parser objects used when parsing color strings. */
  addParser(parser: Parser): void {
    // Map parsers by their expected prefix for quicker lookup
    const list = this.#parsers.get(parser.getPrefix());
    if (list) list.push(parser);
    else this.#parsers.set(parser.getPrefix(), [parser]);
  }

  /**
   * Turn a string into a color data, used in Color object creation.
   *
   * Each available color parser will be asked to parse the color in turn
   * and the successful parser will return object data.
   *
   * @arg input - The string to parse.
   *
   * @returns the parsed data, or undefined if the color was not parsed.
   */
  parse(input: string): ParsedColor | undefined {
    return this.#parse(new StringStream(input));
  }

  /** Internal recursive parser that scans through a string stream, starting at its position. */
  #parse(ss: StringStream): ParsedColor | undefined {
    const ptype = Parser.getCssPrefix(ss);
    const parsers = this.#parsers.get(ptype);
    if (!parsers) return undefined;
    for (const parser of parsers) {
      const pos = ss.tellg();
      const more = { more: false };
      const values: number[] = [];
      const name = parser.parseColor(ss, values, more);
      // We have an RGB color but there's more string, look for an icc-color next.
      if (more.more && ptype === '#') {
        const icc = this.#parse(ss);
        if (icc && icc.type === SpaceType.CMS) {
          return { type: SpaceType.CMS, cms: icc.cms, values: icc.values, fallback: values };
        }
      }
      if (values.length > 0) {
        return { type: parser.getType(), cms: name, values, fallback: [] };
      }
      ss.clear();
      ss.seekg(pos);
    }
    return undefined;
  }
}
