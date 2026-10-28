// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/libnrtype/Layout-TNG.h, src/libnrtype/Layout-TNG.cpp, src/libnrtype/Layout-TNG-Input.cpp, src/libnrtype/Layout-TNG-Output.cpp, src/libnrtype/Layout-TNG-OutIter.cpp
/*
 * Inkscape::Text::Layout - text layout engine
 *
 * Authors:
 *   Richard Hughes <cyreve@users.sf.net>
 *
 * Copyright (C) 2005 Richard Hughes
 */
import { Affine, type OptRect, Point, Rect, Rotate, Translate } from '@inkscape-web/geom';
import type { Drawing, DrawingGroup } from '../display/drawing.ts';
import type { SPObject } from '../object/sp-object.ts';
import type { SPStyle } from '../style.ts';
import { SVGLength } from '../svg/svg-length.ts';
import { calculateFlow } from './Layout-TNG-Compute.ts';
import type { FontDescription, InkBox } from './text-measurer.ts';

/**
 * The text layout of one text object (upstream Inkscape::Text::Layout).
 *
 * Input: SPText and SPFlowtext append their strings, styles and the
 * x/y/dx/dy/rotate attributes (appendText) and the line breaks
 * (appendControlCode). calculateFlow() computes the output: lines, chunks,
 * spans and characters with positions. The output functions and the
 * iterator (cursor movement, hit testing, bounding boxes, cursor shape,
 * selection shape) work on that output.
 *
 * Interim implementation: calculateFlow() is a simple line layout in
 * Layout-TNG-Compute.ts that measures with the injected TextMeasurer, one
 * glyph per code point. The planned port of Layout-TNG on HarfBuzz replaces
 * the computation; this interface (upstream names) stays.
 * TODO: vertical and right-to-left text, text on path (fitToPathAlign),
 * textLength, baseline-shift, convertToCurves, print.
 */
export class Layout {
  /** line-height:normal as a multiple of font-size. */
  static readonly LINE_HEIGHT_NORMAL = 1.25;

  wrap_mode = WrapMode.WRAP_NONE;
  /** Metrics of the text element's font, the minimum line height (CSS strut). */
  strut = new FontMetrics();
  textLength = new SVGLength();
  lengthAdjust = LengthAdjust.LENGTHADJUST_SPACING;

  // Input
  _input_stream: InputStreamItem[] = [];
  /** The frames to flow into (upstream: livarot Shapes; interim: their bounding rectangles). */
  _input_wrap_shapes: Rect[] = [];

  // Output
  _lines: Line[] = [];
  _chunks: Chunk[] = [];
  _spans: Span[] = [];
  _characters: Character[] = [];
  _input_truncated = false;
  /** Cursor shape of an empty layout. */
  _empty_cursor_shape = { position: new Point(0, 0), height: 0, rotation: 0 };

  // ************************** input ****************************

  clear(): void {
    this._input_stream = [];
    this._input_wrap_shapes = [];
    this._clearOutputObjects();
    this.textLength = new SVGLength();
    this.lengthAdjust = LengthAdjust.LENGTHADJUST_SPACING;
  }

  inputExists(): boolean {
    return this._input_stream.length > 0;
  }

  /** True if the text does not fit into its frame. */
  inputTruncated(): boolean {
    return this._input_truncated;
  }

  /**
   * Add text with style from source (an SPString, or the span itself for an
   * empty span). optional_attributes are the x/y/dx/dy/rotate of the
   * characters; they start at optional_attributes_offset.
   */
  appendText(
    text: string,
    style: SPStyle,
    source: SPObject,
    optional_attributes: OptionalTextTagAttrs | null = null,
    optional_attributes_offset = 0,
  ): void {
    const chars: string[] = [];
    const offsets: number[] = [];
    let offset = 0;
    for (const c of text) {
      chars.push(c);
      offsets.push(offset);
      offset += c.length;
    }
    const item: InputStreamTextSource = {
      type: InputStreamItemType.TEXT_SOURCE,
      source,
      style,
      text,
      chars,
      offsets,
      x: [],
      y: [],
      dx: [],
      dy: [],
      rotate: [],
    };
    if (optional_attributes) {
      // At least one value: an empty text keeps its start position.
      const n = Math.max(1, chars.length);
      const copy = (list: SVGLength[]) =>
        list.slice(optional_attributes_offset, optional_attributes_offset + n);
      item.x = copy(optional_attributes.x);
      item.y = copy(optional_attributes.y);
      item.dx = copy(optional_attributes.dx);
      item.dy = copy(optional_attributes.dy);
      item.rotate = copy(optional_attributes.rotate);
      // The last rotate value applies to all following characters (SVG 1.1 section 10.5).
      if (!item.rotate.length && optional_attributes.rotate.length) {
        const last = optional_attributes.rotate.at(-1);
        if (last) item.rotate = [last];
      }
      if (item.rotate.length && item.rotate.length < chars.length) {
        const last = item.rotate.at(-1);
        while (last && item.rotate.length < chars.length) item.rotate.push(last);
      }
    }
    this._input_stream.push(item);
  }

