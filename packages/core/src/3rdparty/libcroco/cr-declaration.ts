// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/3rdparty/libcroco/src/cr-declaration.c, src/3rdparty/libcroco/src/cr-parser.c, src/3rdparty/libcroco/src/cr-tknzr.c, src/3rdparty/libcroco/src/cr-term.c, src/3rdparty/libcroco/src/cr-num.c, src/3rdparty/libcroco/src/cr-rgb.c
/*
 * Parser for CSS declaration lists ("fill:red;stroke:#00f !important"), a port of the part of
 * libcroco that Inkscape uses for style attributes (cr_declaration_parse_list_from_buf and
 * cr_term_to_string).
 *
 * Inkscape depends on the normalization that libcroco does when it prints a value again: terms
 * are separated by a single space, commas get a space after them, strings are re-quoted, url()
 * values lose their quotes, `rgb()` values are printed with truncated integers, and so on. This
 * file does the same, including the quirks of the tokenizer (for example, a number followed by
 * an unknown unit is printed with the text "unknown" as unit).
 *
 * This file is part of The Croco Library (LGPL-2.1, which allows distribution under the GPL v2
 * or later).
 *
 * Author: Dodji Seketeli
 * See COPYRIGHTS file of libcroco for copyrights information.
 */

export type CRTermOperator = 'none' | 'divide' | 'comma';

interface TermBase {
  /** Operator between the previous term and this one. */
  operator: CRTermOperator;
  /** Unary sign written before the term. */
  unary: '' | '+' | '-';
}

/** A term of a declaration value (libcroco CRTerm). */
export type CRTerm = TermBase &
  (
    | { kind: 'number'; val: number; unit: string }
    | { kind: 'function'; name: string; params: CRTerm[] }
    | { kind: 'string'; value: string }
    | { kind: 'ident'; value: string }
    | { kind: 'uri'; value: string }
    | { kind: 'rgb'; red: number; green: number; blue: number; percentage: boolean }
    | { kind: 'hash'; value: string }
  );

/** A parsed declaration (libcroco CRDeclaration). */
export interface CRDeclaration {
  property: string;
  /** The value with libcroco's normalization (cr_term_to_string). */
  value: string;
  important: boolean;
}

const DBL_DIG = 15;

/** Upstream: pretty_ascii_dtostr, with the integer case of cr_num_to_string. */
function numToString(val: number): string {
  if (val - Math.trunc(val) === 0) return String(Math.trunc(val) || 0);
  const digits = Math.min(Math.max(DBL_DIG - Math.ceil(Math.log10(Math.abs(val))), 0), 100);
  let s = val.toFixed(digits);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

/** Quote like _string_append_quoted: single quotes, or double quotes if the string has a single quote. */
function quoted(val: string): string {
  const quote = val.includes("'") && !val.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of val) out += ch === quote || ch === '\\' ? `\\${ch}` : ch;
  return out + quote;
}

/** Upstream: cr_term_to_string */
export function termsToString(terms: readonly CRTerm[]): string {
  let out = '';
  terms.forEach((t, i) => {
    if (t.operator === 'divide') out += ' / ';
    else if (t.operator === 'comma') out += ', ';
    else if (i > 0) out += ' ';
    out += t.unary;
    switch (t.kind) {
      case 'number':
        out += numToString(t.val) + t.unit;
        break;
      case 'function':
        out += `${t.name}(${termsToString(t.params)})`;
        break;
      case 'string':
        out += quoted(t.value);
        break;
      case 'ident':
        out += t.value;
        break;
      case 'uri':
        out += `url(${t.value})`;
        break;
      case 'rgb':
        out += t.percentage
          ? `rgb(${t.red}%, ${t.green}%, ${t.blue}%)`
          : `rgb(${t.red}, ${t.green}, ${t.blue})`;
        break;
      case 'hash':
        out += `#${t.value}`;
        break;
    }
  });
  return out;
}

// Units in the order that the tokenizer tests them, with the text that cr_num_to_string prints.
const UNITS: readonly (readonly [string, string])[] = [
  ['em', 'em'],
  ['ex', 'ex'],
  ['px', 'px'],
  ['cm', 'cm'],
  ['mm', 'mm'],
  ['in', 'in'],
  ['pt', 'pt'],
  ['pc', 'pc'],
  ['deg', 'deg'],
  ['rad', 'rad'],
  ['grad', 'grad'],
  ['turn', 'turn'],
  ['ms', 'ms'],
  ['s', 's'],
  ['Hz', 'Hz'],
  ['kHz', 'KHz'],
  ['%', '%'],
];

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
const isLetter = (c: string | undefined): boolean =>
  c !== undefined && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'));
