// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/libnrtype/Layout-TNG-Compute.cpp, src/libnrtype/Layout-TNG-Compute.h
/*
 * Inkscape::Text::Layout::Calculator - text layout engine meaty bits
 *
 * Authors:
 *   Richard Hughes <cyreve@users.sf.net>
 *
 * Copyright (C) 2005 Richard Hughes
 */
import { Point } from '@inkscape-web/geom';
import { SPFlowpara } from '../object/sp-flowdiv.ts';
import type { SPStyle } from '../style.ts';
import { SPCSSBaseline, SPCSSTextOrientation } from '../style-enums.ts';
import { SPCSSUnit } from '../style-internal.ts';
import { ink_font_from_style } from '../style-text.ts';
import { SVGLength } from '../svg/svg-length.ts';
import { FontFactory } from './font-factory.ts';
import type { FontInstance } from './font-instance.ts';
import {
  Alignment,
  type Character,
  Direction,
  FontMetrics,
  type Glyph,
  InputStreamControlCode,
  InputStreamTextSource,
  Layout,
  LengthAdjust,
  Orientation,
  type Span,
  TextControlCode,
  UNICODE_SOFT_HYPHEN,
  WrapMode,
} from './Layout-TNG.ts';
import {
  InfiniteScanlineMaker,
  type ScanlineMaker,
  type ScanRun,
  ShapeScanlineMaker,
  scanRunWidth,
} from './Layout-TNG-Scanline-Makers.ts';
import {
  type PangoAttrRange,
  type PangoGlyphString,
  PangoGravity,
  PangoGravityHint,
  type PangoGravitySettings,
  type PangoItem,
  type PangoLogAttr,
  pango_get_log_attrs,
  pango_itemize,
  pango_shape,
} from './pango.ts';

/** Temporary storage associated with each item returned by the call to pango_itemize(). */
interface PangoItemInfo {
  item: PangoItem;
  font: FontInstance;
}

/**
 * These spans have approximately the same definition as that used for
 * Layout::Span (constant font, direction, etc), except that they are from
 * before we have located the line breaks, so bear no relation to chunks.
 * They are guaranteed to be in at most one PangoItem, exactly one input
 * object and will only have one change of x, y, dx, dy or rotate attribute,
 * which will be at the beginning. An UnbrokenSpan can cross a chunk boundary.
 * Upstream counts bytes of UTF-8; here all offsets count code points.
 */
interface UnbrokenSpan {
  glyph_string: PangoGlyphString | null;
  /** index into _para.pango_items, or -1 if this is style only */
  pango_item_index: number;
  /** index into Layout::_input_stream */
  input_index: number;
  /** index of the first character in the code points of the input item */
  input_stream_first_character: number;
  font_size: number;
  /** This is not the CSS line-height attribute! */
  line_height: FontMetrics;
  /** calculated from the font-height css property */
  line_height_multiplier: number;
  /** calculated from the baseline-shift css property */
  baseline_shift: number;
  text_orientation: SPCSSTextOrientation;
  /** Number of characters (upstream: bytes). */
  text_bytes: number;
  /** the index of the first character in this span in the paragraph, for looking up char_attributes */
  char_index_in_para: number;
  // these are reoriented copies of the <tspan> attributes. We change span when we encounter one.
  x: SVGLength;
  y: SVGLength;
  dx: SVGLength;
  dy: SVGLength;
  rotate: SVGLength;
}

function newUnbrokenSpan(): UnbrokenSpan {
  return {
    glyph_string: null,
    pango_item_index: -1,
    input_index: 0,
    input_stream_first_character: 0,
    font_size: 0,
    line_height: new FontMetrics(),
    line_height_multiplier: Layout.LINE_HEIGHT_NORMAL,
    baseline_shift: 0,
    text_orientation: SPCSSTextOrientation.SP_CSS_TEXT_ORIENTATION_MIXED,
    text_bytes: 0,
    char_index_in_para: 0,
    x: new SVGLength(),
    y: new SVGLength(),
    dx: new SVGLength(),
    dy: new SVGLength(),
    rotate: new SVGLength(),
  };
}

/** Used to provide storage for anything that applies to the current paragraph only. */
interface ParagraphInfo {
  text: number[];
  /** Index into Layout::_input_stream. */
  first_input_index: number;
  direction: Direction;
  alignment: Alignment;
  pango_items: PangoItemInfo[];
  /** For every character in the paragraph. */
  char_attributes: PangoLogAttr[];
  unbroken_spans: UnbrokenSpan[];
}

/** A useful little iterator for moving char-by-char across spans. */
class UnbrokenSpanPosition {
  constructor(
    public iter_span = 0,
    public char_byte = 0,
    public char_index = 0,
  ) {}

  /** Step forward by one character. */
  increment(spans: readonly UnbrokenSpan[]): void {
    this.char_byte++;
    this.char_index++;
    if (this.char_byte === spans[this.iter_span]!.text_bytes) {
      this.iter_span++;
      this.char_index = this.char_byte = 0;
    }
  }

  equals(other: UnbrokenSpanPosition): boolean {
    return this.char_byte === other.char_byte && this.iter_span === other.iter_span;
  }

  copy(): UnbrokenSpanPosition {
    return new UnbrokenSpanPosition(this.iter_span, this.char_byte, this.char_index);
  }
}

/**
 * The line breaking algorithm will convert each UnbrokenSpan into one or
 * more of these. A BrokenSpan will never cross a chunk boundary.
 */
class BrokenSpan {
  start = new UnbrokenSpanPosition();
  /** the end of this will always be the same as the start of the next */
  end = new UnbrokenSpanPosition();
  start_glyph_index = 0;
  end_glyph_index = 0;
  width = 0;
  whitespace_count = 0;
  ends_with_whitespace = false;
  each_whitespace_width = 0;
  /** Save so we can subtract from width at end of line (for center justification) */
  letter_spacing = 0;
  word_spacing = 0;

  setZero(): void {
    this.end = this.start.copy();
    this.width = 0.0;
    this.whitespace_count = 0;
    this.end_glyph_index = this.start_glyph_index = 0;
    this.ends_with_whitespace = false;
    this.each_whitespace_width = 0.0;
    this.letter_spacing = 0.0;
    this.word_spacing = 0.0;
  }

  copy(): BrokenSpan {
    const b = new BrokenSpan();
    Object.assign(b, this);
    b.start = this.start.copy();
    b.end = this.end.copy();
    return b;
  }

  assign(other: BrokenSpan): void {
    Object.assign(this, other);
    this.start = other.start.copy();
    this.end = other.end.copy();
  }
}

/**
 * The definition of a chunk used here is the same as that used in Layout:
 * A collection of contiguous broken spans on the same line.
 */
interface ChunkInfo {
  broken_spans: BrokenSpan[];
  scanrun_width: number;
  /** Total width used by the text (excluding justification). */
  text_width: number;
  x: number;
  whitespace_count: number;
}

const reNonSpacingMark = /^\p{Mn}$/u;

/**
 * Finds the value of line_height_multiplier given the 'line-height'
 * property. The result of multiplying l by line_height_multiplier is the
 * inline box height as specified in css2 section 10.8.
 */
export function computeFontLineHeight(style: SPStyle): number {
  // This is a bit backwards... we should be returning the absolute height
  // but as the code expects line_height_multiplier we return that.
  if (style.line_height.normal) return Layout.LINE_HEIGHT_NORMAL;
  if (style.line_height.unit === SPCSSUnit.SP_CSS_UNIT_NONE) {
    // Special case per CSS, computed value is multiplier
    return style.line_height.computed;
  }
  // Normal case, computed value is absolute height. Turn it into multiplier.
  return style.line_height.computed / style.font_size.computed;
}

/**
 * Does the real work of text flowing (upstream Layout::Calculator): a
 * standard greedy paragraph wrapping algorithm.
 *
 *   foreach(paragraph) {
 *     itemize (_buildPangoItemizationForPara())
 *     break into spans, without dealing with wrapping (_buildSpansForPara())
 *     foreach(line in flow shape) {
 *       foreach(chunk in flow shape) {   (in _buildChunksInScanRun())
 *         // this inner loop in _measureUnbrokenSpan()
 *         if the line height changed discard the line and start again
 *         keep adding characters until we run out of space in the chunk, then back up to the last word boundary
 *       }
 *       push all the glyphs, chars, spans, chunks and line to output (in _outputLine())
 *     }
 *     push the paragraph (in calculate())
 *   }
 *
 * ...and all of that needs to work vertically too.
 */
class Calculator {
  readonly _flow: Layout;
  _scanline_maker: ScanlineMaker | null = null;
  /** index into Layout::_input_wrap_shapes */
  _current_shape_index = 0;
  _gravity: PangoGravitySettings = {
    base_gravity: PangoGravity.PANGO_GRAVITY_AUTO,
    gravity_hint: PangoGravityHint.PANGO_GRAVITY_HINT_NATURAL,
  };
  _block_progression = Direction.TOP_TO_BOTTOM;
  /**
   * For y= attributes in tspan elements et al, we do the adjustment by moving
   * each glyph individually by this number. The spec means that this is
   * maintained across paragraphs.
   */
  _y_offset = 0;

  constructor(text_flow: Layout) {
    this._flow = text_flow;
  }

  _charAttributes(para: ParagraphInfo, span_pos: UnbrokenSpanPosition): PangoLogAttr {
    return para.char_attributes[
      para.unbroken_spans[span_pos.iter_span]!.char_index_in_para + span_pos.char_index
    ]!;
  }