  /** Add a control code (a line break) from source. */
  appendControlCode(code: TextControlCode, source: SPObject, width = 0, ascent = 0, descent = 0): void {
    this._input_stream.push({ type: InputStreamItemType.CONTROL_CODE, source, code, width, ascent, descent });
  }

  /** Add a frame to flow the text into. Interim: only the bounding rectangle of the shape is used. */
  appendWrapShape(shape: Rect): void {
    this._input_wrap_shapes.push(shape);
  }

  // ************************** computation **********************

  /** Compute the output from the input. Returns false if there is nothing to lay out. */
  calculateFlow(): boolean {
    return calculateFlow(this);
  }

  _clearOutputObjects(): void {
    this._lines = [];
    this._chunks = [];
    this._spans = [];
    this._characters = [];
    this._input_truncated = false;
    this._empty_cursor_shape = { position: new Point(0, 0), height: 0, rotation: 0 };
  }

  // ************************** output ***************************

  outputExists(): boolean {
    return this._characters.length > 0;
  }

  /**
   * Add the display items of the text to in_arena: one DrawingText per span.
   * Upstream also passes the style attachments (paint servers) and uses
   * paintbox for objectBoundingBox paints.
   */
  show(drawing: Drawing, in_arena: DrawingGroup, _paintbox: OptRect): void {
    for (let span_index = 0; span_index < this._spans.length; span_index++) {
      const span = this._spans[span_index]!;
      if (!span.style || this._lines[span.in_line]?.hidden) continue;
      const chars = this._characters.filter((c) => c.in_span === span_index && !c.is_break);
      if (!chars.length) continue;
      const nr_text = drawing.createText();
      nr_text.setStyle(span.style);
      for (const c of chars) nr_text.addComponent(c.the_char, c.x, c.y, c.rotation, c.advance);
      nr_text.setItemBounds(this.bounds(Affine.identity()));
      in_arena.appendChild(nr_text);
    }
  }

  /**
   * Bounding box of the glyphs from start (char index) for length characters
   * (-1: to the end), transformed by transform. with_stroke adds half the stroke width.
   */
  bounds(transform: Affine, with_stroke = false, start = -1, length = -1): OptRect {
    let bbox: OptRect = null;
    const first = Math.max(start, 0);
    const last = length < 0 ? this._characters.length : Math.min(this._characters.length, first + length);
    for (let i = first; i < last; i++) {
      const c = this._characters[i]!;
      if (c.is_break || this._lines[c.in_line]?.hidden) continue;
      let box = this.#inkBox(c);
      if (!box) continue;
      if (with_stroke) {
        const style = this._spans[c.in_span]?.style;
        if (style && !style.stroke.isNone()) {
          const scale = transform.descrim();
          const r = (style.stroke_width.computed * 0.5) / (scale || 1);
          box = box.expandBy(r);
        }
      }
      const t = Translate(-c.x, -c.y)
        .multiply(Rotate(c.rotation))
        .multiply(Translate(c.x, c.y))
        .multiply(transform);
      const r = box.transformed(t);
      bbox = bbox ? bbox.unionWith(r) : r;
    }
    return bbox;
  }

