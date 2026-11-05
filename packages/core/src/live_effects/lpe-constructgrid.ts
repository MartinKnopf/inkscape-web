// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-constructgrid.cpp, src/live_effects/lpe-constructgrid.h
/** \file
 * LPE <construct_grid> implementation
 */
/*
 * Authors:
 *   Johan Engelen
 *
 * Copyright (C) Johan Engelen 2007 <j.b.c.engelen@utwente.nl>
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { LineSegment, Path, type PathVector, Translate } from '@inkscape-web/geom';
import { _ } from '../i18n.ts';
import { Effect } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { ScalarParam } from './parameter/parameter.ts';

/**
 * Construct grid (upstream LPEConstructGrid): a grid made from a path of three nodes; the second
 * node is the origin and the other two give the directions and the cell size.
 */
export class LPEConstructGrid extends Effect {
  readonly nr_x: ScalarParam;
  readonly nr_y: ScalarParam;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.nr_x = new ScalarParam(_('Size _X:'), _('The size of the grid in X direction.'), 'nr_x', this, 5);
    this.nr_y = new ScalarParam(_('Size _Y:'), _('The size of the grid in Y direction.'), 'nr_y', this, 5);
    this.registerParameter(this.nr_x);
    this.registerParameter(this.nr_y);

    this.nr_x.param_make_integer();
    this.nr_y.param_make_integer();
    this.nr_x.param_set_range(1, 1e10);
    this.nr_y.param_set_range(1, 1e10);
  }

  protected override doEffect_path(path_in: PathVector): PathVector {
    const first = path_in[0];
    // Check that the path has at least 3 nodes (i.e. 2 segments), more nodes are ignored
    if (!first || first.size() < 2) return path_in;
    // read the first 3 nodes (the third is the end of an open path of two segments: the initial
    // point of its closing segment):
    const origin = first.at(1).initialPoint();
    // make first_p and second_p be the construction *vectors* of the grid:
    const first_p = first.at(0).initialPoint().sub(origin);
    const second_p = first.at(2).initialPoint().sub(origin);
    const first_translation = Translate(first_p);
    const second_translation = Translate(second_p);
    const nr_x = this.nr_x.get_value();
    const nr_y = this.nr_y.get_value();

    // create the gridpaths of the two directions
    const first_path = new Path(origin);
    const first_end = origin.add(first_p.mul(nr_y));
    first_path.appendCurve(new LineSegment(origin, first_end));
    const second_path = new Path(origin);
    const second_end = origin.add(second_p.mul(nr_x));
    second_path.appendCurve(new LineSegment(origin, second_end));

    // use the gridpaths and set them in the correct grid
    const path_out: PathVector = [first_path];
    for (let ix = 0; ix < nr_x; ix++) {
      path_out.push((path_out.at(-1) as Path).transformed(second_translation));
    }
    path_out.push(second_path);
    for (let iy = 0; iy < nr_y; iy++) {
      path_out.push((path_out.at(-1) as Path).transformed(first_translation));
    }
    return path_out;
  }
}
