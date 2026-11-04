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
import {
  Affine,
  type OptRect,
  type PathVector,
  Point,
  PathVector as PV,
  Rect,
  Rotate,
  Translate,
} from '@inkscape-web/geom';
import type { Drawing, DrawingGroup } from '../display/drawing.ts';
import type { SPObject } from '../object/sp-object.ts';
import type { SPStyle } from '../style.ts';
import {
  SPCSSBaseline,
  SPCSSTextAlign,
  SPCSSTextOrientation,
  SPCSSWritingMode,
  SPTextAnchor,
} from '../style-enums.ts';
import { ink_font_description_from_style } from '../style-text.ts';
import { SVGLength, SVGLengthUnit } from '../svg/svg-length.ts';
import { FontFactory, type PangoFontDescription, sp_font_description_get_family } from './font-factory.ts';
import type { FontInstance } from './font-instance.ts';
import { calculateFlow } from './Layout-TNG-Compute.ts';
import type { TextPathBackend, WrapShape } from './Layout-TNG-Scanline-Makers.ts';
import { emptyLogAttr, type PangoLogAttr } from './pango.ts';

/** Used to specify any particular text direction required (both 'direction' and 'block-progression'). */
export enum Direction {
  LEFT_TO_RIGHT,
  RIGHT_TO_LEFT,
  TOP_TO_BOTTOM,
  BOTTOM_TO_TOP,
}

export enum Orientation {
  ORIENTATION_UPRIGHT,
  ORIENTATION_SIDEWAYS,
}

/** Display alignment for shapes. See appendWrapShape(). */
export enum DisplayAlign {
  DISPLAY_ALIGN_BEFORE,
  DISPLAY_ALIGN_CENTER,
  DISPLAY_ALIGN_AFTER,
}

/** lengthAdjust values */
export enum LengthAdjust {
  LENGTHADJUST_SPACING,
  LENGTHADJUST_SPACINGANDGLYPHS,
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

/** Control codes which can be embedded in the text to be flowed. See appendControlCode(). */
export enum TextControlCode {
  /** forces the flow to move on to the next line */
  PARAGRAPH_BREAK,
  /** forces the flow to ignore the remainder of the current shape and continue at the top of the one after. */
  SHAPE_BREAK,
  /** inserts an arbitrarily-sized hole in the flow in line with the current text. */
  ARBITRARY_GAP,
}

/**
 * For expressing paragraph alignment. These values are rotated in the case
 * of vertical text, but are not dependent on whether the paragraph is rtl or
 * ltr, thus LEFT is always either left or top.
 */
export enum Alignment {
  LEFT,
  CENTER,
  RIGHT,
  FULL,
  NONE,
}

/**
 * The optional attributes which can be applied to a SVG text or related
 * tag. It is the responsibility of the caller to deal with the inheritance
 * of these values using its knowledge of the parse tree.
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

/** Pango's soft hyphen. */
export const UNICODE_SOFT_HYPHEN = 0x00ad;

/**
 * Holds font metrics: ascent and descent of a font, normalized to one em and
 * then scaled by the font size, or the line box of a line (upstream
 * Layout::FontMetrics).
 */
export class FontMetrics {
  /** Typographic ascent. */
  ascent = 0.8;
  /** Typographic descent. (Normally positive). */
  descent = 0.2;
  /** Height of 'x' measured from alphabetic baseline. */
  xheight = 0.5;
  /** Maximum ascent of all glyphs in font. */
  ascent_max = 0.8;
  /** Maximum descent of all glyphs in font. */
  descent_max = 0.2;

  reset(): void {
    this.ascent = 0.8;
    this.descent = 0.2;
    this.xheight = 0.5;
    this.ascent_max = 0.8;
    this.descent_max = 0.2;
  }

  set(font: FontInstance | null): void {
    if (font) {
      this.ascent = font.GetTypoAscent();
      this.descent = font.GetTypoDescent();
      this.xheight = font.GetXHeight();
      this.ascent_max = font.GetMaxAscent();
      this.descent_max = font.GetMaxDescent();
    }
  }

  /** CSS 2.1 dictates that font-size is based on em-size which is defined as ascent + descent */
  emSize(): number {
    return this.ascent + this.descent;
  }
  /** Alternatively name function for use 2. */
  lineSize(): number {
    return this.ascent + this.descent;
  }
  setZero(): void {
    this.ascent = this.descent = this.xheight = this.ascent_max = this.descent_max = 0.0;
  }

  /** For scaling for 'font-size' (upstream operator*=). */
  scale(x: number): this {
    this.ascent *= x;
    this.descent *= x;
    this.xheight *= x;
    this.ascent_max *= x;
    this.descent_max *= x;
    return this;
  }

  /** Save the larger values of ascent and descent between this and other. Needed for laying out a line with mixed font-sizes, fonts, line-heights. */
  max(other: FontMetrics): void {
    if (other.ascent > this.ascent) this.ascent = other.ascent;
    if (other.descent > this.descent) this.descent = other.descent;
    if (other.xheight > this.xheight) this.xheight = other.xheight;
    if (other.ascent_max > this.ascent_max) this.ascent_max = other.ascent_max;
    if (other.descent_max > this.descent_max) this.descent_max = other.descent_max;
  }

  /** Calculate the effective ascent and descent including half "leading". */
  computeEffective(line_height_multiplier: number): void {
    const half_leading = 0.5 * (line_height_multiplier - 1.0) * this.emSize();
    this.ascent += half_leading;
    this.descent += half_leading;
  }

  getTypoAscent(): number {
    return this.ascent;
  }
  getTypoDescent(): number {
    return this.descent;
  }
  getXHeight(): number {
    return this.xheight;
  }
  getMaxAscent(): number {
    return this.ascent_max;
  }
  getMaxDescent(): number {
    return this.descent_max;
  }

  copy(): FontMetrics {
    const m = new FontMetrics();
    m.ascent = this.ascent;
    m.descent = this.descent;
    m.xheight = this.xheight;
    m.ascent_max = this.ascent_max;
    m.descent_max = this.descent_max;
    return m;
  }
}

export enum InputStreamItemType {
  TEXT_SOURCE,
  CONTROL_CODE,
}

/**
 * Text appended with appendText(). Most of the members are copies of the
 * values passed to appendText().
 */
export class InputStreamTextSource {
  readonly type = InputStreamItemType.TEXT_SOURCE;
  source: SPObject;
  /** The whole text of the source object (upstream: owned by the caller). */
  text: string;
  style: SPStyle;
  /** The code points from text_begin to text_end. */
  chars: number[] = [];
  /** Code unit offset in text of each code point of chars. */
  offsets: number[] = [];
  /** in characters, from text_start to text_end only */
  text_length = 0;
  /** These vectors can (often will) be shorter than the text in this source, but never longer. */
  x: SVGLength[] = [];
  y: SVGLength[] = [];
  dx: SVGLength[] = [];
  dy: SVGLength[] = [];
  rotate: SVGLength[] = [];
  textLength = new SVGLength();
  lengthAdjust = LengthAdjust.LENGTHADJUST_SPACING;
  lang = '';

  constructor(source: SPObject, text: string, style: SPStyle) {
    this.source = source;
    this.text = text;
    this.style = style;
  }

  styleGetFontDescription(): PangoFontDescription {
    return ink_font_description_from_style(this.style);
  }

  styleGetFontInstance(): FontInstance {
    return FontFactory.get().Face(this.styleGetFontDescription());
  }

  styleGetBlockProgression(): Direction {
    switch (this.style.writing_mode.computed) {
      case SPCSSWritingMode.SP_CSS_WRITING_MODE_LR_TB:
      case SPCSSWritingMode.SP_CSS_WRITING_MODE_RL_TB:
        return Direction.TOP_TO_BOTTOM;
      case SPCSSWritingMode.SP_CSS_WRITING_MODE_TB_RL:
        return Direction.RIGHT_TO_LEFT;
      case SPCSSWritingMode.SP_CSS_WRITING_MODE_TB_LR:
        return Direction.LEFT_TO_RIGHT;
      default:
        return Direction.TOP_TO_BOTTOM;
    }
  }

  styleGetTextOrientation(): SPCSSTextOrientation {
    return this.style.text_orientation.computed;
  }

  styleGetDominantBaseline(): SPCSSBaseline {
    return this.style.dominant_baseline.computed;
  }

