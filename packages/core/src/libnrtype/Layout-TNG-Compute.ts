// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/libnrtype/Layout-TNG-Compute.cpp interim: a simple line layout, not a port (see docs/PLAN.md)
/*
 * Inkscape::Text::Layout::Calculator - text layout engine meaty bits
 *
 * Authors:
 *   Richard Hughes <cyreve@users.sf.net>
 *
 * Copyright (C) 2005 Richard Hughes
 */
import { Point, type Rect } from '@inkscape-web/geom';
import type { SPStyle } from '../style.ts';
import { SPCSSTextAlign, SPTextAnchor } from '../style-enums.ts';
import { SPCSSUnit } from '../style-internal.ts';
import {
  Alignment,
  type Character,
  FontMetrics,
  InputStreamItemType,
  type InputStreamTextSource,
  isWordChar,
  type Layout,
  type Line,
  type Span,
  TextControlCode,
  WrapMode,
} from './Layout-TNG.ts';
import { type FontDescription, getTextMeasurer, type InkBox, ink_font_from_style } from './text-measurer.ts';

/** A character of a paragraph with its measurements and attributes. */
interface GlyphInfo {
  item: number;
  /** Index of the code point in the item. */
  ci: number;
  ch: string;
  advance: number;
  ink: InkBox | null;
  x: number | null;
  y: number | null;
  dx: number;
  dy: number;
  /** Degrees. */
  rotate: number;
  spacing: number;
  is_white: boolean;
  /** A preserved '\n' that ends the line. */
  is_newline: boolean;
}

interface ItemInfo {
  font: FontDescription;
  /** Font metrics scaled by the font size, without leading. */
  metrics: FontMetrics;
  line_height: number;
  style: SPStyle;
}

interface Paragraph {
  items: number[];
  /** The input index of the break that ends the paragraph, or null for the last one. */
  break_item: number | null;
}

/**
 * Compute the output of flow from its input (upstream Layout::calculateFlow).
 *
 * Interim algorithm, until the HarfBuzz port of Layout-TNG: each code point
 * is a glyph with the advance from the TextMeasurer; paragraphs (the
 * PARAGRAPH_BREAK control codes and preserved newlines) start new lines;
 * with a wrap frame, lines break greedily at white space. Line spacing
 * follows upstream: the line box is the larger of the strut and the spans,
 * each with half-leading from line-height. Chunks start at absolute x
 * attributes and are aligned with text-anchor (or text-align in a frame).
 */