  /** The code point at a position of an unbroken span. */
  _charAt(span: UnbrokenSpan, char_byte: number): number {
    const source = this._flow._input_stream[span.input_index] as InputStreamTextSource;
    return source.chars[span.input_stream_first_character + char_byte] ?? 0;
  }

  /**
   * Computes the width of a single UnbrokenSpan (pointed to by
   * span.start.iter_span) and outputs its vital statistics into the other
   * fields of span. Measuring will stop if maximum_width is reached and in
   * that case the function will return false. In other cases where a line
   * break must be done immediately the function will also return false. On
   * return last_break_span will contain the vital statistics for the span
   * only up to the last line breaking change. Similarly,
   * last_emergency_break_span will contain the vital statistics for the span
   * up to the last inter-character boundary.
   */
  _measureUnbrokenSpan(
    para: ParagraphInfo,
    span: BrokenSpan,
    last_break_span: BrokenSpan,
    last_emergency_break_span: BrokenSpan,
    maximum_width: number,
  ): boolean {
    span.setZero();
    const start_span = para.unbroken_spans[span.start.iter_span]!;

    if (start_span.dx._set && span.start.char_byte === 0) {
      if (para.direction === Direction.RIGHT_TO_LEFT) span.width -= start_span.dx.computed;
      else span.width += start_span.dx.computed;
    }

    if (start_span.pango_item_index === -1) {
      // if this is a style-only span there's no text in it
      // so we don't need to do very much at all
      span.end.iter_span++;
      return true;
    }

    const input = this._flow._input_stream[start_span.input_index]!;
    if (input instanceof InputStreamControlCode) {
      if (input.code === TextControlCode.SHAPE_BREAK || input.code === TextControlCode.PARAGRAPH_BREAK) {
        last_emergency_break_span.assign(span);
        last_break_span.assign(span);
        return false;
      }
      if (input.code === TextControlCode.ARBITRARY_GAP) {
        // Not used!
        if (span.width + input.width > maximum_width) return false;
        span.width += input.width;
        span.end.increment(para.unbroken_spans);
      }
      return true;
    }

    const text_source = input;
    if (Layout._directions_are_orthogonal(this._block_progression, text_source.styleGetBlockProgression())) {
      // TODO: block-progression altered in the middle
      // Measure the precomputed flow from para.input_items
      span.end.iter_span++; // for now, skip to the next span
      return true;
    }

    // a normal span going with a normal block-progression
    const font_size_multiplier = start_span.font_size;
    let soft_hyphen_glyph_width = 0.0;
    let soft_hyphen_in_word = false;
    let is_soft_hyphen = false;
    const glyph_string = start_span.glyph_string!;

    // if we're not at the start of the span we need to pre-init glyph_index
    span.start_glyph_index = 0;
    while (
      span.start_glyph_index < glyph_string.num_glyphs &&
      glyph_string.log_clusters[span.start_glyph_index]! < span.start.char_byte
    ) {
      span.start_glyph_index++;
    }
    span.end_glyph_index = span.start_glyph_index;

    // go char-by-char summing the width, while keeping track of the previous break point
    do {
      const char_attributes = this._charAttributes(para, span.end);
      const end_span = para.unbroken_spans[span.end.iter_span]!;

      if (char_attributes.is_mandatory_break && !span.end.equals(span.start)) {
        last_emergency_break_span.assign(span);
        last_break_span.assign(span);
        return false;
      }

      if (char_attributes.is_line_break) {
        // a suitable position to break at, record where we are
        last_emergency_break_span.assign(span);
        last_break_span.assign(span);
        if (soft_hyphen_in_word) {
          // if there was a previous soft hyphen we're not going to need it any more so we can remove it
          span.width -= soft_hyphen_glyph_width;
          if (!is_soft_hyphen) soft_hyphen_in_word = false;
        }
      } else if (char_attributes.is_char_break) {
        last_emergency_break_span.assign(span);
      }
      // todo: break between chars if necessary (ie no word breaks present) when doing rectangular flowing

      // sum the glyph widths, letter spacing, word spacing, and textLength adjustment to get the character width
      let char_width = 0.0;
      const end_glyphs = end_span.glyph_string!;
      while (
        span.end_glyph_index < end_glyphs.num_glyphs &&
        end_glyphs.log_clusters[span.end_glyph_index]! <= span.end.char_byte
      ) {
        const info = end_glyphs.glyphs[span.end_glyph_index]!;
        const glyph_width = font_size_multiplier * info.width;

        if (
          this._block_progression === Direction.LEFT_TO_RIGHT ||
          this._block_progression === Direction.RIGHT_TO_LEFT
        ) {
          // Vertical text
          if (
            text_source.style.text_orientation.computed ===
              SPCSSTextOrientation.SP_CSS_TEXT_ORIENTATION_SIDEWAYS ||
            (text_source.style.text_orientation.computed ===
              SPCSSTextOrientation.SP_CSS_TEXT_ORIENTATION_MIXED &&
              para.pango_items[end_span.pango_item_index]!.item.analysis.gravity ===
                PangoGravity.PANGO_GRAVITY_SOUTH)
          ) {
            // Sideways orientation
            char_width += glyph_width;
          } else {
            // Upright orientation
            const c = this._charAt(end_span, span.end.char_byte);
            if (!reNonSpacingMark.test(String.fromCodePoint(c))) {
              // Non-spacing marks should not contribute to width. Fonts may not report the correct advance, especially if the 'vmtx' table is missing.
              char_width += glyph_width;
            }
          }
        } else {
          // Horizontal text
          char_width += glyph_width;
        }
        span.end_glyph_index++;
      }

      if (char_attributes.is_cursor_position) {
        char_width += text_source.style.letter_spacing.computed * this._flow.getTextLengthMultiplierDue();
      }
      if (char_attributes.is_expandable_space) {
        char_width += text_source.style.word_spacing.computed * this._flow.getTextLengthMultiplierDue();
      }
      char_width += this._flow.getTextLengthIncrementDue();
      span.width += char_width;

      if (char_attributes.is_expandable_space) {
        span.whitespace_count++;
        span.each_whitespace_width = char_width;
      }
      span.ends_with_whitespace = char_attributes.is_expandable_space;

      is_soft_hyphen = UNICODE_SOFT_HYPHEN === this._charAt(end_span, span.end.char_byte);
      if (is_soft_hyphen) soft_hyphen_glyph_width = char_width;

      // Go to next character (resets end.char_byte to zero if at end)
      span.end.increment(para.unbroken_spans);

      // Width should not include letter_spacing (or word_spacing) after last letter at end of line.
      // word_spacing is attached to white space that is already removed from line end (?)
      const test_width = span.width - text_source.style.letter_spacing.computed;

      // Save letter_spacing and word_spacing for subtraction later if span is last span in line.
      span.letter_spacing = text_source.style.letter_spacing.computed;
      span.word_spacing = text_source.style.word_spacing.computed;

      if (test_width > maximum_width && !char_attributes.is_white) {
        // whitespaces don't matter, we can put as many as we want at eol
        return false;
      }
    } while (span.end.char_byte !== 0); // while we haven't wrapped to the next span

    return true;
  }

  /* *********************************************************************************************************/
  //                             Per-line functions (output)

  /**
   * Uses the paragraph alignment and the chunk information to work out where
   * the actual left of the final chunk must be. Also returns the amount of x
   * to add at each whitespace character to make full justification work.
   */
  _getChunkLeftWithAlignment(
    para: ParagraphInfo,
    it_chunk: ChunkInfo,
  ): { left: number; add_to_each_whitespace: number } {
    let add_to_each_whitespace = 0.0;
    if (!this._flow._input_wrap_shapes.length) {
      switch (para.alignment) {
        case Alignment.RIGHT:
          return { left: it_chunk.x - it_chunk.text_width, add_to_each_whitespace };
        case Alignment.CENTER:
          return { left: it_chunk.x - it_chunk.text_width / 2, add_to_each_whitespace };
        default:
          return { left: it_chunk.x, add_to_each_whitespace };
      }
    }

    switch (para.alignment) {
      case Alignment.FULL: {
        // Don't justify the last line chunk in the span
        const last = it_chunk.broken_spans.at(-1);
        if (last && last.end.iter_span !== para.unbroken_spans.length) {
          // Don't justify a single word or a line that ends with a manual line break.
          const char_attributes = this._charAttributes(para, last.end);
          if (it_chunk.whitespace_count && !char_attributes.is_mandatory_break) {
            // Set the amount of extra space between each word to a fraction
            // of the remaining line space to justify this line.
            add_to_each_whitespace =
              (it_chunk.scanrun_width - it_chunk.text_width) / it_chunk.whitespace_count;
          }
        }
        return { left: it_chunk.x, add_to_each_whitespace };
      }
      case Alignment.RIGHT:
        return { left: it_chunk.x + it_chunk.scanrun_width - it_chunk.text_width, add_to_each_whitespace };
      case Alignment.CENTER:
        return {
          left: it_chunk.x + (it_chunk.scanrun_width - it_chunk.text_width) / 2,
          add_to_each_whitespace,
        };
      default:
        return { left: it_chunk.x, add_to_each_whitespace };
    }
  }