  styleGetAlignment(para_direction: Direction, try_text_align: boolean): Alignment {
    if (!try_text_align) return text_anchor_to_alignment(this.style.text_anchor.computed, para_direction);

    // there's no way to tell the difference between text-anchor set higher up the cascade to the default and
    // text-anchor never set anywhere in the cascade, so in order to detect which of text-anchor or text-align
    // to use we'll have to run up the style tree ourselves.
    let this_style: SPStyle | null = this.style;
    for (;;) {
      // If both text-align and text-anchor are set at the same level, text-align takes
      // precedence because it is the most expressive.
      if (this_style.text_align.set) {
        switch (this.style.text_align.computed) {
          case SPCSSTextAlign.SP_CSS_TEXT_ALIGN_END:
            return para_direction === Direction.LEFT_TO_RIGHT ? Alignment.RIGHT : Alignment.LEFT;
          case SPCSSTextAlign.SP_CSS_TEXT_ALIGN_LEFT:
            return Alignment.LEFT;
          case SPCSSTextAlign.SP_CSS_TEXT_ALIGN_RIGHT:
            return Alignment.RIGHT;
          case SPCSSTextAlign.SP_CSS_TEXT_ALIGN_CENTER:
            return Alignment.CENTER;
          case SPCSSTextAlign.SP_CSS_TEXT_ALIGN_JUSTIFY:
            return Alignment.FULL;
          default:
            return para_direction === Direction.LEFT_TO_RIGHT ? Alignment.LEFT : Alignment.RIGHT;
        }
      }
      if (this_style.text_anchor.set)
        return text_anchor_to_alignment(this_style.text_anchor.computed, para_direction);
      const object: SPObject | null = this_style.object;
      if (!object?.parent) break;
      this_style = object.parent.style;
      if (!this_style) break;
    }
    return para_direction === Direction.LEFT_TO_RIGHT ? Alignment.LEFT : Alignment.RIGHT;
  }
}

function text_anchor_to_alignment(anchor: number, para_direction: Direction): Alignment {
  switch (anchor) {
    case SPTextAnchor.SP_CSS_TEXT_ANCHOR_MIDDLE:
      return Alignment.CENTER;
    case SPTextAnchor.SP_CSS_TEXT_ANCHOR_END:
      return para_direction === Direction.LEFT_TO_RIGHT ? Alignment.RIGHT : Alignment.LEFT;
    default:
      return para_direction === Direction.LEFT_TO_RIGHT ? Alignment.LEFT : Alignment.RIGHT;
  }
}

/** Represents a control code item in the input stream. All the members are copies of the values passed to appendControlCode(). */
export class InputStreamControlCode {
  readonly type = InputStreamItemType.CONTROL_CODE;
  constructor(
    public source: SPObject,
    public code: TextControlCode,
    public ascent: number,
    public descent: number,
    public width: number,
  ) {}
}

export type InputStreamItem = InputStreamTextSource | InputStreamControlCode;

interface InputWrapShape {
  /** as passed to Layout::appendWrapShape() */
  shape: WrapShape;
  /** as passed to Layout::appendWrapShape() */
  display_align: DisplayAlign;
}

export interface Glyph {
  glyph: number;
  in_character: number;
  hidden: boolean;
  /** relative to the start of the chunk */
  x: number;
  /** relative to the current line's baseline */
  y: number;
  /** absolute, modulo any object transforms, which we don't know about */
  rotation: number;
  /** Orientation of glyph in vertical text */
  orientation: Orientation;
  /** for positioning next glyph */
  advance: number;
  /** to implement lengthAdjust="spacingAndGlyphs" that must scale glyphs only horizontally */
  vertical_scale: number;
}

export interface Character {
  in_span: number;
  /** relative to the start of the *span* (so we can do block-progression) */
  x: number;
  char_attributes: PangoLogAttr;
  the_char: string;
  /** will be -1 if this character has no visual representation */
  in_glyph: number;
}

export interface Span {
  in_chunk: number;
  font: FontInstance | null;
  font_size: number;
  /** relative to the start of the chunk */
  x_start: number;
  /** relative to the start of the chunk */
  x_end: number;
  /** relative to line baseline (without baseline shift) */
  y_offset: number;
  line_height: FontMetrics;
  /** relative to the line's baseline (CSS) */
  baseline_shift: number;
  text_orientation: SPCSSTextOrientation;
  /** See CSS3 section 3.2. Either rtl or ltr */
  direction: Direction;
  /** See CSS3 section 3.2. The direction in which lines go. */
  block_progression: Direction;
  in_input_stream_item: number;
  /** Index of the first character of the span in the code points of its input item. */
  input_stream_first_character: number;
}

export function spanWidth(span: Span): number {
  return Math.abs(span.x_start - span.x_end);
}

export interface Chunk {
  in_line: number;
  /** Left of the chunk after alignment. */
  left_x: number;
}

export interface Line {
  in_paragraph: number;
  baseline_y: number;
  in_shape: number;
  /** For SVG2 text-overflow */
  hidden: boolean;
}

export interface Paragraph {
  /** can be overridden by child Span objects */
  base_direction: Direction;
  alignment: Alignment;
}

/**
 * Generates the layout for either wrapped or non-wrapped text and stores the
 * result (upstream Inkscape::Text::Layout).
 *
 * Usage: set the text using appendText() and appendControlCode(), call
 * appendWrapShape() for wrapping, then calculateFlow(). The output (glyphs,
 * characters, spans, chunks, lines, paragraphs) is read with the iterator
 * (begin(), end()) and the query methods.
 */
export class Layout {
  /** The CSS spec allows line-height:normal to be whatever the user agent thinks will look good. This is our value, as a multiple of font-size. */
  static readonly LINE_HEIGHT_NORMAL = 1.25;

  wrap_mode = WrapMode.WRAP_NONE;
  _input_truncated = false;
  /** The minimum line height (CSS strut), from the block element. */
  strut = new FontMetrics();

  // textLength: we support it on text and flowRoot only, as upstream.
  textLength = new SVGLength();
  lengthAdjust = LengthAdjust.LENGTHADJUST_SPACING;
  /** The multiplier and increment for lengthAdjust to meet the textLength target. */
  textLengthMultiplier = 1;
  textLengthIncrement = 0;

  _input_stream: InputStreamItem[] = [];
  _input_wrap_shapes: InputWrapShape[] = [];
  _path_fitted: TextPathBackend | null = null;

  _empty_cursor_shape = { position: new Point(0, 0), height: 0, rotation: 0 };

  _paragraphs: Paragraph[] = [];
  _lines: Line[] = [];
  _chunks: Chunk[] = [];
  _spans: Span[] = [];
  _characters: Character[] = [];
  _glyphs: Glyph[] = [];
  _baselines: [Point, Point][] = [];
  _end_pos_attributes: PangoLogAttr = emptyLogAttr();

  // ************************** input ****************************

  /**
   * Empties everything stored in this class and resets it to its original
   * state, like when it was created.
   */
  clear(): void {
    this._clearInputObjects();
    this._clearOutputObjects();
    this.textLength = new SVGLength();
    this.textLengthMultiplier = 1;
    this.textLengthIncrement = 0;
    this.lengthAdjust = LengthAdjust.LENGTHADJUST_SPACING;
  }

  /** Queries whether any calls have been made to appendText() or appendControlCode() since the object was last cleared. */
  inputExists(): boolean {
    return this._input_stream.length > 0;
  }

  inputTruncated(): boolean {
    return this._input_truncated;
  }

  _clearInputObjects(): void {
    this._input_stream = [];
    for (const s of this._input_wrap_shapes) s.shape.delete();
    this._input_wrap_shapes = [];
  }

  /**
   * Adds a new piece of text to the end of the current list of text to be
   * processed (upstream appendText, without text_begin/text_end).
   * optional_attributes are the x/y/dx/dy/rotate of the characters, read
   * from optional_attributes_offset.
   */
  appendText(
    text: string,
    style: SPStyle | null,
    source: SPObject,
    optional_attributes: OptionalTextTagAttrs | null = null,
    optional_attributes_offset = 0,
  ): void {
    if (!style) return;
    const new_source = new InputStreamTextSource(source, text, style);
    let offset = 0;
    for (const c of text) {
      new_source.chars.push(c.codePointAt(0)!);
      new_source.offsets.push(offset);
      offset += c.length;
    }
    new_source.text_length = new_source.chars.length;
    if (optional_attributes) {
      // we need to fill in x and y even if the text is empty so that empty paragraphs can be positioned correctly
      const n = new_source.text_length;
      new_source.x = Layout._copyInputVector(
        optional_attributes.x,
        optional_attributes_offset,
        Math.max(1, n),
      );
      new_source.y = Layout._copyInputVector(
        optional_attributes.y,
        optional_attributes_offset,
        Math.max(1, n),
      );
      new_source.dx = Layout._copyInputVector(optional_attributes.dx, optional_attributes_offset, n);
      new_source.dy = Layout._copyInputVector(optional_attributes.dy, optional_attributes_offset, n);
      new_source.rotate = Layout._copyInputVector(optional_attributes.rotate, optional_attributes_offset, n);
      if (
        optional_attributes.rotate.length &&
        optional_attributes_offset >= optional_attributes.rotate.length
      ) {
        let last_rotate = new SVGLength();
        last_rotate.assign(0);
        for (const it of optional_attributes.rotate) if (it._set) last_rotate = it;
        new_source.rotate = [last_rotate];
      }
      new_source.textLength = optional_attributes.textLength.copy();
      new_source.lengthAdjust = optional_attributes.lengthAdjust;
    }
    this._input_stream.push(new_source);
  }

  /**
   * Copy the attribute vectors from input_offset, at most max_length values,
   * stopping at the first unset value.
   */
  static _copyInputVector(
    input_vector: readonly SVGLength[],
    input_offset: number,
    max_length: number,
  ): SVGLength[] {
    const out: SVGLength[] = [];
    if (input_offset >= input_vector.length) return out;
    while (input_offset < input_vector.length && max_length !== 0) {
      if (!input_vector[input_offset]!._set) break;
      out.push(input_vector[input_offset]!);
      input_offset++;
      max_length--;
    }
    return out;
  }

  /**
   * Control codes are metadata in the text stream to signify items that
   * occupy real space (unlike style changes) but don't belong in the text
   * string.
   */
  appendControlCode(code: TextControlCode, source: SPObject, width = 0.0, ascent = 0.0, descent = 0.0): void {
    this._input_stream.push(new InputStreamControlCode(source, code, ascent, descent, width));
  }

  /**
   * Stores another shape inside which to flow the text. Text can be flowed
   * inside multiple shapes in sequence. The layout owns (and deletes) the shape.
   */
  appendWrapShape(shape: WrapShape, display_align = DisplayAlign.DISPLAY_ALIGN_BEFORE): void {
    this._input_wrap_shapes.push({ shape, display_align });
  }

  _blockProgression(): Direction {
    const first = this._input_stream[0];
    if (first instanceof InputStreamTextSource) return first.styleGetBlockProgression();
    return Direction.TOP_TO_BOTTOM;
  }

  _blockTextOrientation(): SPCSSTextOrientation {
    const first = this._input_stream[0];
    if (first instanceof InputStreamTextSource) return first.styleGetTextOrientation();
    return SPCSSTextOrientation.SP_CSS_TEXT_ORIENTATION_MIXED;
  }

  _blockBaseline(): SPCSSBaseline {
    const first = this._input_stream[0];
    if (first instanceof InputStreamTextSource) return first.styleGetDominantBaseline();
    return SPCSSBaseline.SP_CSS_BASELINE_AUTO;
  }

  /** So that LEFT_TO_RIGHT == RIGHT_TO_LEFT but != TOP_TO_BOTTOM */
  static _directions_are_orthogonal(d1: Direction, d2: Direction): boolean {
    if (d1 === Direction.BOTTOM_TO_TOP) d1 = Direction.TOP_TO_BOTTOM;
    if (d2 === Direction.BOTTOM_TO_TOP) d2 = Direction.TOP_TO_BOTTOM;
    if (d1 === Direction.RIGHT_TO_LEFT) d1 = Direction.LEFT_TO_RIGHT;
    if (d2 === Direction.RIGHT_TO_LEFT) d2 = Direction.LEFT_TO_RIGHT;
    return d1 !== d2;
  }

  // ************************** computation **********************

  /**
   * Takes all the stuff you set with the members above here and creates a
   * load of glyphs for use with the members below here. All iterators on
   * this object will be invalidated.
   */
  calculateFlow(): boolean {
    return calculateFlow(this);
  }

  getTextLengthIncrementDue(): number {
    if (
      this.textLength._set &&
      this.textLengthIncrement !== 0 &&
      this.lengthAdjust === LengthAdjust.LENGTHADJUST_SPACING
    ) {
      return this.textLengthIncrement;
    }
    return 0;
  }

  getTextLengthMultiplierDue(): number {
    if (
      this.textLength._set &&
      this.textLengthMultiplier !== 1 &&
      this.lengthAdjust === LengthAdjust.LENGTHADJUST_SPACINGANDGLYPHS
    ) {
      return this.textLengthMultiplier;
    }
    return 1;
  }

  getActualLength(): number {
    let length = 0;
    for (const span of this._spans) length += spanWidth(span);
    return length;
  }

  // ************************** output ***************************

  _clearOutputObjects(): void {
    this._paragraphs = [];
    this._lines = [];
    this._chunks = [];
    this._spans = [];
    this._characters = [];
    this._glyphs = [];
    this._path_fitted = null;
  }

  /** Returns true if there are some glyphs in this object. */
  outputExists(): boolean {
    return this._characters.length > 0;
  }

