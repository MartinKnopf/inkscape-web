// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-dashed-stroke.cpp, src/live_effects/lpe-dashed-stroke.h
/*
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { type PathVector, write_svg_path } from '@inkscape-web/geom';
import { _ } from '../i18n.ts';
import { pathBoolopBackend } from '../path/path-boolop.ts';
import { sp_svg_read_pathv } from '../svg/svg-path.ts';
import { Effect } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { MessageParam } from './parameter/message.ts';
import { ScalarParam } from './parameter/parameter.ts';

/**
 * Dashed Stroke (upstream LPEDashedStroke): the path cut into dashes that end on the nodes.
 * The geometry runs in WASM.
 */
export class LPEDashedStroke extends Effect {
  readonly numberdashes: ScalarParam;
  readonly holefactor: ScalarParam;
  readonly splitsegments: BoolParam;
  readonly halfextreme: BoolParam;
  readonly unifysegment: BoolParam;
  readonly message: MessageParam;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.numberdashes = new ScalarParam(
      _('Number of dashes'),
      _('Number of dashes'),
      'numberdashes',
      this,
      3,
    );
    this.holefactor = new ScalarParam(_('Hole factor'), _('Hole factor'), 'holefactor', this, 0.0);
    this.splitsegments = new BoolParam(_('Use segments'), _('Use segments'), 'splitsegments', this, true);
    this.halfextreme = new BoolParam(
      _('Half start/end'),
      _('Start and end of each segment has half size'),
      'halfextreme',
      this,
      true,
    );
    this.unifysegment = new BoolParam(
      _('Equalize dashes'),
      _('Global dash length is approximately the length of the dashes in the shortest path segment'),
      'unifysegment',
      this,
      true,
    );
    this.message = new MessageParam(
      _('Note'),
      _('Important messages'),
      'message',
      this,
      _('Add <b>"Fill Between Many LPE"</b> to add fill.'),
    );
    this.registerParameter(this.numberdashes);
    this.registerParameter(this.holefactor);
    this.registerParameter(this.splitsegments);
    this.registerParameter(this.halfextreme);
    this.registerParameter(this.unifysegment);
    this.registerParameter(this.message);
    this.message.write_to_SVG(); // resert old legacy uneeded data
    this.numberdashes.param_set_range(2, 999999999);
    this.numberdashes.param_set_increments(1, 1);
    this.numberdashes.param_set_digits(0);
    this.holefactor.param_set_range(-0.99999, 0.99999);
    this.holefactor.param_set_increments(0.01, 0.01);
    this.holefactor.param_set_digits(5);
  }

  protected override doEffect_path(path_in: PathVector): PathVector {
    const d = pathBoolopBackend().dashedStrokePath(
      write_svg_path(path_in),
      this.numberdashes.get_value(),
      this.holefactor.get_value(),
      this.splitsegments.get_value(),
      this.halfextreme.get_value(),
      this.unifysegment.get_value(),
    );
    return sp_svg_read_pathv(d);
  }
}
