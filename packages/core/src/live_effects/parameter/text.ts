// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/parameter/text.cpp, src/live_effects/parameter/text.h
/*
 * Authors:
 *   Maximilian Albert
 *   Johan Engelen
 *
 * Copyright (C) jucablues 2007 <jucablues@users.sourceforge.net>
 */
import type { Effect } from '../effect.ts';
import { ParamType } from '../effect-enum.ts';
import { Parameter, type ParamWidget } from './parameter.ts';

/**
 * A text value (upstream TextParam).
 * TODO: the text on the canvas (setPos, setPosAndAnchor; used by Ruler and Measure segments).
 */
export class TextParam extends Parameter {
  protected value: string;
  protected defvalue: string;

  constructor(label: string, tip: string, key: string, effect: Effect, default_value = '') {
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
  /** Do not show the text on the canvas (no canvas text here yet). */
  param_hide_canvas_text(): void {}
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
  paramType(): ParamType {
    return ParamType.TEXT;
  }
}