  _charSpan(c: Character): Span {
    return this._spans[c.in_span]!;
  }
  _charChunk(c: Character): Chunk {
    return this._chunks[this._spans[c.in_span]!.in_chunk]!;
  }
  _charLine(c: Character): Line {
    return this._lines[this._chunks[this._spans[c.in_span]!.in_chunk]!.in_line]!;
  }
  _spanLine(span: Span): Line {
    return this._lines[this._chunks[span.in_chunk]!.in_line]!;
  }
  _spanParagraph(span: Span): Paragraph {
    return this._paragraphs[this._spanLine(span).in_paragraph]!;
  }

  /** The transform of a glyph: font size, rotation and position (upstream Glyph::transform). */
  glyphTransform(glyph: Glyph): Affine {
    const glyph_span = this._charSpan(this._characters[glyph.in_character]!);
    let r = glyph.rotation;
    const vertical =
      glyph_span.block_progression === Direction.LEFT_TO_RIGHT ||
      glyph_span.block_progression === Direction.RIGHT_TO_LEFT;
    if (vertical && glyph.orientation === Orientation.ORIENTATION_SIDEWAYS) {
      // Vertical sideways text
      r += Math.PI / 2.0;
    }
    const sin_rotation = Math.sin(r);
    const cos_rotation = Math.cos(r);
    const fs = glyph_span.font_size;
    const chunk = this._chunks[glyph_span.in_chunk]!;
    const line = this._lines[chunk.in_line]!;
    let e: number;
    let f: number;
    if (vertical) {
      // Vertical text
      // This effectively swaps x for y which changes handedness of coordinate system. This is a bit strange
      // and not what one would expect but the compute code already reverses y so OK.
      e = line.baseline_y + glyph.y;
      f = chunk.left_x + glyph.x;
    } else {
      // Horizontal text
      e = chunk.left_x + glyph.x;
      f = line.baseline_y + glyph.y;
    }
    // unscale vertically so the specified text height is preserved if lengthAdjust=spacingAndGlyphs
    return new Affine(
      fs * cos_rotation,
      fs * sin_rotation,
      fs * sin_rotation,
      -fs * cos_rotation * glyph.vertical_scale,
      e,
      f,
    );
  }

  /**
   * Adds all the output glyphs to in_arena: one DrawingText per span (upstream
   * show()). The paint servers come from the style (the drawing resolves them).
   */
  show(drawing: Drawing, in_arena: DrawingGroup, paintbox: OptRect): void {
    let glyph_index = 0;
    let phase0 = 0.0;
    for (let i = 0; i < this._spans.length; i++) {
      const span = this._spans[i]!;
      const item = this._input_stream[span.in_input_stream_item];
      if (!(item instanceof InputStreamTextSource)) continue;
      if (this._spanLine(span).hidden) continue; // Line corresponds to text overflow. Don't show!

      const style = item.style;
      const data = style.text_decoration_data;
      data.tspan_width = spanWidth(span);
      data.ascender = span.line_height.getTypoAscent();
      data.descender = span.line_height.getTypoDescent();
      const line_of_span = (k: number) => this._chunks[this._spans[k]!.in_chunk]!.in_line;
      data.tspan_line_start = i === 0 || line_of_span(i) !== line_of_span(i - 1);
      data.tspan_line_end = i === this._spans.length - 1 || line_of_span(i) !== line_of_span(i + 1);
      if (span.font) {
        const d = span.font.FontDecoration();
        data.underline_thickness = d.underline_thickness;
        data.underline_position = d.underline_position;
        data.line_through_thickness = d.linethrough_thickness;
        data.line_through_position = d.linethrough_position;
      } else {
        data.underline_thickness = 0.0;
        data.underline_position = 0.0;
        data.line_through_thickness = 0.0;
        data.line_through_position = 0.0;
      }

      const drawing_text = drawing.createText();
      let first_line_glyph = true;
      // Skip the glyphs of spans that were not shown.
      while (
        glyph_index < this._glyphs.length &&
        this._characters[this._glyphs[glyph_index]!.in_character]!.in_span < i
      ) {
        glyph_index++;
      }
      while (
        glyph_index < this._glyphs.length &&
        this._characters[this._glyphs[glyph_index]!.in_character]!.in_span === i
      ) {
        const g = this._glyphs[glyph_index]!;
        if (this._characters[g.in_character]!.in_glyph !== -1 && span.font) {
          const glyph_matrix = this.glyphTransform(g);
          if (first_line_glyph && data.tspan_line_start) {
            first_line_glyph = false;
            phase0 = glyph_matrix.translation().x;
          }
          // Save the starting coordinates for the line - these are needed for figuring out dot/dash/wave phase.
          // Use maximum ascent and descent to ensure glyphs that extend outside the embox are fully drawn.
          drawing_text.addComponent(
            span.font,
            g.glyph,
            glyph_matrix,
            g.advance,
            span.line_height.getMaxAscent(),
            span.line_height.getMaxDescent(),
            glyph_matrix.translation().x - phase0,
          );
        }
        glyph_index++;
      }
      drawing_text.setStyle(style);
      drawing_text.setItemBounds(paintbox);
      // Text spans must be painted in the right order (see inkscape/685)
      in_arena.appendChild(drawing_text);
      // Set item bounds without filter enlargement
      in_arena.setItemBounds(paintbox);
    }
  }

  /**
   * Calculates the smallest rectangle completely enclosing all the glyphs
   * (from start for length characters, -1: all), transformed by transform.
   */
  bounds(transform: Affine, with_stroke = false, start = -1, length = -1): OptRect {
    let bbox: OptRect = null;
    for (const glyph of this._glyphs) {
      if (glyph.hidden) continue; // To do: This and the next line should represent the same thing, use on or the other.
      if (this._characters[glyph.in_character]!.in_glyph === -1) continue;
      if (start !== -1 && glyph.in_character < start) continue;
      if (length !== -1) {
        if (start === -1) start = 0;
        if (glyph.in_character > start + length) continue;
      }
      // this could be faster
      const glyph_matrix = this.glyphTransform(glyph);
      const total_transform = glyph_matrix.multiply(transform);
      const span = this._charSpan(this._characters[glyph.in_character]!);
      if (!span.font) continue;
      const glyph_rect = span.font.BBoxExact(glyph.glyph);
      if (!glyph_rect) continue;
      let glyph_box = glyph_rect.transformed(total_transform);
      // FIXME: Expand rectangle by half stroke width, this doesn't include meters
      // and so is not the most ideal calculation, we could use the glyph Path here.
      if (with_stroke) {
        const text_source = this._input_stream[span.in_input_stream_item] as InputStreamTextSource;
        if (!text_source.style.stroke.isNone()) {
          const scale = transform.descrim();
          glyph_box = glyph_box.expandBy(0.5 * text_source.style.stroke_width.computed * scale);
        }
      }
      bbox = bbox ? bbox.unionWith(glyph_box) : glyph_box;
    }
    return bbox;
  }

  /** The family of the font of a span. */
  getFontFamily(span_index: number): string {
    const span = this._spans[span_index];
    if (!span?.font) return '';
    return sp_font_description_get_family(span.font.get_descr());
  }

  /**
   * Moves all the glyphs so that the characters sit along path (upstream
   * fitToPathAlign). Text on a path has one chunk; startOffset and the
   * alignment as in SVG 1.1 section 10.13.2. The path is kept for the
   * cursor functions.
   */
  fitToPathAlign(startOffset: SVGLength, path: TextPathBackend): void {
    if (path.empty()) return;

    let cluster_offset = 0.0; // cluster position relative to path start.
    const path_length = path.length();
    if (startOffset._set) {
      if (startOffset.unit === SVGLengthUnit.PERCENT) cluster_offset = startOffset.computed * path_length;
      else cluster_offset = startOffset.computed;
    }
    let path_start = cluster_offset;

    // Text on a path should have only one chunk.
    const alignment = this._paragraphs.length ? this._paragraphs[0]!.alignment : Alignment.LEFT;
    switch (alignment) {
      case Alignment.CENTER:
        path_start -= path_length / 2.0;
        cluster_offset -= this._getChunkWidth(0) * 0.5;
        break;
      case Alignment.RIGHT:
        path_start -= path_length;
        cluster_offset -= this._getChunkWidth(0);
        break;
      default:
        break;
    }
    if (!path.closed()) path_start = 0;
    const path_stop = path_start + path_length;

    const vertical = Layout._directions_are_orthogonal(this._blockProgression(), Direction.TOP_TO_BOTTOM);
    if (!this._characters.length) {
      // Find cursor position.
      const pos = path.position(cluster_offset);
      if (cluster_offset >= 0.0 && pos.length) {
        const [x, y, tx, ty] = path.pointAndTangentAt(pos[0]!, pos[1]!);
        this._empty_cursor_shape.position = new Point(x!, y!);
        this._empty_cursor_shape.rotation = vertical ? Math.atan2(-tx!, ty!) : Math.atan2(ty!, tx!);
      }
    }

    for (let char_index = 0; char_index < this._characters.length; ) {
      const span = this._charSpan(this._characters[char_index]!);

      // We position one cluster at a time. A cluster may correspond to:
      // - one or more characters
      // - one or more glyphs.
      // Find first character of next cluster.
      let next_cluster_char_index = char_index + 1;
      for (; next_cluster_char_index < this._characters.length; next_cluster_char_index++) {
        const c = this._characters[next_cluster_char_index]!;
        if (c.in_glyph !== -1 && c.char_attributes.is_cursor_position) break;
      }

      // Find first glyph of next cluster.
      const next_cluster_glyph_index =
        next_cluster_char_index === this._characters.length
          ? this._glyphs.length
          : this._characters[next_cluster_char_index]!.in_glyph;

      // Find width of "cluster".
      let cluster_width = 0.0;
      const current_cluster_glyph_index = this._characters[char_index]!.in_glyph;
      if (current_cluster_glyph_index >= 0) {
        for (let gi = current_cluster_glyph_index; gi < next_cluster_glyph_index; gi++) {
          cluster_width += this._glyphs[gi]!.advance;
        }
      }

      let cluster_start = cluster_offset + span.x_start + this._characters[char_index]!.x;
      // TODO block progression?
      if (span.direction === Direction.RIGHT_TO_LEFT) cluster_start -= cluster_width;
      let cluster_end = cluster_start + cluster_width;
      let cluster_mid = (cluster_start + cluster_end) * 0.5;
      const on_path = cluster_mid > path_start && cluster_mid < path_stop; // Calculate now before messing with positions.

      // Translate positions to actual path, if on closed path. Accounts for wrapping backwards and forwards.
      if (path.closed() && path_length > 1e-6) {
        const mod = (a: number) => (a + path_length) % path_length; // Add path_length to ensure positive.
        cluster_start = mod(cluster_start);
        cluster_mid = mod(cluster_mid);
        cluster_end = mod(cluster_end);
      }

      const midpoint_pos = path.position(cluster_mid);
      if (on_path && midpoint_pos.length && current_cluster_glyph_index >= 0) {
        // On path
        // Find rotation for glyphs based on cluster position along path.
        const [mx, my, tx0, ty0] = path.pointAndTangentAt(midpoint_pos[0]!, midpoint_pos[1]!);
        const midpoint = new Point(mx!, my!);
        let tangent = new Point(tx0!, ty0!);

        // Try to get a better tangent (i.e. at sharp corner).
        if (cluster_start >= 0.0 && cluster_end >= 0.0) {
          const start_pos = path.position(cluster_start);
          const end_pos = path.position(cluster_end);
          if (start_pos.length && end_pos.length && path.onSameSubpath(start_pos[0]!, end_pos[0]!)) {
            // both points were on the same subpath (without this test the angle is very weird)
            const [sx, sy] = path.pointAt(start_pos[0]!, start_pos[1]!);
            const [ex, ey] = path.pointAt(end_pos[0]!, end_pos[1]!);
            if (sx !== ex || sy !== ey) tangent = new Point(ex! - sx!, ey! - sy!).normalized();
          }
        }

        // Position and rotate glyphs in cluster.
        const chunk_left = this._chunks[span.in_chunk]!.left_x;
        const baseline = this._lines[0]!.baseline_y;
        if (vertical) {
          const rotation = Math.atan2(-tangent.x, tangent.y);
          for (let gi = current_cluster_glyph_index; gi < next_cluster_glyph_index; gi++) {
            const g = this._glyphs[gi]!;
            const gy = g.y;
            g.x = midpoint.y - tangent.x * gy - chunk_left;
            g.y = midpoint.x + tangent.y * gy - baseline;
            g.rotation += rotation;
          }
        } else {
          const rotation = Math.atan2(tangent.y, tangent.x);
          for (let gi = current_cluster_glyph_index; gi < next_cluster_glyph_index; gi++) {
            const g = this._glyphs[gi]!;
            let tangent_shift = -cluster_width * 0.5 + g.x - (this._characters[char_index]!.x + span.x_start);
            if (span.direction === Direction.RIGHT_TO_LEFT) tangent_shift += cluster_width;
            const gy = g.y;
            g.x = midpoint.x + tangent.x * tangent_shift - tangent.y * gy - chunk_left;
            g.y = midpoint.y + tangent.y * tangent_shift + tangent.x * gy - baseline;
            g.rotation += rotation;
          }
        }
        this._input_truncated = false;
      } else {
        // Outside path, hide glyphs
        this._characters[char_index]!.in_glyph = -1;
        this._input_truncated = true;
      }
      char_index = next_cluster_char_index;
    }

    for (const span of this._spans) {
      span.x_start += cluster_offset;
      span.x_end += cluster_offset;
    }
    this._path_fitted = path;
  }

