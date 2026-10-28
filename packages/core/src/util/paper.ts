// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/util/paper.cpp, src/util/paper.h, src/util/pages-skeleton.h
/*
 * Inkscape PaperSize
 *
 * Authors:
 *      Bob Jamison (2006)
 *      Martin Owens (2021)
 *
 * Copyright (C) 2021 AUTHORS
 */
import { convertUnit } from '../svg/svg-length.ts';

/** A named page size. width and height are in unit. */
export interface PaperSize {
  name: string;
  width: number;
  height: number;
  unit: string;
}

/** The page sizes of pages-skeleton.h (the default pages.csv). */
// biome-ignore format: table
export const PAGE_SIZES: readonly PaperSize[] = [
  { name: 'US Letter', width: 8.5, height: 11, unit: 'in' },
  { name: 'US Legal', width: 8.5, height: 14, unit: 'in' },
  { name: 'US Executive', width: 7.25, height: 10.5, unit: 'in' },
  { name: 'US Ledger/Tabloid', width: 11, height: 17, unit: 'in' },
  { name: 'A0', width: 841, height: 1189, unit: 'mm' },
  { name: 'A1', width: 594, height: 841, unit: 'mm' },
  { name: 'A2', width: 420, height: 594, unit: 'mm' },
  { name: 'A3', width: 297, height: 420, unit: 'mm' },
  { name: 'A4', width: 210, height: 297, unit: 'mm' },
  { name: 'A5', width: 148, height: 210, unit: 'mm' },
  { name: 'A6', width: 105, height: 148, unit: 'mm' },
  { name: 'A7', width: 74, height: 105, unit: 'mm' },
  { name: 'A8', width: 52, height: 74, unit: 'mm' },
  { name: 'A9', width: 37, height: 52, unit: 'mm' },
  { name: 'A10', width: 26, height: 37, unit: 'mm' },
  { name: 'B0', width: 1000, height: 1414, unit: 'mm' },
  { name: 'B1', width: 707, height: 1000, unit: 'mm' },
  { name: 'B2', width: 500, height: 707, unit: 'mm' },
  { name: 'B3', width: 353, height: 500, unit: 'mm' },
  { name: 'B4', width: 250, height: 353, unit: 'mm' },
  { name: 'B5', width: 176, height: 250, unit: 'mm' },
  { name: 'B6', width: 125, height: 176, unit: 'mm' },
  { name: 'B7', width: 88, height: 125, unit: 'mm' },
  { name: 'B8', width: 62, height: 88, unit: 'mm' },
  { name: 'B9', width: 44, height: 62, unit: 'mm' },
  { name: 'B10', width: 31, height: 44, unit: 'mm' },
  { name: 'C0', width: 917, height: 1297, unit: 'mm' },
  { name: 'C1', width: 648, height: 917, unit: 'mm' },
  { name: 'C2', width: 458, height: 648, unit: 'mm' },
  { name: 'C3', width: 324, height: 458, unit: 'mm' },
  { name: 'C4', width: 229, height: 324, unit: 'mm' },
  { name: 'C5', width: 162, height: 229, unit: 'mm' },
  { name: 'C6', width: 114, height: 162, unit: 'mm' },
  { name: 'C7', width: 81, height: 114, unit: 'mm' },
  { name: 'C8', width: 57, height: 81, unit: 'mm' },
  { name: 'C9', width: 40, height: 57, unit: 'mm' },
  { name: 'C10', width: 28, height: 40, unit: 'mm' },
  { name: 'D1', width: 545, height: 771, unit: 'mm' },
  { name: 'D2', width: 385, height: 545, unit: 'mm' },
  { name: 'D3', width: 272, height: 385, unit: 'mm' },
  { name: 'D4', width: 192, height: 272, unit: 'mm' },
  { name: 'D5', width: 136, height: 192, unit: 'mm' },
  { name: 'D6', width: 96, height: 136, unit: 'mm' },
  { name: 'D7', width: 68, height: 96, unit: 'mm' },
  { name: 'E3', width: 400, height: 560, unit: 'mm' },
  { name: 'E4', width: 280, height: 400, unit: 'mm' },
  { name: 'E5', width: 200, height: 280, unit: 'mm' },
  { name: 'E6', width: 140, height: 200, unit: 'mm' },
  { name: 'CSE', width: 462, height: 649, unit: 'pt' },
  { name: 'US #10 Envelope', width: 9.5, height: 4.125, unit: 'in' },
  { name: 'DL Envelope', width: 220, height: 110, unit: 'mm' },
  { name: 'Banner 468x60', width: 468, height: 60, unit: 'px' },
  { name: 'Icon 16x16', width: 16, height: 16, unit: 'px' },
  { name: 'Icon 32x32', width: 32, height: 32, unit: 'px' },
  { name: 'Icon 48x48', width: 48, height: 48, unit: 'px' },
  { name: 'ID Card (ISO 7810)', width: 85.6, height: 53.98, unit: 'mm' },
  { name: 'Business Card (US)', width: 3.5, height: 2, unit: 'in' },
  { name: 'Business Card (Europe)', width: 85, height: 55, unit: 'mm' },
  { name: 'Business Card (AU/NZ)', width: 90, height: 55, unit: 'mm' },
  { name: 'Arch A', width: 9, height: 12, unit: 'in' },
  { name: 'Arch B', width: 12, height: 18, unit: 'in' },
  { name: 'Arch C', width: 18, height: 24, unit: 'in' },
  { name: 'Arch D', width: 24, height: 36, unit: 'in' },
  { name: 'Arch E', width: 36, height: 48, unit: 'in' },
  { name: 'Arch E1', width: 30, height: 42, unit: 'in' },
  { name: 'Video SD / PAL', width: 768, height: 576, unit: 'px' },
  { name: 'Video SD-Widescreen / PAL', width: 1024, height: 576, unit: 'px' },
  { name: 'Video SD / NTSC', width: 544, height: 480, unit: 'px' },
  { name: 'Video SD-Widescreen / NTSC', width: 872, height: 486, unit: 'px' },
  { name: 'Video HD 720p', width: 1280, height: 720, unit: 'px' },
  { name: 'Video HD 1080p', width: 1920, height: 1080, unit: 'px' },
  { name: 'Video DCI 2k (Full Frame)', width: 2048, height: 1080, unit: 'px' },
  { name: 'Video UHD 4k', width: 3840, height: 2160, unit: 'px' },
  { name: 'Video DCI 4k (Full Frame)', width: 4096, height: 2160, unit: 'px' },
  { name: 'Video UHD 8k', width: 7680, height: 4320, unit: 'px' },
];

/**
 * The page size that matches width x height in unit within half a px, in either
 * orientation (upstream PaperSize::findPaperSize).
 */
export function findPaperSize(width: number, height: number, unit: string): PaperSize | null {
  const [smaller, larger] = width < height ? [width, height] : [height, width];
  for (const page of PAGE_SIZES) {
    const a = convertUnit(smaller, unit, page.unit);
    const b = convertUnit(larger, unit, page.unit);
    const tolerance = convertUnit(0.5, 'px', page.unit);
    const [ps, pl] = page.width < page.height ? [page.width, page.height] : [page.height, page.width];
    if (Math.abs(ps - a) <= tolerance && Math.abs(pl - b) <= tolerance) return page;
  }
  return null;
}
