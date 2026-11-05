// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-extrude.cpp, src/live_effects/lpe-extrude.h
/**
 * @file
 * LPE effect for extruding paths (making them "3D").
 *
 */
/* Authors:
 *   Johan Engelen <j.b.c.engelen@utwente.nl>
 *
 * Copyright (C) 2009 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { type PathVector, Point, write_svg_path } from '@inkscape-web/geom';
import { _ } from '../i18n.ts';
import type { SPItem } from '../object/sp-item.ts';
import { pathBoolopBackend } from '../path/path-boolop.ts';
import { sp_svg_read_pathv } from '../svg/svg-path.ts';
import { Effect } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { VectorParam } from './parameter/vector.ts';

/**
 * Extrude (upstream LPEExtrude): a closed subpath for each face between the path and its copy
 * moved by the extrude vector. The pwd2 math runs in WASM.
 */
export class LPEExtrude extends Effect {
  readonly extrude_vector: VectorParam;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.extrude_vector = new VectorParam(
      _('Direction'),
      _('Defines the direction and magnitude of the extrusion'),
      'extrude_vector',
      this,
      new Point(-10, 10),
    );
    this.show_orig_path = true;
    this.concatenate_before_pwd2 = false;
    this.registerParameter(this.extrude_vector);
  }

  protected override doEffect_path(path_in: PathVector): PathVector {
    const v = this.extrude_vector.getVector();
    return sp_svg_read_pathv(pathBoolopBackend().extrudePath(write_svg_path(path_in), [v.x, v.y]));
  }

  override resetDefaults(item: SPItem): void {
    super.resetDefaults(item);
    const bbox = item.geometricBounds();
    if (bbox) {
      const boundingbox_X = bbox.xInterval;
      const boundingbox_Y = bbox.yInterval;
      this.extrude_vector.set_and_write_new_values(
        new Point(boundingbox_X.middle(), boundingbox_Y.middle()),
        new Point(-0.05, 0.2).mul(boundingbox_X.extent() + boundingbox_Y.extent()),
      );
    }
  }
}
