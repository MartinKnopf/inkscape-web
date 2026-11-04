// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/parameter/colorpicker.cpp, src/live_effects/parameter/colorpicker.h
import { Color } from '../../colors/color.ts';
import { C_ } from '../../i18n.ts';
import type { Effect } from '../effect.ts';
import { ParamType } from '../effect-enum.ts';
import { Parameter, type ParamWidget } from './parameter.ts';

/** A color with opacity (upstream ColorPickerParam); it is stored as a CSS color string. */
export class ColorPickerParam extends Parameter {
  protected value: Color;
  protected defvalue: Color;

  constructor(label: string, tip: string, key: string, effect: Effect, default_color: Color) {
    super(label, tip, key, effect);
    this.value = default_color;
    this.defvalue = default_color;
  }

  param_set_default(): void {
    this.param_setValue(this.defvalue);
  }
  param_update_default(default_value: string | null): void {
    this.defvalue = Color.parse(default_value ?? '') ?? this.defvalue;
  }
  param_readSVGValue(strvalue: string): boolean {
    const color = Color.parse(strvalue);
    if (color) this.param_setValue(color);
    return true;
  }
  param_getSVGValue(): string {
    return this.value.toString();
  }
  param_getDefaultSVGValue(): string {
    return this.defvalue.toString();
  }
  param_newWidget(): ParamWidget | null {
    return { kind: 'color', color: this.value.toString(false), opacity: this.value.getOpacity() };
  }
  /** Set from the color picker: color is "#rrggbb", opacity 0 to 1. */
  param_set_from_widget(color: string, opacity: number): void {
    const parsed = Color.parse(color);
    if (!parsed) return;
    parsed.setOpacity(opacity);
    this.param_write_from_widget(parsed.toString(), C_('Undo', 'Change color button parameter'));
  }
  param_setValue(newvalue: Color): void {
    this.value = newvalue;
  }
  get_value(): Color {
    return this.value;
  }
  paramType(): ParamType {
    return ParamType.COLOR_PICKER;
  }
}
