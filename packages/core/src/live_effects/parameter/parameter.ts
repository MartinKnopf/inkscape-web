// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/parameter/parameter.cpp, src/live_effects/parameter/parameter.h
/*
 * Copyright (C) Johan Engelen 2007 <j.b.c.engelen@utwente.nl>
 */
import type { Affine, PathVector } from '@inkscape-web/geom';
import { DocumentUndo } from '../../document-undo.ts';
import { C_ } from '../../i18n.ts';
import type { SPItem } from '../../object/sp-item.ts';
import type { SPLPEItem } from '../../object/sp-lpe-item.ts';
import type { SPObject } from '../../object/sp-object.ts';
import { Preferences } from '../../preferences.ts';
import { svgNumber } from '../../svg/stringstream.ts';
import { spSvgNumberReadD } from '../../svg/svg-length.ts';
import type { KnotHolder } from '../../ui/knot/knot-holder-entity.ts';
import type { Effect } from '../effect.ts';
import { EffectType, ParamType } from '../effect-enum.ts';

// In gtk2, this wasn't an issue; we could toss around
// G_MAXDOUBLE and not worry about size allocations. But
// in gtk3, it is an issue: it allocates widget size for the maxmium
// value you pass to it, leading to some insane lengths.
// If you need this to be more, please be conservative about it.
export const SCALARPARAM_G_MAXDOUBLE = 10000000000.0; // TODO fixme: using an arbitrary large number as a magic value seems fragile.

/**
 * The description of the widget of a parameter for the Path Effects dialog (upstream:
 * param_newWidget() builds a GTK widget). The dialog renders it and writes the new value with
 * Parameter.param_write_from_widget().
 */
export type ParamWidget =
  | {
      kind: 'scalar';
      value: number;
      min: number;
      max: number;
      digits: number;
      inc_step: number;
      inc_page: number;
      slider: boolean;
    }
  | { kind: 'bool'; value: boolean }
  | { kind: 'toggle'; value: boolean; label_on: string; label_off: string }
  | { kind: 'enum'; value: string; options: { key: string; label: string }[] }
  | { kind: 'point'; x: number; y: number }
  | { kind: 'unit'; value: string; options: string[] }
  | { kind: 'random'; value: number; seed: number; min: number; max: number; integer: boolean }
  | { kind: 'path' }
  | { kind: 'buttons'; buttons: { label: string; onClick: () => void }[] };

/** Base class of the parameters of an effect (upstream Inkscape::LivePathEffect::Parameter). */
export abstract class Parameter {
  param_key: string;
  param_tooltip: string;
  param_label: string;
  oncanvas_editable = false;
  widget_is_visible = true;
  widget_is_enabled = true;
  protected _updating = false;
  protected param_effect: Effect;

  constructor(label: string, tip: string, key: string, effect: Effect) {
    this.param_key = key;
    this.param_label = label;
    this.param_tooltip = tip;
    this.param_effect = effect;
  }

  /** Read the value from SVG; returns true if new value is valid / accepted. */
  abstract param_readSVGValue(strvalue: string): boolean;
  abstract param_getSVGValue(): string;
  abstract param_getDefaultSVGValue(): string;
  abstract param_set_default(): void;
  abstract param_update_default(default_value: string): void;
  /** The widget for the dialog, or null for none (upstream creates a GTK widget). */
  abstract param_newWidget(): ParamWidget | null;
  /** force all LPE params has overrided method */
  abstract paramType(): ParamType;

  param_widget_is_visible(is_visible: boolean): void {
    this.widget_is_visible = is_visible;
  }
  param_widget_is_enabled(is_enabled: boolean): void {
    this.widget_is_enabled = is_enabled;
  }
  setUpdating(updating: boolean): void {
    this._updating = updating;
  }
  getUpdating(): boolean {
    return this._updating;
  }
  param_getTooltip(): string {
    return this.param_tooltip;
  }

  // overload these for your particular parameter to make it provide knotholder handles or canvas helperpaths
  providesKnotHolderEntities(): boolean {
    return false;
  }
  addKnotHolderEntities(_knotholder: KnotHolder, _item: SPItem): void {}
  addCanvasIndicators(_lpeitem: SPLPEItem, _hp_vec: PathVector[]): void {}
  param_transform_multiply(_postmul: Affine, _set: boolean): void {}
  /** we get satellites of parameter, virtual function overided by some parameter with linked satellites */
  param_get_satellites(): SPObject[] {
    return [];
  }
  update_satellites(): void {}

  effectType(): EffectType {
    return this.param_effect ? this.param_effect.effectType() : EffectType.INVALID_LPE;
  }

  write_to_SVG(): void {
    this.param_write_to_repr(this.param_getSVGValue());
  }

