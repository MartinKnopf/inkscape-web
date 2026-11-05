// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-rough-hatches.cpp, src/live_effects/lpe-rough-hatches.h
/** \file
 * LPE Curve Stitching implementation, used as an example for a base starting class
 * when implementing new LivePathEffects.
 *
 */
/*
 * Authors:
 *   JF Barraud.
 *
 * Copyright (C) Johan Engelen 2007 <j.b.c.engelen@utwente.nl>
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { type PathVector, Point, write_svg_path } from '@inkscape-web/geom';
import { _ } from '../i18n.ts';
import type { SPItem } from '../object/sp-item.ts';
import type { SPLPEItem } from '../object/sp-lpe-item.ts';
import { pathBoolopBackend } from '../path/path-boolop.ts';
import { sp_svg_read_pathv } from '../svg/svg-path.ts';
import { Effect } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { ScalarParam } from './parameter/parameter.ts';
import { RandomParam } from './parameter/random.ts';
import { VectorParam } from './parameter/vector.ts';

/**
 * Hatches (rough) (upstream LPERoughHatches): fills the path with a zigzag hatching. The pwd2
 * math runs in WASM; it reads the random numbers from the RandomParams here.
 */
export class LPERoughHatches extends Effect {
  hatch_dist = 0;
  readonly dist_rdm: RandomParam;
  readonly growth: ScalarParam;
  //FIXME:  top/bottom names are inverted in the UI/svg and in the code!!
  readonly scale_tf: ScalarParam;
  readonly scale_tb: ScalarParam;
  readonly scale_bf: ScalarParam;
  readonly scale_bb: ScalarParam;
  readonly top_edge_variation: RandomParam;
  readonly bot_edge_variation: RandomParam;
  readonly top_tgt_variation: RandomParam;
  readonly bot_tgt_variation: RandomParam;
  readonly top_smth_variation: RandomParam;
  readonly bot_smth_variation: RandomParam;
  readonly fat_output: BoolParam;
  readonly do_bend: BoolParam;
  readonly stroke_width_top: ScalarParam;
  readonly stroke_width_bot: ScalarParam;
  readonly front_thickness: ScalarParam;
  readonly back_thickness: ScalarParam;
  readonly direction: VectorParam;
  readonly bender: VectorParam;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.dist_rdm = new RandomParam(
      _('Randomness'),
      _('Global variation of distance between hatches, in %.'),
      'dist_rdm',
      this,
      75,
    );
    this.growth = new ScalarParam(_('Growth'), _('Growth of distance between hatches.'), 'growth', this, 0);
    //FIXME:  top/bottom names are inverted in the UI/svg and in the code!!
    //FIXME2: This needs to be fixed in code not a in tooltips
    this.scale_tf = new ScalarParam(
      _('Smooth: Bottom ←'),
      _("Set smoothness/sharpness of path when reaching a 'bottom' half-turn. 0=sharp, 1=default"),
      'scale_bf',
      this,
      1,
    );
    this.scale_tb = new ScalarParam(
      _('Smooth: Bottom →'),
      _("Set smoothness/sharpness of path when leaving a 'bottom' half-turn. 0=sharp, 1=default"),
      'scale_bb',
      this,
      1,
    );
    this.scale_bf = new ScalarParam(
      _('Smooth: Top ←'),
      _("Set smoothness/sharpness of path when reaching a 'top' half-turn. 0=sharp, 1=default"),
      'scale_tf',
      this,
      1,
    );
    this.scale_bb = new ScalarParam(
      _('Smooth: Top →'),
      _("Set smoothness/sharpness of path when leaving a 'top' half-turn. 0=sharp, 1=default"),
      'scale_tb',
      this,
      1,
    );
    this.top_edge_variation = new RandomParam(
      _('↑↓ Random: Bottom'),
      _("Randomly moves 'bottom' half-turns up and down to produce magnitude variations."),
      'bottom_edge_variation',
      this,
      0,
    );
    this.bot_edge_variation = new RandomParam(
      _('↑↓ Random: Top'),
      _("Randomly moves 'top' half-turns up and down to produce magnitude variations."),
      'top_edge_variation',
      this,
      0,
    );
    this.top_tgt_variation = new RandomParam(
      _('←→ Random: Bottom'),
      _("Add direction randomness by moving 'bottom' half-turns tangentially to the boundary."),
      'bottom_tgt_variation',
      this,
      0,
    );
    this.bot_tgt_variation = new RandomParam(
      _('←→ Random: Top'),
      _("Add direction randomness by randomly moving 'top' half-turns tangentially to the boundary."),
      'top_tgt_variation',
      this,
      0,
    );
    this.top_smth_variation = new RandomParam(
      _('Rand. Smooth: Bottom'),
      _("Randomness of 'bottom' half-turns' smoothness"),
      'top_smth_variation',
      this,
      0,
    );
    this.bot_smth_variation = new RandomParam(
      _('Rand. Smooth: Top'),
      _("Randomness of 'top' half-turns' smoothness"),
      'bottom_smth_variation',
      this,
      0,
    );
    this.fat_output = new BoolParam(
      _('Vary stroke width'),
      _('Simulate a stroke of varying width'),
      'fat_output',
      this,
      true,
    );
    this.do_bend = new BoolParam(
      _('Bend hatches'),
      _('Add a global bending to the hatches (slower)'),
      'do_bend',
      this,
      true,
    );
    this.stroke_width_top = new ScalarParam(
      _('↓ Width'),
      _("Width at 'bottom' half-turns"),
      'stroke_width_top',
      this,
      1,
    );
    this.stroke_width_bot = new ScalarParam(
      _('↑ Width'),
      _("Width at 'top' half-turns"),
      'stroke_width_bottom',
      this,
      1,
    );
    this.front_thickness = new ScalarParam(
      _('← Width'),
      _("Width of line from 'top' to 'bottom'"),
      'front_thickness',
      this,
      1,
    );
    this.back_thickness = new ScalarParam(
      _('→ Width'),
      _("Width of line from 'bottom' to 'top'"),
      'back_thickness',
      this,
      0.25,
    );
    this.direction = new VectorParam(
      _('Hatches width and dir'),
      _('Defines hatches frequency and direction'),
      'direction',
      this,
      new Point(50, 0),
    );
    this.bender = new VectorParam(
      _('Global bending'),
      _('Relative position to a reference point defines global bending direction and amount'),
      'bender',
      this,
      new Point(-5, 0),
    );