  /** Ink box of a character in layout coordinates (unrotated), or null for empty glyphs. */
  #inkBox(c: Character): Rect | null {
    if (c.ink) {
      if (c.ink.right - c.ink.left <= 0 || c.ink.ascent + c.ink.descent <= 0) return null;
      return new Rect(c.x + c.ink.left, c.y - c.ink.ascent, c.x + c.ink.right, c.y + c.ink.descent);
    }
    if (c.is_white) return null;
    const span = this._spans[c.in_span]!;
    return new Rect(c.x, c.y - span.ascent, c.x + c.advance, c.y + span.descent);
  }

  // ************************** iterators ************************

  begin(): LayoutIterator {
    return new LayoutIterator(this, 0);
  }

  end(): LayoutIterator {
    return new LayoutIterator(this, this._characters.length);
  }

  charIndexToIterator(char_index: number): LayoutIterator {
    return new LayoutIterator(this, Math.max(0, Math.min(char_index, this._characters.length)));
  }

  iteratorToCharIndex(it: LayoutIterator): number {
    return it._char_index;
  }

  /** Clamp it to the current output (after the text changed). */
  validateIterator(it: LayoutIterator): void {
    it._parent_layout = this;
    if (it._char_index > this._characters.length) it._char_index = this._characters.length;
  }

  /** The character at it ('' at the end; '\n' for a line break). */
  characterAt(it: LayoutIterator): string {
    const c = this._characters[it._char_index];
    if (!c) return '';
    return c.is_break ? '\n' : c.the_char;
  }

  isWhitespace(it: LayoutIterator): boolean {
    return !!this._characters[it._char_index]?.is_white;
  }

  isCursorPosition(it: LayoutIterator): boolean {
    return it._char_index <= this._characters.length;
  }

  isStartOfWord(it: LayoutIterator): boolean {
    return !!this._characters[it._char_index]?.is_word_start;
  }

  isEndOfWord(it: LayoutIterator): boolean {
    if (it._char_index === this._characters.length)
      return !!this._characters.at(-1) && isWordChar(this._characters.at(-1)!);
    return !!this._characters[it._char_index]?.is_word_end;
  }

  isHidden(it: LayoutIterator): boolean {
    const c = this._characters[it._char_index];
    return !!c && !!this._lines[c.in_line]?.hidden;
  }

  /**
   * The source of the character at it: the SPString (with the code unit
   * offset of the character in its string) or, for a line break, the
   * object of the break. At the end: null.
   */
  getSourceOfCharacter(it: LayoutIterator): { source: SPObject | null; text_offset: number } {
    const c = this._characters[it._char_index];
    if (!c) return { source: null, text_offset: 0 };
    const item = this._input_stream[this._spans[c.in_span]!.in_input_stream_item]!;
    return { source: item.source, text_offset: c.text_offset };
  }

  /** Iterator at the first character that comes from source or one of its descendants; end() if none. */
  sourceToIterator(source: SPObject): LayoutIterator {
    if (!this._characters.length) return this.end();
    for (let i = 0; i < this._characters.length; i++) {
      const s = this._input_stream[this._spans[this._characters[i]!.in_span]!.in_input_stream_item]!.source;
      if (s === source || source.isAncestorOf(s)) return new LayoutIterator(this, i);
    }
    return this.end();
  }

  /** The cursor position nearest to point p (layout coordinates). */
  getNearestCursorPositionTo(p: Point): LayoutIterator {
    if (!this._lines.length) return this.begin();
    // Find the line by y, then the nearest position on it by x.
    let best_line = 0;
    let best_distance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this._lines.length; i++) {
      const line = this._lines[i]!;
      if (line.hidden) continue;
      const top = line.baseline_y - line.ascent;
      const bottom = line.baseline_y + line.descent;
      const d = p.y < top ? top - p.y : p.y > bottom ? p.y - bottom : 0;
      if (d < best_distance) {
        best_distance = d;
        best_line = i;
      }
    }
    return this._cursorXOnLineToIterator(best_line, p.x);
  }

  /** The character whose box contains p, or end(). */
  getLetterAt(p: Point): LayoutIterator {
    for (let it = this.begin(); !it.equals(this.end()); it.nextCharacter()) {
      if (this.characterBoundingBox(it).rect.contains(p)) return it.copy();
    }
    return this.end();
  }

  /** The cursor position on line line_index nearest to local_x. */
  _cursorXOnLineToIterator(line_index: number, local_x: number): LayoutIterator {
    let best = -1;
    let best_difference = Number.POSITIVE_INFINITY;
    let i = this._lineToCharacter(line_index);
    for (; i < this._characters.length && this._characters[i]!.in_line === line_index; i++) {
      const d = Math.abs(this._characters[i]!.x - local_x);
      if (d < best_difference) {
        best_difference = d;
        best = i;
      }
    }
    // The end of the last line is a cursor position too.
    if (i === this._characters.length && this._characters.at(-1)?.in_line === line_index) {
      const last = this._characters.at(-1)!;
      if (Math.abs(last.x + last.advance - local_x) < best_difference) best = i;
    }
    if (best < 0) best = i; // empty line
    return new LayoutIterator(this, best);
  }

  /** Index of the first character of line_index (characters.length if there is none). */
  _lineToCharacter(line_index: number): number {
    const i = this._characters.findIndex((c) => c.in_line >= line_index);
    return i < 0 ? this._characters.length : i;
  }

  /** The line of the cursor position it. */
  _cursorLine(it: LayoutIterator): number {
    const c = this._characters[it._char_index];
    if (c) return c.in_line;
    return Math.max(0, this._lines.length - 1);
  }

  /** Point on the baseline at the start of the character at it (layout coordinates). */
  characterAnchorPoint(it: LayoutIterator): Point {
    if (!this._characters.length) return this._empty_cursor_shape.position;
    return this.#cursorPoint(it._char_index);
  }

  /** The baseline point of the first line where the alignment is anchored (for snapping). */
  baselineAnchorPoint(): Point | null {
    const pos = this.begin();
    const left_pt = this.characterAnchorPoint(pos);
    pos.thisEndOfLine();
    const right_pt = this.characterAnchorPoint(pos);
    switch (this.paragraphAlignment(this.begin())) {
      case Alignment.LEFT:
      case Alignment.FULL:
        return left_pt;
      case Alignment.CENTER:
        return left_pt.add(right_pt).div(2);
      case Alignment.RIGHT:
        return right_pt;
      default:
        return null;
    }
  }

  /** The alignment of the paragraph of it. */
  paragraphAlignment(it: LayoutIterator): Alignment {
    const chunk = this._chunks[this._lines[this._cursorLine(it)]?.first_chunk ?? 0];
    return chunk?.alignment ?? Alignment.LEFT;
  }

  /** The point where the chunk of it is anchored (its x attribute and the baseline). */
  chunkAnchorPoint(it: LayoutIterator): Point {
    if (!this._chunks.length) return new Point(0, 0);
    let chunk_index: number;
    if (!this._characters.length) chunk_index = 0;
    else if (it._char_index >= this._characters.length) chunk_index = this._chunks.length - 1;
    else chunk_index = this._spans[this._characters[it._char_index]!.in_span]!.in_chunk;
    const chunk = this._chunks[chunk_index]!;
    let x = chunk.left_x;
    if (chunk.alignment === Alignment.RIGHT) x += chunk.width;
    else if (chunk.alignment === Alignment.CENTER) x += chunk.width * 0.5;
    return new Point(x, this._lines[chunk.in_line]!.baseline_y);
  }

  /** The em box of the character at it and its rotation (radians). */
  characterBoundingBox(it: LayoutIterator): { rect: Rect; rotation: number } {
    const c = this._characters[it._char_index] ?? this._characters.at(-1);
    if (!c) return { rect: new Rect(0, 0, 0, 0), rotation: 0 };
    const span = this._spans[c.in_span]!;
    return {
      rect: new Rect(c.x, c.y - span.ascent, c.x + c.advance, c.y + span.descent),
      rotation: c.rotation,
    };
  }

  /**
   * The quadrilaterals (4 points each, transformed by transform) that cover
   * the characters between it_start and it_end, for the selection highlight.
   */
  createSelectionShape(it_start: LayoutIterator, it_end: LayoutIterator, transform: Affine): Point[] {
    const quads: Point[] = [];
    let char_index = Math.min(it_start._char_index, it_end._char_index);
    const end_char_index = Math.min(
      Math.max(it_start._char_index, it_end._char_index),
      this._characters.length,
    );
    while (char_index < end_char_index) {
      const c = this._characters[char_index]!;
      if (c.is_break) {
        char_index++;
        continue;
      }
      let box: Rect;
      if (c.rotation !== 0) {
        box = this.characterBoundingBox(new LayoutIterator(this, char_index)).rect;
        char_index++;
      } else {
        // For straight text, combine the boxes of the characters of a span into one box.
        const span = this._spans[c.in_span]!;
        const left = c.x;
        let right = c.x + c.advance;
        while (
          char_index < end_char_index &&
          this._characters[char_index]!.in_span === c.in_span &&
          this._characters[char_index]!.rotation === 0 &&
          !this._characters[char_index]!.is_break
        ) {
          const cc = this._characters[char_index]!;
          right = cc.x + cc.advance;
          char_index++;
        }
        box = new Rect(left, c.y - span.ascent, right, c.y + span.descent);
      }
      if (box.width() === 0 || box.height() === 0) continue;
      const center = new Point(box.midpoint().x, c.y);
      const total = Translate(center.neg())
        .multiply(Rotate(c.rotation))
        .multiply(Translate(center))
        .multiply(transform);
      for (let i = 0; i < 4; i++) quads.push(box.corner(i).transformed(total));
    }
    return quads;
  }

  /**
   * The text cursor at it: position is the bottom of the cursor (the
   * baseline plus the descent), height its length, rotation its angle.
   * x is where the next typed character goes; y and height come from the
   * previous character on the same line.
   */
  queryCursorShape(it: LayoutIterator): { position: Point; height: number; rotation: number } {
    if (!this._characters.length) return { ...this._empty_cursor_shape };
    const i = it._char_index;
    const base = this.#cursorPoint(i);
    const span = this.#cursorSpan(i);
    const c = this._characters[i];
    const rotation = c && !c.is_break ? c.rotation : 0;
    const height = span.ascent + span.descent;
    const position = new Point(
      base.x - Math.sin(rotation) * span.descent,
      base.y + Math.cos(rotation) * span.descent,
    );
    return { position, height, rotation };
  }

  /** The baseline point of cursor position i. */
  #cursorPoint(i: number): Point {
    const c = this._characters[i];
    if (c) return new Point(c.x, c.y);
    // The end: after the last character, or the start of an empty last line.
    const last = this._characters.at(-1)!;
    const line_index = this._lines.length - 1;
    if (last.in_line === line_index && !last.is_break) return new Point(last.x + last.advance, last.y);
    const line = this._lines[line_index]!;
    const chunk = this._chunks[line.first_chunk]!;
    return new Point(chunk.left_x, line.baseline_y);
  }

  /** The span whose metrics the cursor at i uses. */
  #cursorSpan(i: number): Span {
    const c = this._characters[i];
    const prev = this._characters[i - 1];
    const line = c ? c.in_line : this._lines.length - 1;
    if (prev && prev.in_line === line && !prev.is_break) return this._spans[prev.in_span]!;
    if (c) return this._spans[c.in_span]!;
    return this._spans[this._lines[line]!.first_span]!;
  }
}

