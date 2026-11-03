// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/parameter/message.cpp, src/live_effects/parameter/message.h
/*
 * Authors:
 *   Jabiertxo Arraiza Cenoz <jabier.arraiza@marker.es>
 */
import type { Effect } from '../effect.ts';
import { ParamType } from '../effect-enum.ts';
import { Parameter, type ParamWidget } from './parameter.ts';

/**
 * A message in the effect's widget (upstream MessageParam). The message is not stored in the
 * SVG: param_getSVGValue() is empty.
 */
export class MessageParam extends Parameter {
  protected defmessage: string;
  protected _legend: string;

  constructor(
    label: string,
    tip: string,
    key: string,
    effect: Effect,
    default_message: string,
    legend = 'Use Label',
  ) {
    super(label, tip, key, effect);
    this.defmessage = default_message;
    this._legend = legend === 'Use Label' ? label : legend;
  }

  param_set_default(): void {
    // do nothing
  }
  param_update_default(default_message: string): void {
    this.defmessage = default_message;
  }
  param_readSVGValue(strvalue: string): boolean {
    // do nothing if the strvalue is empty, stick to default value
    if (strvalue !== '') this.param_setValue(strvalue);
    return true;
  }
  param_getSVGValue(): string {
    // we dont want to store messages in the SVG
    return '';
  }
  param_getDefaultSVGValue(): string {
    return this.defmessage;
  }
  param_newWidget(): ParamWidget | null {
    return { kind: 'message', legend: this._legend, message: this.defmessage };
  }
  param_setValue(strvalue: string): void {
    if (strvalue !== this.defmessage) this.param_effect.refresh_widgets = true;
    this.defmessage = strvalue;
  }
  paramType(): ParamType {
    return ParamType.MESSAGE;
  }
}
