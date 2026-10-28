// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tool/node-types.h
/* Authors:
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright (C) 2009 Authors
 */

/** Types of nodes supported in the node tool. */
export enum NodeType {
  /** Cusp node - no handle constraints */
  NODE_CUSP,
  /** Smooth node - handles must be colinear */
  NODE_SMOOTH,
  /** Auto node - handles adjusted automatically based on neighboring nodes */
  NODE_AUTO,
  /** Symmetric node - handles must be colinear and of equal length */
  NODE_SYMMETRIC,
  /** Last real type of node - used for ctrl+click on a node */
  NODE_LAST_REAL_TYPE,
  /** Select type based on handle positions */
  NODE_PICK_BEST = 100,
}

/** Types of segments supported in the node tool. */
export enum SegmentType {
  /** Straight linear segment */
  SEGMENT_STRAIGHT,
  /** Bezier curve with two control points */
  SEGMENT_CUBIC_BEZIER,
}

/** Target of the node alignment (upstream AlignTargetNode). */
export enum AlignTargetNode {
  LAST_NODE,
  FIRST_NODE,
  MID_NODE,
  MIN_NODE,
  MAX_NODE,
}