  /** Convert the specified range of glyphs into the outlines of the glyphs (upstream convertToCurves). */
  convertToCurves(
    from_glyph: LayoutIterator = this.begin(),
    to_glyph: LayoutIterator = this.end(),
  ): PathVector {
    const curve: PathVector = [];
    for (let glyph_index = from_glyph._glyph_index; glyph_index < to_glyph._glyph_index; glyph_index++) {
      const glyph = this._glyphs[glyph_index];
      if (!glyph) continue;
      const span = this._charSpan(this._characters[glyph.in_character]!);
      const pathv = span.font?.PathVector(glyph.glyph);
      if (pathv?.length) curve.push(...PV.transformed(pathv, this.glyphTransform(glyph)));
    }
    return curve;
  }

  /**
   * Apply the given transform to all the output presently stored in this
   * object. This only transforms the glyph positions, the glyphs themselves
   * will not be transformed.
   */
  transform(transform: Affine): void {
    // this is all massively oversimplified
    for (const g of this._glyphs) {
      const point = new Point(g.x, g.y).transformed(transform);
      g.x = point.x;
      g.y = point.y;
    }
  }

  // ************************** iterators ************************

  /** Returns an iterator pointing at the first glyph of the flowed output. */
  begin(): LayoutIterator {
    return new LayoutIterator(this, 0, 0);
  }

  /** Returns an iterator pointing just past the end of the last glyph. */
  end(): LayoutIterator {
    return new LayoutIterator(this, this._characters.length, this._glyphs.length);
  }

  /** Returns an iterator pointing at the given character index. */
  charIndexToIterator(char_index: number): LayoutIterator {
    if (char_index < 0) return this.begin();
    if (char_index >= this._characters.length) return this.end();
    return LayoutIterator.at(this, char_index);
  }

  /** Returns the character index from the start of the flow represented by the given iterator. */
  iteratorToCharIndex(it: LayoutIterator): number {
    return it._char_index;
  }

  /** Checks the validity of the given iterator over the current layout and corrects it. */
  validateIterator(it: LayoutIterator): void {
    it._parent_layout = this;
    if (it._char_index >= this._characters.length) {
      it._char_index = this._characters.length;
      it._glyph_index = this._glyphs.length;
    } else {
      it._glyph_index = this._characters[it._char_index]!.in_glyph;
    }
  }

  /** The line of the character at it. */
  lineIndex(it: LayoutIterator): number {
    return it._char_index === this._characters.length
      ? this._lines.length - 1
      : this._charChunk(this._characters[it._char_index]!).in_line;
  }

  /** The shape of the character at it. */
  shapeIndex(it: LayoutIterator): number {
    return it._char_index === this._characters.length
      ? this._input_wrap_shapes.length - 1
      : this._charLine(this._characters[it._char_index]!).in_shape;
  }

  /** The paragraph of the character at it. */
  paragraphIndex(it: LayoutIterator): number {
    return it._char_index === this._characters.length
      ? this._paragraphs.length - 1
      : this._charLine(this._characters[it._char_index]!).in_paragraph;
  }

  /**
   * Returns the actual alignment used for the paragraph containing the
   * character pointed to by it.
   */
  paragraphAlignment(it: LayoutIterator): Alignment {
    return this._paragraphs.length === 0
      ? Alignment.NONE
      : this._paragraphs[this.paragraphIndex(it)]!.alignment;
  }

  isWhitespace(it: LayoutIterator): boolean {
    return (
      it._char_index === this._characters.length || this._characters[it._char_index]!.char_attributes.is_white
    );
  }

  characterAt(it: LayoutIterator): string {
    return this._characters[it._char_index]?.the_char ?? '';
  }

  isCursorPosition(it: LayoutIterator): boolean {
    return (
      it._char_index === this._characters.length ||
      this._characters[it._char_index]!.char_attributes.is_cursor_position
    );
  }

  isStartOfWord(it: LayoutIterator): boolean {
    return (
      it._char_index !== this._characters.length &&
      this._characters[it._char_index]!.char_attributes.is_word_start
    );
  }

  isEndOfWord(it: LayoutIterator): boolean {
    return (
      it._char_index === this._characters.length ||
      this._characters[it._char_index]!.char_attributes.is_word_end
    );
  }

  isStartOfSentence(it: LayoutIterator): boolean {
    return (
      it._char_index !== this._characters.length &&
      this._characters[it._char_index]!.char_attributes.is_sentence_start
    );
  }

  isEndOfSentence(it: LayoutIterator): boolean {
    return (
      it._char_index === this._characters.length ||
      this._characters[it._char_index]!.char_attributes.is_sentence_end
    );
  }

  isHidden(it: LayoutIterator): boolean {
    const c = this._characters[it._char_index];
    return !!c && this._charLine(c).hidden;
  }

  _lineToSpan(line_index: number): number {
    let lo = 0;
    let hi = this._spans.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this._chunks[this._spans[mid]!.in_chunk]!.in_line < line_index) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  _lineToCharacter(line_index: number): number {
    let lo = 0;
    let hi = this._characters.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this._charChunk(this._characters[mid]!).in_line < line_index) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  _spanToCharacter(span_index: number): number {
    let lo = 0;
    let hi = this._characters.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this._characters[mid]!.in_span < span_index) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  _sourceToCharacter(source_index: number): number {
    let lo = 0;
    let hi = this._characters.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this._charSpan(this._characters[mid]!).in_input_stream_item < source_index) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * The cursor position on line_index nearest to local_x ('y' is needed to
   * handle cases where multiline text is simulated via the 'y' attribute).
   */
  _cursorXOnLineToIterator(line_index: number, local_x: number, local_y = 0): LayoutIterator {
    let char_index = this._lineToCharacter(line_index);
    let best_char_index = -1;
    let best_difference = Number.MAX_VALUE;

    if (char_index === this._characters.length) return this.end();

    for (; char_index < this._characters.length; char_index++) {
      const c = this._characters[char_index]!;
      if (this._charChunk(c).in_line !== line_index) break;
      if (!c.char_attributes.is_cursor_position) continue;
      const span = this._charSpan(c);
      const delta_x = c.x + span.x_start + this._charChunk(c).left_x - local_x;
      const delta_y = span.y_offset + this._charLine(c).baseline_y - local_y;
      const this_difference = Math.sqrt(delta_x * delta_x + delta_y * delta_y);
      if (this_difference < best_difference) {
        best_difference = this_difference;
        best_char_index = char_index;
      }
    }

    // also try the very end of a para (not lines though because the space wraps)
    if (
      char_index === this._characters.length ||
      this._characters[char_index]!.char_attributes.is_mandatory_break
    ) {
      let delta_x: number;
      let delta_y: number;
      if (char_index === 0) {
        delta_x = this._spans[0]!.x_end + this._chunks[0]!.left_x - local_x;
        delta_y = this._spans[0]!.y_offset + this._spanLine(this._spans[0]!).baseline_y - local_y;
      } else {
        const p = this._characters[char_index - 1]!;
        delta_x = this._charSpan(p).x_end + this._charChunk(p).left_x - local_x;
        delta_y = this._charSpan(p).y_offset + this._charLine(p).baseline_y - local_y;
      }
      const this_difference = Math.sqrt(delta_x * delta_x + delta_y * delta_y);
      if (this_difference < best_difference) {
        best_char_index = char_index;
        best_difference = this_difference;
      }
    }

    if (best_char_index === -1) best_char_index = char_index;
    if (best_char_index === this._characters.length) return this.end();
    return LayoutIterator.at(this, best_char_index);
  }

  /** Gets the overall width of the chunk (the largest x coordinate of its spans). */
  _getChunkWidth(chunk_index: number): number {
    let chunk_width = 0.0;
    let span_index: number;
    if (chunk_index) {
      span_index = this._lineToSpan(this._chunks[chunk_index]!.in_line);
      for (
        ;
        span_index < this._spans.length && this._spans[span_index]!.in_chunk < chunk_index;
        span_index++
      ) {}
    } else {
      span_index = 0;
    }
    for (
      ;
      span_index < this._spans.length && this._spans[span_index]!.in_chunk === chunk_index;
      span_index++
    ) {
      const s = this._spans[span_index]!;
      chunk_width = Math.max(chunk_width, Math.max(s.x_start, s.x_end));
    }
    return chunk_width;
  }

