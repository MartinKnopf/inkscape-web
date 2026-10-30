// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/trace/potrace/inkscape-potrace.cpp, src/trace/potrace/inkscape-potrace.h
/*
 * This is the C++ glue between Inkscape and Potrace
 *
 * Authors:
 *   Bob Jamison <rjamison@titan.com>
 *   Stéphane Gimenez <dev@gim.name>
 *
 * Copyright (C) 2004-2006 Authors
 *
 * Potrace, the wonderful tracer located at http://potrace.sourceforge.net,
 * is provided by the generosity of Peter Selinger, to whom we are grateful.
 */
import { PathBuilder, type PathVector, Point } from '@inkscape-web/geom';
import { GrayMap, type IndexedMap, type RGB } from '../imagemap.ts';
import {
  gdkPixbufToGrayMap,
  gdkPixbufToRgbMap,
  grayMapToGdkPixbuf,
  indexedMapToGdkPixbuf,
  type RgbaImage,
} from '../imagemap-gdk.ts';
import type { TraceResult, TracingEngine } from '../trace.ts';
import {
  grayMapCanny,
  type PotracePath,
  quantizeBand,
  rgbMapGaussian,
  rgbMapQuantize,
  traceBackend,
} from '../trace-backend.ts';

export enum TraceType {
  BRIGHTNESS,
  BRIGHTNESS_MULTI,
  CANNY,
  QUANT,
  QUANT_COLOR,
  QUANT_MONO,
  // Used in tracedialog.cpp
  AUTOTRACE_SINGLE,
  AUTOTRACE_MULTI,
  AUTOTRACE_CENTERLINE,
}

/** Segment tags of potracelib.h. */
const POTRACE_CURVETO = 1;
const POTRACE_CORNER = 2;

const twohex = (value: number): string => (value & 0xff).toString(16).padStart(2, '0');

/**
 * The potrace tracing engine (upstream PotraceTracingEngine): filters the image to black and
 * white (brightness cutoff, edge detection, color quantization) or into several scans
 * (brightness steps, colors, grays), and traces each with potrace.
 * TODO: progress and cancelling (it runs synchronously).
 */
export class PotraceTracingEngine implements TracingEngine {
  /** potrace_param_t: speckles, smooth corners, optimize. */
  potraceParams = { turdsize: 2, alphamax: 1.0, opticurve: true, opttolerance: 0.2 };

  traceType = TraceType.BRIGHTNESS;
  // Whether the image should be inverted at the end.
  invert = false;
  // Color -> b&w quantization
  quantizationNrColors = 8;
  // Brightness items
  brightnessThreshold = 0.45;
  brightnessFloor = 0.0;
  // Canny items
  cannyHighThreshold = 0.65;
  // Color -> multiscan quantization
  multiScanNrColors = 8;
  multiScanStack = true; // do we tile or stack?
  multiScanSmooth = false; // do we use gaussian filter?
  multiScanRemoveBackground = false; // do we remove the bottom trace?

  constructor(
    traceType?: TraceType,
    invert?: boolean,
    quantizationNrColors?: number,
    brightnessThreshold?: number,
    brightnessFloor?: number,
    cannyHighThreshold?: number,
    multiScanNrColors?: number,
    multiScanStack?: boolean,
    multiScanSmooth?: boolean,
    multiScanRemoveBackground?: boolean,
  ) {
    if (traceType === undefined) return;
    this.traceType = traceType;
    this.invert = invert ?? false;
    this.quantizationNrColors = quantizationNrColors ?? 8;
    this.brightnessThreshold = brightnessThreshold ?? 0.45;
    this.brightnessFloor = brightnessFloor ?? 0;
    this.cannyHighThreshold = cannyHighThreshold ?? 0.65;
    this.multiScanNrColors = multiScanNrColors ?? 8;
    this.multiScanStack = multiScanStack ?? true;
    this.multiScanSmooth = multiScanSmooth ?? false;
    this.multiScanRemoveBackground = multiScanRemoveBackground ?? false;
  }