const isHex = (c: string | undefined): boolean =>
  c !== undefined && (isDigit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'));
/** Upstream: cr_utils_is_nonascii, which tests the value 177 (decimal). */
const isNonAscii = (c: string | undefined): boolean => c !== undefined && c.codePointAt(0)! > 177;
const isSpace = (c: string | undefined): boolean =>
  c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';

/** The tokenizer and parser. Every parse method restores `pos` when it fails. */
class Parser {
  pos = 0;

  constructor(readonly s: string) {}

  peek(offset = 0): string | undefined {
    return this.s[this.pos + offset];
  }

  eof(): boolean {
    return this.pos >= this.s.length;
  }

  startsWith(text: string): boolean {
    return this.s.startsWith(text, this.pos);
  }

  skipSpaces(): void {
    while (isSpace(this.peek())) this.pos++;
  }

  /** Upstream: cr_parser_try_to_skip_spaces_and_comments */
  skipSpacesAndComments(): void {
    for (;;) {
      this.skipSpaces();
      if (!this.startsWith('/*')) return;
      const end = this.s.indexOf('*/', this.pos + 2);
      if (end < 0) return;
      this.pos = end + 2;
    }
  }

  /** Upstream: cr_tknzr_parse_escape. Returns the character or null. */
  parseEscape(): string | null {
    if (this.peek() !== '\\') return null;
    const next = this.peek(1);
    if (isHex(next)) {
      let i = this.pos + 1;
      let hex = '';
      while (hex.length < 6 && isHex(this.s[i])) hex += this.s[i++];
      if (isSpace(this.s[i])) i += this.s[i] === '\r' && this.s[i + 1] === '\n' ? 2 : 1;
      const code = Number.parseInt(hex, 16);
      if (code > 0x10ffff) return null;
      this.pos = i;
      return String.fromCodePoint(code);
    }
    if (next === undefined) return null;
    const ch = String.fromCodePoint(this.s.codePointAt(this.pos + 1)!);
    if (ch !== ' ' && ch.codePointAt(0)! < 200) return null;
    this.pos += 1 + ch.length;
    return ch;
  }

  /** Upstream: cr_tknzr_parse_nmstart */
  parseNmStart(): string | null {
    const c = this.peek();
    if (c === '\\') return this.parseEscape();
    if (isLetter(c) || isNonAscii(c)) {
      const ch = String.fromCodePoint(this.s.codePointAt(this.pos)!);
      this.pos += ch.length;
      return ch;
    }
    return null;
  }

  /** Upstream: cr_tknzr_parse_nmchar */
  parseNmChar(): string | null {
    const c = this.peek();
    if (c === '\\') return this.parseEscape();
    if (isLetter(c) || isNonAscii(c) || isDigit(c) || c === '-' || c === '_') {
      const ch = String.fromCodePoint(this.s.codePointAt(this.pos)!);
      this.pos += ch.length;
      return ch;
    }
    return null;
  }

  /** Upstream: cr_tknzr_parse_ident (CSS 3 ident: `-?` nmstart nmchar*, or `--` nmchar*). */
  parseIdent(): string | null {
    const start = this.pos;
    let out = '';
    let skipNmStart = false;
    if (this.peek() === '-') {
      out += '-';
      this.pos++;
      if (this.peek() === '-') skipNmStart = true;
    }
    if (!skipNmStart) {
      const c = this.parseNmStart();
      if (c === null) {
        this.pos = start;
        return null;
      }
      out += c;
    }
    for (let c = this.parseNmChar(); c !== null; c = this.parseNmChar()) out += c;
    return out;
  }

  /** Upstream: cr_tknzr_parse_string */
  parseString(): string | null {
    const start = this.pos;
    const delim = this.peek();
    if (delim !== '"' && delim !== "'") return null;
    this.pos++;
    let out = '';
    for (;;) {
      const c = this.peek();
      if (c === undefined) break;
      if (c === '\\') {
        const next = this.peek(1);
        if (next === "'" || next === '"' || next === '\\') {
          out += next;
          this.pos += 2;
        } else {
          const esc = this.parseEscape();
          if (esc !== null) {
            out += esc;
          } else {
            // Consume the backslash and try to parse a newline.
            this.pos++;
            if (this.startsWith('\r\n')) this.pos += 2;
            else if (this.peek() === '\n' || this.peek() === '\r' || this.peek() === '\f') this.pos++;
            else {
              this.pos = start;
              return null;
            }
          }
        }
      } else if (c === delim) {
        this.pos++;
        return out;
      } else if (c === '\t' || (c >= ' ' && c <= '~')) {
        out += c;
        this.pos++;
      } else if (c.codePointAt(0)! > 127) {
        const ch = String.fromCodePoint(this.s.codePointAt(this.pos)!);
        out += ch;
        this.pos += ch.length;
      } else {
        break;
      }
    }
    this.pos = start;
    return null;
  }

  /** Upstream: cr_tknzr_parse_uri. `url(` is at pos. */
  parseUri(): string | null {
    const start = this.pos;
    this.pos += 4;
    this.skipSpaces();
    let result = '';
    let ok = false;
    const str = this.parseString();
    if (str !== null) {
      result = str;
      this.skipSpaces();
      if (this.peek() === ')') {
        this.pos++;
        ok = true;
      }
    }
    if (!ok) {
      for (;;) {
        const c = this.peek();
        if (
          c !== undefined &&
          ('!#$%&'.includes(c) || (c >= '*' && c <= '~') || isNonAscii(c)) /* multi-byte char */
        ) {
          result += c;
          this.pos++;
          continue;
        }
        const esc = this.parseEscape();
        if (esc === null) break;
        result += esc;
      }
      this.skipSpaces();
      if (this.peek() !== ')') {
        this.pos = start;
        return null;
      }
      this.pos++;
    }
    return result;
  }

  /** Upstream: cr_tknzr_parse_num. Returns the value or null. */
  parseNum(): number | null {
    const start = this.pos;
    let sign = 1;
    let c = this.peek();
    if (c === '+' || c === '-') {
      if (c === '-') sign = -1;
      this.pos++;
      c = this.peek();
    }
    let numerator: number;
    let denominator = 1;
    let parsingDec: boolean;
    let parsed: boolean;
    if (isDigit(c)) {
      numerator = c!.charCodeAt(0) - 48;
      parsingDec = false;
      parsed = true;
      this.pos++;
    } else if (c === '.') {
      numerator = 0;
      parsingDec = true;
      parsed = false;
      this.pos++;
    } else {
      this.pos = start;
      return null;
    }
    let parsingExp = false;
    let exponent = 0;
    let expSign = 1;
    for (;;) {
      const next = this.peek();
      if (next === undefined) break;
      if (next === '.') {
        if (parsingDec) {
          this.pos = start;
          return null;
        }
        this.pos++;
        parsingDec = true;
        parsed = false;
      } else if (!parsingExp && (next === 'E' || next === 'e') && parsed) {
        const after = this.peek(1);
        if (after === '+') {
          this.pos += 2;
        } else if (after === '-') {
          expSign = -1;
          this.pos += 2;
        } else if (!isDigit(after)) {
          break;
        } else {
          this.pos += 1;
        }
        parsingExp = true;
        parsed = false;
      } else if (isDigit(next)) {
        this.pos++;
        parsed = true;
        if (parsingExp) {
          exponent = exponent * 10 + (next.charCodeAt(0) - 48);
        } else {
          numerator = numerator * 10 + (next.charCodeAt(0) - 48);
          if (parsingDec) denominator *= 10;
        }
      } else {
        break;
      }
    }
    if (!parsed) {
      this.pos = start;
      return null;
    }
    return (numerator / denominator) * sign * 10 ** (exponent * expSign);
  }

  /** Upstream: cr_tknzr_parse_rgb. `rgb(` is at pos. Returns null when the syntax does not match. */
  parseRgb(): { red: number; green: number; blue: number; percentage: boolean } | null {
    const start = this.pos;
    this.pos += 4;
    const fail = () => {
      this.pos = start;
      return null;
    };
    this.skipSpaces();
    let percentage = false;
    const comps: number[] = [];
    for (let i = 0; i < 3; i++) {
      if (i > 0) {
        if (this.peek() !== ',') return fail();
        this.pos++;
        this.skipSpaces();
      }
      const num = this.parseNum();
      if (num === null) return fail();
      comps.push(Math.trunc(num));
      if (this.peek() === '%') {
        this.pos++;
        percentage = true;
      }
      this.skipSpaces();
    }
    // The closing byte is read without a check.
    this.pos++;
    return { red: comps[0]!, green: comps[1]!, blue: comps[2]!, percentage };
  }

  /** Upstream: the number branch of cr_tknzr_get_next_token. */
  parseNumberTerm(): CRTerm | null {
    const val = this.parseNum();
    if (val === null) return null;
    for (const [text, printed] of UNITS) {
      if (this.startsWith(text)) {
        this.pos += text.length;
        return { kind: 'number', val, unit: printed, operator: 'none', unary: '' };
      }
    }
    // A unit that we do not know is printed as "unknown".
    if (this.parseIdent() !== null)
      return { kind: 'number', val, unit: 'unknown', operator: 'none', unary: '' };
    return { kind: 'number', val, unit: '', operator: 'none', unary: '' };
  }

  /** Upstream: cr_parser_parse_term */
  parseTerm(): CRTerm | null {
    const start = this.pos;
    const base = { operator: 'none', unary: '' } as const;
    let unary: '' | '+' | '-' = '';
    const c = this.peek();
    if (c === undefined) return null;
    const fail = () => {
      this.pos = start;
      return null;
    };

    // Tokens that start a term.
    let term: CRTerm | null = null;
    const identOrFunction = (): CRTerm | null => {
      const name = this.parseIdent();
      if (name === null) return null;
      if (this.peek() === '(') {
        this.pos++;
        this.skipSpacesAndComments();
        const params = this.parseExpr();
        if (!params || this.peek() !== ')') return null;
        this.pos++;
        return { kind: 'function', name, params, ...base };
      }
      return { kind: 'ident', value: name, ...base };
    };

    const lexTerm = (): CRTerm | null => {
      const ch = this.peek();
      if (ch === undefined) return null;
      if (ch === 'u' && this.startsWith('url(')) {
        const uri = this.parseUri();
        if (uri !== null) return { kind: 'uri', value: uri, ...base };
        return identOrFunction();
      }
      if (ch === 'r' && this.startsWith('rgb(')) {
        const rgb = this.parseRgb();
        if (rgb) return { kind: 'rgb', ...rgb, ...base };
        return identOrFunction();
      }
      if (ch === '-') {
        if (this.startsWith('-->')) return null;
        const name = this.parseIdent();
        if (name !== null) return { kind: 'ident', value: name, ...base };
        return this.parseNumberTerm();
      }
      if (ch === '#') {
        this.pos++;
        let name = '';
        for (let n = this.parseNmChar(); n !== null; n = this.parseNmChar()) name += n;
        if (!name) return null;
        return { kind: 'hash', value: name, ...base };
      }
      if (ch === '"' || ch === "'") {
        const str = this.parseString();
        return str === null ? null : { kind: 'string', value: str, ...base };
      }
      if (isDigit(ch) || ch === '.' || ch === '+') return this.parseNumberTerm();
      if (ch === '\\' || isNonAscii(ch) || isLetter(ch)) return identOrFunction();
      return null;
    };

    if (c === '+' || c === '-') {
      // A sign is a separate token only if no number or identifier follows it directly.
      const here = this.pos;
      term = lexTerm();
      if (term === null) {
        this.pos = here;
        unary = c;
        this.pos++;
        this.skipSpacesAndComments();
        term = lexTerm();
      }
    } else {
      term = lexTerm();
    }
    if (term === null) return fail();
    term.unary = unary;
    this.skipSpacesAndComments();
    return term;
  }

  /** Upstream: cr_parser_parse_expr */
  parseExpr(): CRTerm[] | null {
    const first = this.parseTerm();
    if (!first) return null;
    const terms = [first];
    for (;;) {
      if (this.eof()) break;
      let operator: CRTermOperator = 'none';
      const c = this.peek();
      if (c === '/') {
        operator = 'divide';
        this.pos++;
      } else if (c === ',') {
        operator = 'comma';
        this.pos++;
      }
      this.skipSpacesAndComments();
      const term = this.parseTerm();
      if (!term) break;
      term.operator = operator;
      terms.push(term);
    }
    return terms;
  }

  /** Upstream: cr_parser_parse_prio (`!important`). */
  parsePrio(): boolean {
    if (this.peek() !== '!') return false;
    const start = this.pos;
    this.pos++;
    this.skipSpaces();
    if (this.startsWith('important')) {
      this.pos += 9;
      this.skipSpacesAndComments();
      return true;
    }
    this.pos = start;
    return false;
  }

  /** Upstream: cr_parser_parse_declaration */
  parseDeclaration(): CRDeclaration | null {
    const start = this.pos;
    const property = this.parseIdent();
    if (property === null) return null;
    this.skipSpacesAndComments();
    if (this.peek() !== ':') {
      this.pos = start;
      return null;
    }
    this.pos++;
    this.skipSpacesAndComments();
    const terms = this.parseExpr();
    if (!terms) {
      this.pos = start;
      return null;
    }
    this.skipSpacesAndComments();
    const important = this.parsePrio();
    return { property, value: termsToString(terms), important };
  }
}

/**
 * Parse a list of declarations separated by semicolons, as in a style attribute. A broken
 * declaration is skipped up to the next semicolon.
 * Upstream: cr_declaration_parse_list_from_buf
 */
export function parseDeclarationList(text: string): CRDeclaration[] {
  const parser = new Parser(text);
  const result: CRDeclaration[] = [];
  for (let first = true; ; first = false) {
    parser.skipSpacesAndComments();
    if (!first) {
      if (parser.eof()) break;
      if (parser.peek() === ';') {
        parser.pos++;
        parser.skipSpacesAndComments();
      } else {
        // Skip a character and try to read on until we reach the end or a ';'.
        parser.pos++;
        continue;
      }
    }
    if (parser.eof()) break;
    const decl = parser.parseDeclaration();
    if (decl) result.push(decl);
  }
  return result;
}