  /**
   * Returns an iterator pointing to the cursor position for a mouse click
   * at the given coordinates (upstream getNearestCursorPositionTo).
   */
  getNearestCursorPositionTo(point: Point): LayoutIterator {
    if (!this._lines.length) return this.begin();
    let local_x = point.x;
    let local_y = point.y;

    if (this._path_fitted) {
      local_x = this._path_fitted.nearestLength(point.x, point.y);
      return this._cursorXOnLineToIterator(0, local_x + this._chunks[0]!.left_x);
    }

    if (Layout._directions_are_orthogonal(this._blockProgression(), Direction.TOP_TO_BOTTOM)) {
      local_x = point.y;
      local_y = point.x;
    }
    // stage 1:
    for (const span of this._spans) {
      const span_left = Math.min(span.x_start, span.x_end);
      const span_right = Math.max(span.x_start, span.x_end);
      const y_line = this._spanLine(span).baseline_y + span.baseline_shift + span.y_offset;
      const left_x = this._chunks[span.in_chunk]!.left_x;
      if (
        local_x >= left_x + span_left &&
        local_x <= left_x + span_right &&
        local_y >= y_line - span.line_height.ascent &&
        local_y <= y_line + span.line_height.descent
      ) {
        return this._cursorXOnLineToIterator(this._chunks[span.in_chunk]!.in_line, local_x, local_y);
      }
    }

    // stage 2:
    let span_index = 0;
    let best_chunk_index = -1;
    let best_y_range = Number.MAX_VALUE;
    let best_x_range = Number.MAX_VALUE;
    for (let chunk_index = 0; chunk_index < this._chunks.length; chunk_index++) {
      const line_height = new FontMetrics();
      line_height.scale(0.0); // Set all metrics to zero.
      let chunk_width = 0.0;
      for (
        ;
        span_index < this._spans.length && this._spans[span_index]!.in_chunk === chunk_index;
        span_index++
      ) {
        const s = this._spans[span_index]!;
        line_height.max(s.line_height);
        chunk_width = Math.max(chunk_width, Math.max(s.x_start, s.x_end));
      }
      const chunk = this._chunks[chunk_index]!;
      const baseline_y = this._lines[chunk.in_line]!.baseline_y;
      let this_y_range: number;
      if (local_y < baseline_y - line_height.ascent) this_y_range = baseline_y - line_height.ascent - local_y;
      else if (local_y > baseline_y + line_height.descent)
        this_y_range = local_y - (baseline_y + line_height.descent);
      else this_y_range = 0.0;
      if (this_y_range <= best_y_range) {
        if (this_y_range < best_y_range) best_x_range = Number.MAX_VALUE;
        let this_x_range: number;
        if (local_x < chunk.left_x) this_x_range = chunk.left_x - local_y;
        else if (local_x > chunk.left_x + chunk_width) this_x_range = local_x - (chunk.left_x + chunk_width);
        else this_x_range = 0.0;
        if (this_x_range < best_x_range) {
          best_y_range = this_y_range;
          best_x_range = this_x_range;
          best_chunk_index = chunk_index;
        }
      }
    }

    // stage 3:
    if (best_chunk_index === -1) return this.begin(); // never happens
    return this._cursorXOnLineToIterator(this._chunks[best_chunk_index]!.in_line, local_x, local_y);
  }

  /** Returns an iterator pointing to the letter at the given point, end() if none. */
  getLetterAt(point: Point): LayoutIterator {
    for (const it = this.begin(); !it.equals(this.end()); it.nextCharacter()) {
      if (this.characterBoundingBox(it).rect.contains(point)) return it.copy();
    }
    return this.end();
  }

  /**
   * Returns an iterator pointing to the first character in the output which
   * was created from the given source. end() if the source is not in the input.
   */
  sourceToIterator(source: SPObject): LayoutIterator {
    if (!this._characters.length) return this.end();
    let source_index = 0;
    for (; source_index < this._input_stream.length; source_index++) {
      if (this._input_stream[source_index]!.source === source) break;
    }
    if (source_index === this._input_stream.length) {
      // Not an input item itself: the first character of a descendant.
      for (let i = 0; i < this._characters.length; i++) {
        const s = this._input_stream[this._charSpan(this._characters[i]!).in_input_stream_item]!.source;
        if (source.isAncestorOf(s)) return LayoutIterator.at(this, i);
      }
      return this.end();
    }
    const char_index = this._sourceToCharacter(source_index);
    if (char_index >= this._characters.length) return this.end();
    return LayoutIterator.at(this, char_index);
  }

  /** Returns the bounding box of the given glyph, and its rotation. */
  glyphBoundingBox(it: LayoutIterator): { rect: OptRect; rotation: number } {
    const glyph = this._glyphs[it._glyph_index];
    if (!glyph) return { rect: null, rotation: 0 };
    const span = this._charSpan(this._characters[glyph.in_character]!);
    return { rect: span.font?.BBoxExact(glyph.glyph) ?? null, rotation: glyph.rotation };
  }

  /**
   * Returns the source of the character at it: the object of appendText()
   * or appendControlCode(), and for text the code unit offset of the
   * character in its string. At the end: null.
   */
  getSourceOfCharacter(it: LayoutIterator): { source: SPObject | null; text_offset: number } {
    if (it._char_index >= this._characters.length) return { source: null, text_offset: 0 };
    const original_input_source_index = this._charSpan(
      this._characters[it._char_index]!,
    ).in_input_stream_item;
    const stream_item = this._input_stream[original_input_source_index]!;
    if (!(stream_item instanceof InputStreamTextSource))
      return { source: stream_item.source, text_offset: 0 };
    let char_index = it._char_index;
    let k = 0;
    while (
      char_index &&
      this._charSpan(this._characters[char_index - 1]!).in_input_stream_item === original_input_source_index
    ) {
      k++;
      char_index--;
    }
    return { source: stream_item.source, text_offset: stream_item.offsets[k] ?? stream_item.text.length };
  }

  /** The point on the baseline at the start of the character it points to. */
  characterAnchorPoint(it: LayoutIterator): Point {
    if (!this._characters.length) return this._empty_cursor_shape.position;
    let res: Point;
    if (it._char_index === this._characters.length) {
      res = new Point(
        this._chunks.at(-1)!.left_x + this._spans.at(-1)!.x_end,
        this._lines.at(-1)!.baseline_y + this._spans.at(-1)!.baseline_shift,
      );
    } else {
      const c = this._characters[it._char_index]!;
      const span = this._charSpan(c);
      res = new Point(
        this._charChunk(c).left_x + span.x_start + c.x,
        this._charLine(c).baseline_y + span.baseline_shift,
      );
    }
    if (Layout._directions_are_orthogonal(this._blockProgression(), Direction.TOP_TO_BOTTOM)) {
      res = new Point(res.y, res.x);
    }
    return res;
  }

  /**
   * For left aligned text, the leftmost end of the baseline. For rightmost
   * text, the rightmost... you probably got it by now ;-)
   */
  baselineAnchorPoint(): Point | null {
    const pos = this.begin();
    let left_pt = this.characterAnchorPoint(pos);
    pos.thisEndOfLine();
    let right_pt = this.characterAnchorPoint(pos);

    const direction = this._spans[0]?.direction;
    if (direction === Direction.RIGHT_TO_LEFT) [right_pt, left_pt] = [left_pt, right_pt];

    switch (this.paragraphAlignment(pos)) {
      case Alignment.LEFT:
      case Alignment.FULL:
        return left_pt;
      case Alignment.CENTER:
        return left_pt.add(right_pt).div(2); // middle point
      case Alignment.RIGHT:
        return right_pt;
      default:
        return null;
    }
  }

  /** The baseline of the first line: from the start to the end of the line. */
  baseline(): [Point, Point] {
    const pos = this.begin();
    const left_pt = this.characterAnchorPoint(pos);
    pos.thisEndOfLine();
    return [left_pt, this.characterAnchorPoint(pos)];
  }

  getBaselines(): [Point, Point][] {
    return this._baselines;
  }

  _calculateBaselines(): void {
    this._baselines = [];
    const pos = this.begin();
    while (!pos.equals(this.end())) {
      const start_anchor_pt = this.characterAnchorPoint(pos);
      pos.thisEndOfLine();
      const end_anchor_pt = this.characterAnchorPoint(pos);
      this._baselines.push([start_anchor_pt, end_anchor_pt]);
      if (!pos.nextCharacter()) break;
    }
  }

  _get_attributes(it: LayoutIterator): PangoLogAttr {
    if (it._char_index < this._characters.length) return this._characters[it._char_index]!.char_attributes;
    return this._end_pos_attributes;
  }

  /**
   * Gets the anchor point of the chunk of it, as used by the x and y
   * attributes: it takes alignment into account.
   */
  chunkAnchorPoint(it: LayoutIterator): Point {
    if (!this._chunks.length) return new Point(0.0, 0.0);
    let chunk_index: number;
    if (!this._characters.length) chunk_index = 0;
    else if (it._char_index === this._characters.length) chunk_index = this._chunks.length - 1;
    else chunk_index = this._charSpan(this._characters[it._char_index]!).in_chunk;

    const chunk = this._chunks[chunk_index]!;
    const alignment = this._paragraphs[this._lines[chunk.in_line]!.in_paragraph]!.alignment;
    let x = chunk.left_x;
    const y = this._lines[chunk.in_line]!.baseline_y;
    const chunk_width = this._getChunkWidth(chunk_index);
    if (alignment === Alignment.RIGHT) x += chunk_width;
    else if (alignment === Alignment.CENTER) x += chunk_width * 0.5;

    if (Layout._directions_are_orthogonal(this._blockProgression(), Direction.TOP_TO_BOTTOM))
      return new Point(y, x);
    return new Point(x, y);
  }

  /**
   * Returns the box extents (not ink extents) of the character at it, and
   * its rotation. The centre of rotation is at the horizontal centre of the
   * box on the text baseline.
   */
  characterBoundingBox(it: LayoutIterator): { rect: Rect; rotation: number } {
    let top_left = new Point(0, 0);
    let bottom_right = new Point(0, 0);
    let rotation = 0;
    let char_index = it._char_index;
    if (!this._characters.length) return { rect: new Rect(0, 0, 0, 0), rotation };

    if (this._path_fitted) {
      let cluster_half_width = 0.0;
      for (
        let glyph_index = this._characters[char_index]?.in_glyph ?? -1;
        glyph_index >= 0 && glyph_index < this._glyphs.length;
        glyph_index++
      ) {
        if (this._glyphs[glyph_index]!.in_character !== char_index) break;
        cluster_half_width += this._glyphs[glyph_index]!.advance;
      }
      cluster_half_width *= 0.5;
      const c = this._characters[Math.min(char_index, this._characters.length - 1)]!;
      const span = this._charSpan(c);
      const midpoint_offset = span.x_start + c.x + cluster_half_width;
      const pos = this._path_fitted.position(midpoint_offset);
      if (midpoint_offset >= 0.0 && pos.length) {
        const [mx, my, tx, ty] = this._path_fitted.pointAndTangentAt(pos[0]!, pos[1]!);
        top_left = new Point(mx! - cluster_half_width, my! - span.line_height.ascent);
        bottom_right = new Point(mx! + cluster_half_width, my! + span.line_height.descent);
        const normal = new Point(-ty!, tx!); // tangent.cw()
        top_left = top_left.add(normal.mul(span.baseline_shift));
        bottom_right = bottom_right.add(normal.mul(span.baseline_shift));
        rotation = Math.atan2(ty!, tx!);
      }
      return { rect: new Rect(top_left, bottom_right), rotation };
    }

    let tlx: number;
    let brx: number;
    if (it._char_index === this._characters.length) {
      tlx = brx = this._chunks.at(-1)!.left_x + this._spans.at(-1)!.x_end;
      char_index--;
    } else {
      const c = this._characters[it._char_index]!;
      const span_x = this._charSpan(c).x_start + this._charChunk(c).left_x;
      tlx = span_x + c.x;
      const next = this._characters[it._char_index + 1];
      if (!next || next.in_span !== c.in_span) brx = this._charSpan(c).x_end + this._charChunk(c).left_x;
      else brx = span_x + next.x;
    }

    const c = this._characters[char_index]!;
    const span = this._charSpan(c);
    const baseline_y = this._charLine(c).baseline_y + span.baseline_shift;
    let tly: number;
    let bry: number;
    if (Layout._directions_are_orthogonal(this._blockProgression(), Direction.TOP_TO_BOTTOM)) {
      const span_height = span.line_height.emSize();
      tly = tlx;
      tlx = baseline_y - span_height * 0.5;
      bry = brx;
      brx = baseline_y + span_height * 0.5;
    } else {
      tly = baseline_y - span.line_height.ascent;
      bry = baseline_y + span.line_height.descent;
    }

    if (it._glyph_index === -1) rotation = 0.0;
    else if (it._glyph_index === this._glyphs.length) rotation = this._glyphs.at(-1)?.rotation ?? 0;
    else rotation = this._glyphs[it._glyph_index]!.rotation;

    return { rect: new Rect(new Point(tlx, tly), new Point(brx, bry)), rotation };
  }