  /**
   * Once we've got here we have finished making changes to the line and are
   * ready to output the final result to _flow.
   */
  _outputLine(para: ParagraphInfo, line_height: FontMetrics, chunk_info: ChunkInfo[], hidden: boolean): void {
    if (!chunk_info.length) return; // line too short to fit anything on it, go to next
    const flow = this._flow;
    const maker = this._scanline_maker!;

    // we've finished fiddling about with ascents and descents: create the output
    const new_line = {
      in_paragraph: flow._paragraphs.length - 1,
      baseline_y: maker.yCoordinate(),
      in_shape: this._current_shape_index,
      hidden,
    };

    // The y coordinate is at the beginning edge of the line box (top for horizontal text, left
    // edge for vertical lr text, right edge for vertical rl text. We align, by default to the
    // alphabetic baseline for horizontal text and the central baseline for vertical text.
    if (this._block_progression === Direction.RIGHT_TO_LEFT) {
      // Vertical text, use em box center as baseline
      new_line.baseline_y -= 0.5 * line_height.emSize();
    } else if (this._block_progression === Direction.LEFT_TO_RIGHT) {
      // Vertical text, use em box center as baseline
      new_line.baseline_y += 0.5 * line_height.emSize();
    } else {
      new_line.baseline_y += line_height.getTypoAscent();
    }
    flow._lines.push(new_line);

    for (const it_chunk of chunk_info) {
      let add_to_each_whitespace = 0;
      // add the chunk to the list
      const new_chunk = { in_line: flow._lines.length - 1, left_x: 0 };
      if (hidden) {
        new_chunk.left_x = it_chunk.x; // Don't align. We'll place below last shape.
      } else {
        const r = this._getChunkLeftWithAlignment(para, it_chunk);
        new_chunk.left_x = r.left;
        add_to_each_whitespace = r.add_to_each_whitespace;
      }

      // we may also have y move orders to deal with here (dx, dy and rotate are done per span)

      // We must handle two cases:
      //
      //   1. Inkscape SVG where the first line is placed by the read-in "y" value and the
      //      rest are determined by 'font-size' and 'line-height' (and not by any
      //      y-kerning). <tspan>s in this case are marked by sodipodi:role="line". This
      //      allows new lines to be inserted in the middle of a <text> object. On output,
      //      new "y" values are calculated for each <tspan> that represents a new line. Line
      //      spacing is already handled by the calling routine.
      //
      //   2. Plain SVG where each <text> or <tspan> is placed by its own "x" and "y" values.
      //      Note that in this case Inkscape treats each <text> object with any included
      //      <tspan>s as a single line of text. This can be confusing in the code below.
      const front = it_chunk.broken_spans[0];
      if (front && front.start.char_byte === 0) {
        // Not empty paragraph, beginning of unbroken span
        const front_span = para.unbroken_spans[front.start.iter_span]!;
        const last_char = flow._characters.at(-1);
        // If empty or new line (sodipode:role="line")
        if (!last_char || flow._charChunk(last_char).in_line !== flow._lines.length - 1) {
          // This is the Inkscape SVG case.
          //
          // If <tspan> "y" attribute is set, use it (initial "y" attributes in
          // <tspans> other than the first have already been stripped for <tspans>
          // marked with role="line", see sp-text.cpp: SPText::_buildLayoutInput).
          // NOTE: for vertical text, "y" is the user-space "x" value.
          if (front_span.y._set) {
            // Use set "y" attribute for baseline
            new_line.baseline_y = front_span.y.computed;

            // Calculate new top of box... given specified baseline.
            let top_of_line_box = new_line.baseline_y;
            if (this._block_progression === Direction.RIGHT_TO_LEFT) {
              // Vertical text, use em box center as baseline
              top_of_line_box += 0.5 * line_height.emSize();
            } else if (this._block_progression === Direction.LEFT_TO_RIGHT) {
              // Vertical text, use em box center as baseline
              top_of_line_box -= 0.5 * line_height.emSize();
            } else {
              top_of_line_box -= line_height.getTypoAscent();
            }
            // Set the initial y coordinate of the for this line (see above).
            maker.setNewYCoordinate(top_of_line_box);
          }

          // Reset relative y_offset ("dy" attribute is relative but should be reset at
          // the beginning of each line since each line will have a new "y" written out.)
          this._y_offset = 0.0;
        } else {
          // This is the plain SVG case
          //
          // "x" and "y" are used to place text, simulating lines as necessary
          if (front_span.y._set) this._y_offset = front_span.y.computed - new_line.baseline_y;
        }
      }
      flow._chunks.push(new_chunk);

      let current_x: number;
      let direction_sign: number;
      let previous_direction = para.direction;
      let counter_directional_width_remaining = 0.0;
      let glyph_rotate = 0.0;
      if (para.direction === Direction.LEFT_TO_RIGHT) {
        direction_sign = +1.0;
        current_x = 0.0;
      } else {
        direction_sign = -1.0;
        if (para.alignment === Alignment.FULL && flow._input_wrap_shapes.length) {
          current_x = it_chunk.scanrun_width;
        } else {
          current_x = it_chunk.text_width;
        }
      }

      // Loop over broken spans; a broken span is part of no more than one PangoItem.
      for (let span_i = 0; span_i < it_chunk.broken_spans.length; span_i++) {
        const it_span = it_chunk.broken_spans[span_i]!;
        // begin adding spans to the list
        const unbroken_span = para.unbroken_spans[it_span.start.iter_span]!;
        let x_in_span_last = 0.0; // set at the END when a new cluster starts
        let x_in_span = 0.0; // set from the preceding at the START when a new cluster starts.

        if (it_span.start.char_byte === 0) {
          // Start of an unbroken span, we might have dx, dy or rotate still to process
          // (x and y are done per chunk)
          if (unbroken_span.dx._set) current_x += unbroken_span.dx.computed;
          if (unbroken_span.dy._set) this._y_offset += unbroken_span.dy.computed;
          if (unbroken_span.rotate._set) glyph_rotate = unbroken_span.rotate.computed * (Math.PI / 180);
        }

        const input = flow._input_stream[unbroken_span.input_index]!;
        if (input instanceof InputStreamTextSource && unbroken_span.pango_item_index === -1) {
          // style only, nothing to output
          continue;
        }

        const new_span: Span = {
          in_chunk: flow._chunks.length - 1,
          line_height: unbroken_span.line_height,
          in_input_stream_item: unbroken_span.input_index,
          baseline_shift: 0.0,
          block_progression: this._block_progression,
          text_orientation: unbroken_span.text_orientation,
          font: null,
          font_size: 0,
          direction: para.direction,
          input_stream_first_character: 0,
          x_start: 0,
          x_end: 0,
          y_offset: 0,
        };
        if (input instanceof InputStreamTextSource) {
          new_span.font = para.pango_items[unbroken_span.pango_item_index]!.font;
          new_span.font_size = unbroken_span.font_size;
          new_span.direction =
            para.pango_items[unbroken_span.pango_item_index]!.item.analysis.level & 1
              ? Direction.RIGHT_TO_LEFT
              : Direction.LEFT_TO_RIGHT;
          new_span.input_stream_first_character =
            unbroken_span.input_stream_first_character + it_span.start.char_byte;
        } else {
          // a control code
          new_span.font = null;
          new_span.font_size = new_span.line_height.emSize();
          new_span.direction = para.direction;
        }

        if (new_span.direction === para.direction) {
          current_x -= counter_directional_width_remaining;
          counter_directional_width_remaining = 0.0;
        } else if (new_span.direction !== previous_direction) {
          // measure width of spans we need to switch round
          counter_directional_width_remaining = 0.0;
          for (let k = span_i; k < it_chunk.broken_spans.length; k++) {
            const it_following_span = it_chunk.broken_spans[k]!;
            const following = para.unbroken_spans[it_following_span.start.iter_span]!;
            if (following.pango_item_index === -1) break;
            const following_input = flow._input_stream[following.input_index] as InputStreamTextSource;
            const following_span_progression = following_input.styleGetBlockProgression();
            if (!Layout._directions_are_orthogonal(following_span_progression, this._block_progression)) {
              const following_direction =
                para.pango_items[following.pango_item_index]!.item.analysis.level & 1
                  ? Direction.RIGHT_TO_LEFT
                  : Direction.LEFT_TO_RIGHT;
              if (new_span.direction !== following_direction) break;
            }
            counter_directional_width_remaining +=
              direction_sign *
              (it_following_span.width + it_following_span.whitespace_count * add_to_each_whitespace);
          }
          current_x += counter_directional_width_remaining;
          counter_directional_width_remaining = 0.0; // we want to go increasingly negative
        }
        new_span.x_start = current_x;
        new_span.y_offset = this._y_offset; // Offset from baseline due to 'y' and 'dy' attributes (used to simulate multiline text).

        if (input instanceof InputStreamTextSource) {
          // the span is set up, push the glyphs and chars
          const text_source = input;
          let iter_source_text = unbroken_span.input_stream_first_character + it_span.start.char_byte;
          let char_index_in_unbroken_span = it_span.start.char_index;
          const font_size_multiplier = new_span.font_size;
          let log_cluster_size_glyphs = 0; // Number of glyphs in this log_cluster
          let log_cluster_size_chars = 0; // Number of characters in this log_cluster
          let end_byte = 0;

          // Get some pointers (constant for an unbroken span).
          const font = para.pango_items[unbroken_span.pango_item_index]!.font;
          const pango_item = para.pango_items[unbroken_span.pango_item_index]!.item;
          const glyph_string = unbroken_span.glyph_string!;

          // Loop over glyphs in span
          let x_offset_cluster = 0.0; // Handle wrong glyph positioning post-1.44 Pango.

          for (
            let glyph_index = it_span.start_glyph_index;
            glyph_index < it_span.end_glyph_index;
            glyph_index++
          ) {
            let char_byte = iter_source_text - unbroken_span.input_stream_first_character;
            let newcluster = false;
            if (glyph_string.glyphs[glyph_index]!.is_cluster_start) {
              newcluster = true;
              x_in_span = x_in_span_last;
            }

            const source_char = text_source.chars[iter_source_text] ?? 0;
            if (
              glyph_string.log_clusters[glyph_index]! < unbroken_span.text_bytes &&
              source_char === UNICODE_SOFT_HYPHEN &&
              glyph_index + 1 !== it_span.end_glyph_index
            ) {
              // if we're looking at a soft hyphen and it's not the last glyph in the
              // chunk we don't draw the glyph but we still need to add to _characters
              flow._characters.push({
                the_char: String.fromCodePoint(source_char),
                in_span: flow._spans.length, // the span hasn't been added yet, so no -1
                char_attributes:
                  para.char_attributes[unbroken_span.char_index_in_para + char_index_in_unbroken_span]!,
                in_glyph: -1,
                x: x_in_span,
              });
              iter_source_text++;
              char_index_in_unbroken_span++;
              while (
                glyph_index < glyph_string.num_glyphs &&
                glyph_string.log_clusters[glyph_index] === char_byte
              ) {
                glyph_index++;
              }
              glyph_index--;
              continue;
            }

            // create the Layout::Glyph
            const unbroken_span_glyph_info = glyph_string.glyphs[glyph_index]!;
            const glyph_width = font_size_multiplier * unbroken_span_glyph_info.width;

            const new_glyph: Glyph = {
              glyph: unbroken_span_glyph_info.glyph,
              in_character: flow._characters.length,
              rotation: glyph_rotate,
              orientation: Orientation.ORIENTATION_UPRIGHT, // Only effects vertical text
              hidden, // SVG 2 overflow
              x: current_x,
              y: this._y_offset,
              advance: glyph_width,
              // We may have scaled font size to fit textLength; now, if
              // @lengthAdjust=spacingAndGlyphs, this scaling must be only horizontal,
              // not vertical, so we unscale it back vertically during output
              vertical_scale:
                flow.lengthAdjust === LengthAdjust.LENGTHADJUST_SPACINGANDGLYPHS
                  ? 1.0 / flow.getTextLengthMultiplierDue()
                  : 1.0,
            };

            if (source_char === 0x0a) {
              // Line feeds should take zero space but they are given 'space' width.
              new_glyph.advance = 0.0;
            }

            // y-coordinate is flipped between vertical and horizontal text...
            // delta_y is common offset but applied with opposite sign
            const delta_x = unbroken_span_glyph_info.x_offset * font_size_multiplier;
            const delta_y =
              unbroken_span_glyph_info.y_offset * font_size_multiplier - unbroken_span.baseline_shift;
            let dominant_baseline = flow._blockBaseline();

            if (
              this._block_progression === Direction.LEFT_TO_RIGHT ||
              this._block_progression === Direction.RIGHT_TO_LEFT
            ) {
              // Vertical text

              // Default dominant baseline is determined by overall block (i.e. <text>) 'text-orientation' value.
              if (flow._blockTextOrientation() !== SPCSSTextOrientation.SP_CSS_TEXT_ORIENTATION_SIDEWAYS) {
                if (dominant_baseline === SPCSSBaseline.SP_CSS_BASELINE_AUTO)
                  dominant_baseline = SPCSSBaseline.SP_CSS_BASELINE_CENTRAL;
              } else if (dominant_baseline === SPCSSBaseline.SP_CSS_BASELINE_AUTO) {
                dominant_baseline = SPCSSBaseline.SP_CSS_BASELINE_ALPHABETIC;
              }

              // TODO: Should also check 'glyph_orientation_vertical' if 'text-orientation' is unset...
              if (
                new_span.text_orientation === SPCSSTextOrientation.SP_CSS_TEXT_ORIENTATION_SIDEWAYS ||
                (new_span.text_orientation === SPCSSTextOrientation.SP_CSS_TEXT_ORIENTATION_MIXED &&
                  pango_item.analysis.gravity === PangoGravity.PANGO_GRAVITY_SOUTH)
              ) {
                // Sideways orientation (Latin characters, CJK punctuation), 90deg rotation done at output stage.
                new_glyph.orientation = Orientation.ORIENTATION_SIDEWAYS;
                new_glyph.x += delta_x;
                new_glyph.y -= delta_y;
                // Multiplying by font-size could cause slight differences in
                // positioning for different baselines if the font size varies within a
                // line of text (e.g. sub-scripts and super-scripts).
                new_glyph.y -= new_span.font_size * font.GetBaselines()[dominant_baseline]!;
              } else {
                // Upright orientation (Pango >= 1.48.4: good mark positioning)
                new_glyph.x += delta_x;
                new_glyph.y -= delta_y;

                // If a font has no vertical metrics, HarfBuzz using OpenType functions
                // (which Pango uses by default from 1.44.0) to position glyphs so that
                // the top of their "ink rectangle" is at the top of the "em-box". This
                // section of code moves each cluster (base glyph with marks) down to
                // match fonts with vertical metrics.
                if (font.face && !font.face.hasVExtents()) {
                  // Font does not have vertical metrics!
                  if (!reNonSpacingMark.test(String.fromCodePoint(source_char))) {
                    // Probably should include other marks!
                    const m = font.face.glyphMetrics(new_glyph.glyph);
                    if (m[6]) {
                      const baseline_adjust = new_span.line_height.ascent / new_span.font_size;
                      x_offset_cluster = (m[3]! / font.face.upem - baseline_adjust) * new_span.font_size;
                    } else {
                      x_offset_cluster = 0.0; // Failed to find extents.
                    }
                  } else {
                    // Is non-spacing mark!
                    // Many fonts report a non-zero vertical advance for marks, especially if the 'vmtx'
                    // table is missing.
                    new_glyph.advance = 0;
                  }
                  new_glyph.x -= x_offset_cluster;
                }
              }
            } else {
              // Horizontal text
              if (dominant_baseline === SPCSSBaseline.SP_CSS_BASELINE_AUTO)
                dominant_baseline = SPCSSBaseline.SP_CSS_BASELINE_ALPHABETIC;
              new_glyph.x += delta_x;
              new_glyph.y += delta_y;
              new_glyph.y += new_span.font_size * font.GetBaselines()[dominant_baseline]!;
            }

            // Correct for right to left text
            if (new_span.direction === Direction.RIGHT_TO_LEFT) {
              // Subtracting cluster width gives wrong placement if more than one glyph has a
              // horizontal advance (GitHub issue 469): subtract only the glyph width.
              new_glyph.x -= font_size_multiplier * glyph_string.glyphs[glyph_index]!.width;
            }

            // Store glyph data
            flow._glyphs.push(new_glyph);

            // Create the Layout::Character(s)
            if (newcluster) {
              newcluster = false;

              // Figure out how many glyphs are in the log_cluster.
              log_cluster_size_glyphs = 0;
              for (
                ;
                log_cluster_size_glyphs + glyph_index < it_span.end_glyph_index;
                log_cluster_size_glyphs++
              ) {
                if (
                  glyph_string.log_clusters[glyph_index] !==
                  glyph_string.log_clusters[glyph_index + log_cluster_size_glyphs]
                ) {
                  break;
                }
              }

              // Find where the text ends for this log_cluster.
              end_byte = para.unbroken_spans[it_span.start.iter_span]!.text_bytes; // Upper limit
              for (
                let next_glyph_index = glyph_index + 1;
                next_glyph_index < glyph_string.num_glyphs;
                next_glyph_index++
              ) {
                if (glyph_string.glyphs[next_glyph_index]!.is_cluster_start) {
                  end_byte = glyph_string.log_clusters[next_glyph_index]!;
                  break;
                }
              }

              // Figure out how many characters are in the log_cluster.
              log_cluster_size_chars = Math.max(0, end_byte - char_byte);
            }

            let advance_width = new_glyph.advance;
            let cursor_positions = 0; // number of selectable positions within glyph
            const first_char_pos = flow._characters.length;
            while (char_byte < end_byte) {
              /* Hack to survive ligatures:  in log_cluster keep the number of available chars >= number of glyphs remaining.
                 When there are no ligatures these two sizes are always the same.
              */
              if (log_cluster_size_chars < log_cluster_size_glyphs) {
                log_cluster_size_glyphs--;
                break;
              }

              // Store character info
              const new_character: Character = {
                the_char: String.fromCodePoint(text_source.chars[iter_source_text] ?? 0x20),
                in_span: flow._spans.length,
                x: x_in_span,
                char_attributes:
                  para.char_attributes[unbroken_span.char_index_in_para + char_index_in_unbroken_span]!,
                in_glyph: hidden ? -1 : flow._glyphs.length - 1,
              };
              flow._characters.push(new_character);
              if (new_character.char_attributes.is_cursor_position) cursor_positions++;

              // Letter/word spacing and justification
              if (new_character.char_attributes.is_expandable_space) {
                advance_width +=
                  text_source.style.word_spacing.computed * flow.getTextLengthMultiplierDue() +
                  add_to_each_whitespace; // justification
              }
              if (new_character.char_attributes.is_cursor_position) {
                advance_width +=
                  text_source.style.letter_spacing.computed * flow.getTextLengthMultiplierDue();
              }
              advance_width += flow.getTextLengthIncrementDue();

              // Update counters
              iter_source_text++;
              char_index_in_unbroken_span++;
              char_byte = iter_source_text - unbroken_span.input_stream_first_character;
              log_cluster_size_chars--;
            }
            this._estimateLigatureSubcomponents(
              flow._characters.slice(first_char_pos),
              flow._glyphs.at(-1)!,
              cursor_positions,
              direction_sign * (new_span.direction !== para.direction ? -1 : 1),
            );

            // Update x position variables
            advance_width *= direction_sign;
            if (new_span.direction !== para.direction) {
              counter_directional_width_remaining -= advance_width;
              current_x -= advance_width;
              x_in_span_last -= advance_width;
            } else {
              current_x += advance_width;
              x_in_span_last += advance_width;
            }
          } // Loop over glyphs in span
        } else if (input instanceof InputStreamControlCode) {
          current_x += input.width;
        }

        new_span.x_end = new_span.x_start + x_in_span_last;
        flow._spans.push(new_span);
        previous_direction = new_span.direction;
      }
      // end adding spans to the list, on to the next chunk...
    }
  }

