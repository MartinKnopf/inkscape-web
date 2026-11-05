// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-ellipse_5pts.cpp, src/live_effects/lpe-ellipse_5pts.h
/** \file
 * LPE "Ellipse through 5 points" implementation
 */
/*
 * Authors:
 *   Theodore Janeczko
 *
 * Copyright (C) Theodore Janeczko 2012 <flutterguy317@gmail.com>
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { Ellipse, Path, type PathVector, Point, X, Y } from '@inkscape-web/geom';
import { _ } from '../i18n.ts';
import { Effect } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';

/**
 * Ellipse through 5 points (upstream LPEEllipse5Pts): the ellipse that passes the first 5 nodes of
 * the path.
 * TODO: the warnings go to the console, not to the status bar (no message stack in the core).
 */
export class LPEEllipse5Pts extends Effect {
  /** The unit circle, from (1, 0) through (-1, 0) back to (1, 0). */
  readonly #unit_circle = Path.fromCircle(new Point(0, 0), 1);
  /** The last warning (upstream: flashed on the status bar). */
  warning: string | null = null;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
  }

  #flashWarning(message: string): void {
    this.warning = message;
    console.warn(message);
  }

  /** Fit an ellipse to the first 5 nodes in the given PathVector. */
  protected override doEffect_path(path_in: PathVector): PathVector {
    const source = path_in[0];
    if (!source || source.size() < 4 /* For 5 nodes, we need at least 4 segments. */) {
      this.#flashWarning(_('Five points required for constructing an ellipse'));
      return path_in;
    }

    const source_points: Point[] = [];
    for (let i = 0; i < 5; i++) source_points.push(source.pointAt(i));

    let ellipse: Ellipse | null = null;
    try {
      ellipse = Ellipse.fit(source_points);
    } catch (e) {
      if (!(e instanceof RangeError)) throw e;
    }
    if (!ellipse || ellipse.ray(X) === 0 || ellipse.ray(Y) === 0) {
      this.#flashWarning(_('No unique ellipse passing through these points'));
      return path_in;
    }
    this.warning = null;

    // Transform the unit circle contour to the fitted ellipse.
    return [this.#unit_circle.transformed(ellipse.unitCircleTransform())];
  }
}