  /**
   * sometimes for example on ungrouping or loading documents we need to relay in stored value instead the volatile
   * version in the parameter
   */
  read_from_SVG(): void {
    const val = this.param_effect.getRepr()?.attribute(this.param_key);
    if (val !== null && val !== undefined) this.param_readSVGValue(val);
  }

  protected param_write_to_repr(svgd: string | null): void {
    this.param_effect.getRepr()?.setAttribute(this.param_key, svgd);
  }

  /**
   * Write a value that the user set in the widget, as one undo step (upstream
   * RegisteredWidget::write_to_xml with the undo parameters of the widget).
   */
  param_write_from_widget(svgstr: string, event_description: string): void {
    const repr = this.param_effect.getRepr();
    const doc = this.param_effect.getSPDoc();
    if (!repr || !doc) return;
    repr.setAttribute(this.param_key, svgstr);
    this.param_effect.onParamWidgetChanged(this);
    DocumentUndo.done(doc, event_description, 'dialog-path-effects');
  }
}

/** A number parameter (upstream ScalarParam). */
export class ScalarParam extends Parameter {
  protected value: number;
  protected min = -SCALARPARAM_G_MAXDOUBLE;
  protected max = SCALARPARAM_G_MAXDOUBLE;
  protected integer = false;
  protected defvalue: number;
  protected digits = 2;
  protected inc_step = 0.1;
  protected inc_page = 1;
  protected add_slider = false;
  protected _set_undo = true;
  protected _no_leading_zeros = false;
  protected _width_chars = -1;

  constructor(label: string, tip: string, key: string, effect: Effect, default_value = 1.0) {
    super(label, tip, key, effect);
    this.value = default_value;
    this.defvalue = default_value;
  }

  param_readSVGValue(strvalue: string): boolean {
    const newval = spSvgNumberReadD(strvalue);
    if (newval !== null) {
      this.param_set_value(newval);
      return true;
    }
    return false;
  }
  param_getSVGValue(): string {
    return svgNumber(this.value);
  }
  param_getDefaultSVGValue(): string {
    return svgNumber(this.defvalue);
  }
  override param_transform_multiply(postmul: Affine, set: boolean): void {
    const transform_stroke = Preferences.get().getBool('/options/transform/stroke', true);
    if (transform_stroke || set) {
      this.param_set_value(this.value * postmul.descrim());
      this.write_to_SVG();
    }
  }
  param_set_default(): void {
    this.param_set_value(this.defvalue);
  }
  param_update_default(default_value: number | string): void {
    if (typeof default_value === 'number') {
      this.defvalue = default_value;
      return;
    }
    const newval = spSvgNumberReadD(default_value);
    if (newval !== null) this.defvalue = newval;
  }
  param_set_value(val: number): void {
    this.value = val;
    if (this.integer) this.value = Math.round(this.value);
    if (this.value > this.max) this.value = this.max;
    if (this.value < this.min) this.value = this.min;
  }
  param_make_integer(yes = true): void {
    this.integer = yes;
    this.digits = 0;
    this.inc_step = 1;
    this.inc_page = 10;
  }
  param_set_range(min: number, max: number): void {
    this.min = Math.max(min, -SCALARPARAM_G_MAXDOUBLE);
    this.max = Math.min(max, SCALARPARAM_G_MAXDOUBLE);
    this.param_set_value(this.value); // reset value to see whether it is in ranges
  }
  param_set_digits(digits: number): void {
    this.digits = digits;
  }
  param_set_increments(step: number, page: number): void {
    this.inc_step = step;
    this.inc_page = page;
  }
  param_set_no_leading_zeros(): void {
    this._no_leading_zeros = true;
  }
  param_set_width_chars(width_chars: number): void {
    this._width_chars = width_chars;
  }
  addSlider(add_slider_widget: boolean): void {
    this.add_slider = add_slider_widget;
  }
  param_get_max(): number {
    return this.max;
  }
  param_get_min(): number {
    return this.min;
  }
  param_set_undo(set_undo: boolean): void {
    this._set_undo = set_undo;
  }
  param_newWidget(): ParamWidget | null {
    if (!this.widget_is_visible) return null;
    return {
      kind: 'scalar',
      value: this.value,
      min: this.min,
      max: this.max,
      digits: this.digits,
      inc_step: this.inc_step,
      inc_page: this.inc_page,
      slider: this.add_slider,
    };
  }
  /** Write a value set in the widget (one undo step unless param_set_undo(false)). */
  param_set_from_widget(value: number): void {
    if (this._set_undo) this.param_write_from_widget(svgNumber(value), C_('Undo', 'Change scalar parameter'));
    else this.param_write_to_repr(svgNumber(value));
  }
  paramType(): ParamType {
    return ParamType.SCALAR;
  }
  get_value(): number {
    return this.value;
  }
}