  /**
   * Initialises the ScanlineMaker for the first shape in the flow, or the
   * infinite version if we're not doing wrapping.
   */
  _createFirstScanlineMaker(): void {
    this._current_shape_index = 0;
    const text_source = this._flow._input_stream[0] as InputStreamTextSource;
    if (!this._flow._input_wrap_shapes.length) {
      // create the special no-wrapping infinite scanline maker
      const initial_x = text_source.x.length ? text_source.x[0]!.computed : 0;
      const initial_y = text_source.y.length ? text_source.y[0]!.computed : 0;
      this._scanline_maker = new InfiniteScanlineMaker(initial_x, initial_y, this._block_progression);
    } else {
      this._scanline_maker = new ShapeScanlineMaker(
        this._flow._input_wrap_shapes[this._current_shape_index]!.shape,
        this._block_progression,
      );

      // 'inline-size' uses an infinitely high (wide) shape. We must set initial y. (We only need to do it here as there is only one shape.)
      if (this._flow.wrap_mode === WrapMode.WRAP_INLINE_SIZE) {
        this._block_progression = this._flow._blockProgression();
        if (
          this._block_progression === Direction.RIGHT_TO_LEFT ||
          this._block_progression === Direction.LEFT_TO_RIGHT
        ) {
          // Vertical text, CJK
          this._scanline_maker.setNewYCoordinate(text_source.x.length ? text_source.x[0]!.computed : 0);
        } else {
          // Horizontal text
          this._scanline_maker.setNewYCoordinate(text_source.y.length ? text_source.y[0]!.computed : 0);
        }
      }
    }
  }