export function calculateFlow(flow: Layout): boolean {
  flow._clearOutputObjects();
  const input = flow._input_stream;
  if (!input.length) return false;
  const measurer = getTextMeasurer();

  const itemInfo = new Map<number, ItemInfo>();
  const infoOf = (index: number): ItemInfo | null => {
    const item = input[index];
    if (!item) return null;
    const style = item.type === InputStreamItemType.TEXT_SOURCE ? item.style : item.source.style;
    let info = itemInfo.get(index);
    if (!info) {
      const font = ink_font_from_style(style);
      const metrics = new FontMetrics();
      metrics.set(measurer.fontMetrics(font), font.size);
      metrics.scale(font.size);
      info = { font, metrics, line_height: computeFontLineHeight(style), style };
      itemInfo.set(index, info);
    }
    return info;
  };

  // Split the input into paragraphs.
  const paragraphs: Paragraph[] = [{ items: [], break_item: null }];
  input.forEach((item, i) => {
    if (item.type === InputStreamItemType.CONTROL_CODE) {
      if (item.code === TextControlCode.PARAGRAPH_BREAK || item.code === TextControlCode.SHAPE_BREAK) {
        paragraphs.at(-1)!.break_item = i;
        paragraphs.push({ items: [], break_item: null });
      }
    } else {
      paragraphs.at(-1)!.items.push(i);
    }
  });

  const frame: Rect | null =
    flow.wrap_mode === WrapMode.WRAP_SHAPE_INSIDE || flow.wrap_mode === WrapMode.WRAP_INLINE_SIZE
      ? (flow._input_wrap_shapes[0] ?? null)
      : null;
  const wrap_width = frame ? frame.width() : null;
  const in_frame = frame !== null;

  // The start position: the first x and y attributes.
  const firstText = input.find((i): i is InputStreamTextSource => i.type === InputStreamItemType.TEXT_SOURCE);
  const x0 = frame ? frame.left() : (firstText?.x[0]?.computed ?? 0);
  const y0 = firstText?.y[0]?.computed ?? 0;

  const strut = flow.strut.copy();
  let prev_line: Line | null = null;

  for (let para_index = 0; para_index < paragraphs.length; para_index++) {
    const para = paragraphs[para_index]!;
    const glyphs = paragraphGlyphs(flow, para, infoOf);
    const alignment = paragraphAlignment(
      infoOf(para.items[0] ?? para.break_item ?? 0)?.style ?? null,
      in_frame,
    );

    for (const range of breakLines(glyphs, wrap_width)) {
      const line_glyphs = glyphs.slice(range.start, range.end);
      const line_index = flow._lines.length;

      // Line box: the strut and the spans, with half-leading.
      const box = strut.copy();
      const line_items = new Set(line_glyphs.map((g) => g.item));
      const metric_items = line_items.size ? [...line_items] : emptyLineItems(para, glyphs);
      for (const i of metric_items) {
        const info = infoOf(i);
        if (!info) continue;
        const m = info.metrics.copy();
        m.computeEffective(info.line_height);
        box.max(m);
      }

      // Baseline.
      let baseline: number;
      const first = line_glyphs[0];
      if (first?.y !== null && first?.y !== undefined) baseline = first.y;
      else if (prev_line) baseline = prev_line.baseline_y + prev_line.descent + box.ascent;
      else if (frame && flow.wrap_mode === WrapMode.WRAP_SHAPE_INSIDE) baseline = frame.top() + box.ascent;
      else baseline = y0;

      const line: Line = {
        baseline_y: baseline,
        ascent: box.ascent,
        descent: box.descent,
        in_paragraph: para_index,
        in_shape: 0,
        first_chunk: flow._chunks.length,
        first_span: flow._spans.length,
        hidden:
          !!frame && flow.wrap_mode === WrapMode.WRAP_SHAPE_INSIDE && baseline + box.descent > frame.bottom(),
      };
      if (line.hidden) flow._input_truncated = true;
      flow._lines.push(line);

      layoutLine(flow, line, line_index, line_glyphs, {
        start_x: first?.x ?? x0,
        frame,
        alignment,
        infoOf,
        metric_items,
        break_item: range.end === glyphs.length && !range.forced ? para.break_item : null,
      });
      prev_line = line;
    }
  }

  // Word boundaries and white space.
  const chars = flow._characters;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    const word = isWordChar(c);
    const prev_word = i > 0 && isWordChar(chars[i - 1]!);
    c.is_word_start = word && !prev_word;
    c.is_word_end = !word && prev_word;
  }

  if (!chars.length) {
    const line = flow._lines[0];
    const span = line ? flow._spans[line.first_span] : undefined;
    if (span) {
      flow._empty_cursor_shape = {
        position: flow.chunkAnchorPoint(flow.begin()).add(new Point(0, span.descent)),
        height: span.ascent + span.descent,
        rotation: 0,
      };
    }
  }
  return true;
}

/** line-height as a multiple of the font size (upstream _computeFontLineHeight). */
export function computeFontLineHeight(style: SPStyle): number {
  const lh = style.line_height;
  if (lh.normal) return 1.25;
  if (lh.unit === SPCSSUnit.SP_CSS_UNIT_NONE) return lh.computed;
  const size = style.font_size.computed;
  return size > 0 ? lh.computed / size : 1.25;
}

/** The paragraph alignment: text-anchor for SVG 1.1 text, text-align in a frame. */
function paragraphAlignment(style: SPStyle | null, in_frame: boolean): Alignment {
  if (!style) return Alignment.LEFT;
  if (in_frame) {
    switch (style.text_align.computed) {
      case SPCSSTextAlign.SP_CSS_TEXT_ALIGN_CENTER:
        return Alignment.CENTER;
      case SPCSSTextAlign.SP_CSS_TEXT_ALIGN_END:
      case SPCSSTextAlign.SP_CSS_TEXT_ALIGN_RIGHT:
        return Alignment.RIGHT;
      default:
        return Alignment.LEFT; // TODO: justify
    }
  }
  switch (style.text_anchor.computed) {
    case SPTextAnchor.SP_CSS_TEXT_ANCHOR_MIDDLE:
      return Alignment.CENTER;
    case SPTextAnchor.SP_CSS_TEXT_ANCHOR_END:
      return Alignment.RIGHT;
    default:
      return Alignment.LEFT;
  }
}