/** Whether a character belongs to a word (for word movement). */
export function isWordChar(c: Character): boolean {
  return !c.is_break && /[\p{L}\p{N}_]/u.test(c.the_char);
}

export enum WrapMode {
  /** No wrapping or wrapping via role="line". */
  WRAP_NONE,
  /** Wrapping via 'white-space' property. */
  WRAP_WHITE_SPACE,
  /** Wrapping via 'inline-size' property. */
  WRAP_INLINE_SIZE,
  /** Wrapping via 'shape-inside' property. */
  WRAP_SHAPE_INSIDE,
}

export enum LengthAdjust {
  LENGTHADJUST_SPACING,
  LENGTHADJUST_SPACINGANDGLYPHS,
}

/** Control codes which can be embedded in the text to be flowed. See appendControlCode(). */
export enum TextControlCode {
  /** forces the flow to move on to the next line */
  PARAGRAPH_BREAK,
  /** forces the flow to ignore the remainder of the current shape and continue at the top of the one after. */
  SHAPE_BREAK,
  /** inserts an arbitrarily-sized hole in the flow in line with the current text. */
  ARBITRARY_GAP,
}

/** Paragraph alignment; LEFT is always left (or top). */
export enum Alignment {
  LEFT,
  CENTER,
  RIGHT,
  FULL,
  NONE,
}

