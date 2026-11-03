// SPDX-License-Identifier: GPL-2.0-or-later
// The upstream C/C++ that Trace Bitmap and the paint bucket run in WASM: potrace, the filters
// of src/trace/filterset.cpp, the color quantization of src/trace/quantize.cpp and the
// livarot part of the paint bucket. `Trace` of @inkscape-web/wasm implements it.
//
// The core has no dependency on the WASM module: the app (or a test) loads it and passes it to
// setTraceBackend() once at startup. Then all calls are synchronous.
import { GrayMap, IndexedMap, RgbMap } from './imagemap.ts';

/** A node of the potrace path tree: segment tags, 6 numbers per segment, child paths. */
export interface PotracePath {
  tags: number[];
  c: number[];
  children: PotracePath[];
}

export interface TraceBackend {
  potraceTrace(
    bits: Uint8Array,
    width: number,
    height: number,
    params: { turdsize: number; alphamax: number; opticurve: boolean; opttolerance: number },
  ): PotracePath[] | null;
  rgbMapQuantize(
    rgb: Uint8Array,
    width: number,
    height: number,
    nrColors: number,
  ): { pixels: Uint32Array; clut: number[]; nrColors: number };
  rgbMapGaussian(rgb: Uint8Array, width: number, height: number): Uint8Array;
  grayMapGaussian(gray: Uint32Array, width: number, height: number): Uint32Array;
  grayMapCanny(gray: Uint32Array, width: number, height: number, low: number, high: number): Uint32Array;
  quantizeBand(rgb: Uint8Array, width: number, height: number, nrColors: number): Uint32Array;
  floodPathData(d: string, offset: number): string;
}

let backend: TraceBackend | null = null;

/** Set the implementation of the trace operations (see TraceBackend). */
export function setTraceBackend(b: TraceBackend | null): void {
  backend = b;
}

/** The implementation of the trace operations. Throws if none was set. */
export function traceBackend(): TraceBackend {
  if (!backend) throw new Error('No trace backend: call setTraceBackend() at startup');
  return backend;
}

// The functions of src/trace/filterset.cpp and src/trace/quantize.cpp on the map classes.

export function rgbMapQuantize(rgbmap: RgbMap, ncolor: number): IndexedMap {
  const q = traceBackend().rgbMapQuantize(rgbmap.pixels, rgbmap.width, rgbmap.height, ncolor);
  const imap = new IndexedMap(rgbmap.width, rgbmap.height, q.pixels);
  imap.nrColors = q.nrColors;
  for (let i = 0; i < q.nrColors; i++) {
    imap.clut[i] = { r: q.clut[3 * i] ?? 0, g: q.clut[3 * i + 1] ?? 0, b: q.clut[3 * i + 2] ?? 0 };
  }
  return imap;
}

export function rgbMapGaussian(me: RgbMap): RgbMap {
  const pixels = traceBackend().rgbMapGaussian(me.pixels, me.width, me.height);
  return new RgbMap(me.width, me.height, pixels);
}

export function grayMapGaussian(me: GrayMap): GrayMap {
  return new GrayMap(me.width, me.height, traceBackend().grayMapGaussian(me.pixels, me.width, me.height));
}

export function grayMapCanny(gm: GrayMap, dLowThreshold: number, dHighThreshold: number): GrayMap {
  const pixels = traceBackend().grayMapCanny(gm.pixels, gm.width, gm.height, dLowThreshold, dHighThreshold);
  return new GrayMap(gm.width, gm.height, pixels);
}

export function quantizeBand(rgbMap: RgbMap, nrColors: number): GrayMap {
  const pixels = traceBackend().quantizeBand(rgbMap.pixels, rgbMap.width, rgbMap.height, nrColors);
  return new GrayMap(rgbMap.width, rgbMap.height, pixels);
}
