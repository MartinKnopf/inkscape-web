// SPDX-License-Identifier: LGPL-2.1-only OR MPL-1.1
// Upstream: src/3rdparty/2geom/include/2geom/curve.h, src/3rdparty/2geom/src/2geom/curve.cpp
/*
 * Authors:
 *   MenTaLguY <mental@rydia.net>
 *   Marco Cecchetti <mrcekets at gmail.com>
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *   Rafał Siejakowski <rs@rs-math.net>
 *
 * Copyright 2007-2009 Authors
 */
import type { Affine } from './affine.ts';
import type { Coord } from './coord.ts';
import type { PathSink } from './path-sink.ts';
import type { Point } from './point.ts';
import type { Rect } from './rect.ts';

/**
 * A curve segment with the time range [0, 1]. Curves are immutable; operations that
 * upstream does in place (`transform`, `setFinal`) return a new curve.
 */
export interface Curve {
  initialPoint(): Point;
  finalPoint(): Point;
  /** True when the curve is a single point. */
  isDegenerate(): boolean;
  /** True when all points of the curve lie on the straight segment between its ends. */
  isLineSegment(): boolean;
  /** Point at time t in [0, 1]. */
  pointAt(t: Coord): Point;
  /** Bounding box that is cheap to compute and contains the curve (not always tight). */
  boundsFast(): Rect;
  /** Tight bounding box. */
  boundsExact(): Rect;
  /** The curve after the transform (upstream `*curve * m`). */
  transformed(m: Affine): Curve;
  /** The same curve traversed in the opposite direction. */
  reverse(): Curve;
  /** The part of the curve between the times `from` and `to`; `from > to` reverses it. */
  portion(from: Coord, to: Coord): Curve;
  /** The curve with its final point moved to p (upstream `setFinal`). */
  withFinal(p: Point): Curve;
  /** Exact equality of type and geometry. */
  equals(other: Curve): boolean;
  /** Send the curve to a sink. The sink gets `moveTo(initialPoint)` first when moveToInitial is true. */
  feed(sink: PathSink, moveToInitial: boolean): void;
}