  /**
   * Take all the text from para.first_input_index to the end of the
   * paragraph and stitch it together so that pango_itemize() can be called
   * on the whole thing. Output: para.direction, para.pango_items,
   * para.char_attributes.
   */
  _buildPangoItemizationForPara(para: ParagraphInfo): void {
    const flow = this._flow;
    const factory = FontFactory.get();
    const attributes_list: PangoAttrRange[] = [];
    para.text = [];
    for (let input_index = para.first_input_index; input_index < flow._input_stream.length; input_index++) {
      const input = flow._input_stream[input_index]!;
      if (input instanceof InputStreamControlCode) {
        if (input.code === TextControlCode.SHAPE_BREAK || input.code === TextControlCode.PARAGRAPH_BREAK) {
          break; // stop at the end of the paragraph
        }
        // all other control codes we'll pick up later
      } else {
        const text_source = input;
        // create the FontInstance
        const descr = text_source.styleGetFontDescription();
        const font = factory.Face(descr);

        const start_index = para.text.length;
        for (const c of text_source.chars) para.text.push(c); // build the combined text
        const end_index = para.text.length;

        // The following attributes shall apply only to this section of text
        attributes_list.push({
          start: start_index,
          end: end_index,
          font,
          fallbacks: factory.fallbackFaces(descr),
          features: pango_features(text_source.style.getFontFeatureString()),
          language: text_source.source.getLanguage() ?? '',
        });
      }
    }

    // Pango Itemize
    para.direction = Direction.LEFT_TO_RIGHT; // CSS default
    const first = flow._input_stream[para.first_input_index];
    let rtl = false;
    if (first instanceof InputStreamTextSource) {
      rtl = first.style.direction.computed !== 0; // SP_CSS_DIRECTION_LTR
      para.direction = rtl ? Direction.RIGHT_TO_LEFT : Direction.LEFT_TO_RIGHT;
    }
    const text = Uint32Array.from(para.text);
    const items = attributes_list.length
      ? pango_itemize(factory.backend, text, rtl, attributes_list, this._gravity)
      : [];

    // convert to our vector<> and make the FontInstance for each PangoItem at the same time
    para.pango_items = items.map((item) => ({ item, font: item.analysis.font }));

    // and get the character attributes on everything
    const language = attributes_list[0]?.language ?? '';
    para.char_attributes = pango_get_log_attrs(factory.backend, text, language);

    // Fix for Pango 1.49 which changes the end of a paragraph to a mandatory break.
    // This breaks Inkscape's multiline text (i.e. sodipodi:role line).
    para.char_attributes[para.text.length]!.is_mandatory_break = false;
  }