/** The measured characters of a paragraph. */
function paragraphGlyphs(flow: Layout, para: Paragraph, infoOf: (i: number) => ItemInfo | null): GlyphInfo[] {
  const measurer = getTextMeasurer();
  const glyphs: GlyphInfo[] = [];
  for (const index of para.items) {
    const item = flow._input_stream[index] as InputStreamTextSource;
    const info = infoOf(index)!;
    const letter = info.style.letter_spacing.normal ? 0 : info.style.letter_spacing.computed;
    const word = info.style.word_spacing.normal ? 0 : info.style.word_spacing.computed;
    item.chars.forEach((ch, ci) => {
      const is_newline = ch === '\n';
      const is_white = /\s/u.test(ch);
      glyphs.push({
        item: index,
        ci,
        ch,
        advance: is_newline ? 0 : measurer.advance(ch, info.font),
        ink: is_newline ? null : measurer.inkBox(ch, info.font),
        x: item.x[ci]?._set ? item.x[ci]!.computed : null,
        y: item.y[ci]?._set ? item.y[ci]!.computed : null,
        dx: item.dx[ci]?.computed ?? 0,
        dy: item.dy[ci]?.computed ?? 0,
        rotate: item.rotate[ci]?.computed ?? 0,
        spacing: is_newline ? 0 : letter + (is_white ? word : 0),
        is_white,
        is_newline,
      });
    });
  }
  return glyphs;
}

/** The items that give the metrics of an empty line: the empty spans of the paragraph, else its break. */
function emptyLineItems(para: Paragraph, glyphs: GlyphInfo[]): number[] {
  if (glyphs.length) return [glyphs.at(-1)!.item];
  if (para.items.length) return [para.items[0]!];
  return para.break_item !== null ? [para.break_item] : [];
}

/**
 * Split the glyphs of a paragraph into lines: at preserved newlines and,
 * with a wrap width, greedily after white space (a long word breaks anywhere).
 * Every paragraph has at least one (possibly empty) line.
 */
function breakLines(
  glyphs: GlyphInfo[],
  wrap_width: number | null,
): { start: number; end: number; forced: boolean }[] {
  const lines: { start: number; end: number; forced: boolean }[] = [];
  let start = 0;
  let width = 0;
  let last_break = -1;
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i]!;
    if (g.is_newline) {
      lines.push({ start, end: i + 1, forced: true });
      start = i + 1;
      width = 0;
      last_break = -1;
      continue;
    }
    const w = g.advance + g.spacing;
    if (wrap_width !== null && !g.is_white && width + w > wrap_width && i > start) {
      const end = last_break >= start ? last_break + 1 : i;
      lines.push({ start, end, forced: false });
      start = end;
      width = 0;
      for (let j = start; j < i; j++) width += glyphs[j]!.advance + glyphs[j]!.spacing;
      last_break = -1;
    }
    width += w;
    if (g.is_white) last_break = i;
  }
  lines.push({ start, end: glyphs.length, forced: false });
  return lines;
}

interface LineContext {
  start_x: number;
  frame: Rect | null;
  alignment: Alignment;
  infoOf: (i: number) => ItemInfo | null;
  metric_items: number[];
  /** The paragraph break after this line, if it is the last line of the paragraph. */
  break_item: number | null;
}

