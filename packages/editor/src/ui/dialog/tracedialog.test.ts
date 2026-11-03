// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/tracedialog.cpp
import { TraceType } from '@inkscape-web/core';
import { describe, expect, it } from 'vitest';
import { getTraceData, Page, trace_defaults } from './tracedialog.ts';

describe('getTraceData', () => {
  it('the defaults trace the brightness cutoff with the details on', () => {
    const eng = getTraceData(trace_defaults());
    expect(eng?.traceType).toBe(TraceType.BRIGHTNESS);
    expect(eng?.brightnessThreshold).toBe(0.45);
    expect(eng?.potraceParams).toEqual({ turdsize: 2, alphamax: 1, opticurve: true, opttolerance: 0.2 });
  });

  it('switched off details give turdsize 0 and alphamax 0', () => {
    const eng = getTraceData({
      ...trace_defaults(),
      speckles_on: false,
      smooth_on: false,
      optimize_on: false,
    });
    expect(eng?.potraceParams).toEqual({ turdsize: 0, alphamax: 0, opticurve: false, opttolerance: 0.2 });
  });

  it('the multiple scans page uses its own mode and the scan options', () => {
    const eng = getTraceData({
      ...trace_defaults(),
      page: Page.MultiScan,
      CBT_MS: 2,
      MS_scans: 5,
      MS_rb: true,
    });
    expect(eng?.traceType).toBe(TraceType.QUANT_MONO);
    expect([eng?.multiScanNrColors, eng?.multiScanRemoveBackground, eng?.multiScanSmooth]).toEqual([
      5,
      true,
      true,
    ]);
  });

  it('autotrace and pixel art have no engine yet', () => {
    expect(getTraceData({ ...trace_defaults(), CBT_SS: 3 })).toBeNull();
    expect(getTraceData({ ...trace_defaults(), page: Page.PixelArt })).toBeNull();
  });
});