  /**
   * Split the paragraph into spans. Also call pango_shape() on them.
   * Returns the index of the beginning of the following paragraph in _flow._input_stream.
   */
  _buildSpansForPara(para: ParagraphInfo): number {
    const flow = this._flow;
    let pango_item_index = 0;
    let char_index_in_para = 0;
    let byte_index_in_para = 0;
    let input_index: number;
    let para_text_index = 0;
    const text = Uint32Array.from(para.text);

    para.unbroken_spans = [];

    for (input_index = para.first_input_index; input_index < flow._input_stream.length; input_index++) {
      const input = flow._input_stream[input_index]!;
      if (input instanceof InputStreamControlCode) {
        if (input.code === TextControlCode.SHAPE_BREAK || input.code === TextControlCode.PARAGRAPH_BREAK) {
          // Add span to be used to calculate line spacing of blank lines.
          const new_span = newUnbrokenSpan();
          new_span.pango_item_index = -1;
          new_span.input_index = input_index;

          // No pango object, so find font and line height ourselves.
          const object = input.source;
          if (object) {
            let style: SPStyle | null = object.style;
            // This is a workaround for Inkscape 0.92 SVG1.2 flowed text output, it is technically
            // incorrect to ignore the style of an empty paragraph, but so many legacy documents
            // depend on this functionality that fixing it causes real issues.
            if (object instanceof SPFlowpara) style = object.parent?.style ?? style;
            if (style) {
              new_span.font_size = style.font_size.computed * flow.getTextLengthMultiplierDue();
              const font = ink_font_from_style(style);
              new_span.line_height_multiplier = computeFontLineHeight(style);
              new_span.line_height.set(font);
              new_span.line_height.scale(new_span.font_size);
            }
          }
          new_span.text_bytes = 0;
          new_span.char_index_in_para = char_index_in_para;
          para.unbroken_spans.push(new_span);
          break; // stop at the end of the paragraph
        } else if (input.code === TextControlCode.ARBITRARY_GAP) {
          // Not used!
          const new_span = newUnbrokenSpan();
          new_span.pango_item_index = -1;
          new_span.input_index = input_index;
          new_span.line_height.ascent = input.ascent * flow.getTextLengthMultiplierDue();
          new_span.line_height.descent = input.descent * flow.getTextLengthMultiplierDue();
          new_span.text_bytes = 0;
          new_span.char_index_in_para = char_index_in_para;
          para.unbroken_spans.push(new_span);
        }
      } else if (pango_item_index < para.pango_items.length) {
        const text_source = input;
        let char_index_in_source = 0;
        let span_start_byte_in_source = 0;

        // we'll need to make several spans from each text source, based on the rules described about the UnbrokenSpan definition
        for (;;) {
          /* we need to change spans at every change of PangoItem, source stream change,
             or change in one of the attributes altering position/rotation. */
          const pango_item_bytes =
            pango_item_index >= para.pango_items.length
              ? 0
              : para.pango_items[pango_item_index]!.item.offset +
                para.pango_items[pango_item_index]!.item.length -
                byte_index_in_para;
          const text_source_bytes = text_source.text_length - span_start_byte_in_source;
          const new_span = newUnbrokenSpan();
          new_span.text_bytes = Math.min(text_source_bytes, pango_item_bytes);
          new_span.input_stream_first_character = span_start_byte_in_source;
          new_span.char_index_in_para = char_index_in_para + char_index_in_source;
          new_span.input_index = input_index;

          // cut at <tspan> attribute changes as well
          const num = (v: number) => {
            const l = new SVGLength();
            l.assign(v);
            return l;
          };
          const i0 = char_index_in_source;
          if (
            this._block_progression === Direction.TOP_TO_BOTTOM ||
            this._block_progression === Direction.BOTTOM_TO_TOP
          ) {
            // Horizontal text
            if (text_source.x.length > i0) new_span.x = text_source.x[i0]!.copy();
            if (text_source.y.length > i0) new_span.y = text_source.y[i0]!.copy();
            if (text_source.dx.length > i0)
              new_span.dx = num(text_source.dx[i0]!.computed * flow.getTextLengthMultiplierDue());
            if (text_source.dy.length > i0)
              new_span.dy = num(text_source.dy[i0]!.computed * flow.getTextLengthMultiplierDue());
          } else {
            // Vertical text
            if (text_source.x.length > i0) new_span.y = text_source.x[i0]!.copy();
            if (text_source.y.length > i0) new_span.x = text_source.y[i0]!.copy();
            if (text_source.dx.length > i0)
              new_span.dy = num(text_source.dx[i0]!.computed * flow.getTextLengthMultiplierDue());
            if (text_source.dy.length > i0)
              new_span.dx = num(text_source.dy[i0]!.computed * flow.getTextLengthMultiplierDue());
          }
          if (text_source.rotate.length > i0) new_span.rotate = text_source.rotate[i0]!.copy();
          else if (i0 === 0) new_span.rotate = num(0);
          if (
            input_index === 0 &&
            para.unbroken_spans.length === 0 &&
            !new_span.y._set &&
            !flow._input_wrap_shapes.length
          ) {
            // if we don't set an explicit y some of the automatic wrapping code takes over and moves the text vertically
            // so that the top of the letters is at zero, not the baseline
            new_span.y = num(0.0);
          }
          for (let i = i0 + 1, k = 1; ; i++, k++) {
            if (i >= text_source.text_length) break;
            if (k >= new_span.text_bytes) break;
            if (
              i >= text_source.x.length &&
              i >= text_source.y.length &&
              i >= text_source.dx.length &&
              i >= text_source.dy.length &&
              i >= text_source.rotate.length
            ) {
              break;
            }
            if (
              (text_source.x.length > i && text_source.x[i]!._set) ||
              (text_source.y.length > i && text_source.y[i]!._set) ||
              (text_source.dx.length > i && text_source.dx[i]!._set && text_source.dx[i]!.computed !== 0.0) ||
              (text_source.dy.length > i && text_source.dy[i]!._set && text_source.dy[i]!.computed !== 0.0) ||
              (text_source.rotate.length > i &&
                text_source.rotate[i]!._set &&
                (i === 0 || text_source.rotate[i]!.computed !== text_source.rotate[i - 1]!.computed))
            ) {
              new_span.text_bytes = k;
              break;
            }
          }

          // now we know the length, do some final calculations and add the UnbrokenSpan to the list
          new_span.font_size = text_source.style.font_size.computed * flow.getTextLengthMultiplierDue();
          if (new_span.text_bytes) {
            const pango_item = para.pango_items[pango_item_index]!;
            // Convert characters to glyphs
            const glyph_string = pango_shape(
              text,
              para_text_index,
              new_span.text_bytes,
              pango_item.item.analysis,
            );
            new_span.glyph_string = glyph_string;

            if (pango_item.item.analysis.level & 1) {
              // Right to left text (Arabic, Hebrew, etc.)

              // pango_shape() will reorder glyphs in rtl sections into visual order
              // (start offsets in ascending order) which messes us up because the svg
              // spec requires us to draw glyphs in logical order so let's reverse the
              // glyphstring.
              glyph_string.glyphs.reverse();
              glyph_string.log_clusters.reverse();

              // We've messed up the flag that tells a glyph it is first in a cluster.
              const nglyphs = glyph_string.num_glyphs;
              for (let i = 0; i < nglyphs; ++i) {
                // Set flag for start of cluster, we skip all other glyphs in cluster below.
                glyph_string.glyphs[i]!.is_cluster_start = true;
                // Find index of first glyph in next cluster
                let j = i + 1;
                while (j < nglyphs && glyph_string.log_clusters[j] === glyph_string.log_clusters[i]) {
                  glyph_string.glyphs[j]!.is_cluster_start = false; // Zero
                  j++;
                }
                // Move on to next cluster.
                i = j;
              }
            } // End right to left text.

            new_span.pango_item_index = pango_item_index;
            new_span.line_height_multiplier = computeFontLineHeight(text_source.style);
            new_span.line_height.set(pango_item.font);
            new_span.line_height.scale(new_span.font_size);

            // At some point we may want to calculate baseline_shift here (to take advantage
            // of otm features like superscript baseline), but for now we use style baseline_shift.
            new_span.baseline_shift = text_source.style.baseline_shift.computed;
            new_span.text_orientation = text_source.style.text_orientation.computed;
          } else {
            // if there's no text we still need to initialise the styles
            new_span.pango_item_index = -1;
            const font = text_source.styleGetFontInstance();
            new_span.line_height_multiplier = computeFontLineHeight(text_source.style);
            new_span.line_height.set(font);
            new_span.line_height.scale(new_span.font_size);
          }
          para.unbroken_spans.push(new_span);

          // calculations for moving to the next UnbrokenSpan
          byte_index_in_para += new_span.text_bytes;
          para_text_index += new_span.text_bytes;
          char_index_in_source += new_span.text_bytes;

          if (new_span.text_bytes >= pango_item_bytes) {
            // end of pango item
            pango_item_index++;
            if (pango_item_index === para.pango_items.length) break; // end of paragraph
          }
          if (new_span.text_bytes === text_source_bytes) break; // end of source
          // else <tspan> attribute changed
          span_start_byte_in_source += new_span.text_bytes;
        }
        char_index_in_para += char_index_in_source; // This seems wrong. Probably should be inside loop.
      }
    }
    return input_index;
  }

  /**
   * Moves onto next shape with a new scanline_maker. If there is no next
   * shape, creates an infinite scanline maker to stash remaining text.
   * Returns false if an infinite scanline maker is created.
   */
  _goToNextWrapShape(): boolean {
    const shapes = this._flow._input_wrap_shapes;
    if (!shapes.length) return false; // Shouldn't happen.

    this._current_shape_index++;
    this._scanline_maker?.dispose();
    this._scanline_maker = null;

    if (this._current_shape_index < shapes.length) {
      this._scanline_maker = new ShapeScanlineMaker(
        shapes[this._current_shape_index]!.shape,
        this._block_progression,
      );
      return true;
    }
    // Out of shapes, create infinite scanline maker to stash overflow.
    // First find a suitable position for overflow text.  (index - 1 exists since we just incremented index)
    const [left_x, , , bottom_y] = shapes[this._current_shape_index - 1]!.shape.bbox();
    this._scanline_maker = new InfiniteScanlineMaker(left_x!, bottom_y!, this._block_progression);
    return false;
  }

  /**
   * Given para filled in and start_span_pos set, keeps trying to find
   * somewhere it can fit the next line of text. Returns with start_span_pos
   * set to the end of the text that was fitted, chunk_info completely filled
   * out and line_box_height set with the largest ascent and the largest
   * descent on the line. The return value is false only if we've run out of
   * shapes to wrap inside (and hence stashed overflow).
   */
  _findChunksForLine(
    para: ParagraphInfo,
    start_span_pos: UnbrokenSpanPosition,
    chunk_info: ChunkInfo[],
    line_box_height: FontMetrics,
    strut_height: FontMetrics,
  ): boolean {
    // CSS 2.1 dictates that the minimum line height (i.e. the strut height)
    // is found from the block element.
    Object.assign(line_box_height, strut_height.copy());

    let truncated = false;
    let span_pos = start_span_pos.copy();
    for (;;) {
      // Get regions where one can place one line of text (can be more than one, if filling a
      // donut for example).
      let scan_runs = this._scanline_maker!.makeScanline(line_box_height); // 1 scan run with "InfiniteScanlineMaker"

      // If scan_runs is empty, we must have reached the bottom of a shape. Go to next shape.
      while (!scan_runs.length) {
        // Reset for new shape.
        Object.assign(line_box_height, strut_height.copy());
        // Only used by ShapeScanlineMaker
        if (!this._goToNextWrapShape()) truncated = true;
        // If we've run out of shapes, this will be the infinite line scanline maker with one scan_run).
        scan_runs = this._scanline_maker!.makeScanline(line_box_height);
      }

      chunk_info.length = 0;
      if (para.direction === Direction.RIGHT_TO_LEFT) scan_runs.reverse();
      let scan_run_index: number;
      span_pos = start_span_pos.copy();
      for (scan_run_index = 0; scan_run_index < scan_runs.length; scan_run_index++) {
        // Returns false if some text in line requires a taller line_box_height.
        // (We try again with a larger line_box_height.)
        if (
          !this._buildChunksInScanRun(para, span_pos, scan_runs[scan_run_index]!, chunk_info, line_box_height)
        ) {
          break;
        }
        const last = chunk_info.at(-1);
        if (last?.broken_spans.length) span_pos = last.broken_spans.at(-1)!.end.copy();
      }
      if (scan_run_index === scan_runs.length) break; // ie when buildChunksInScanRun() succeeded
    }

    start_span_pos.iter_span = span_pos.iter_span;
    start_span_pos.char_byte = span_pos.char_byte;
    start_span_pos.char_index = span_pos.char_index;
    return !truncated;
  }

