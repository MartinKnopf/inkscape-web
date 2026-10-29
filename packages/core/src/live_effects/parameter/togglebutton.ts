// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/parameter/togglebutton.cpp, src/live_effects/parameter/togglebutton.h
/*
 * Copyright (C) Jabiertxo Arraiza Cenoz 2014
 */
import { C_ } from '../../i18n.ts';
import type { Effect } from '../effect.ts';
import { ParamType } from '../effect-enum.ts';
import { read_bool } from './bool.ts';
import { Parameter, type ParamWidget } from './parameter.ts';

/** A toggle button with an optional label for the inactive state (upstream ToggleButtonParam). */
export class ToggleButtonParam extends Parameter {
  protected value: boolean;
  protected defvalue: boolean;
  readonly inactive_label: string;
  readonly _icon_active: string | null;
  readonly _icon_inactive: string | null;

  constructor(
    label: string,
    tip: string,
    key: string,
    effect: Effect,
    default_value = false,
    inactive_label = '',
    icon_active: string | null = null,
    icon_inactive: string | null = null,
  ) {
    super(label, tip, key, effect);
    this.value = default_value;
    this.defvalue = default_value;
    this.inactive_label = inactive_label;
    this._icon_active = icon_active;
    this._icon_inactive = icon_inactive;
  }

  param_set_default(): void {
    this.param_setValue(this.defvalue);
  }
  param_readSVGValue(strvalue: string): boolean {
    this.param_setValue(read_bool(strvalue, this.defvalue));
    return true; // not correct: if value is unacceptable, should return false!
  }
  param_getSVGValue(): string {
    return this.value ? 'true' : 'false';
  }
  param_getDefaultSVGValue(): string {
    return this.defvalue ? 'true' : 'false';
  }
  param_update_default(default_value: boolean | string): void {
    this.defvalue =
      typeof default_value === 'boolean' ? default_value : read_bool(default_value, this.defvalue);
  }
  param_newWidget(): ParamWidget | null {
    return {
      kind: 'toggle',
      value: this.value,
      label_on: this.param_label,
      label_off: this.inactive_label || this.param_label,
    };
  }
  param_set_from_widget(value: boolean): void {
    this.param_write_from_widget(value ? 'true' : 'false', C_('Undo', 'Change togglebutton parameter'));
  }
  param_setValue(newvalue: boolean): void {
    if (this.value !== newvalue && this.param_effect) this.param_effect.refresh_widgets = true;
    this.value = newvalue;
  }
  get_value(): boolean {
    return this.value;
  }
  paramType(): ParamType {
    return ParamType.TOGGLE_BUTTON;
  }
}
