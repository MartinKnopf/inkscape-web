// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/parameter/enum.h
/*
 * Copyright (C) Johan Engelen 2007 <j.b.c.engelen@utwente.nl>
 */
import { _, C_ } from '../../i18n.ts';
import type { EnumDataConverter } from '../../util/enums.ts';
import type { Effect } from '../effect.ts';
import { ParamType } from '../effect-enum.ts';
import { Parameter, type ParamWidget } from './parameter.ts';

/** A choice from an enumeration, written as its key (upstream EnumParam<E>). */
export class EnumParam<E extends number> extends Parameter {
  private value: E;
  private defvalue: E;
  private readonly sorted: boolean;
  private readonly enumdataconv: EnumDataConverter<E>;

  constructor(
    label: string,
    tip: string,
    key: string,
    c: EnumDataConverter<E>,
    effect: Effect,
    default_value: E,
    sort = true,
  ) {
    super(label, tip, key, effect);
    this.enumdataconv = c;
    this.defvalue = default_value;
    this.value = default_value;
    this.sorted = sort;
  }

  param_newWidget(): ParamWidget | null {
    const options: { key: string; label: string }[] = [];
    for (let i = 0; i < this.enumdataconv._length; i++) {
      const d = this.enumdataconv.data(i);
      options.push({ key: d.key, label: _(d.label) });
    }
    if (this.sorted) options.sort((a, b) => a.label.localeCompare(b.label));
    return { kind: 'enum', value: this.param_getSVGValue(), options };
  }
  param_set_from_widget(key: string): void {
    this.param_write_from_widget(key, C_('Undo', 'Change enumeration parameter'));
  }
  param_readSVGValue(strvalue: string | null): boolean {
    if (strvalue === null) {
      this.param_set_default();
      return true;
    }
    this.param_set_value(this.enumdataconv.get_id_from_key(strvalue));
    return true;
  }
  param_getSVGValue(): string {
    return this.enumdataconv.get_key(this.value);
  }
  param_getDefaultSVGValue(): string {
    return this.enumdataconv.get_key(this.defvalue);
  }
  get_value(): E {
    return this.value;
  }
  param_set_default(): void {
    this.param_set_value(this.defvalue);
  }
  param_update_default(default_value: E | string): void {
    this.defvalue =
      typeof default_value === 'string' ? this.enumdataconv.get_id_from_key(default_value) : default_value;
  }
  param_set_value(val: E): void {
    this.value = val;
  }
  paramType(): ParamType {
    return ParamType.ENUM;
  }
}
