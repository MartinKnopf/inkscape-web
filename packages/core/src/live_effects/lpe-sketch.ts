// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-sketch.cpp, src/live_effects/lpe-sketch.h
/*
 * Authors:
 *   Jean-Francois Barraud
 *
 * Copyright (C) Johan Engelen 2007 <j.b.c.engelen@utwente.nl>
 */
import { type PathVector, write_svg_path } from '@inkscape-web/geom';
import { _ } from '../i18n.ts';
import type { SPLPEItem } from '../object/sp-lpe-item.ts';
import { pathBoolopBackend } from '../path/path-boolop.ts';
import { sp_svg_read_pathv } from '../svg/svg-path.ts';
import { Effect } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { ScalarParam } from './parameter/parameter.ts';
import { RandomParam } from './parameter/random.ts';

/**
 * Sketch (upstream LPESketch): many short strokes along the path, and construction lines
 * (tangents). The 2geom part runs in WASM; it draws its random numbers from the parameters here.
 * TODO: the separators between the parameter groups of the upstream widget.
 */
export class LPESketch extends Effect {
  readonly nbiter_approxstrokes: ScalarParam;
  readonly strokelength: ScalarParam;
  readonly strokelength_rdm: RandomParam;
  readonly strokeoverlap: ScalarParam;
  readonly strokeoverlap_rdm: RandomParam;
  readonly ends_tolerance: RandomParam;
  readonly parallel_offset: RandomParam;
  readonly tremble_size: RandomParam;
  readonly tremble_frequency: ScalarParam;
  readonly nbtangents: ScalarParam;
  readonly tgtscale: ScalarParam;
  readonly tgtlength: ScalarParam;
  readonly tgtlength_rdm: RandomParam;
  readonly tgt_places_rdmness: RandomParam;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.nbiter_approxstrokes = new ScalarParam(
      _('Strokes'),
      _('Draw that many approximating strokes'),
      'nbiter_approxstrokes',
      this,
      5,
    );
    this.parallel_offset = new RandomParam(
      _('Offset'),
      _('Average distance each stroke is away from the original path'),
      'parallel_offset',
      this,
      5,
    );
    this.strokelength = new ScalarParam(
      _('Stroke length max.'),
      _('Maximum length of approximating strokes'),
      'strokelength',
      this,
      100,
    );
    this.strokelength_rdm = new RandomParam(
      _('Stroke length'),
      _('Random variation of stroke length (relative to maximum length)'),
      'strokelength_rdm',
      this,
      0.3,
    );
    this.strokeoverlap = new ScalarParam(
      _('Overlap max.'),
      _('How much successive strokes should overlap (relative to maximum length)'),
      'strokeoverlap',
      this,
      0.3,
    );
    this.strokeoverlap_rdm = new RandomParam(
      _('Overlap'),
      _('Random variation of overlap (relative to maximum overlap)'),
      'strokeoverlap_rdm',
      this,
      0.3,
    );
    this.ends_tolerance = new RandomParam(
      _('Ending'),
      _('Maximum distance between ends of original and approximating paths (relative to maximum length)'),
      'ends_tolerance',
      this,
      0.1,
    );
    this.tremble_size = new RandomParam(
      _('Displacement size'),
      _('Maximum tremble magnitude'),
      'tremble_size',
      this,
      5,
    );
    this.tremble_frequency = new ScalarParam(
      _('Displacement details'),
      _('Average number of tremble periods in a stroke'),
      'tremble_frequency',
      this,
      1,
    );
    this.nbtangents = new ScalarParam(
      _('Add extra lines'),
      _('How many construction lines (tangents) to draw'),
      'nbtangents',
      this,
      5,
    );
    this.tgtscale = new ScalarParam(
      _('Scale'),
      _('Scale factor relating curvature and length of construction lines (try 5*offset)'),
      'tgtscale',
      this,
      10.0,
    );
    this.tgtlength = new ScalarParam(
      _('Length max.'),
      _('Maximum length of construction lines'),
      'tgtlength',
      this,
      100.0,
    );
    this.tgtlength_rdm = new RandomParam(
      _('Length'),
      _('Random variation of the length of construction lines'),
      'tgtlength_rdm',
      this,
      0.3,
    );
    this.tgt_places_rdmness = new RandomParam(
      _('Placement'),
      _('0: evenly distributed construction lines, 1: purely random placement'),
      'tgt_places_rdmness',
      this,
      1,
    );
    this.registerParameter(this.nbiter_approxstrokes);
    this.registerParameter(this.parallel_offset);
    this.registerParameter(this.strokelength);
    this.registerParameter(this.strokelength_rdm);
    this.registerParameter(this.strokeoverlap);
    this.registerParameter(this.strokeoverlap_rdm);
    this.registerParameter(this.ends_tolerance);
    this.registerParameter(this.tremble_size);
    this.registerParameter(this.tremble_frequency);
    this.registerParameter(this.nbtangents);
    this.registerParameter(this.tgt_places_rdmness);
    this.registerParameter(this.tgtlength);
    this.registerParameter(this.tgtlength_rdm);
    this.registerParameter(this.tgtscale);

