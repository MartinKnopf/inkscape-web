// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/parameter/fontbutton.cpp, src/live_effects/parameter/fontbutton.h
/*
 * Copyright (C) Jabiertxo Arraiza Cenoz 2014
 */
import type { Effect } from '../effect.ts';
import { ParamType } from '../effect-enum.ts';
import { Parameter, type ParamWidget } from './parameter.ts';

/**
 * A font as Pango font description string, "Sans Bold 10" (upstream FontButtonParam).
 * TODO: a font chooser in the dialog; it is a text entry.
 */
export class FontButtonParam extends Parameter {
  protected value: string;
  protected defvalue: string;

  constructor(label: string, tip: string, key: string, effect: Effect, default_value = 'Sans 10') {
    super(label, tip, key, effect);
    this.value = default_value;
    this.defvalue = default_value;
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
    return { kind: 'text', value: this.value };
  }
  param_setValue(newvalue: string): void {
    if (this.value !== newvalue) this.param_effect.refresh_widgets = true;
    this.value = newvalue;
  }
  get_value(): string {
    return this.value;
  }
  paramType(): ParamType {
    return ParamType.FONT_BUTTON;
  }
}
