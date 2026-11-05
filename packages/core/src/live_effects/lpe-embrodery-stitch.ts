// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-embrodery-stitch.cpp, src/live_effects/lpe-embrodery-stitch.h
/*
 * Embroidery stitch live path effect (Implementation)
 *
 * Copyright (C) 2016 Michael Soegtrop
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { type PathVector, write_svg_path } from '@inkscape-web/geom';
import { _, N_ } from '../i18n.ts';
import { pathBoolopBackend } from '../path/path-boolop.ts';
import { sp_svg_read_pathv } from '../svg/svg-path.ts';
import { EnumDataConverter } from '../util/enums.ts';
import { Effect } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { EnumParam } from './parameter/enum.ts';
import { ScalarParam } from './parameter/parameter.ts';

export enum order_method {
  order_method_no_reorder,
  order_method_zigzag,
  order_method_zigzag_rev_first,
  order_method_closest,
  order_method_closest_rev_first,
  order_method_tsp_kopt_2,
  order_method_tsp_kopt_3,
  order_method_tsp_kopt_4,
  order_method_tsp_kopt_5,
  order_method_count,
}

export enum connect_method {
  connect_method_line,
  connect_method_move_point_from,
  connect_method_move_point_mid,
  connect_method_move_point_to,
  connect_method_count,
}

const OrderMethodConverter = new EnumDataConverter<order_method>([
  { id: order_method.order_method_no_reorder, label: N_('no reordering'), key: 'no-reorder' },
  { id: order_method.order_method_zigzag, label: N_('zig-zag'), key: 'zig-zag' },
  {
    id: order_method.order_method_zigzag_rev_first,
    label: N_('zig-zag, reverse first'),
    key: 'zig-zag-rev-first',
  },
  { id: order_method.order_method_closest, label: N_('closest'), key: 'closest' },
  {
    id: order_method.order_method_closest_rev_first,
    label: N_('closest, reverse first'),
    key: 'closest-rev-first',
  },
  {
    id: order_method.order_method_tsp_kopt_2,
    label: N_('traveling salesman 2-opt (fast, bad)'),
    key: 'tsp-2opt',
  },
  {
    id: order_method.order_method_tsp_kopt_3,
    label: N_('traveling salesman 3-opt (fast, ok)'),
    key: 'tsp-3opt',
  },
  {
    id: order_method.order_method_tsp_kopt_4,
    label: N_('traveling salesman 4-opt (seconds)'),
    key: 'tsp-4opt',
  },
  {
    id: order_method.order_method_tsp_kopt_5,
    label: N_('traveling salesman 5-opt (minutes)'),
    key: 'tsp-5opt',
  },
]);

const ConnectMethodConverter = new EnumDataConverter<connect_method>([
  { id: connect_method.connect_method_line, label: N_('straight line'), key: 'line' },
  { id: connect_method.connect_method_move_point_from, label: N_('move to begin'), key: 'move-begin' },
  { id: connect_method.connect_method_move_point_mid, label: N_('move to middle'), key: 'move-middle' },
  { id: connect_method.connect_method_move_point_to, label: N_('move to end'), key: 'move-end' },
]);

/**
 * Embroidery stitch (upstream LPEEmbroderyStitch): orders the subpaths and divides them into
 * straight stitches. The ordering (lpe-embrodery-stitch-ordering.cpp) and the stitches are
 * computed in WASM.
 */
export class LPEEmbroderyStitch extends Effect {
  readonly ordering: EnumParam<order_method>;
  readonly connection: EnumParam<connect_method>;
  readonly stitch_length: ScalarParam;
  readonly stitch_min_length: ScalarParam;
  readonly stitch_pattern: ScalarParam;
  readonly show_stitches: BoolParam;
  readonly show_stitch_gap: ScalarParam;
  readonly jump_if_longer: ScalarParam;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.ordering = new EnumParam(
      _('Ordering method'),
      _('Method used to order sub paths'),
      'ordering',
      OrderMethodConverter,
      this,
      order_method.order_method_no_reorder,
    );
    this.connection = new EnumParam(
      _('Connection method'),
      _('Method to connect end points of sub paths'),
      'connection',
      ConnectMethodConverter,
      this,
      connect_method.connect_method_line,
    );
    this.stitch_length = new ScalarParam(
      _('Stitch length'),
      _('Divide path into straight segments of given length (in user units)'),
      'stitch-length',
      this,
      10.0,
    );
    this.stitch_min_length = new ScalarParam(
      _('Minimum stitch length [%]'),
      _('Merge stitches that are shorter than this percentage of the stitch length'),
      'stitch-min-length',
      this,
      25.0,
    );
    this.stitch_pattern = new ScalarParam(
      _('Stitch pattern'),
      _('Select between different stitch patterns'),
      'stitch_pattern',
      this,
      0,
    );
    this.show_stitches = new BoolParam(
      _('Show stitches'),
      _('Creates gaps between stitches (use only for preview, deactivate for use with embroidery machines)'),
      'show-stitches',
      this,
      false,
    );
    this.show_stitch_gap = new ScalarParam(
      _('Show stitch gap'),
      _('Length of the gap between stitches when showing stitches'),
      'show-stitch-gap',
      this,
      0.5,
    );
    this.jump_if_longer = new ScalarParam(
      _('Jump if longer'),
      _('Jump connection if longer than'),
      'jump-if-longer',
      this,
      100,
    );
    this.registerParameter(this.ordering);
    this.registerParameter(this.connection);
    this.registerParameter(this.stitch_length);
    this.registerParameter(this.stitch_min_length);
    this.registerParameter(this.stitch_pattern);
    this.registerParameter(this.show_stitches);
    this.registerParameter(this.show_stitch_gap);
    this.registerParameter(this.jump_if_longer);

    this.stitch_length.param_set_digits(1);
    this.stitch_length.param_set_range(1, 10000);
    this.stitch_min_length.param_set_digits(1);
    this.stitch_min_length.param_set_range(0, 100);
    this.stitch_pattern.param_make_integer();
    this.stitch_pattern.param_set_range(0, 2);
    this.show_stitch_gap.param_set_range(0.001, 10);
    this.jump_if_longer.param_set_range(0.0, 1000000);
  }

  protected override doEffect_path(path_in: PathVector): PathVector {
    const d = pathBoolopBackend().embroderyStitchPath(write_svg_path(path_in), {
      ordering: this.ordering.get_value(),
      connection: this.connection.get_value(),
      stitch_length: this.stitch_length.get_value(),
      stitch_min_length: this.stitch_min_length.get_value(),
      stitch_pattern: this.stitch_pattern.get_value(),
      show_stitches: this.show_stitches.get_value(),
      show_stitch_gap: this.show_stitch_gap.get_value(),
      jump_if_longer: this.jump_if_longer.get_value(),
    });
    return sp_svg_read_pathv(d);
  }
}
