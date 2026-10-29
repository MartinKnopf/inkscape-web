// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/parameter/unit.cpp, src/live_effects/parameter/unit.h
/*
 * Copyright (C) Maximilian Albert 2008 <maximilian.albert@gmail.com>
 */
import { C_ } from '../../i18n.ts';
import { getUnit, type Unit } from '../../svg/svg-length.ts';
import type { Effect } from '../effect.ts';
import { ParamType } from '../effect-enum.ts';
import { Parameter, type ParamWidget } from './parameter.ts';

/** The units of the unit menu (upstream UnitMenu with UNIT_TYPE_LINEAR). */
const LINEAR_UNITS = ['px', 'in', 'ft', 'mm', 'cm', 'm', 'pt', 'pc'];

/** A length unit (upstream UnitParam). */
export class UnitParam extends Parameter {
  private unit: Unit;
  private defunit: string;

  constructor(label: string, tip: string, key: string, effect: Effect, default_unit = 'px') {
    super(label, tip, key, effect);
    this.defunit = default_unit;
    this.unit = getUnit(default_unit);
  }

  param_readSVGValue(strvalue: string): boolean {
    this.param_set_value(strvalue);
    return true;
  }
  param_getSVGValue(): string {
    return this.unit.abbr;
  }
  param_getDefaultSVGValue(): string {
    return this.defunit;
  }
  param_set_default(): void {
    this.param_set_value(this.defunit);
  }
  param_update_default(default_unit: string | null): void {
    this.defunit = default_unit ?? 'px'; // fallback to px
  }
  param_set_value(strvalue: string): void {
    if (this.param_effect) this.param_effect.refresh_widgets = true;
    this.unit = getUnit(strvalue);
  }
  get_abbreviation(): string {
    return this.unit.abbr;
  }
  param_newWidget(): ParamWidget | null {
    return { kind: 'unit', value: this.unit.abbr, options: LINEAR_UNITS };
  }
  param_set_from_widget(abbr: string): void {
    this.param_write_from_widget(abbr, C_('Undo', 'Change unit parameter'));
  }
  paramType(): ParamType {
    return ParamType.UNIT;
  }
}