    this.nbiter_approxstrokes.param_make_integer();
    this.nbiter_approxstrokes.addSlider(true);
    this.nbiter_approxstrokes.param_set_range(1, 20);
    this.nbiter_approxstrokes.param_set_increments(1, 1);
    this.nbiter_approxstrokes.param_set_digits(0);
    this.strokelength.addSlider(true);
    this.strokelength.param_set_range(5, 1000);
    this.strokelength.param_set_increments(0.5, 0.5);
    this.strokelength_rdm.param_set_range(0, 1);
    this.strokeoverlap.addSlider(true);
    this.strokeoverlap.param_set_range(0, 1);
    this.strokeoverlap.param_set_increments(0.05, 0.05);
    this.ends_tolerance.param_set_range(0, 1);
    this.parallel_offset.param_set_range(0, 50);
    this.tremble_frequency.addSlider(true);
    this.tremble_frequency.param_set_range(0.01, 25);
    this.tremble_frequency.param_set_increments(0.5, 0.5);
    this.strokeoverlap_rdm.param_set_range(0, 1);
    this.nbtangents.param_make_integer();
    this.nbtangents.param_set_range(0, 2147483647);
    this.tgtscale.addSlider(true);
    this.tgtscale.param_set_range(0, 300);
    this.tgtscale.param_set_increments(0.1, 0.1);
    this.tgtlength.addSlider(true);
    this.tgtlength.param_set_range(0, 300);
    this.tgtlength.param_set_increments(1, 0.1);
    this.tgtlength_rdm.param_set_range(0, 1);
    this.tgt_places_rdmness.param_set_range(0, 1);
    this.concatenate_before_pwd2 = true;
  }

  /** The RandomParams in the order of the WASM binding (Sketch::Rnd). */
  #randoms(): RandomParam[] {
    return [
      this.strokelength_rdm,
      this.strokeoverlap_rdm,
      this.ends_tolerance,
      this.parallel_offset,
      this.tremble_size,
      this.tgtlength_rdm,
      this.tgt_places_rdmness,
    ];
  }

  protected override doBeforeEffect(_lpeitem: SPLPEItem): void {
    //init random parameters.
    this.parallel_offset.resetRandomizer();
    this.strokelength_rdm.resetRandomizer();
    this.strokeoverlap_rdm.resetRandomizer();
    this.ends_tolerance.resetRandomizer();
    this.tremble_size.resetRandomizer();
    this.tgtlength_rdm.resetRandomizer();
    this.tgt_places_rdmness.resetRandomizer();
  }

  protected override doEffect_path(path_in: PathVector): PathVector {
    const randoms = this.#randoms();
    const d = pathBoolopBackend().sketchPath(
      write_svg_path(path_in),
      (k) => (randoms[k] as RandomParam).next(),
      randoms.map((r) => r.get_value()),
      this.nbiter_approxstrokes.get_value(),
      this.strokelength.get_value(),
      this.strokeoverlap.get_value(),
      this.tremble_frequency.get_value(),
      this.nbtangents.get_value(),
      this.tgtscale.get_value(),
      this.tgtlength.get_value(),
    );
    // upstream: an exception in the effect leaves the path as it is
    return d === '!' ? path_in : sp_svg_read_pathv(d);
  }
}
