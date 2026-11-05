// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-line_segment.cpp, src/live_effects/lpe-line_segment.h, src/ui/tools/lpe-tool.cpp
/** \file
 * LPE <line_segment> implementation
 */
/*
 * Authors:
 *   Maximilian Albert
 *
 * Copyright (C) Maximilian Albert 2008 <maximilian.albert@gmail.com>
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import {
  type Dim2,
  Interval,
  LineSegment,
  other_dimension,
  Path,
  type PathVector,
  Point,
  Rect,
  X,
  Y,
} from '@inkscape-web/geom';
import type { SPDocument } from '../document.ts';
import { _, N_ } from '../i18n.ts';
import type { SPLPEItem } from '../object/sp-lpe-item.ts';
import { Preferences } from '../preferences.ts';
import { EnumDataConverter } from '../util/enums.ts';
import { Effect } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { EnumParam } from './parameter/enum.ts';

export enum EndType {
  END_CLOSED,
  END_OPEN_INITIAL,
  END_OPEN_FINAL,
  END_OPEN_BOTH,
}

const EndTypeConverter = new EnumDataConverter<EndType>([
  { id: EndType.END_CLOSED, label: N_('Closed'), key: 'closed' },
  { id: EndType.END_OPEN_INITIAL, label: N_('Open start'), key: 'open_start' },
  { id: EndType.END_OPEN_FINAL, label: N_('Open end'), key: 'open_end' },
  { id: EndType.END_OPEN_BOTH, label: N_('Open both'), key: 'open_both' },
]);

/**
 * The corners of the limiting bounding box of the LPE tool: the page, unless the preferences
 * say otherwise (upstream lpetool_get_limiting_bbox_corners() of ui/tools/lpe-tool.cpp).
 */
export function lpetool_get_limiting_bbox_corners(document: SPDocument): [Point, Point] {
  const { x: w, y: h } = document.getDimensions();
  const prefs = Preferences.get();
  const ulx = prefs.getDouble('/tools/lpetool/bbox_upperleftx', 0);
  const uly = prefs.getDouble('/tools/lpetool/bbox_upperlefty', 0);
  const lrx = prefs.getDouble('/tools/lpetool/bbox_lowerrightx', w);
  const lry = prefs.getDouble('/tools/lpetool/bbox_lowerrighty', h);
  return [new Point(ulx, uly), new Point(lrx, lry)];
}

/**
 * The part of the line through a and b that is inside the rectangle r, from the a side to the b
 * side, or null (upstream Geom::Line(a, b).clip(r)).
 */
function clipLine(a: Point, b: Point, r: Rect): LineSegment | null {
  const v = b.sub(a);
  // handle horizontal and vertical lines first,
  // since the root-based code below will break for them
  for (const d of [X, Y] as Dim2[]) {
    const o = other_dimension(d);
    if (v.at(d) !== 0) continue;
    if (!r.at(d).contains(a.at(d))) return null;
    const pa = [0, 0];
    const pb = [0, 0];
    pa[o] = r.at(o).min();
    pb[o] = r.at(o).max();
    pa[d] = pb[d] = a.at(d);
    const p = new Point(pa[0] as number, pa[1] as number);
    const q = new Point(pb[0] as number, pb[1] as number);
    return v.at(o) > 0 ? new LineSegment(p, q) : new LineSegment(q, p);
  }
  // Line::root(value, d): the time at which the line is at value in the dimension d
  const root = (value: number, d: Dim2) => (value - a.at(d)) / v.at(d);
  const xpart = new Interval(root(r.at(X).min(), X), root(r.at(X).max(), X));
  const ypart = new Interval(root(r.at(Y).min(), Y), root(r.at(Y).max(), Y));
  if (!xpart.isFinite() || !ypart.isFinite()) return null;
  const common = xpart.intersect(ypart);
  if (!common) return null;
  const clamp = (p: Point) => new Point(r.at(X).clamp(p.x), r.at(Y).clamp(p.y));
  return new LineSegment(clamp(a.lerp(common.min(), b)), clamp(a.lerp(common.max(), b)));
}

/**
 * Line segment (upstream LPELineSegment): the line through the first and the last node of the
 * path, cut by the limiting bounding box on the sides that are open.
 */
export class LPELineSegment extends Effect {
  readonly end_type: EnumParam<EndType>;
  /** Upper left and lower right corner of the limiting bounding box. */
  #bboxA = new Point(0, 0);
  #bboxB = new Point(0, 0);

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.end_type = new EnumParam(
      _('End type:'),
      _('Determines on which side the line or line segment is infinite.'),
      'end_type',
      EndTypeConverter,
      this,
      EndType.END_OPEN_BOTH,
    );
    /* register all your parameters here, so Inkscape knows which parameters this effect has: */
    this.registerParameter(this.end_type);
  }

  protected override doBeforeEffect(lpeitem: SPLPEItem): void {
    [this.#bboxA, this.#bboxB] = lpetool_get_limiting_bbox_corners(lpeitem.document);
  }

  protected override doEffect_path(path_in: PathVector): PathVector {
    let A = path_in[0]?.initialPoint();
    let B = path_in.at(-1)?.finalPoint();
    if (!A || !B) return path_in;

    const dummyRect = new Rect(this.#bboxA, this.#bboxB);
    const intersection_segment = clipLine(A, B, dummyRect);

    if (!intersection_segment) {
      console.warn('Possible error - no intersection with limiting bounding box.');
      return path_in;
    }

    const type = this.end_type.get_value();
    if (type === EndType.END_OPEN_INITIAL || type === EndType.END_OPEN_BOTH) {
      A = intersection_segment.initialPoint();
    }

    if (type === EndType.END_OPEN_FINAL || type === EndType.END_OPEN_BOTH) {
      B = intersection_segment.finalPoint();
    }

    const path = new Path(A);
    path.appendCurve(new LineSegment(A, B));
    return [path];
  }
}