    this.registerParameter(this.direction);
    this.registerParameter(this.dist_rdm);
    this.registerParameter(this.growth);
    this.registerParameter(this.do_bend);
    this.registerParameter(this.bender);
    this.registerParameter(this.top_edge_variation);
    this.registerParameter(this.bot_edge_variation);
    this.registerParameter(this.top_tgt_variation);
    this.registerParameter(this.bot_tgt_variation);
    this.registerParameter(this.scale_tf);
    this.registerParameter(this.scale_tb);
    this.registerParameter(this.scale_bf);
    this.registerParameter(this.scale_bb);
    this.registerParameter(this.top_smth_variation);
    this.registerParameter(this.bot_smth_variation);
    this.registerParameter(this.fat_output);
    this.registerParameter(this.stroke_width_top);
    this.registerParameter(this.stroke_width_bot);
    this.registerParameter(this.front_thickness);
    this.registerParameter(this.back_thickness);

    //hatch_dist.param_set_range(0.1, Geom::infinity());
    this.growth.param_set_range(0, Number.MAX_VALUE);
    this.dist_rdm.param_set_range(0, 99);
    this.stroke_width_top.param_set_range(0, Number.MAX_VALUE);
    this.stroke_width_bot.param_set_range(0, Number.MAX_VALUE);
    this.front_thickness.param_set_range(0, Number.MAX_VALUE);
    this.back_thickness.param_set_range(0, Number.MAX_VALUE);

    // hide the widgets for direction and bender vectorparams
    this.direction.widget_is_visible = false;
    this.bender.widget_is_visible = false;

    this.concatenate_before_pwd2 = false;
    this.show_orig_path = true;
  }

  /** The random parameters in the order of RoughHatches::Rnd of the WASM binding. */
  #randoms(): RandomParam[] {
    return [
      this.dist_rdm,
      this.top_edge_variation,
      this.bot_edge_variation,
      this.top_tgt_variation,
      this.bot_tgt_variation,
      this.top_smth_variation,
      this.bot_smth_variation,
    ];
  }

  protected override doOnApply(_lpeitem: SPLPEItem): void {
    this.lpeversion.param_setValue('1.2', true);
  }

  protected override doEffect_path(path_in: PathVector): PathVector {
    const randoms = this.#randoms();
    const o = this.direction.getOrigin();
    const v = this.direction.getVector();
    const b = this.bender.getVector();
    this.hatch_dist = v.length() / 5;
    const d = pathBoolopBackend().roughHatchesPath(
      write_svg_path(path_in),
      (k) => (randoms[k] as RandomParam).next(),
      randoms.map((r) => r.get_value()),
      {
        growth: this.growth.get_value(),
        scale_tf: this.scale_tf.get_value(),
        scale_tb: this.scale_tb.get_value(),
        scale_bf: this.scale_bf.get_value(),
        scale_bb: this.scale_bb.get_value(),
        fat_output: this.fat_output.get_value(),
        do_bend: this.do_bend.get_value(),
        stroke_width_top: this.stroke_width_top.get_value(),
        stroke_width_bot: this.stroke_width_bot.get_value(),
        front_thickness: this.front_thickness.get_value(),
        back_thickness: this.back_thickness.get_value(),
        direction: [o.x, o.y, v.x, v.y],
        bender: [b.x, b.y],
      },
    );
    return sp_svg_read_pathv(d);
  }

  protected override doBeforeEffect(_lpeitem: SPLPEItem): void {
    for (const r of this.#randoms()) r.resetRandomizer();
  }

  override resetDefaults(item: SPItem): void {
    super.resetDefaults(item);
    const bbox = item.geometricBounds();
    let origin = new Point(0, 0);
    let vector = new Point(50, 0);
    if (bbox) {
      origin = bbox.midpoint();
      vector = new Point(bbox.width() / 4, 0);
      this.top_edge_variation.param_set_value(bbox.height() / 10, 0);
      this.bot_edge_variation.param_set_value(bbox.height() / 10, 0);
      this.top_edge_variation.write_to_SVG();
      this.bot_edge_variation.write_to_SVG();
    }
    this.direction.set_and_write_new_values(origin.add(new Point(0, -5)), vector);
    this.bender.set_and_write_new_values(origin, new Point(5, 0));
    this.hatch_dist = vector.length() / 2;
  }
}
