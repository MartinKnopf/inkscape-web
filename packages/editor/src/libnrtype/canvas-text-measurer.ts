// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/libnrtype/font-instance.cpp interim: metrics from Canvas 2D measureText instead of FreeType
/*
 * Authors:
 *   fred
 *   bulia byak <buliabyak@users.sf.net>
 *
 * Copyright (C) 2018 Authors
 */
import { type FontDescription, type InkBox, setTextMeasurer, type TextMeasurer } from '@inkscape-web/core';

/** Fonts are measured at this size, the results are scaled (the browser's text metrics scale linearly). */
const REFERENCE_SIZE = 100;

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** The CSS font shorthand of font at the reference size. */
function cssFont(font: FontDescription): string {
  const variant = font.variant === 'small-caps' ? 'small-caps' : 'normal';
  return `${font.style} ${variant} ${font.weight} ${font.stretch} ${REFERENCE_SIZE}px ${font.family}`;
}

/**
 * Measures text with the browser's font engine (Canvas 2D measureText), the
 * same engine that draws the svg:text of the drawing. Results are cached per
 * font and cluster.
 */
export class CanvasTextMeasurer implements TextMeasurer {
  readonly #ctx: Context2D;
  #current = '';
  readonly #advances = new Map<string, number>();
  readonly #ink = new Map<string, InkBox>();
  readonly #metrics = new Map<string, { ascent: number; descent: number; xheight: number }>();

  constructor(ctx: Context2D) {
    this.#ctx = ctx;
  }

  /** A measurer on an OffscreenCanvas (or a canvas element), or null without Canvas 2D. */
  static create(
    doc: Document | null = typeof document === 'undefined' ? null : document,
  ): CanvasTextMeasurer | null {
    try {
      const ctx =
        typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(1, 1).getContext('2d')
          : (doc?.createElement('canvas').getContext('2d') ?? null);
      // happy-dom and other DOMs without rendering have no measureText.
      if (!ctx || typeof ctx.measureText !== 'function') return null;
      return new CanvasTextMeasurer(ctx);
    } catch {
      return null;
    }
  }

  #measure(text: string, font: FontDescription): TextMetrics {
    const css = cssFont(font);
    if (css !== this.#current) {
      this.#ctx.font = css;
      this.#current = css;
    }
    return this.#ctx.measureText(text);
  }

  fontMetrics(font: FontDescription): { ascent: number; descent: number; xheight: number } {
    const key = cssFont(font);
    let m = this.#metrics.get(key);
    if (!m) {
      const t = this.#measure('x', font);
      m = {
        ascent: t.fontBoundingBoxAscent ?? 0.8 * REFERENCE_SIZE,
        descent: t.fontBoundingBoxDescent ?? 0.2 * REFERENCE_SIZE,
        xheight: t.actualBoundingBoxAscent,
      };
      this.#metrics.set(key, m);
    }
    const s = font.size / REFERENCE_SIZE;
    return { ascent: m.ascent * s, descent: m.descent * s, xheight: m.xheight * s };
  }

  advance(text: string, font: FontDescription): number {
    const key = `${cssFont(font)}\u0000${text}`;
    let w = this.#advances.get(key);
    if (w === undefined) {
      w = this.#measure(text, font).width;
      this.#advances.set(key, w);
    }
    return (w * font.size) / REFERENCE_SIZE;
  }

  inkBox(text: string, font: FontDescription): InkBox | null {
    const key = `${cssFont(font)}\u0000${text}`;
    let box = this.#ink.get(key);
    if (!box) {
      const t = this.#measure(text, font);
      box = {
        left: -t.actualBoundingBoxLeft,
        right: t.actualBoundingBoxRight,
        ascent: t.actualBoundingBoxAscent,
        descent: t.actualBoundingBoxDescent,
      };
      this.#ink.set(key, box);
    }
    const s = font.size / REFERENCE_SIZE;
    return { left: box.left * s, right: box.right * s, ascent: box.ascent * s, descent: box.descent * s };
  }
}

let installed = false;

/**
 * Let the text layout measure with the browser's fonts. Call it before
 * documents are loaded; it does nothing without Canvas 2D (tests keep the
 * fixed-width measurer of the core).
 */
export function installCanvasTextMeasurer(): void {
  if (installed) return;
  const m = CanvasTextMeasurer.create();
  if (m) setTextMeasurer(m);
  installed = true;
}
