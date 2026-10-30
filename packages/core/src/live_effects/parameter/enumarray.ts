// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/parameter/enumarray.h
/*
 * Copyright (C) Johan Engelen 2007 <j.b.c.engelen@utwente.nl>
 */
import { _, C_ } from '../../i18n.ts';
import type { EnumDataConverter } from '../../util/enums.ts';
import type { Effect } from '../effect.ts';
import { ParamType } from '../effect-enum.ts';
import { StringArrayParam } from './array.ts';
import type { ParamWidget } from './parameter.ts';

/** An enumeration key per subpath; the widget edits the active one (upstream EnumArrayParam). */
export class EnumArrayParam extends StringArrayParam {
  _active_index = 0;
  #defvalue: number;
  readonly #sorted: boolean;
  readonly #enumdataconv: EnumDataConverter<number>;

  constructor(
    label: string,
    tip: string,
    key: string,
    c: EnumDataConverter<number>,
    effect: Effect,
    default_value: number,
    visible = true,
    n = 0,
    sort = true,
  ) {
    super(label, tip, key, effect, n);
    this.#defvalue = default_value;
    this.#enumdataconv = c;
    this.#sorted = sort;
    this.widget_is_visible = visible;
  }

  override param_newWidget(): ParamWidget | null {
    if (!this.widget_is_visible || !this.valid_index(this._active_index)) return null;
    const options: { key: string; label: string }[] = [];
    for (let i = 0; i < this.#enumdataconv._length; i++) {
      const d = this.#enumdataconv.data(i);
      options.push({ key: d.key, label: _(d.label) });
    }
    if (this.#sorted) options.sort((a, b) => a.label.localeCompare(b.label));
    return { kind: 'enum', value: this._vector[this._active_index] as string, options };
  }

  /** Set the active element from the widget (upstream _on_change_combo). */
  param_set_from_widget(key: string): void {
    if (!key) return;
    const v = [...this._vector];
    v[this._active_index] = key;
    this.param_write_from_widget(this.writesvg(v), C_('Undo', 'Change enumeration parameter'));
  }

  param_setActive(index: number): void {
    this._active_index = index;
    this.param_effect.refresh_widgets = true;
  }
  override param_getDefaultSVGValue(): string {
    return this.#enumdataconv.get_key(this.#defvalue);
  }
  override param_set_default(): void {
    this._vector = this._vector.map(() => this.#enumdataconv.get_key(this.#defvalue));
  }
  override param_update_default(default_value: number | string): void {
    this.#defvalue =
      typeof default_value === 'number' ? default_value : this.#enumdataconv.get_id_from_key(default_value);
  }
  override paramType(): ParamType {
    return ParamType.ENUM_ARRAY;
  }
}