/**
 * The optional attributes which can be applied to a SVG text or related tag
 * (SVG 1.1 section 10.4). See appendText().
 */
export interface OptionalTextTagAttrs {
  x: SVGLength[];
  y: SVGLength[];
  dx: SVGLength[];
  dy: SVGLength[];
  rotate: SVGLength[];
  textLength: SVGLength;
  lengthAdjust: LengthAdjust;
}

export function emptyOptionalTextTagAttrs(): OptionalTextTagAttrs {
  return {
    x: [],
    y: [],
    dx: [],
    dy: [],
    rotate: [],
    textLength: new SVGLength(),
    lengthAdjust: LengthAdjust.LENGTHADJUST_SPACING,
  };
}

/**
 * Font metrics (upstream Layout::FontMetrics): ascent and descent of a font
 * (normalized to one em, then scaled by the font size), or the effective
 * ascent and descent of a line box including the half-leading.
 */
export class FontMetrics {
  ascent = 0.8;
  descent = 0.2;
  xheight = 0.5;
  ascent_max = 0.8;
  descent_max = 0.2;

  reset(): void {
    this.ascent = 0.8;
    this.descent = 0.2;
    this.xheight = 0.5;
    this.ascent_max = 0.8;
    this.descent_max = 0.2;
  }

  /** Metrics from the measurer, normalized like upstream FontInstance (ascent + descent = 1 em). */
  set(metrics: { ascent: number; descent: number; xheight: number }, size: number): void {
    const em = metrics.ascent + metrics.descent;
    if (em <= 0 || size <= 0) {
      this.reset();
      return;
    }
    this.ascent = this.ascent_max = metrics.ascent / em;
    this.descent = this.descent_max = metrics.descent / em;
    this.xheight = metrics.xheight / size;
  }