  /**
   * Basically uses characterBoundingBox() on all the characters from start
   * to end and returns the union of these boxes: quadrilaterals of four
   * points each.
   */
  createSelectionShape(it_start: LayoutIterator, it_end: LayoutIterator, transform: Affine): Point[] {
    const quads: Point[] = [];
    let char_index: number;
    let end_char_index: number;
    if (it_start._char_index < it_end._char_index) {
      char_index = it_start._char_index;
      end_char_index = Math.min(it_end._char_index, this._characters.length);
    } else {
      char_index = it_end._char_index;
      end_char_index = Math.min(it_start._char_index, this._characters.length);
    }
    for (; char_index < end_char_index; ) {
      const c = this._characters[char_index]!;
      if (c.in_glyph === -1) {
        char_index++;
        continue;
      }
      let char_rotation = this._glyphs[c.in_glyph]!.rotation;
      const span_index = c.in_span;
      const span = this._spans[span_index]!;

      let top_left: Point;
      let bottom_right: Point;
      if (this._path_fitted || char_rotation !== 0.0) {
        const box = this.characterBoundingBox(LayoutIterator.at(this, char_index));
        char_rotation = box.rotation;
        top_left = box.rect.min();
        bottom_right = box.rect.max();
        char_index++;
      } else {
        // for straight text we can be faster by combining all the character boxes in a span into one box
        const span_x = span.x_start + this._chunks[span.in_chunk]!.left_x;
        let tlx = span_x + c.x;
        while (char_index < end_char_index && this._characters[char_index]!.in_span === span_index)
          char_index++;
        let brx: number;
        if (char_index === this._characters.length || this._characters[char_index]!.in_span !== span_index) {
          brx = span.x_end + this._chunks[span.in_chunk]!.left_x;
        } else {
          brx = span_x + this._characters[char_index]!.x;
        }
        const baseline_y = this._spanLine(span).baseline_y + span.baseline_shift;
        const vertical_scale = this._glyphs.at(-1)?.vertical_scale ?? 1;
        const offset_y = span.y_offset;
        let tly: number;
        let bry: number;
        if (Layout._directions_are_orthogonal(this._blockProgression(), Direction.TOP_TO_BOTTOM)) {
          const span_height = vertical_scale * span.line_height.emSize();
          tly = tlx;
          tlx = offset_y + baseline_y - span_height * 0.5;
          bry = brx;
          brx = offset_y + baseline_y + span_height * 0.5;
        } else {
          tly = offset_y + baseline_y - vertical_scale * span.line_height.ascent;
          bry = offset_y + baseline_y + vertical_scale * span.line_height.descent;
        }
        top_left = new Point(tlx, tly);
        bottom_right = new Point(brx, bry);
      }

      const char_box = new Rect(top_left, bottom_right);
      if (char_box.width() === 0.0 || char_box.height() === 0.0) continue;
      const center_of_rotation = new Point(
        (top_left.x + bottom_right.x) * 0.5,
        top_left.y + span.line_height.ascent,
      );
      const total_transform = Translate(center_of_rotation.neg())
        .multiply(Rotate(char_rotation))
        .multiply(Translate(center_of_rotation))
        .multiply(transform);
      for (let i = 0; i < 4; i++) quads.push(char_box.corner(i).transformed(total_transform));
    }
    return quads;
  }

  /**
   * Gets the ideal cursor shape for a given iterator: position is the
   * centre of the 'bottom' of the cursor, height its length and rotation
   * its angle (radians, zero up, increasing clockwise).
   */
  queryCursorShape(it: LayoutIterator): { position: Point; height: number; rotation: number } {
    if (!this._characters.length) return { ...this._empty_cursor_shape };

    // we want to cursor to be positioned where the next character would go
    let span: Span;
    let px: number;
    let py: number;
    let rotation: number;
    let height: number;
    const vertical_text = Layout._directions_are_orthogonal(
      this._blockProgression(),
      Direction.TOP_TO_BOTTOM,
    );
    if (this._path_fitted) {
      // text on a path
      let x: number;
      if (it._char_index >= this._characters.length) {
        span = this._spans.at(-1)!;
        x = span.x_end + this._chunks.at(-1)!.left_x - this._chunks[0]!.left_x;
      } else {
        const c = this._characters[it._char_index]!;
        span = this._charSpan(c);
        x = this._chunks[span.in_chunk]!.left_x + span.x_start + c.x - this._chunks[0]!.left_x;
        if (vertical_text) x -= span.line_height.descent;
        if (it._char_index !== 0) span = this._charSpan(this._characters[it._char_index - 1]!);
      }
      const path_length = this._path_fitted.length();
      const x_on_path = Math.max(0.0, x);
      let pos = this._path_fitted.position(x_on_path);
      if (!pos.length) pos = [this._path_fitted.lastPiece(), 0.9999]; // 1.0 will get the wrong tangent
      const [ptx, pty, tx, ty] = this._path_fitted.pointAndTangentAt(pos[0]!, pos[1]!);
      let point = new Point(ptx!, pty!);
      const tangent = new Point(tx!, ty!);
      if (x < 0.0) point = point.add(tangent.mul(x));
      if (x > path_length) point = point.add(tangent.mul(x - path_length));
      if (vertical_text) {
        rotation = Math.atan2(-tangent.x, tangent.y);
        px = point.y - tangent.x * span.baseline_shift;
        py = point.x + tangent.y * span.baseline_shift;
      } else {
        rotation = Math.atan2(tangent.y, tangent.x);
        px = point.x - tangent.y * span.baseline_shift;
        py = point.y + tangent.x * span.baseline_shift;
      }
    } else {
      // text is not on a path
      let last_char_is_newline = false;
      if (it._char_index >= this._characters.length) {
        span = this._spans.at(-1)!;
        px = this._chunks[span.in_chunk]!.left_x + span.x_end;
        rotation = this._glyphs.length ? this._glyphs.at(-1)!.rotation : 0.0;
        if (this._characters.at(-1)!.the_char === '\n') {
          last_char_is_newline = true;
          const anchor = this.chunkAnchorPoint(it);
          px = vertical_text ? anchor.y : anchor.x;
        }
      } else {
        const c = this._characters[it._char_index]!;
        span = this._charSpan(c);
        px = this._chunks[span.in_chunk]!.left_x + span.x_start + c.x;
        if (it._glyph_index === -1) rotation = 0.0;
        else if (it._glyph_index === 0) rotation = this._glyphs.length ? this._glyphs[0]!.rotation : 0.0;
        else rotation = this._glyphs[it._glyph_index - 1]!.rotation;
        // the first char in a line wants to have the y of the new line, so in that case we don't switch to the previous span
        if (
          it._char_index !== 0 &&
          this._charChunk(this._characters[it._char_index - 1]!).in_line ===
            this._chunks[span.in_chunk]!.in_line
        ) {
          span = this._charSpan(this._characters[it._char_index - 1]!);
        }
      }
      py = this._spanLine(span).baseline_y + span.baseline_shift + span.y_offset;
      if (last_char_is_newline) {
        const vertical_scale = this._glyphs.length ? this._glyphs.at(-1)!.vertical_scale : 1.0;
        if (vertical_text) py -= vertical_scale * span.line_height.emSize();
        else py += vertical_scale * span.line_height.emSize();
      }
    }
    // up to now *position is the baseline point, not the final point which will be the bottom of the descent
    const vertical_scale = this._glyphs.length ? this._glyphs.at(-1)!.vertical_scale : 1.0;
    if (vertical_text) {
      // This would look better if we could position the cursor in the center of the character
      height = vertical_scale * span.line_height.emSize();
      rotation += Math.PI / 2;
      [px, py] = [py, px];
      px -= vertical_scale * Math.sin(rotation) * height * 0.5;
      py += vertical_scale * Math.cos(rotation) * height * 0.5;
    } else {
      let caret_slope_run = 0.0;
      let caret_slope_rise = 1.0;
      if (span.font) ({ run: caret_slope_run, rise: caret_slope_rise } = span.font.FontSlope());
      const caret_slope = Math.atan2(caret_slope_run, caret_slope_rise);
      height = (vertical_scale * span.line_height.emSize()) / Math.cos(caret_slope);
      rotation += caret_slope;
      px -= Math.sin(rotation) * vertical_scale * span.line_height.descent;
      py += Math.cos(rotation) * vertical_scale * span.line_height.descent;
    }
    return { position: new Point(px, py), height, rotation };
  }

