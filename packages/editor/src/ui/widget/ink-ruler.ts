// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/widget/ink-ruler.cpp, src/ui/widget/ink-ruler.h, share/ui/units.xml
/*
 * Ruler widget. Indicates horizontal or vertical position of a cursor in a specified widget.
 *
 * Copyright (C) 2019 Tavmjong Bah
 *               2022 Martin Owens
 *
 * Rewrite of the 'C' ruler code which came originally from Gimp.
 */

/** Ruler metrics (upstream share/ui/units.xml): major tick scales and subdivisions. */
interface RulerMetric {
  ruler_scale: readonly number[];
  subdivide: readonly number[];
}

/** Ruler metrics for most scales. */
const GENERAL: RulerMetric = {
  ruler_scale: [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000],
  subdivide: [1, 5, 10, 50, 100],
};
/** Ruler metrics for inch scales. */
const DYADIC: RulerMetric = {
  ruler_scale: [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768],
  subdivide: [1, 2, 4, 8, 16],
};

/** Thickness of a ruler in px. */
export const RULER_SIZE = 20;
const FONT_SIZE = 9;

/**
 * A horizontal or vertical ruler: tick marks and numbers in the display unit
 * for the range lower..upper (the values at both ends), the page as a light
 * band and a marker at the pointer position.
 * TODO: the selection bar, the context menu, the theme colors.
 */
export class Ruler {
  readonly element: HTMLCanvasElement;
  readonly #horizontal: boolean;
  #lower = 0;
  #upper = 1;
  #page_lower = 0;
  #page_upper = 0;
  #position = Number.NaN;
  #unit = 'px';
  #frame = 0;

  constructor(doc: Document, horizontal: boolean) {
    this.#horizontal = horizontal;
    this.element = doc.createElement('canvas');
    this.element.className = horizontal ? 'ink-ruler horz' : 'ink-ruler vert';
    Object.assign(this.element.style, { display: 'block', width: '100%', height: '100%', cursor: 'default' });
  }

  /** The display unit abbreviation (selects the metric: dyadic for inches). */
  set_unit(unit: string): void {
    if (this.#unit === unit) return;
    this.#unit = unit;
    this.#queueDraw();
  }

  /** The values (in the display unit) at the start and the end of the ruler. */
  set_range(lower: number, upper: number): void {
    if (this.#lower === lower && this.#upper === upper) return;
    this.#lower = lower;
    this.#upper = upper;
    this.#queueDraw();
  }

  /** The page interval, in px along the ruler. */
  set_page(lower: number, upper: number): void {
    if (this.#page_lower === lower && this.#page_upper === upper) return;
    this.#page_lower = lower;
    this.#page_upper = upper;
    this.#queueDraw();
  }

  /** The pointer position in px along the ruler (NaN hides the marker). */
  set_position(position: number): void {
    if (this.#position === position) return;
    this.#position = position;
    this.#queueDraw();
  }

  /** Draw now (normally drawing happens once per frame). */
  draw(): void {
    this.#frame = 0;
    const canvas = this.element;
    const ctx = canvas.getContext?.('2d');
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!ctx || !w || !h) return;
    const scale = globalThis.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * scale) || canvas.height !== Math.round(h * scale)) {
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
    }
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    // aparallel is the longer dimension of the ruler; aperp shorter.
    const [aparallel, aperp] = this.#horizontal ? [w, h] : [h, w];
    // Draw the vertical ruler as a horizontal one, with the axes swapped.
    if (!this.#horizontal) ctx.setTransform(0, scale, scale, 0, 0, 0);
    ctx.fillStyle = '#f4f4f4';
    ctx.fillRect(0, 0, aparallel, aperp);
    // Color in page indication box
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(this.#page_lower, 0, this.#page_upper - this.#page_lower, aperp);
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, aperp - 0.5);
    ctx.lineTo(aparallel, aperp - 0.5);
    ctx.stroke();

    const max_size = this.#upper - this.#lower;
    const abs_size = Math.abs(max_size) || 1;
    const sign = max_size >= 0 ? 1 : -1;
    // Figure out scale. Largest ticks must be far enough apart to fit largest text in vertical ruler.
    // We actually require twice the distance.
    const digits = String(Math.ceil(abs_size)).length + 1; // Add one for negative sign.
    const minimum = digits * FONT_SIZE * 2;
    const pixels_per_unit = aparallel / abs_size;
    const metric = this.#unit === 'in' ? DYADIC : GENERAL;
    let scale_index = 0;
    for (; scale_index < metric.ruler_scale.length - 1; ++scale_index) {
      if ((metric.ruler_scale[scale_index] as number) * pixels_per_unit > minimum) break;
    }
    const units_per_major = metric.ruler_scale[scale_index] as number;
    // Now we find out what is the subdivide index for the closest ticks we can draw
    let divide_index = 0;
    for (; divide_index < metric.subdivide.length - 1; ++divide_index) {
      if (units_per_major * pixels_per_unit < 5 * (metric.subdivide[divide_index + 1] as number)) break;
    }
    const subdivisions = metric.subdivide[divide_index] as number;
    const pixels_per_major = pixels_per_unit * units_per_major;
    const pixels_per_tick = pixels_per_major / subdivisions;

    ctx.fillStyle = '#333';
    ctx.strokeStyle = '#333';
    ctx.font = `${FONT_SIZE}px sans-serif`;
    ctx.textBaseline = 'top';
    ctx.beginPath();
    // The first major tick at or before the start of the ruler.
    const first_major = Math.floor((sign * this.#lower) / units_per_major) * units_per_major;
    const start = ((first_major - sign * this.#lower) / (sign * units_per_major)) * pixels_per_major * sign;
    for (let n = 0; ; n++) {
      const major_pos = start + n * pixels_per_major;
      if (major_pos > aparallel) break;
      for (let i = 0; i < subdivisions; i++) {
        const pos = Math.round(major_pos + i * pixels_per_tick) + 0.5;
        if (pos < 0 || pos > aparallel) continue;
        // Major ticks are full length, minor ones a quarter or half.
        const len =
          i === 0 ? aperp : subdivisions % 2 === 0 && i === subdivisions / 2 ? aperp / 2 : aperp / 4;
        ctx.moveTo(pos, aperp);
        ctx.lineTo(pos, aperp - len);
      }
      const value = first_major + sign * n * units_per_major;
      this.#label(ctx, String(Math.round(value * 1000) / 1000), Math.round(major_pos) + 3, scale);
    }
    ctx.stroke();

    // Draw a pointer marker
    if (!Number.isNaN(this.#position)) {
      const p = Math.round(this.#position) + 0.5;
      ctx.strokeStyle = '#d00';
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, aperp);
      ctx.stroke();
    }
  }

  /** A number label next to a major tick; along the ruler, also on the vertical ruler. */
  #label(ctx: CanvasRenderingContext2D, text: string, pos: number, scale: number): void {
    if (this.#horizontal) {
      ctx.fillText(text, pos, 1);
      return;
    }
    // Vertical ruler: the text reads from bottom to top, below the tick.
    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.translate(1, pos - 3);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'right';
    ctx.fillText(text, -2, 0);
    ctx.restore();
  }

  #queueDraw(): void {
    if (this.#frame || typeof requestAnimationFrame === 'undefined') return;
    this.#frame = requestAnimationFrame(() => this.draw());
  }
}