  /** CSS 2.1 dictates that font-size is based on em-size which is defined as ascent + descent. */
  emSize(): number {
    return this.ascent + this.descent;
  }

  scale(x: number): this {
    this.ascent *= x;
    this.descent *= x;
    this.xheight *= x;
    this.ascent_max *= x;
    this.descent_max *= x;
    return this;
  }

  /** Save the larger values of ascent and descent between this and other. */
  max(other: FontMetrics): void {
    this.ascent = Math.max(this.ascent, other.ascent);
    this.descent = Math.max(this.descent, other.descent);
    this.xheight = Math.max(this.xheight, other.xheight);
    this.ascent_max = Math.max(this.ascent_max, other.ascent_max);
    this.descent_max = Math.max(this.descent_max, other.descent_max);
  }

  /** Calculate the effective ascent and descent including half "leading". */
  computeEffective(line_height: number): void {
    const half_leading = 0.5 * (line_height - 1.0) * this.emSize();
    this.ascent += half_leading;
    this.descent += half_leading;
  }

  copy(): FontMetrics {
    const m = new FontMetrics();
    Object.assign(m, this);
    return m;
  }
}

export enum InputStreamItemType {
  TEXT_SOURCE,
  CONTROL_CODE,
}

/** Text appended with appendText(). The attribute lists are per character of this text. */
export interface InputStreamTextSource {
  type: InputStreamItemType.TEXT_SOURCE;
  source: SPObject;
  style: SPStyle;
  text: string;
  /** The code points of text. */
  chars: string[];
  /** Code unit offset of each code point in text. */
  offsets: number[];
  x: SVGLength[];
  y: SVGLength[];
  dx: SVGLength[];
  dy: SVGLength[];
  rotate: SVGLength[];
}

export interface InputStreamControlCode {
  type: InputStreamItemType.CONTROL_CODE;
  source: SPObject;
  code: TextControlCode;
  width: number;
  ascent: number;
  descent: number;
}

export type InputStreamItem = InputStreamTextSource | InputStreamControlCode;

/** An output line. ascent and descent are the effective line box (with half-leading). */
export interface Line {
  baseline_y: number;
  ascent: number;
  descent: number;
  in_paragraph: number;
  in_shape: number;
  first_chunk: number;
  first_span: number;
  /** Below the frame (flowed text that does not fit). */
  hidden: boolean;
}

/** A run of text on a line that is aligned as one block (it starts at an x attribute). */
export interface Chunk {
  in_line: number;
  /** Left edge after alignment. */
  left_x: number;
  width: number;
  alignment: Alignment;
}

/** A run of characters on a chunk from one input item, with one style. */
export interface Span {
  in_input_stream_item: number;
  in_chunk: number;
  in_line: number;
  x_start: number;
  x_end: number;
  /** Ascent and descent of the font (no leading), for cursor and selection. */
  ascent: number;
  descent: number;
  font: FontDescription | null;
  style: SPStyle | null;
}

