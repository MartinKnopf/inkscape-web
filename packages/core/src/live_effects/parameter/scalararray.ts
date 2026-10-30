// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/parameter/scalararray.cpp, src/live_effects/parameter/scalararray.h
/*
 * Copyright (C) Johan Engelen 2008 <j.b.c.engelen@utwente.nl>
 */
import { C_ } from '../../i18n.ts';
import { svgNumber } from '../../svg/stringstream.ts';
import { spSvgNumberReadD } from '../../svg/svg-length.ts';
import type { Effect } from '../effect.ts';
import { ScalarArrayParamBase } from './array.ts';
import { type ParamWidget, SCALARPARAM_G_MAXDOUBLE } from './parameter.ts';

/**
 * A number per subpath; the widget edits the active one (upstream ScalarArrayParam, used by
 * Taper stroke).
 */
export class ScalarArrayParam extends ScalarArrayParamBase {
  protected defvalue: number;
  protected min = -SCALARPARAM_G_MAXDOUBLE;
  protected max = SCALARPARAM_G_MAXDOUBLE;
  protected integer = false;
  protected digits = 2;
  protected inc_step = 0.1;
  protected inc_page = 1;
  protected add_slider = false;
  protected _set_undo = true;
  _active_index = 0;

  constructor(
    label: string,
    tip: string,
    key: string,
    effect: Effect,
    default_value = 1.0,
    visible = true,
    n = 0,
  ) {
    super(label, tip, key, effect, n);
    this.defvalue = default_value;
    this.widget_is_visible = visible;
  }

  override param_newWidget(): ParamWidget | null {
    if (!this.widget_is_visible || this._active_index >= this._vector.length) return null;
    return {
      kind: 'scalar',
      value: this._vector[this._active_index] as number,
      min: this.min,
      max: this.max,
      digits: this.digits,
      inc_step: this.inc_step,
      inc_page: this.inc_page,
      slider: this.add_slider,
    };
  }

  /** Set the active element from the widget (upstream on_value_changed). */
  param_set_from_widget(value: number): void {
    if (this._active_index >= this._vector.length) return;
    const val = value < 1e-6 && value > -1e-6 ? 0.0 : value;
    const v = [...this._vector];
    v[this._active_index] = val;
    this.param_write_from_widget(this.writesvg(v), C_('Undo', 'Change scalar parameter'));
  }

  override param_getDefaultSVGValue(): string {
    return svgNumber(this.defvalue);
  }
  override param_set_default(): void {
    this._vector = this._vector.map(() => this.defvalue);
  }
  override param_update_default(default_value: number | string): void {
    if (typeof default_value === 'number') {
      this.defvalue = default_value;
      return;
    }
    const newval = spSvgNumberReadD(default_value);
    if (newval !== null) this.defvalue = newval;
  }
  param_set_range(min: number, max: number): void {
    this.min = min >= -SCALARPARAM_G_MAXDOUBLE ? min : -SCALARPARAM_G_MAXDOUBLE;
    this.max = max <= SCALARPARAM_G_MAXDOUBLE ? max : SCALARPARAM_G_MAXDOUBLE;
    this.param_effect.refresh_widgets = true;
  }
  param_make_integer(yes = true): void {
    this.integer = yes;
    this.digits = 0;
    this.inc_step = 1;
    this.inc_page = 10;
  }
  param_set_undo(set_undo: boolean): void {
    this._set_undo = set_undo;
  }
  param_set_digits(digits: number): void {
    this.digits = digits;
  }
  param_set_increments(step: number, page: number): void {
    this.inc_step = step;
    this.inc_page = page;
  }
  addSlider(add_slider_widget: boolean): void {
    this.add_slider = add_slider_widget;
  }
  param_setActive(index: number): void {
    this._active_index = index;
    this.param_effect.refresh_widgets = true;
  }
}
