// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/algorithms/removeoverlap.cpp, src/object/algorithms/removeoverlap.h
/*
 * Interface between Inkscape code (SPItem) and remove-overlaps function.
 *
 * Authors:
 *   Tim Dwyer <tgdwyer@gmail.com>
 *   Abhishek Sharma
 *
 * Copyright (C) 2005 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { Translate } from '@inkscape-web/geom';
import { pathBoolopBackend } from '../../path/path-boolop.ts';
import type { SPItem } from '../sp-item.ts';

/**
 * Takes a list of items and moves them as little as possible such that rectangular bounding
 * boxes are separated by at least xGap horizontally and yGap vertically.
 */
export function removeoverlap(items: readonly SPItem[], xGap: number, yGap: number): void {
  const records: { item: SPItem; midpoint: { x: number; y: number } }[] = [];
  const boxes: number[] = [];
  for (const item of items) {
    const item_box = item.desktopVisualBounds();
    if (!item_box) continue;
    let [minx, miny] = [item_box.left() - 0.5 * xGap, item_box.top() - 0.5 * yGap];
    let [maxx, maxy] = [item_box.right() + 0.5 * xGap, item_box.bottom() + 0.5 * yGap];
    // A negative gap is allowed, but will lead to problems when the gap is larger than the bounding
    // box (in either direction, or both); min will have become max now, which cannot be handled by
    // the rectangle. That's why we enforce some boundaries on min and max here:
    if (maxx < minx) minx = maxx = (minx + maxx) / 2;
    if (maxy < miny) miny = maxy = (miny + maxy) / 2;
    records.push({ item, midpoint: item_box.midpoint() });
    boxes.push(minx, maxx, miny, maxy);
  }
  if (records.length === 0) return;
  const centres = pathBoolopBackend().removeOverlaps(boxes);
  records.forEach(({ item, midpoint }, i) => {
    item.move_rel(
      Translate((centres[2 * i] as number) - midpoint.x, (centres[2 * i + 1] as number) - midpoint.y),
    );
  });
}
