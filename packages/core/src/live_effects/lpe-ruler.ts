// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-ruler.cpp, src/live_effects/lpe-ruler.h
/** \file
 * LPE <ruler> implementation
 */
/*
 * Authors:
 *   Maximilian Albert
 *
 * Copyright (C) Maximilian Albert 2008 <maximilian.albert@gmail.com>
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { type PathVector, write_svg_path } from '@inkscape-web/geom';
import type { SPDocument } from '../document.ts';
import { _, N_, NC_ } from '../i18n.ts';
import type { SPLPEItem } from '../object/sp-lpe-item.ts';
import { pathBoolopBackend } from '../path/path-boolop.ts';
import { convertUnit, svgLengthUnitAbbr } from '../svg/svg-length.ts';
import { sp_svg_read_pathv } from '../svg/svg-path.ts';
import { EnumDataConverter } from '../util/enums.ts';
import { Effect } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { EnumParam } from './parameter/enum.ts';
import { ScalarParam } from './parameter/parameter.ts';
import { UnitParam } from './parameter/unit.ts';

export enum MarkDirType {
  MARKDIR_LEFT,
  MARKDIR_RIGHT,
  MARKDIR_BOTH,
}

export enum BorderMarkType {
  BORDERMARK_NONE,
  BORDERMARK_START,
  BORDERMARK_END,
  BORDERMARK_BOTH,
}

const MarkDirTypeConverter = new EnumDataConverter<MarkDirType>([
  { id: MarkDirType.MARKDIR_LEFT, label: N_('Left'), key: 'left' },
  { id: MarkDirType.MARKDIR_RIGHT, label: N_('Right'), key: 'right' },
  { id: MarkDirType.MARKDIR_BOTH, label: N_('Both'), key: 'both' },
]);

const BorderMarkTypeConverter = new EnumDataConverter<BorderMarkType>([
  { id: BorderMarkType.BORDERMARK_NONE, label: NC_('Border mark', 'None'), key: 'none' },
  { id: BorderMarkType.BORDERMARK_START, label: N_('Start'), key: 'start' },
  { id: BorderMarkType.BORDERMARK_END, label: N_('End'), key: 'end' },
  { id: BorderMarkType.BORDERMARK_BOTH, label: N_('Both'), key: 'both' },
]);

/**
 * Ruler (upstream LPERuler): marks along the path at a distance, with major marks every few steps.
 * The 2geom part (arc length and the marks) runs in WASM.
 */
export class LPERuler extends Effect {
  readonly mark_distance: ScalarParam;
  readonly unit: UnitParam;
  readonly mark_length: ScalarParam;
  readonly minor_mark_length: ScalarParam;
  readonly minor_mark_gap: ScalarParam;
  readonly major_mark_gap: ScalarParam;
  readonly major_mark_steps: ScalarParam;
  readonly mark_angle: ScalarParam;
  readonly shift: ScalarParam;
  readonly mark_dir: EnumParam<MarkDirType>;
  readonly offset: ScalarParam;
  readonly border_marks: EnumParam<BorderMarkType>;
  prev_unit = '';
  legacy = false;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.mark_distance = new ScalarParam(
      _('_Mark distance:'),
      _('Distance between successive ruler marks'),
      'mark_distance',
      this,
      20.0,
    );
    this.unit = new UnitParam(_('Unit:'), _('Unit'), 'unit', this);
    this.mark_length = new ScalarParam(
      _('Ma_jor length:'),
      _('Length of major ruler marks'),
      'mark_length',
      this,
      14.0,
    );
    this.minor_mark_length = new ScalarParam(
      _('Mino_r length:'),
      _('Length of minor ruler marks'),
      'minor_mark_length',
      this,
      7.0,
    );
    this.minor_mark_gap = new ScalarParam(
      _('Minor mark _gap:'),
      // xgettext:no-c-format
      _('Space between path and minor ruler mark, % of mark length'),
      'minor_mark_gap',
      this,
      0.0,
    );
    this.major_mark_gap = new ScalarParam(
      _('Major mar_k gap:'),
      // xgettext:no-c-format
      _('Space between path and major ruler mark, % of mark length'),
      'major_mark_gap',
      this,
      0.0,
    );
    this.major_mark_steps = new ScalarParam(
      _('Major steps_:'),
      _('Draw a major mark every ... steps'),
      'major_mark_steps',
      this,
      5,
    );
    this.mark_angle = new ScalarParam(
      _('Mark angle:'),
      _('Rotate marks (-180° to 180°)'),
      'mark_angle',
      this,
      0.0,
    );
    this.shift = new ScalarParam(
      _('Shift marks _by:'),
      _('Shift marks by this many steps'),
      'shift',
      this,
      0,
    );
    this.mark_dir = new EnumParam(
      _('Mark direction:'),
      _('Direction of marks (when viewing along the path from start to end)'),
      'mark_dir',
      MarkDirTypeConverter,
      this,
      MarkDirType.MARKDIR_LEFT,
    );
    this.offset = new ScalarParam(_('_Offset:'), _('Offset of first mark'), 'offset', this, 0.0);
    this.border_marks = new EnumParam(
      _('Border marks:'),
      _('Choose whether to draw marks at the beginning and end of the path'),
      'border_marks',
      BorderMarkTypeConverter,
      this,
      BorderMarkType.BORDERMARK_BOTH,
    );
    this.registerParameter(this.unit);
    this.registerParameter(this.mark_distance);
    this.registerParameter(this.mark_angle);
    this.registerParameter(this.mark_length);
    this.registerParameter(this.minor_mark_length);
    this.registerParameter(this.minor_mark_gap);
    this.registerParameter(this.major_mark_gap);
    this.registerParameter(this.major_mark_steps);
    this.registerParameter(this.shift);
    this.registerParameter(this.offset);
    this.registerParameter(this.mark_dir);
    this.registerParameter(this.border_marks);

