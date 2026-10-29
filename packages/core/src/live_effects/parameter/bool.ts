// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/parameter/bool.cpp, src/live_effects/parameter/bool.h, src/util/numeric/converters.h
/*
 * Copyright (C) Johan Engelen 2007 <j.b.c.engelen@utwente.nl>
 */
import { C_ } from '../../i18n.ts';
import type { Effect } from '../effect.ts';
import { ParamType } from '../effect-enum.ts';
import { Parameter, type ParamWidget } from './parameter.ts';

/** Upstream Inkscape::Util::read_bool: "true" or "false", else the default. */
export function read_bool(value: string | null, default_value: boolean): boolean {
  if (value === null) return default_value;
  if (value.startsWith('true')) return true;
  if (value.startsWith('false')) return false;
  return default_value;
}

/** A check box parameter (upstream BoolParam). */
export class BoolParam extends Parameter {
  protected value: boolean;
  protected defvalue: boolean;

  constructor(label: string, tip: string, key: string, effect: Effect, default_value = false) {
    super(label, tip, key, effect);
    this.value = default_value;
    this.defvalue = default_value;
  }

  param_set_default(): void {
    this.param_setValue(this.defvalue);
  }
  param_update_default(default_value: boolean | string): void {
    this.defvalue =
      typeof default_value === 'boolean' ? default_value : read_bool(default_value, this.defvalue);
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
  param_newWidget(): ParamWidget | null {
    return this.widget_is_visible ? { kind: 'bool', value: this.value } : null;
  }
  param_set_from_widget(value: boolean): void {
    this.param_write_from_widget(value ? 'true' : 'false', C_('Undo', 'Change bool parameter'));
  }
  param_setValue(newvalue: boolean): void {
    if (this.value !== newvalue && this.param_effect) this.param_effect.refresh_widgets = true;
    this.value = newvalue;
  }
  get_value(): boolean {
    return this.value;
  }
  paramType(): ParamType {
    return ParamType.BOOL;
  }
}
