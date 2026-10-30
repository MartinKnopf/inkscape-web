// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/trace/potrace/inkscape-potrace.cpp, src/trace/imagemap-gdk.cpp
import { PathVector } from '@inkscape-web/geom';
import { loadGeom } from '@inkscape-web/wasm';
import { describe, expect, it } from 'vitest';
import { gdkPixbufToGrayMap, gdkPixbufToRgbMap, type RgbaImage } from '../imagemap-gdk.ts';
import { setTraceBackend } from '../trace-backend.ts';
import { PotraceTracingEngine, TraceType } from './inkscape-potrace.ts';

setTraceBackend(await loadGeom());

/** A 40 x 40 image: white, with a color square from 10 to 30 and a second color on the right half of it. */
function image(left: [number, number, number], right = left): RgbaImage {
  const w = 40;
  const data = new Uint8ClampedArray(4 * w * w).fill(255);
  for (let y = 10; y < 30; y++) {
    for (let x = 10; x < 30; x++) data.set([...(x < 20 ? left : right), 255], 4 * (x + y * w));
  }
  return { width: w, height: w, data };
}

const bounds = (pv: PathVector) => {
  const b = PathVector.boundsExact(pv);
  return b && [b.left(), b.top(), b.right(), b.bottom()];
};

describe('PotraceTracingEngine', () => {
  it('brightness cutoff traces the dark pixels as one black path', () => {
    const results = new PotraceTracingEngine().trace(image([0, 0, 0]));
    expect(results).toHaveLength(1);
    expect(results[0]?.style).toBe('fill:#000000');
    expect(bounds(results[0]?.path ?? [])).toEqual([10, 10, 30, 30]);
  });

  it('invert traces the light pixels: the square is a hole in the outline of the image', () => {
    const engine = new PotraceTracingEngine(TraceType.BRIGHTNESS, true);
    const pv = engine.trace(image([0, 0, 0]))[0]?.path ?? [];
    expect(bounds(pv)).toEqual([0, 0, 40, 40]);
    expect(pv).toHaveLength(2);
  });

  it('edge detection traces the edges of the square', () => {
    const engine = new PotraceTracingEngine(TraceType.CANNY);
    const pv = engine.trace(image([0, 0, 0]))[0]?.path ?? [];
    expect(pv.length).toBeGreaterThan(0);
    const b = PathVector.boundsExact(pv);
    expect(b?.left()).toBeGreaterThanOrEqual(8);
    expect(b?.right()).toBeLessThanOrEqual(32);
  });

  it('color quantization traces each color as a path of that color', () => {
    const engine = new PotraceTracingEngine(TraceType.QUANT_COLOR, false, 8, 0.45, 0, 0.65, 3, false);
    const results = engine.trace(image([255, 0, 0], [0, 0, 255]));
    // Opaque pixels lose 1 (upstream gdkPixbufToRgbMap: p * alpha / 256).
    expect(results.map((r) => r.style).sort()).toEqual(['fill:#0000fe', 'fill:#fe0000', 'fill:#fefefe']);
    const red = results.find((r) => r.style === 'fill:#fe0000');
    expect(bounds(red?.path ?? [])).toEqual([10, 10, 20, 30]);
  });

  it('brightness steps make gray scans; remove background drops the last one', () => {
    const engine = new PotraceTracingEngine(TraceType.BRIGHTNESS_MULTI, false, 8, 0.45, 0, 0.65, 3, true);
    engine.multiScanRemoveBackground = false;
    const all = engine.trace(image([0, 0, 0], [128, 128, 128]));
    // Cutoffs 0.2, 0.2 + 0.7/3, 0.2 + 1.4/3 of the brightness: the gray is 256 times the cutoff.
    expect(all.map((r) => r.style)).toEqual([
      'fill-opacity:1.0;fill:#333333',
      'fill-opacity:1.0;fill:#6e6e6e',
      'fill-opacity:1.0;fill:#aaaaaa',
    ]);
    engine.multiScanRemoveBackground = true;
    expect(engine.trace(image([0, 0, 0], [128, 128, 128]))).toHaveLength(2);
  });

  it('the preview shows the filtered image', () => {
    const p = new PotraceTracingEngine().preview(image([0, 0, 0]));
    expect([p?.width, p?.height]).toEqual([40, 40]);
    expect([...(p?.data.slice(0, 4) ?? [])]).toEqual([255, 255, 255, 255]);
    expect(p?.data[4 * (15 + 15 * 40)]).toBe(0);
  });

  it('speckles: spots smaller than turdsize are dropped', () => {
    const img = image([255, 255, 255]);
    img.data.set([0, 0, 0, 255], 4 * (5 + 5 * 40));
    const engine = new PotraceTracingEngine();
    expect(engine.trace(img)[0]?.path).toHaveLength(0);
    engine.setTurdSize(0);
    expect(engine.trace(img)[0]?.path).toHaveLength(1);
  });
});

describe('imagemap-gdk', () => {
  it('transparent pixels are white', () => {
    const img: RgbaImage = { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 0]) };
    expect(gdkPixbufToGrayMap(img).getPixel(0, 0)).toBe(765);
    expect(gdkPixbufToRgbMap(img).getPixel(0, 0)).toEqual({ r: 255, g: 255, b: 255 });
  });
});