    this.mark_angle.param_make_integer();
    this.mark_angle.param_set_range(-180, 180);
    this.major_mark_steps.param_make_integer();
    this.major_mark_steps.param_set_range(1, 1000);
    this.shift.param_make_integer();
    this.mark_distance.param_set_range(0.01, Number.MAX_VALUE);
    this.mark_distance.param_set_digits(2);
    this.minor_mark_gap.param_make_integer();
    this.minor_mark_gap.param_set_range(0, 100);
    this.major_mark_gap.param_make_integer();
    this.major_mark_gap.param_set_range(0, 100);
    this.mark_length.param_set_increments(1.0, 10.0);
    this.minor_mark_length.param_set_increments(1.0, 10.0);
    this.offset.param_set_increments(1.0, 10.0);
  }

  protected override doOnApply(_lpeitem: SPLPEItem): void {
    this.lpeversion.param_setValue('1.3.1', true);
    this.legacy = false;
  }

  /**
   * A length in the unit of the effect in the units of the item: legacy documents use the unit
   * of the width of the document, others px divided by the scale of the document.
   */
  #realLength(value: number, document: SPDocument | null): number {
    if (!document) return value;
    const unit = this.unit.get_abbreviation();
    if (this.legacy) return convertUnit(value, unit, svgLengthUnitAbbr(document.root.width.unit));
    return convertUnit(value, unit, 'px') / document.getDocumentScale().x;
  }

  /** Upstream doEffect_pwd2 on each subpath. */
  protected override doEffect_path(path_in: PathVector): PathVector {
    if (this.is_load) {
      this.legacy = this.lpeversion.param_getSVGValue() < '1.3.1';
    }
    const mminterval = Math.trunc(this.major_mark_steps.get_value());
    const i_shift = Math.trunc(this.shift.get_value()) % mminterval;
    const document = this.getSPDoc();

    if (document && !this.legacy) {
      // Keep the lengths when the unit changes. TODO: the display unit of legacy documents.
      const punit = this.prev_unit;
      this.prev_unit = this.unit.get_abbreviation();
      if (punit !== '' && this.prev_unit !== punit) {
        const unit = this.unit.get_abbreviation();
        for (const p of [this.mark_distance, this.offset, this.minor_mark_length, this.mark_length]) {
          p.param_set_value(convertUnit(p.get_value(), punit, unit));
        }
        this.minor_mark_length.write_to_SVG();
        this.mark_length.write_to_SVG();
        this.mark_distance.write_to_SVG();
        this.offset.write_to_SVG();
      }
    }
    const real_mark_distance = this.#realLength(this.mark_distance.get_value(), document);
    const real_offset = this.#realLength(this.offset.get_value(), document);
    const real_mark_length = this.#realLength(this.mark_length.get_value(), document);
    const real_minor_mark_length = this.#realLength(this.minor_mark_length.get_value(), document);
    if (!(real_mark_distance > 0)) return path_in;

    const path_out: PathVector = [];
    for (const path of path_in) {
      const d = pathBoolopBackend().rulerPath(
        write_svg_path([path]),
        real_mark_distance,
        real_offset,
        this.offset.get_value(),
        real_mark_length,
        real_minor_mark_length,
        this.major_mark_gap.get_value(),
        this.minor_mark_gap.get_value(),
        this.mark_angle.get_value(),
        this.mark_dir.get_value(),
        this.border_marks.get_value(),
        mminterval,
        i_shift,
      );
      path_out.push(...sp_svg_read_pathv(d));
    }
    return path_out;
  }
}