  /**
   * Determines the dx/dy/rotate attributes that would reproduce the layout
   * of the characters from to to with plain kerning (upstream
   * simulateLayoutUsingKerning).
   */
  simulateLayoutUsingKerning(from: LayoutIterator, to: LayoutIterator, result: OptionalTextTagAttrs): void {
    const zero = () => {
      const l = new SVGLength();
      l.assign(0.0);
      return l;
    };
    const set = (list: SVGLength[], index: number, v: number) => {
      while (list.length < index + 1) list.push(zero());
      const l = new SVGLength();
      l.assign(v);
      list[index] = l;
    };
    result.x = [];
    result.y = [];
    result.dx = [];
    result.dy = [];
    result.rotate = [];
    if (to._char_index <= from._char_index) return;

    for (let char_index = from._char_index; char_index < to._char_index; char_index++) {
      const c = this._characters[char_index]!;
      if (!c.char_attributes.is_char_break) continue;
      if (char_index === 0) continue;
      const prev = this._characters[char_index - 1]!;
      if (this._charChunk(c).in_line !== this._charChunk(prev).in_line) continue;

      let prev_cluster_char_index = char_index - 1;
      for (
        ;
        prev_cluster_char_index !== 0 &&
        !this._characters[prev_cluster_char_index]!.char_attributes.is_cursor_position;
        prev_cluster_char_index--
      ) {}
      const pc = this._characters[prev_cluster_char_index]!;
      const span = this._charSpan(c);
      if (span.in_chunk === this._charSpan(prev).in_chunk) {
        // dx is zero for the first char in a chunk
        // this algorithm works by comparing the summed widths of the glyphs with the observed
        // difference in x coordinates of characters, and subtracting the two to produce the x kerning.
        let glyphs_width = 0.0;
        if (pc.in_glyph !== -1) {
          for (let glyph_index = pc.in_glyph; glyph_index < c.in_glyph; glyph_index++) {
            glyphs_width += this._glyphs[glyph_index]!.advance;
          }
        }
        if (span.direction === Direction.RIGHT_TO_LEFT) glyphs_width = -glyphs_width;
        let dx = c.x + span.x_start - pc.x - this._charSpan(pc).x_start - glyphs_width;
        const input_item = this._input_stream[span.in_input_stream_item];
        if (input_item instanceof InputStreamTextSource) {
          const style = input_item.style;
          if (c.char_attributes.is_white)
            dx -= style.word_spacing.computed * this.getTextLengthMultiplierDue();
          if (c.char_attributes.is_cursor_position)
            dx -= style.letter_spacing.computed * this.getTextLengthMultiplierDue();
          dx -= this.getTextLengthIncrementDue();
        }
        if (Math.abs(dx) > 0.0001) set(result.dx, char_index - from._char_index, dx);
      }
      const dy = span.baseline_shift - this._charSpan(pc).baseline_shift;
      if (Math.abs(dy) > 0.0001) set(result.dy, char_index - from._char_index, dy);
      if (c.in_glyph !== -1 && this._glyphs[c.in_glyph]!.rotation !== 0.0) {
        set(result.rotate, char_index - from._char_index, this._glyphs[c.in_glyph]!.rotation);
      }
    }
  }
}

/**
 * The position of the cursor, a character and a glyph (upstream
 * Layout::iterator). Upstream iterators are value types: copy() where
 * upstream copies, the move functions change the iterator in place.
 */
export class LayoutIterator {
  _parent_layout: Layout;
  /** index into Layout::glyphs, or -1 */
  _glyph_index: number;
  /** index into Layout::character */
  _char_index: number;
  _cursor_moving_vertically = false;
  /**
   * for cursor up/down movement we must maintain the x position where we
   * started so the cursor doesn't 'drift' left or right with the repeated
   * quantization to character boundaries.
   */
  _x_coordinate = 0.0;

  constructor(layout: Layout, char_index = 0, glyph_index?: number) {
    this._parent_layout = layout;
    this._char_index = char_index;
    this._glyph_index = glyph_index ?? layout._characters[char_index]?.in_glyph ?? layout._glyphs.length;
  }

  /** An iterator at a character of layout (upstream iterator(Layout const *p, unsigned c)). */
  static at(layout: Layout, char_index: number): LayoutIterator {
    return new LayoutIterator(layout, char_index, layout._characters[char_index]!.in_glyph);
  }

  copy(): LayoutIterator {
    const it = new LayoutIterator(this._parent_layout, this._char_index, this._glyph_index);
    it._cursor_moving_vertically = this._cursor_moving_vertically;
    it._x_coordinate = this._x_coordinate;
    return it;
  }

  /** Upstream operator==. */
  equals(other: LayoutIterator): boolean {
    return this._glyph_index === other._glyph_index && this._char_index === other._char_index;
  }

  /** Negative, zero or positive as this is before, at or after other (upstream operator<). */
  compare(other: LayoutIterator): number {
    return this._char_index - other._char_index;
  }

  charIndex(): number {
    return this._char_index;
  }

  glyphIndex(): number {
    return this._glyph_index;
  }

  hasGlyph(): boolean {
    return this._glyph_index >= 0;
  }

  get #l(): Layout {
    return this._parent_layout;
  }

  /* **** visual-oriented methods **** */

  nextGlyph(): boolean {
    this._cursor_moving_vertically = false;
    const l = this.#l;
    if (this._glyph_index >= l._glyphs.length - 1) {
      if (this._glyph_index === l._glyphs.length) return false;
      this._char_index = l._characters.length;
      this._glyph_index = l._glyphs.length;
    } else this._char_index = l._glyphs[++this._glyph_index]!.in_character;
    return true;
  }

  prevGlyph(): boolean {
    this._cursor_moving_vertically = false;
    if (this._glyph_index === 0) return false;
    this._char_index = this.#l._glyphs[--this._glyph_index]!.in_character;
    return true;
  }

  /* **** text-oriented methods **** */

  nextCharacter(): boolean {
    this._cursor_moving_vertically = false;
    const l = this.#l;
    if (this._char_index + 1 >= l._characters.length) {
      if (this._char_index === l._characters.length) return false;
      this._char_index = l._characters.length;
      this._glyph_index = l._glyphs.length;
    } else this._glyph_index = l._characters[++this._char_index]!.in_glyph;
    return true;
  }

  prevCharacter(): boolean {
    this._cursor_moving_vertically = false;
    if (this._char_index === 0) return false;
    this._glyph_index = this.#l._characters[--this._char_index]!.in_glyph;
    return true;
  }