/** An output character. Positions are absolute in the text's coordinates; y is the baseline. */
export interface Character {
  the_char: string;
  in_span: number;
  in_line: number;
  x: number;
  y: number;
  advance: number;
  /** Radians, clockwise. */
  rotation: number;
  /** Code unit offset of the character in its input text; -1 for line breaks. */
  text_offset: number;
  /** A line break (the paragraph break between lines); it has no glyph. */
  is_break: boolean;
  is_white: boolean;
  is_word_start: boolean;
  is_word_end: boolean;
  ink: InkBox | null;
}

/**
 * A position in the output: a character index from 0 to the number of
 * characters (the end). Upstream Layout::iterator is a value type; copy()
 * where upstream copies, the move functions change the iterator in place.
 */
export class LayoutIterator {
  _parent_layout: Layout;
  _char_index: number;
  _cursor_moving_vertically = false;
  /** The x coordinate kept while moving up and down. */
  _x_coordinate = 0;

  constructor(layout: Layout, char_index = 0) {
    this._parent_layout = layout;
    this._char_index = char_index;
  }

  copy(): LayoutIterator {
    const it = new LayoutIterator(this._parent_layout, this._char_index);
    it._cursor_moving_vertically = this._cursor_moving_vertically;
    it._x_coordinate = this._x_coordinate;
    return it;
  }

  equals(other: LayoutIterator): boolean {
    return this._char_index === other._char_index;
  }

  /** Negative if this is before other, 0 if equal, positive after. */
  compare(other: LayoutIterator): number {
    return this._char_index - other._char_index;
  }

  charIndex(): number {
    return this._char_index;
  }

