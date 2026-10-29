// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/parameter/path.cpp, src/live_effects/parameter/path.h
/*
 * Copyright (C) Johan Engelen 2007 <j.b.c.engelen@utwente.nl>
 *
 * Abhishek Sharma
 */
import { Affine, type PathVector } from '@inkscape-web/geom';
import { C_ } from '../../i18n.ts';
import type { SPLPEItem } from '../../object/sp-lpe-item.ts';
import { sp_svg_read_pathv, sp_svg_write_path } from '../../svg/svg-path.ts';
import { Signal } from '../../util/signal.ts';
import type { Effect } from '../effect.ts';
import { ParamType } from '../effect-enum.ts';
import { Parameter, type ParamWidget } from './parameter.ts';

/**
 * A path, edited on canvas with the node tool (upstream PathParam).
 * TODO: links to other paths ("#id" values), copy and paste with the clipboard.
 */
export class PathParam extends Parameter {
  /** Set when the path changes; effects that cache derived data reset it. */
  changed = true;
  protected _pathvector: PathVector = [];
  protected defvalue: string;
  _from_original_d = false;
  readonly signal_path_changed = new Signal<[]>();

  constructor(label: string, tip: string, key: string, effect: Effect, default_value = 'M0,0 L1,0') {
    super(label, tip, key, effect);
    this.defvalue = default_value;
    this.param_readSVGValue(this.defvalue);
    this.oncanvas_editable = true;
  }

  /** Reread the linked path (no links yet, see the class comment). */
  reload(): void {
    this.setUpdating(false);
  }

  /** The transform of the linked path relative to the item (identity without link). */
  get_relative_affine(): Affine {
    return Affine.identity();
  }

  get_pathvector(): PathVector {
    return this._pathvector;
  }

  param_set_default(): void {
    this.param_readSVGValue(this.defvalue);
  }
  param_set_and_write_default(): void {
    this.param_write_to_repr(this.defvalue);
  }
  param_readSVGValue(strvalue: string): boolean {
    this._pathvector = sp_svg_read_pathv(strvalue);
    this.emit_changed();
    return true;
  }
  param_getSVGValue(): string {
    return sp_svg_write_path(this._pathvector);
  }
  param_getDefaultSVGValue(): string {
    return this.defvalue;
  }
  param_update_default(default_value: string): void {
    this.defvalue = default_value;
  }
  param_newWidget(): ParamWidget | null {
    return { kind: 'path' };
  }
  override addCanvasIndicators(_lpeitem: SPLPEItem, hp_vec: PathVector[]): void {
    hp_vec.push(this._pathvector);
  }
  /** Only applies transform when not referring to other path! */
  override param_transform_multiply(postmul: Affine, _set: boolean): void {
    this.set_new_value(
      this._pathvector.map((p) => p.transformed(postmul)),
      true,
    );
  }

  /**
   * This method sets new path data.
   * If write_to_svg = true :
   *          The new path data is written to SVG. In this case the signal_path_changed signal
   *          is not directly emitted in this method, because writing to SVG
   *          triggers the LPEObject to which this belongs to call Effect::setParameter which calls
   *          PathParam::readSVGValue, which finally emits the signal_path_changed signal.
   * If write_to_svg = false :
   *          The new path data is not written to SVG. This method will emit the signal_path_changed signal.
   */
  set_new_value(newpath: PathVector, write_to_svg: boolean): void {
    if (newpath.length === 0) {
      this.param_set_and_write_default();
      return;
    }
    this._pathvector = newpath;
    if (write_to_svg) this.param_write_to_repr(sp_svg_write_path(this._pathvector));
    else this.emit_changed();
  }

  /** Paste path data in document coordinates (upstream paste_param_path with the selected item). */
  paste_param_path(svgd: string, item: SPLPEItem | null): void {
    if (!svgd) return;
    let d = svgd;
    if (item) {
      const m = item.i2docAffine().inverse();
      d = sp_svg_write_path(sp_svg_read_pathv(svgd).map((p) => p.transformed(m)));
    }
    this.param_write_to_repr(d);
    this.param_effect.makeUndoDone(C_('Undo', 'Paste path parameter'));
  }

  emit_changed(): void {
    this.changed = true;
    this.signal_path_changed.emit();
  }

  paramType(): ParamType {
    return ParamType.PATH;
  }
}