  #prevStartOfItem(this_func: () => boolean): boolean {
    this._cursor_moving_vertically = false;
    if (this._char_index === 0) return false;
    this._char_index--;
    return this_func();
  }

  #thisStartOfItem(item_getter: (c: Character) => number): boolean {
    this._cursor_moving_vertically = false;
    const l = this.#l;
    if (this._char_index === 0) return false;
    let original_item: number;
    if (this._char_index >= l._characters.length) {
      this._char_index = l._characters.length - 1;
      original_item = item_getter(l._characters[this._char_index]!);
    } else {
      original_item = item_getter(l._characters[this._char_index]!);
      this._char_index--;
    }
    while (item_getter(l._characters[this._char_index]!) === original_item) {
      if (this._char_index === 0) {
        this._glyph_index = l._characters[this._char_index]!.in_glyph;
        return true;
      }
      this._char_index--;
    }
    this._char_index++;
    this._glyph_index = l._characters[this._char_index]!.in_glyph;
    return true;
  }

  #nextStartOfItem(item_getter: (c: Character) => number): boolean {
    this._cursor_moving_vertically = false;
    const l = this.#l;
    if (this._char_index >= l._characters.length) return false;
    const original_item = item_getter(l._characters[this._char_index]!);
    for (;;) {
      this._char_index++;
      if (this._char_index === l._characters.length) {
        this._glyph_index = l._glyphs.length;
        return false;
      }
      if (item_getter(l._characters[this._char_index]!) !== original_item) break;
    }
    this._glyph_index = l._characters[this._char_index]!.in_glyph;
    return true;
  }

  readonly #span = (c: Character) => c.in_span;
  readonly #chunk = (c: Character) => this.#l._charSpan(c).in_chunk;
  readonly #line = (c: Character) => this.#l._charChunk(c).in_line;
  readonly #shape = (c: Character) => this.#l._charLine(c).in_shape;
  readonly #paragraph = (c: Character) => this.#l._charLine(c).in_paragraph;
  readonly #source = (c: Character) => this.#l._charSpan(c).in_input_stream_item;

  prevStartOfSpan(): boolean {
    return this.#prevStartOfItem(() => this.thisStartOfSpan());
  }
  thisStartOfSpan(): boolean {
    return this.#thisStartOfItem(this.#span);
  }
  nextStartOfSpan(): boolean {
    return this.#nextStartOfItem(this.#span);
  }
  prevStartOfChunk(): boolean {
    return this.#prevStartOfItem(() => this.thisStartOfChunk());
  }
  thisStartOfChunk(): boolean {
    return this.#thisStartOfItem(this.#chunk);
  }
  nextStartOfChunk(): boolean {
    return this.#nextStartOfItem(this.#chunk);
  }
  prevStartOfLine(): boolean {
    return this.#prevStartOfItem(() => this.thisStartOfLine());
  }
  thisStartOfLine(): boolean {
    return this.#thisStartOfItem(this.#line);
  }
  nextStartOfLine(): boolean {
    return this.#nextStartOfItem(this.#line);
  }
  prevStartOfShape(): boolean {
    return this.#prevStartOfItem(() => this.thisStartOfShape());
  }
  thisStartOfShape(): boolean {
    return this.#thisStartOfItem(this.#shape);
  }
  nextStartOfShape(): boolean {
    return this.#nextStartOfItem(this.#shape);
  }
  prevStartOfParagraph(): boolean {
    return this.#prevStartOfItem(() => this.thisStartOfParagraph());
  }
  thisStartOfParagraph(): boolean {
    return this.#thisStartOfItem(this.#paragraph);
  }
  nextStartOfParagraph(): boolean {
    return this.#nextStartOfItem(this.#paragraph);
  }
  prevStartOfSource(): boolean {
    return this.#prevStartOfItem(() => this.thisStartOfSource());
  }
  thisStartOfSource(): boolean {
    return this.#thisStartOfItem(this.#source);
  }
  nextStartOfSource(): boolean {
    return this.#nextStartOfItem(this.#source);
  }

  /** Moves to the start of the character to delete with backspace. */
  charEraseStart(): boolean {
    if (this.#l._get_attributes(this).backspace_deletes_character) return this.prevCharacter();
    return this.prevCursorPosition();
  }

  /** Moves to the end of the line (before the white space that wraps it). */
  thisEndOfLine(): boolean {
    const l = this.#l;
    if (this._char_index >= l._characters.length) return false;
    if (this.nextStartOfLine()) {
      if (this._char_index && l._characters[this._char_index - 1]!.char_attributes.is_white) {
        return this.prevCursorPosition();
      }
      return true;
    }
    if (
      this._char_index &&
      l._charChunk(l._characters[this._char_index - 1]!).in_line !== l._lines.length - 1
    ) {
      return this.prevCursorPosition(); // for when the last paragraph is empty
    }
    return false;
  }

  /** stores the current x coordinate so that the cursor won't drift. */
  beginCursorUpDown(): void {
    const l = this.#l;
    if (this._char_index >= l._characters.length) {
      this._x_coordinate = l._chunks.at(-1)!.left_x + l._spans.at(-1)!.x_end;
    } else {
      const c = l._characters[this._char_index]!;
      this._x_coordinate = c.x + l._charSpan(c).x_start + l._charChunk(c).left_x;
    }
    this._cursor_moving_vertically = true;
  }

  nextLineCursor(n = 1): boolean {
    const l = this.#l;
    if (!this._cursor_moving_vertically) this.beginCursorUpDown();
    if (this._char_index >= l._characters.length) return false;
    const line_index = l._charChunk(l._characters[this._char_index]!).in_line;
    if (line_index === l._lines.length - 1) return false; // nowhere to go
    n = Math.min(n, l._lines.length - 1 - line_index);
    if (l._lines[line_index + n]!.in_shape !== l._lines[line_index]!.in_shape) {
      // switching between shapes: adjust the stored x to compensate
      this._x_coordinate +=
        l._chunks[l._spans[l._lineToSpan(line_index + n)]!.in_chunk]!.left_x -
        l._chunks[l._spans[l._lineToSpan(line_index)]!.in_chunk]!.left_x;
    }
    this._char_index = l._cursorXOnLineToIterator(line_index + n, this._x_coordinate)._char_index;
    if (this._char_index >= l._characters.length) this._glyph_index = l._glyphs.length;
    else this._glyph_index = l._characters[this._char_index]!.in_glyph;
    return true;
  }

  prevLineCursor(n = 1): boolean {
    const l = this.#l;
    if (!this._cursor_moving_vertically) this.beginCursorUpDown();
    let line_index: number;
    if (this._char_index >= l._characters.length) line_index = l._lines.length - 1;
    else line_index = l._charChunk(l._characters[this._char_index]!).in_line;
    if (line_index <= 0) return false; // nowhere to go
    n = Math.min(n, line_index);
    if (l._lines[line_index - n]!.in_shape !== l._lines[line_index]!.in_shape) {
      // switching between shapes: adjust the stored x to compensate
      this._x_coordinate +=
        l._chunks[l._spans[l._lineToSpan(line_index - n)]!.in_chunk]!.left_x -
        l._chunks[l._spans[l._lineToSpan(line_index)]!.in_chunk]!.left_x;
    }
    this._char_index = l._cursorXOnLineToIterator(line_index - n, this._x_coordinate)._char_index;
    this._glyph_index = l._characters[this._char_index]?.in_glyph ?? l._glyphs.length;
    return true;
  }

  #nextWithAttributeSet(attr: keyof PangoLogAttr): boolean {
    this._cursor_moving_vertically = false;
    const l = this.#l;
    for (;;) {
      if (this._char_index + 1 >= l._characters.length) {
        this._char_index = l._characters.length;
        this._glyph_index = l._glyphs.length;
        return false;
      }
      this._char_index++;
      if (l._characters[this._char_index]!.char_attributes[attr]) break;
    }
    this._glyph_index = l._characters[this._char_index]!.in_glyph;
    return true;
  }

  #prevWithAttributeSet(attr: keyof PangoLogAttr): boolean {
    this._cursor_moving_vertically = false;
    const l = this.#l;
    for (;;) {
      if (this._char_index === 0) {
        this._glyph_index = 0;
        return false;
      }
      this._char_index--;
      if (l._characters[this._char_index]!.char_attributes[attr]) break;
    }
    this._glyph_index = l._characters[this._char_index]!.in_glyph;
    return true;
  }

  nextCursorPosition(): boolean {
    return this.#nextWithAttributeSet('is_cursor_position');
  }
  prevCursorPosition(): boolean {
    return this.#prevWithAttributeSet('is_cursor_position');
  }
  nextStartOfWord(): boolean {
    return this.#nextWithAttributeSet('is_word_start');
  }
  prevStartOfWord(): boolean {
    return this.#prevWithAttributeSet('is_word_start');
  }
  nextEndOfWord(): boolean {
    return this.#nextWithAttributeSet('is_word_end');
  }
  prevEndOfWord(): boolean {
    return this.#prevWithAttributeSet('is_word_end');
  }
  nextStartOfSentence(): boolean {
    return this.#nextWithAttributeSet('is_sentence_start');
  }
  prevStartOfSentence(): boolean {
    return this.#prevWithAttributeSet('is_sentence_start');
  }
  nextEndOfSentence(): boolean {
    return this.#nextWithAttributeSet('is_sentence_end');
  }
  prevEndOfSentence(): boolean {
    return this.#prevWithAttributeSet('is_sentence_end');
  }

  /**
   * moves the iterator either forwards or backwards one character according
   * to the directionality of the current paragraph, but ignoring block
   * progression. Helper for the cursor*() functions.
   */
  _cursorLeftOrRightLocalX(direction: Direction): boolean {
    // the only reason this function is so complicated is to enable visual cursor
    // movement moving in to or out of counterdirectional runs. We need to
    // determine the logical position of the cursor at the extreme edge of a run.
    const l = this.#l;
    if (!l._characters.length) return false;
    const old_span_index =
      this._char_index >= l._characters.length
        ? l._spans.length - 1
        : l._characters[this._char_index]!.in_span;
    const old_span_direction = l._spans[old_span_index]!.direction;
    const para_direction = l._spanParagraph(l._spans[old_span_index]!).base_direction;

    let scan_direction: number;
    const old_char_index = this._char_index;
    if (
      old_span_direction !== para_direction &&
      ((this._char_index === 0 && direction === para_direction) ||
        (this._char_index >= l._characters.length && direction !== para_direction))
    ) {
      // the end of the text is actually in the middle because of reordering. Do cleverness
      scan_direction = direction === para_direction ? +1 : -1;
    } else {
      if (direction === old_span_direction) {
        if (!this.nextCursorPosition()) return false;
      } else {
        if (!this.prevCursorPosition()) return false;
      }
      const new_span_index = l._characters[this._char_index]!.in_span;
      if (new_span_index === old_span_index) return true;
      if (old_span_direction !== l._spans[new_span_index]!.direction) {
        // we must jump to the other end of a counterdirectional run
        scan_direction = direction === para_direction ? +1 : -1;
      } else if (l._spans[old_span_index]!.in_chunk !== l._spans[new_span_index]!.in_chunk) {
        // we might have to do a weird jump across the chunk boundary
        if (
          l._spanLine(l._spans[old_span_index]!).in_paragraph !==
          l._spanLine(l._spans[new_span_index]!).in_paragraph
        ) {
          return true;
        }
        if (old_span_direction === para_direction) return true;
        scan_direction = direction === para_direction ? +1 : -1;
      } else return true; // same direction, same chunk: no cleverness required
    }

    let new_span_index = old_span_index;
    for (;;) {
      if (scan_direction > 0) {
        if (new_span_index === l._spans.length - 1) {
          if (l._spans[new_span_index]!.direction === old_span_direction) {
            this._char_index = old_char_index;
            return false; // the visual end is in the logical middle
          }
          break;
        }
        new_span_index++;
      } else {
        if (new_span_index === 0) {
          if (l._spans[new_span_index]!.direction === old_span_direction) {
            this._char_index = old_char_index;
            return false; // the visual end is in the logical middle
          }
          break;
        }
        new_span_index--;
      }
      if (l._spans[new_span_index]!.direction === para_direction) {
        if (para_direction === old_span_direction) new_span_index -= scan_direction;
        break;
      }
      if (l._spans[new_span_index]!.in_chunk !== l._spans[old_span_index]!.in_chunk) {
        if (
          l._spanLine(l._spans[old_span_index]!).in_paragraph ===
            l._spanLine(l._spans[new_span_index]!).in_paragraph &&
          para_direction === old_span_direction
        ) {
          new_span_index -= scan_direction;
        }
        break;
      }
    }

    // found the correct span, now find the correct character
    if (
      l._spanLine(l._spans[old_span_index]!).in_paragraph !==
      l._spanLine(l._spans[new_span_index]!).in_paragraph
    ) {
      if (new_span_index > old_span_index) this._char_index = l._spanToCharacter(new_span_index);
      else this._char_index = l._spanToCharacter(new_span_index + 1) - 1;
    } else {
      if (l._spans[new_span_index]!.direction !== direction) {
        if (new_span_index >= l._spans.length - 1) this._char_index = l._characters.length;
        else this._char_index = l._spanToCharacter(new_span_index + 1) - 1;
      } else this._char_index = l._spanToCharacter(new_span_index);
    }
    if (this._char_index >= l._characters.length) {
      this._glyph_index = l._glyphs.length;
      return false;
    }
    this._glyph_index = l._characters[this._char_index]!.in_glyph;
    return this._char_index !== 0;
  }

  /** moves the iterator either forwards or backwards by one word. */
  _cursorLeftOrRightLocalXByWord(direction: Direction): boolean {
    for (;;) {
      const r = this._cursorLeftOrRightLocalX(direction);
      if (!r || this.#l._characters[this._char_index]!.char_attributes.is_word_start) return r;
    }
  }

  cursorUp(n = 1): boolean {
    const block_progression = this.#l._blockProgression();
    if (block_progression === Direction.TOP_TO_BOTTOM) return this.prevLineCursor(n);
    if (block_progression === Direction.BOTTOM_TO_TOP) return this.nextLineCursor(n);
    return this._cursorLeftOrRightLocalX(Direction.RIGHT_TO_LEFT);
  }

  cursorDown(n = 1): boolean {
    const block_progression = this.#l._blockProgression();
    if (block_progression === Direction.TOP_TO_BOTTOM) return this.nextLineCursor(n);
    if (block_progression === Direction.BOTTOM_TO_TOP) return this.prevLineCursor(n);
    return this._cursorLeftOrRightLocalX(Direction.LEFT_TO_RIGHT);
  }

  cursorLeft(): boolean {
    const block_progression = this.#l._blockProgression();
    if (block_progression === Direction.LEFT_TO_RIGHT) return this.prevLineCursor();
    if (block_progression === Direction.RIGHT_TO_LEFT) return this.nextLineCursor();
    return this._cursorLeftOrRightLocalX(Direction.RIGHT_TO_LEFT);
  }

  cursorRight(): boolean {
    const block_progression = this.#l._blockProgression();
    if (block_progression === Direction.LEFT_TO_RIGHT) return this.nextLineCursor();
    if (block_progression === Direction.RIGHT_TO_LEFT) return this.prevLineCursor();
    return this._cursorLeftOrRightLocalX(Direction.LEFT_TO_RIGHT);
  }

  cursorUpWithControl(): boolean {
    const block_progression = this.#l._blockProgression();
    if (block_progression === Direction.TOP_TO_BOTTOM) return this.prevStartOfParagraph();
    if (block_progression === Direction.BOTTOM_TO_TOP) return this.nextStartOfParagraph();
    return this._cursorLeftOrRightLocalXByWord(Direction.RIGHT_TO_LEFT);
  }

  cursorDownWithControl(): boolean {
    const block_progression = this.#l._blockProgression();
    if (block_progression === Direction.TOP_TO_BOTTOM) return this.nextStartOfParagraph();
    if (block_progression === Direction.BOTTOM_TO_TOP) return this.prevStartOfParagraph();
    return this._cursorLeftOrRightLocalXByWord(Direction.LEFT_TO_RIGHT);
  }

  cursorLeftWithControl(): boolean {
    const block_progression = this.#l._blockProgression();
    if (block_progression === Direction.LEFT_TO_RIGHT) return this.prevStartOfParagraph();
    if (block_progression === Direction.RIGHT_TO_LEFT) return this.nextStartOfParagraph();
    return this._cursorLeftOrRightLocalXByWord(Direction.RIGHT_TO_LEFT);
  }

  cursorRightWithControl(): boolean {
    const block_progression = this.#l._blockProgression();
    if (block_progression === Direction.LEFT_TO_RIGHT) return this.nextStartOfParagraph();
    if (block_progression === Direction.RIGHT_TO_LEFT) return this.prevStartOfParagraph();
    return this._cursorLeftOrRightLocalXByWord(Direction.LEFT_TO_RIGHT);
  }
}