  get #size(): number {
    return this._parent_layout._characters.length;
  }

  nextCharacter(): boolean {
    this._cursor_moving_vertically = false;
    if (this._char_index + 1 >= this.#size) {
      if (this._char_index === this.#size) return false;
      this._char_index = this.#size;
    } else this._char_index++;
    return true;
  }

  prevCharacter(): boolean {
    this._cursor_moving_vertically = false;
    if (this._char_index === 0) return false;
    this._char_index--;
    return true;
  }

  nextCursorPosition(): boolean {
    return this.nextCharacter() && this._char_index < this.#size;
  }

  prevCursorPosition(): boolean {
    return this.prevCharacter();
  }

  /** Move to the previous character to erase with Backspace. */
  charEraseStart(): boolean {
    return this.prevCharacter();
  }

  #nextWith(test: (c: Character) => boolean): boolean {
    this._cursor_moving_vertically = false;
    const chars = this._parent_layout._characters;
    for (;;) {
      if (this._char_index + 1 >= chars.length) {
        this._char_index = chars.length;
        return false;
      }
      this._char_index++;
      if (test(chars[this._char_index]!)) return true;
    }
  }

  #prevWith(test: (c: Character) => boolean): boolean {
    this._cursor_moving_vertically = false;
    const chars = this._parent_layout._characters;
    for (;;) {
      if (this._char_index === 0) return false;
      this._char_index--;
      if (test(chars[this._char_index]!)) return true;
    }
  }

  nextStartOfWord(): boolean {
    return this.#nextWith((c) => c.is_word_start);
  }
  prevStartOfWord(): boolean {
    return this.#prevWith((c) => c.is_word_start);
  }
  nextEndOfWord(): boolean {
    return this.#nextWith((c) => c.is_word_end);
  }
  prevEndOfWord(): boolean {
    return this.#prevWith((c) => c.is_word_end);
  }

  /** Move to the start of the item (line, span, ...) given by getter. Upstream THIS_START_OF_ITEM. */
  #thisStartOf(getter: (c: Character) => number): boolean {
    this._cursor_moving_vertically = false;
    const chars = this._parent_layout._characters;
    if (this._char_index === 0) return false;
    let original: number;
    if (this._char_index >= chars.length) {
      this._char_index = chars.length - 1;
      original = getter(chars[this._char_index]!);
    } else {
      original = getter(chars[this._char_index]!);
      this._char_index--;
    }
    while (getter(chars[this._char_index]!) === original) {
      if (this._char_index === 0) return true;
      this._char_index--;
    }
    this._char_index++;
    return true;
  }

  /** Upstream NEXT_START_OF_ITEM. */
  #nextStartOf(getter: (c: Character) => number): boolean {
    this._cursor_moving_vertically = false;
    const chars = this._parent_layout._characters;
    if (this._char_index >= chars.length) return false;
    const original = getter(chars[this._char_index]!);
    for (;;) {
      this._char_index++;
      if (this._char_index === chars.length) return false;
      if (getter(chars[this._char_index]!) !== original) return true;
    }
  }

  thisStartOfLine(): boolean {
    // An empty last line: the end is its start.
    const layout = this._parent_layout;
    if (this._char_index >= layout._characters.length && layout._characters.at(-1)?.is_break) return false;
    return this.#thisStartOf((c) => c.in_line);
  }
  nextStartOfLine(): boolean {
    return this.#nextStartOf((c) => c.in_line);
  }
  prevStartOfLine(): boolean {
    if (this._char_index === 0) return false;
    this._char_index--;
    return this.thisStartOfLine();
  }
  thisStartOfSpan(): boolean {
    return this.#thisStartOf((c) => c.in_span);
  }
  nextStartOfSpan(): boolean {
    return this.#nextStartOf((c) => c.in_span);
  }
  thisStartOfChunk(): boolean {
    return this.#thisStartOf((c) => this._parent_layout._spans[c.in_span]!.in_chunk);
  }
  nextStartOfChunk(): boolean {
    return this.#nextStartOf((c) => this._parent_layout._spans[c.in_span]!.in_chunk);
  }
  thisStartOfParagraph(): boolean {
    return this.#thisStartOf((c) => this._parent_layout._lines[c.in_line]!.in_paragraph);
  }
  nextStartOfParagraph(): boolean {
    return this.#nextStartOf((c) => this._parent_layout._lines[c.in_line]!.in_paragraph);
  }
  /** All text is in one shape here: the start of the text. */
  thisStartOfShape(): boolean {
    if (this._char_index === 0) return false;
    this._char_index = 0;
    return true;
  }
  /** All text is in one shape here: the end of the text. */
  nextStartOfShape(): boolean {
    this._char_index = this.#size;
    return false;
  }

  /** Move to the end of the current line (before its line break). */
  thisEndOfLine(): boolean {
    const chars = this._parent_layout._characters;
    if (this._char_index >= chars.length) return false;
    const line = chars[this._char_index]!.in_line;
    while (this._char_index < chars.length && chars[this._char_index]!.in_line === line) {
      if (chars[this._char_index]!.is_break) return true;
      this._char_index++;
    }
    return true;
  }

  beginCursorUpDown(): void {
    this._x_coordinate = this._parent_layout.characterAnchorPoint(this).x;
    this._cursor_moving_vertically = true;
  }

  nextLineCursor(n = 1): boolean {
    if (!this._cursor_moving_vertically) this.beginCursorUpDown();
    const layout = this._parent_layout;
    const line_index = layout._cursorLine(this);
    if (line_index >= layout._lines.length - 1) return false; // nowhere to go
    const target = Math.min(line_index + n, layout._lines.length - 1);
    this._char_index = layout._cursorXOnLineToIterator(target, this._x_coordinate)._char_index;
    return true;
  }

  prevLineCursor(n = 1): boolean {
    if (!this._cursor_moving_vertically) this.beginCursorUpDown();
    const layout = this._parent_layout;
    const line_index = layout._cursorLine(this);
    if (line_index <= 0) return false; // nowhere to go
    const target = Math.max(line_index - n, 0);
    this._char_index = layout._cursorXOnLineToIterator(target, this._x_coordinate)._char_index;
    return true;
  }

  cursorUp(n = 1): boolean {
    return this.prevLineCursor(n);
  }
  cursorDown(n = 1): boolean {
    return this.nextLineCursor(n);
  }
  cursorLeft(): boolean {
    return this.prevCursorPosition();
  }
  cursorRight(): boolean {
    return this.nextCharacter();
  }
  cursorUpWithControl(): boolean {
    return this.prevStartOfParagraph() || this.thisStartOfParagraph();
  }
  cursorDownWithControl(): boolean {
    return this.nextStartOfParagraph();
  }
  cursorLeftWithControl(): boolean {
    return this.prevStartOfWord();
  }
  cursorRightWithControl(): boolean {
    return this.nextStartOfWord();
  }

  prevStartOfParagraph(): boolean {
    if (this._char_index === 0) return false;
    this._char_index--;
    return this.thisStartOfParagraph();
  }
}