  setOptiCurve(opticurve: boolean): void {
    this.potraceParams.opticurve = opticurve;
  }
  setOptTolerance(opttolerance: number): void {
    this.potraceParams.opttolerance = opttolerance;
  }
  setAlphaMax(alphamax: number): void {
    this.potraceParams.alphamax = alphamax;
  }
  setTurdSize(turdsize: number): void {
    this.potraceParams.turdsize = turdsize;
  }

  check_image_size(): boolean {
    return false;
  }

  /**
   * Recursively descend the potrace path tree paths, writing paths to builder.
   * The points set is used to prevent redundant paths.
   */
  writePaths(paths: readonly PotracePath[], builder: PathBuilder, points: Set<string>): void {
    for (const path of paths) {
      const n = path.tags.length;
      if (n === 0) continue;
      const c = path.c;
      const pt = (i: number, k: number) => new Point(c[6 * i + 2 * k] ?? 0, c[6 * i + 2 * k + 1] ?? 0);

      const start = pt(n - 1, 2);
      // Have we been here already?
      const key = `${start.x},${start.y}`;
      if (points.has(key)) continue;
      points.add(key);
      builder.moveTo(start);

      for (let i = 0; i < n; i++) {
        switch (path.tags[i]) {
          case POTRACE_CORNER:
            builder.lineTo(pt(i, 1));
            builder.lineTo(pt(i, 2));
            break;
          case POTRACE_CURVETO:
            builder.curveTo(pt(i, 0), pt(i, 1), pt(i, 2));
            break;
          default:
            break;
        }
      }
      builder.closePath();

      this.writePaths(path.children, builder, points);
    }
  }

  filter(pixbuf: RgbaImage): GrayMap | null {
    let map: GrayMap | null = null;

    if (this.traceType === TraceType.QUANT) {
      // Color quantization -- banding
      map = quantizeBand(gdkPixbufToRgbMap(pixbuf), this.quantizationNrColors);
    } else if (this.traceType === TraceType.BRIGHTNESS || this.traceType === TraceType.BRIGHTNESS_MULTI) {
      // Brightness threshold
      const gm = gdkPixbufToGrayMap(pixbuf);
      map = new GrayMap(gm.width, gm.height);

      const floor = 3.0 * this.brightnessFloor * 256.0;
      const cutoff = 3.0 * this.brightnessThreshold * 256.0;
      for (let i = 0; i < gm.pixels.length; i++) {
        const brightness = gm.pixels[i] ?? 0;
        const black = brightness >= floor && brightness < cutoff;
        map.pixels[i] = black ? GrayMap.BLACK : GrayMap.WHITE;
      }
    } else if (this.traceType === TraceType.CANNY) {
      // Canny edge detection
      map = grayMapCanny(gdkPixbufToGrayMap(pixbuf), 0.1, this.cannyHighThreshold);
    }

    // Invert the image if necessary.
    if (map && this.invert) {
      for (let i = 0; i < map.pixels.length; i++) map.pixels[i] = GrayMap.WHITE - (map.pixels[i] ?? 0);
    }
    return map;
  }

  filterIndexed(pixbuf: RgbaImage): IndexedMap {
    let map = gdkPixbufToRgbMap(pixbuf);
    if (this.multiScanSmooth) map = rgbMapGaussian(map);

    const imap = rgbMapQuantize(map, this.multiScanNrColors);

    const tomono = (c: RGB): RGB => {
      const s = Math.trunc((c.r + c.g + c.b) / 3);
      return { r: s, g: s, b: s };
    };

    if (this.traceType === TraceType.QUANT_MONO || this.traceType === TraceType.BRIGHTNESS_MULTI) {
      // Turn to grays
      imap.clut = imap.clut.map(tomono);
    }
    return imap;
  }

  preview(pixbuf: RgbaImage): RgbaImage | null {
    if (
      this.traceType === TraceType.QUANT_COLOR ||
      this.traceType === TraceType.QUANT_MONO ||
      this.traceType === TraceType.BRIGHTNESS_MULTI // this is a lie: multipass doesn't use filterIndexed, but it's a better preview approx than filter()
    ) {
      return indexedMapToGdkPixbuf(this.filterIndexed(pixbuf));
    }
    const gm = this.filter(pixbuf);
    return gm ? grayMapToGdkPixbuf(gm) : null;
  }

