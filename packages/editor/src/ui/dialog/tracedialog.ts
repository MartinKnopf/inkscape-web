// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/tracedialog.cpp, src/ui/dialog/tracedialog.h
/*
 * Bitmap tracing settings dialog - second implementation.
 *
 * Authors:
 *   Bob Jamison
 *   Marc Jeanmougin <marc.jeanmougin@telecom-paristech.fr>
 *   PBS <pbs3141@gmail.com>
 *   Others - see git history.
 *
 * Copyright (C) 2019-2022 Authors
 */
import { N_, PotraceTracingEngine, TraceType } from '@inkscape-web/core';

/** The notebook pages of the dialog. */
export enum Page {
  SingleScan,
  MultiScan,
  PixelArt,
}

/** The detection modes of the single scan page (CBT_SS) and their labels. */
export const cbt_ss_map: readonly [TraceType, string][] = [
  [TraceType.BRIGHTNESS, N_('Brightness cutoff')],
  [TraceType.CANNY, N_('Edge detection')],
  [TraceType.QUANT, N_('Color quantization')],
  [TraceType.AUTOTRACE_SINGLE, N_('Autotrace')],
  [TraceType.AUTOTRACE_CENTERLINE, N_('Centerline tracing (autotrace)')],
];

/** The detection modes of the multiple scans page (CBT_MS) and their labels. */
export const cbt_ms_map: readonly [TraceType, string][] = [
  [TraceType.BRIGHTNESS_MULTI, N_('Brightness steps')],
  [TraceType.QUANT_COLOR, N_('Colors')],
  [TraceType.QUANT_MONO, N_('Grays')],
  [TraceType.AUTOTRACE_MULTI, N_('Autotrace (slower)')],
];

/** The settings of the dialog (upstream: its adjustments and check buttons). */
export interface TraceOptions {
  page: Page;
  /** Index into cbt_ss_map. */
  CBT_SS: number;
  /** Index into cbt_ms_map. */
  CBT_MS: number;
  /** Brightness threshold. */
  SS_BC_T: number;
  /** Edge threshold. */
  SS_ED_T: number;
  /** Colors of the color quantization. */
  SS_CQ_T: number;
  /** Number of scans. */
  MS_scans: number;
  invert: boolean;
  MS_smooth: boolean;
  MS_stack: boolean;
  MS_rb: boolean;
  /** Speckles, smooth corners and optimize; upstream has them on both pages (CB_speckles1, ...). */
  speckles_on: boolean;
  speckles: number;
  smooth_on: boolean;
  smooth: number;
  optimize_on: boolean;
  optimize: number;
}

/** The defaults of the Reset button (upstream setDefaults). */
export function trace_defaults(): TraceOptions {
  return {
    page: Page.SingleScan,
    CBT_SS: 0,
    CBT_MS: 0,
    MS_scans: 8,
    SS_BC_T: 0.45,
    SS_CQ_T: 64,
    SS_ED_T: 0.65,
    optimize: 0.2,
    smooth: 1,
    speckles: 2,
    invert: false,
    MS_smooth: true,
    MS_stack: true,
    MS_rb: false,
    speckles_on: true,
    smooth_on: true,
    optimize_on: true,
  };
}

/** The trace type of the options. */
export function trace_type(o: TraceOptions): TraceType {
  const map = o.page === Page.SingleScan ? cbt_ss_map : cbt_ms_map;
  const index = o.page === Page.SingleScan ? o.CBT_SS : o.CBT_MS;
  return (map[index] ?? map[0])?.[0] ?? TraceType.BRIGHTNESS;
}

/**
 * The tracing engine of the options (upstream getTraceData); null for the engines that are
 * not ported: autotrace and depixelize (pixel art).
 * TODO: autotrace (src/3rdparty/autotrace needs glib), depixelize, SIOX.
 */
export function getTraceData(o: TraceOptions): PotraceTracingEngine | null {
  if (o.page === Page.PixelArt) return null;
  const type = trace_type(o);
  if (
    type === TraceType.AUTOTRACE_SINGLE ||
    type === TraceType.AUTOTRACE_CENTERLINE ||
    type === TraceType.AUTOTRACE_MULTI
  ) {
    return null;
  }
  const eng = new PotraceTracingEngine(
    type,
    o.invert,
    Math.trunc(o.SS_CQ_T),
    o.SS_BC_T,
    0, // Brightness floor
    o.SS_ED_T,
    Math.trunc(o.MS_scans),
    o.MS_stack,
    o.MS_smooth,
    o.MS_rb,
  );
  eng.setOptiCurve(o.optimize_on);
  eng.setOptTolerance(o.optimize);
  eng.setAlphaMax(o.smooth_on ? o.smooth : 0);
  eng.setTurdSize(o.speckles_on ? Math.trunc(o.speckles) : 0);
  return eng;
}
