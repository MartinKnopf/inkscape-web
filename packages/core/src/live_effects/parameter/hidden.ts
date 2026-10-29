// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/parameter/hidden.cpp, src/live_effects/parameter/hidden.h
/*
 * Copyright (C) Johan Engelen 2007 <j.b.c.engelen@utwente.nl>
 */
import type { Effect } from '../effect.ts';
import { ParamType } from '../effect-enum.ts';
import { Parameter, type ParamWidget } from './parameter.ts';

/** A string parameter without widget (upstream HiddenParam). */
export class HiddenParam extends Parameter {
  protected value: string;
  protected defvalue: string;

  constructor(
    label: string,
    tip: string,
    key: string,
    effect: Effect,
    default_value = '',
    is_visible = false,
  ) {
    super(label, tip, key, effect);
    this.value = default_value;
    this.defvalue = default_value;
    this.param_widget_is_visible(is_visible);
  }

  param_set_default(): void {
    this.param_setValue(this.defvalue);
  }
  param_update_default(default_value: string): void {
    this.defvalue = default_value;
  }
  param_readSVGValue(strvalue: string): boolean {
    this.param_setValue(strvalue);
    return true;
  }
  param_getSVGValue(): string {
    return this.value;
  }
  param_getDefaultSVGValue(): string {
    return this.defvalue;
  }
  param_newWidget(): ParamWidget | null {
    return null;
  }
  param_setValue(newvalue: string, write = false): void {
    this.value = newvalue;
    if (write) this.param_write_to_repr(this.value);
  }
  paramType(): ParamType {
    return ParamType.HIDDEN;
  }
}