  /** This is the actual wrapper of the call to Potrace. */
  grayMapToPath(grayMap: GrayMap): PathVector {
    // Read the data out of the GrayMap
    const bits = new Uint8Array(grayMap.width * grayMap.height);
    for (let i = 0; i < bits.length; i++) bits[i] = grayMap.pixels[i] ? 0 : 1;

    // Trace the bitmap.
    const tree = traceBackend().potraceTrace(bits, grayMap.width, grayMap.height, this.potraceParams);
    if (!tree) return [];

    // Extract the paths into a pathvector and return it.
    const builder = new PathBuilder();
    this.writePaths(tree, builder, new Set());
    builder.flush();
    return builder.peek();
  }

  /** This is called for a single scan. */
  traceSingle(pixbuf: RgbaImage): TraceResult {
    this.brightnessFloor = 0.0; // important to set this, since used by filter()
    const grayMap = this.filter(pixbuf);
    if (!grayMap) return [];
    return [{ style: 'fill:#000000', path: this.grayMapToPath(grayMap) }];
  }

  /** This allows routines that already generate GrayMaps to skip image filtering, increasing performance. */
  traceGrayMap(grayMap: GrayMap): TraceResult {
    return [{ style: 'fill:#000000', path: this.grayMapToPath(grayMap) }];
  }

  /** Called for multiple-scanning algorithms */
  traceBrightnessMulti(pixbuf: RgbaImage): TraceResult {
    const low = 0.2; // bottom of range
    const high = 0.9; // top of range
    const delta = (high - low) / this.multiScanNrColors;

    this.brightnessFloor = 0.0; // Set bottom to black

    const results: TraceResult = [];
    for (let i = 0; i < this.multiScanNrColors; i++) {
      this.brightnessThreshold = low + delta * i;

      const grayMap = this.filter(pixbuf);
      if (!grayMap) continue;

      const pv = this.grayMapToPath(grayMap);
      if (pv.length === 0) continue;

      // get style info
      const grayVal = Math.trunc(256.0 * this.brightnessThreshold);
      results.push({
        style: `fill-opacity:1.0;fill:#${twohex(grayVal)}${twohex(grayVal)}${twohex(grayVal)}`,
        path: pv,
      });

      if (!this.multiScanStack) this.brightnessFloor = this.brightnessThreshold;
    }

    // Remove the bottom-most scan, if requested.
    if (results.length > 1 && this.multiScanRemoveBackground) results.pop();
    return results;
  }

  /** Quantization */
  traceQuant(pixbuf: RgbaImage): TraceResult {
    const imap = this.filterIndexed(pixbuf);

    // Create and clear a gray map
    const gm = new GrayMap(imap.width, imap.height);
    gm.pixels.fill(GrayMap.WHITE);

    const results: TraceResult = [];
    for (let colorIndex = 0; colorIndex < imap.nrColors; colorIndex++) {
      // Update the graymap for the current color index
      for (let i = 0; i < imap.pixels.length; i++) {
        if (imap.pixels[i] === colorIndex) gm.pixels[i] = GrayMap.BLACK;
        else if (!this.multiScanStack) gm.pixels[i] = GrayMap.WHITE;
      }

      // Now we have a traceable graymap
      const pv = this.grayMapToPath(gm);
      if (pv.length) {
        // get style info
        const rgb = imap.clut[colorIndex] as RGB;
        results.push({ style: `fill:#${twohex(rgb.r)}${twohex(rgb.g)}${twohex(rgb.b)}`, path: pv });
      }
    }

    // Remove the bottom-most scan, if requested.
    if (results.length > 1 && this.multiScanRemoveBackground) results.pop();
    return results;
  }

  trace(pixbuf: RgbaImage): TraceResult {
    if (this.traceType === TraceType.QUANT_COLOR || this.traceType === TraceType.QUANT_MONO) {
      return this.traceQuant(pixbuf);
    }
    if (this.traceType === TraceType.BRIGHTNESS_MULTI) return this.traceBrightnessMulti(pixbuf);
    return this.traceSingle(pixbuf);
  }
}