  /**
   * Given a scan run and a first character, append one or more chunks to
   * chunk_info that describe all the spans and other detail necessary to
   * output the greatest amount of text that will fit on this scan line
   * (greedy line breaking algorithm). line_height must be set on input, and
   * if it needs to be made larger and the scanline maker can't do an in-situ
   * resize then it will be set to the required value and the method will
   * return false.
   */
  _buildChunksInScanRun(
    para: ParagraphInfo,
    start_span_pos: UnbrokenSpanPosition,
    scan_run: ScanRun,
    chunk_info: ChunkInfo[],
    line_height: FontMetrics,
  ): boolean {
    const line_height_saved = line_height.copy(); // Store for recalculating line height if chunks are backed out

    let new_chunk: ChunkInfo = {
      broken_spans: [],
      text_width: 0.0,
      whitespace_count: 0,
      scanrun_width: scanRunWidth(scan_run),
      x: scan_run.x_start,
    };

    // we haven't done anything yet so the last valid break position is the beginning
    const last_span_at_break = new BrokenSpan();
    last_span_at_break.start = start_span_pos.copy();
    last_span_at_break.setZero();
    const last_span_at_emergency_break = new BrokenSpan();
    last_span_at_emergency_break.start = start_span_pos.copy();
    last_span_at_emergency_break.setZero();

    let new_span = new BrokenSpan();
    new_span.end = start_span_pos.copy();
    while (new_span.end.iter_span !== para.unbroken_spans.length) {
      // this loops once for each UnbrokenSpan
      const prev_end = new_span.end.copy();
      new_span = new BrokenSpan();
      new_span.start = prev_end;
      const start_span = para.unbroken_spans[new_span.start.iter_span]!;

      // force a chunk change at x or y attribute change
      if ((start_span.x._set || start_span.y._set) && new_span.start.char_byte === 0) {
        if (new_span.start.iter_span !== start_span_pos.iter_span) chunk_info.push(new_chunk);

        new_chunk = {
          broken_spans: [],
          text_width: 0.0,
          whitespace_count: 0,
          scanrun_width: new_chunk.scanrun_width,
          x: new_chunk.x + new_chunk.text_width,
        };
        if (start_span.x._set) new_chunk.x = start_span.x.computed;
        // y doesn't need to be done until output time
      }

      // see if this span is too tall to fit on the current line
      const new_span_height = start_span.line_height.copy();
      new_span_height.computeEffective(start_span.line_height_multiplier);

      /* floating point 80-bit/64-bit rounding problems require epsilon. See
         discussion http://inkscape.gristle.org/2005-03-16.txt around 22:00 */
      const epsilon = 1.1920929e-7;
      if (
        new_span_height.ascent > line_height.ascent + epsilon ||
        new_span_height.descent > line_height.descent + epsilon
      ) {
        // Take larger of each of the two ascents and two descents per CSS
        line_height.max(new_span_height);

        // Currently always true for flowed text and false for Inkscape multiline text.
        if (!this._scanline_maker!.canExtendCurrentScanline(line_height)) return false;
      }

      const span_fitted = this._measureUnbrokenSpan(
        para,
        new_span,
        last_span_at_break,
        last_span_at_emergency_break,
        new_chunk.scanrun_width - new_chunk.text_width,
      );

      new_chunk.text_width += new_span.width;
      new_chunk.whitespace_count += new_span.whitespace_count;
      new_chunk.broken_spans.push(new_span); // if !span_fitted we'll correct ourselves below

      if (!span_fitted) break;

      if (new_span.end.iter_span === para.unbroken_spans.length) {
        last_span_at_break.assign(new_span);
        break;
      }

      const char_attributes = this._charAttributes(para, new_span.end);
      if (char_attributes.is_mandatory_break) {
        last_span_at_break.assign(new_span);
        break;
      }
    }

    chunk_info.push(new_chunk);

    if (
      scanRunWidth(scan_run) >= 4.0 * line_height.emSize() &&
      last_span_at_break.end.equals(start_span_pos)
    ) {
      /* **non-SVG spec bit**: See bug #1191102
         If the user types a very long line with no spaces, the way the spec
         is written at the moment means that when the length of the text
         exceeds the available width of all remaining areas, the text is
         completely hidden. This condition alters that behaviour so that if
         the length of the line is greater than four times the line-height
         and there are no spaces, it'll be emergency-wrapped at the last
         character. */
      last_span_at_break.assign(last_span_at_emergency_break);
    }

    const back = () => chunk_info.at(-1)!;
    if (back().broken_spans.length && !last_span_at_break.end.equals(back().broken_spans.at(-1)!.end)) {
      // need to back out spans until we come to the one with the last break in it
      while (
        chunk_info.length &&
        last_span_at_break.start.iter_span !== back().broken_spans.at(-1)!.start.iter_span
      ) {
        back().text_width -= back().broken_spans.at(-1)!.width;
        back().whitespace_count -= back().broken_spans.at(-1)!.whitespace_count;
        back().broken_spans.pop();
        if (!back().broken_spans.length) chunk_info.pop();
      }
      if (chunk_info.length) {
        back().text_width -= back().broken_spans.at(-1)!.width;
        back().whitespace_count -= back().broken_spans.at(-1)!.whitespace_count;
        if (last_span_at_break.start.equals(last_span_at_break.end)) {
          back().broken_spans.pop(); // last break was at an existing boundary
          if (!back().broken_spans.length) chunk_info.pop();
        } else {
          back().broken_spans[back().broken_spans.length - 1] = last_span_at_break.copy();
          back().text_width += last_span_at_break.width;
          back().whitespace_count += last_span_at_break.whitespace_count;
        }
      }
    }

    // Recalculate line_box_height after backing out chunks
    Object.assign(line_height, line_height_saved);
    for (const it_chunk of chunk_info) {
      for (const broken_span of it_chunk.broken_spans) {
        const unbroken = para.unbroken_spans[broken_span.start.iter_span]!;
        const span_height = unbroken.line_height.copy();
        span_height.computeEffective(unbroken.line_height_multiplier);
        line_height.max(span_height);
      }
    }

    const last_chunk = chunk_info.at(-1);
    const last_span = last_chunk?.broken_spans.at(-1);
    if (last_chunk && last_span?.ends_with_whitespace) {
      // for justification we need to discard space occupied by the single whitespace at the end of the chunk
      last_span.ends_with_whitespace = false;
      last_span.width -= last_span.each_whitespace_width;
      last_span.whitespace_count--;
      last_chunk.text_width -= last_span.each_whitespace_width;
      last_chunk.whitespace_count--;
    }

    if (last_chunk && last_span) {
      // for justification we need to discard line-spacing and word-spacing at end of the chunk
      last_span.width -= last_span.letter_spacing;
      last_chunk.text_width -= last_span.letter_spacing;
    }

    return true;
  }

  /**
   * Estimate subcomponent positions within ligatures, so that letters merged
   * into a single glyph (ff ffi fi ij) can still be selected.
   */
  _estimateLigatureSubcomponents(
    characters: Character[],
    glyph: Glyph,
    positions: number,
    direction: number,
  ): void {
    if (positions <= 1) return;
    let index = 0;
    for (const character of characters) {
      if (character.char_attributes.is_cursor_position) {
        if (index > 0) character.x += (direction * (glyph.advance * index)) / positions;
        index++;
      }
    }
  }