/** Place the characters of a line and create its chunks and spans. */
function layoutLine(
  flow: Layout,
  line: Line,
  line_index: number,
  glyphs: GlyphInfo[],
  ctx: LineContext,
): void {
  const first_char = flow._characters.length;
  // Chunks: [first glyph index, anchor x].
  const chunks: { start: number; anchor: number }[] = [{ start: 0, anchor: ctx.start_x }];
  let pen_x = ctx.start_x;
  let pen_y = line.baseline_y;
  const placed: { g: GlyphInfo; x: number; y: number; chunk: number }[] = [];
  glyphs.forEach((g, i) => {
    if (g.x !== null && i > 0) {
      chunks.push({ start: i, anchor: g.x });
      pen_x = g.x;
    }
    if (g.y !== null) pen_y = g.y;
    pen_x += g.dx;
    pen_y += g.dy;
    placed.push({ g, x: pen_x, y: pen_y, chunk: chunks.length - 1 });
    pen_x += g.advance + g.spacing;
  });

  // Align the chunks.
  const shifts: number[] = [];
  chunks.forEach((chunk, ci) => {
    const members = placed.filter((p) => p.chunk === ci);
    // Trailing white space hangs at the end of wrapped lines.
    let last = members.length - 1;
    if (ctx.frame) while (last >= 0 && (members[last]!.g.is_white || members[last]!.g.is_newline)) last--;
    const end = last >= 0 ? members[last]!.x + members[last]!.g.advance : chunk.anchor;
    const width = Math.max(0, end - chunk.anchor);
    let left_x = chunk.anchor;
    if (ctx.frame) {
      const free = ctx.frame.width() - width;
      if (ctx.alignment === Alignment.CENTER) left_x = ctx.frame.left() + free / 2;
      else if (ctx.alignment === Alignment.RIGHT) left_x = ctx.frame.left() + free;
    } else if (ctx.alignment === Alignment.CENTER) left_x -= width / 2;
    else if (ctx.alignment === Alignment.RIGHT) left_x -= width;
    shifts.push(left_x - chunk.anchor);
    flow._chunks.push({ in_line: line_index, left_x, width, alignment: ctx.alignment });
  });

  // Characters and spans.
  let span: Span | null = null;
  for (const p of placed) {
    const chunk_index = line.first_chunk + p.chunk;
    if (!span || span.in_input_stream_item !== p.g.item || span.in_chunk !== chunk_index) {
      span = newSpan(flow, ctx.infoOf, p.g.item, chunk_index, line_index, p.x + shifts[p.chunk]!);
    }
    const x = p.x + shifts[p.chunk]!;
    const item = flow._input_stream[p.g.item] as InputStreamTextSource;
    const c: Character = {
      the_char: p.g.ch,
      in_span: flow._spans.length - 1,
      in_line: line_index,
      x,
      y: p.y,
      advance: p.g.advance,
      rotation: (p.g.rotate * Math.PI) / 180,
      text_offset: item.offsets[p.g.ci]!,
      is_break: p.g.is_newline,
      is_white: p.g.is_white,
      is_word_start: false,
      is_word_end: false,
      ink: p.g.ink,
    };
    flow._characters.push(c);
    span.x_end = x + c.advance;
  }

  const last_chunk = flow._chunks.at(-1)!;
  const end_x = span ? span.x_end : last_chunk.left_x;
  if (flow._characters.length === first_char) {
    // An empty line: a span for its metrics.
    const item = ctx.metric_items[0];
    if (item !== undefined) newSpan(flow, ctx.infoOf, item, flow._chunks.length - 1, line_index, end_x);
    else if (flow._spans.length) flow._spans.push({ ...flow._spans.at(-1)!, in_line: line_index });
  }
  if (ctx.break_item !== null) {
    // The paragraph break is a character without glyph at the end of the line.
    newSpan(flow, ctx.infoOf, ctx.break_item, flow._chunks.length - 1, line_index, end_x);
    flow._characters.push({
      the_char: '\n',
      in_span: flow._spans.length - 1,
      in_line: line_index,
      x: end_x,
      y: pen_y,
      advance: 0,
      rotation: 0,
      text_offset: -1,
      is_break: true,
      is_white: true,
      is_word_start: false,
      is_word_end: false,
      ink: null,
    });
  }
}

function newSpan(
  flow: Layout,
  infoOf: (i: number) => ItemInfo | null,
  item: number,
  in_chunk: number,
  in_line: number,
  x: number,
): Span {
  const info = infoOf(item);
  const span: Span = {
    in_input_stream_item: item,
    in_chunk,
    in_line,
    x_start: x,
    x_end: x,
    ascent: info?.metrics.ascent ?? 0.8,
    descent: info?.metrics.descent ?? 0.2,
    font: info?.font ?? null,
    style: info?.style ?? null,
  };
  flow._spans.push(span);
  return span;
}
