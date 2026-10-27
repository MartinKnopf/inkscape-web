// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/path/path-curve.cpp, src/path/path-curve.h
/*
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Johan Engelen
 *
 * Copyright (C) 2000 Lauris Kaplinski
 * Copyright (C) 2000-2001 Ximian, Inc.
 * Copyright (C) 2002 Lauris Kaplinski
 * Copyright (C) 2008 Johan Engelen
 */
import { are_near, type PathVector } from '@inkscape-web/geom';

/** Number of nodes of pathv, as the node tool shows them. TODO: the other helpers of path-curve. */
export function node_count(pathv: PathVector): number {
  let nr = 0;
  for (const path of pathv) {
    // if the path does not have any segments, it is a naked moveto,
    // and therefore any path has at least one valid node
    const sizeClosed = path.sizeClosed();
    nr += Math.max(1, sizeClosed);
    if (path.closed() && sizeClosed > 0) {
      // The last non-degenerate curve (upstream back_closed()).
      const closingline = sizeClosed > path.sizeOpen() ? path.closingSegment() : path.at(sizeClosed - 1);
      // the closing line segment has zero-length (within rounding errors). So stop before that one!
      if (are_near(closingline.initialPoint(), closingline.finalPoint())) nr -= 1;
    }
  }
  return nr;
}