  /** The management function to start the whole thing off. */
  calculate(): boolean {
    const flow = this._flow;
    if (!flow._input_stream.length) return false;
    if (!(flow._input_stream[0] instanceof InputStreamTextSource)) return false;

    flow._clearOutputObjects();

    this._block_progression = flow._blockProgression();
    if (
      this._block_progression === Direction.RIGHT_TO_LEFT ||
      this._block_progression === Direction.LEFT_TO_RIGHT
    ) {
      // Vertical text, CJK
      switch (flow._blockTextOrientation()) {
        case SPCSSTextOrientation.SP_CSS_TEXT_ORIENTATION_UPRIGHT:
          this._gravity = {
            base_gravity: PangoGravity.PANGO_GRAVITY_EAST,
            gravity_hint: PangoGravityHint.PANGO_GRAVITY_HINT_STRONG,
          };
          break;
        case SPCSSTextOrientation.SP_CSS_TEXT_ORIENTATION_SIDEWAYS:
          this._gravity = {
            base_gravity: PangoGravity.PANGO_GRAVITY_SOUTH,
            gravity_hint: PangoGravityHint.PANGO_GRAVITY_HINT_STRONG,
          };
          break;
        default:
          this._gravity = {
            base_gravity: PangoGravity.PANGO_GRAVITY_EAST,
            gravity_hint: PangoGravityHint.PANGO_GRAVITY_HINT_NATURAL,
          };
          break;
      }
    } else {
      // Horizontal text
      this._gravity = {
        base_gravity: PangoGravity.PANGO_GRAVITY_AUTO,
        gravity_hint: PangoGravityHint.PANGO_GRAVITY_HINT_NATURAL,
      };
    }

    // Minimum line box height determined by block container.
    const strut_height = flow.strut;
    this._y_offset = 0.0;
    this._createFirstScanlineMaker();

    const para: ParagraphInfo = {
      text: [],
      first_input_index: 0,
      direction: Direction.LEFT_TO_RIGHT,
      alignment: Alignment.LEFT,
      pango_items: [],
      char_attributes: [],
      unbroken_spans: [],
    };
    const line_box_height = new FontMetrics(); // Current value of line box height for line.
    let keep_going = true; // Set false if we ran out of space and had to stash overflow.
    for (para.first_input_index = 0; para.first_input_index < flow._input_stream.length; ) {
      // jump to the next wrap shape if this is a SHAPE_BREAK control code
      const first = flow._input_stream[para.first_input_index]!;
      if (first instanceof InputStreamControlCode && first.code === TextControlCode.SHAPE_BREAK) {
        this._goToNextWrapShape();
        para.first_input_index++;
        continue; // Go to next paragraph (paragraph only contained control code).
      }

      // Break things up into little pango units with unique direction, gravity, etc.
      this._buildPangoItemizationForPara(para);

      // Do shaping (convert characters to glyphs)
      const para_end_input_index = this._buildSpansForPara(para);

      if (first instanceof InputStreamTextSource) {
        para.alignment = first.styleGetAlignment(para.direction, flow._input_wrap_shapes.length > 0);
      } else {
        para.alignment = para.direction === Direction.LEFT_TO_RIGHT ? Alignment.LEFT : Alignment.RIGHT;
      }

      flow._paragraphs.push({ base_direction: para.direction, alignment: para.alignment });

      // start scanning lines
      const span_pos = new UnbrokenSpanPosition(0, 0, 0);

      do {
        // Until end of paragraph
        const line_chunk_info: ChunkInfo[] = [];

        // Fill line.
        // If we've run out of space, we've put the remaining text in a single line and
        // returned false. If we ran out of space on previous paragraph, we continue with
        // single-line scan-line maker.
        const flowed = this._findChunksForLine(
          para,
          span_pos,
          line_chunk_info,
          line_box_height,
          strut_height,
        );
        if (!flowed) keep_going = false;

        if (line_box_height.emSize() < 0.001 && !line_chunk_info.length) {
          // We need to avoid an infinite (or semi-infinite) loop.
          this._scanline_maker?.dispose();
          return false; // For the moment
        }

        // For Inkscape multi-line text (using role="line") we run into a problem if the first
        // line is empty - namely, there is no character to attach a 'y' attribute value. The
        // result is that the code that takes a baseline position (e.g. 'y') and finds the top
        // of the layout box is bypassed resulting in wrongly placed text (we layout the text
        // relative to the top of the box as this is required for text-in-a-shape). We don't
        // know how to find the top of the box from the 'y' position until we have found the
        // line height parameters for the given line (after calling _findChunksForLine() just
        // above).
        if (para.first_input_index === 0 && flow.wrap_mode === WrapMode.WRAP_NONE) {
          // Calculate new top of box... given specified baseline.
          let top_of_line_box = this._scanline_maker!.yCoordinate(); // Set in constructor.
          if (this._block_progression === Direction.RIGHT_TO_LEFT) {
            // Vertical text, use em box center as baseline
            top_of_line_box += 0.5 * line_box_height.emSize();
          } else if (this._block_progression === Direction.LEFT_TO_RIGHT) {
            // Vertical text, use em box center as baseline
            top_of_line_box -= 0.5 * line_box_height.emSize();
          } else {
            top_of_line_box -= line_box_height.getTypoAscent();
          }
          // Set the initial y coordinate of the for this line (see above).
          this._scanline_maker!.setNewYCoordinate(top_of_line_box);
        }

        // !keep_going --> truncated --> hidden
        this._outputLine(para, line_box_height, line_chunk_info, !keep_going);

        this._scanline_maker!.setLineHeight(line_box_height);
        this._scanline_maker!.completeLine(); // Increments y by line height
      } while (span_pos.iter_span !== para.unbroken_spans.length);

      if (keep_going) {
        // We have more to do, setup next section.
        const last_char = flow._characters.at(-1);
        const is_empty_para =
          !last_char || flow._charLine(last_char).in_paragraph !== flow._paragraphs.length - 1;
        if (
          (is_empty_para && para_end_input_index + 1 >= flow._input_stream.length) ||
          para_end_input_index + 1 < flow._input_stream.length
        ) {
          // we need a span just for the para if it's either an empty last para or a break in the middle
          let new_span: Span;
          if (!flow._spans.length) {
            new_span = {
              in_chunk: 0,
              font: null,
              font_size: line_box_height.emSize(),
              x_start: 0,
              x_end: 0.0,
              y_offset: 0,
              line_height: line_box_height.copy(),
              baseline_shift: 0,
              text_orientation: SPCSSTextOrientation.SP_CSS_TEXT_ORIENTATION_MIXED,
              direction: para.direction,
              block_progression: this._block_progression,
              in_input_stream_item: 0,
              input_stream_first_character: 0,
            };
          } else {
            new_span = { ...flow._spans.at(-1)! };
            if (flow._chunks[new_span.in_chunk]!.in_line !== flow._lines.length - 1) new_span.x_end = 0.0;
          }
          new_span.in_chunk = flow._chunks.length - 1;
          new_span.x_start = new_span.x_end;
          new_span.baseline_shift = 0.0;
          new_span.direction = para.direction;
          new_span.block_progression = this._block_progression;
          if (para_end_input_index === flow._input_stream.length) {
            new_span.in_input_stream_item = flow._input_stream.length - 1;
          } else new_span.in_input_stream_item = para_end_input_index;
          flow._spans.push(new_span);
        }
        if (para_end_input_index + 1 < flow._input_stream.length) {
          // we've got to add an invisible character between paragraphs so that we can position iterators
          // (and hence cursors) both before and after the paragraph break
          const attrs: PangoLogAttr = {
            is_line_break: true,
            is_mandatory_break: true,
            is_char_break: true,
            is_white: true,
            is_cursor_position: true,
            is_word_start: false,
            is_word_end: true,
            is_sentence_start: false,
            is_sentence_end: true,
            is_sentence_boundary: true,
            backspace_deletes_character: true,
            is_expandable_space: false,
            is_word_boundary: false,
          };
          flow._characters.push({
            the_char: '@',
            in_span: flow._spans.length - 1,
            char_attributes: attrs,
            x: flow._spans.at(-1)!.x_end - flow._spans.at(-1)!.x_start,
            in_glyph: -1,
          });
        }
      }
      flow._end_pos_attributes = para.char_attributes.at(-1)!;

      para.first_input_index = para_end_input_index + 1;
    } // Loop over paras

    this._scanline_maker?.dispose();
    this._scanline_maker = null;

    flow._input_truncated = !keep_going;

    if (flow.textLength._set) {
      // Calculate the adjustment needed to meet the textLength
      const actual_length = flow.getActualLength();
      const difference = flow.textLength.computed - actual_length;
      flow.textLengthMultiplier = (actual_length + difference) / actual_length;
      flow.textLengthIncrement =
        difference / (flow._characters.length === 1 ? 1 : flow._characters.length - 1);
    }

    return true;
  }
}

/** Convert the feature string of SPStyle.getFontFeatureString() to the HarfBuzz syntax ("liga 0" → "liga=0"). */
function pango_features(features: string): string {
  if (features === 'normal') return '';
  return features
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) =>
      f.replace(/^["']?([^"'\s]+)["']?\s+(on|off|\d+)$/, (_m, tag: string, v: string) => {
        const value = v === 'on' ? '1' : v === 'off' ? '0' : v;
        return `${tag}=${value}`;
      }),
    )
    .join(',');
}

/** The cursor shape of a layout without characters (upstream _calculateCursorShapeForEmpty). */
function calculateCursorShapeForEmpty(layout: Layout): void {
  layout._empty_cursor_shape = { position: new Point(0, 0), height: 0.0, rotation: 0.0 };
  const text_source = layout._input_stream[0];
  if (!(text_source instanceof InputStreamTextSource)) return;

  const font = text_source.styleGetFontInstance();
  const font_size = text_source.style.font_size.computed;
  const { run: caret_slope_run, rise: caret_slope_rise } = font.FontSlope();
  const line_height = new FontMetrics();
  line_height.set(font);
  line_height.scale(font_size);

  const caret_slope = Math.atan2(caret_slope_run, caret_slope_rise);
  layout._empty_cursor_shape.height = font_size / Math.cos(caret_slope);
  layout._empty_cursor_shape.rotation = caret_slope;

  const first = (list: SVGLength[]) => (list.length && list[0]!._set ? list[0]!.computed : 0.0);
  if (!layout._input_wrap_shapes.length) {
    layout._empty_cursor_shape.position = new Point(first(text_source.x), first(text_source.y));
  } else if (layout.wrap_mode === WrapMode.WRAP_INLINE_SIZE) {
    // 'inline-size' has a wrap shape of an "infinite" rectangle, we need the place where the text should begin.
    layout._empty_cursor_shape.position = new Point(
      text_source.x.length ? text_source.x[0]!.computed : 0,
      text_source.y.length ? text_source.y[0]!.computed : 0,
    );
  } else {
    const block_progression = text_source.styleGetBlockProgression();
    const scanline_maker = new ShapeScanlineMaker(layout._input_wrap_shapes[0]!.shape, block_progression);
    const scan_runs = scanline_maker.makeScanline(line_height);
    scanline_maker.dispose();
    const run = scan_runs[0];
    if (run) {
      if (block_progression === Direction.LEFT_TO_RIGHT || block_progression === Direction.RIGHT_TO_LEFT) {
        // Vertical text
        layout._empty_cursor_shape.position = new Point(run.y + font_size, run.x_start);
      } else {
        // Horizontal text
        layout._empty_cursor_shape.position = new Point(run.x_start, run.y + font_size);
      }
    }
  }
}

/** Upstream Layout::calculateFlow(). */
export function calculateFlow(layout: Layout): boolean {
  const calc = new Calculator(layout);
  let result = calc.calculate();

  if (layout.textLengthIncrement !== 0) {
    // Recalculating layout the second time to fit textLength!
    result = calc.calculate();
  }

  if (!layout._characters.length) calculateCursorShapeForEmpty(layout);

  layout._calculateBaselines();
  return result;
}
