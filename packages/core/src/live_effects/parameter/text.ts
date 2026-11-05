// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/parameter/text.cpp, src/live_effects/parameter/text.h
/*
 * Authors:
 *   Maximilian Albert
 *   Johan Engelen
 *
 * Copyright (C) jucablues 2007 <jucablues@users.sourceforge.net>
 */
import { angle_between, type Path, Point } from '@inkscape-web/geom';
import type { Effect } from '../effect.ts';
import { ParamType } from '../effect-enum.ts';
import { arcLengthSamples } from '../pwd2.ts';
import { Parameter, type ParamWidget } from './parameter.ts';

/** The text that upstream shows on the canvas (CanvasItemText): where and how it is anchored. */
export interface CanvasText {
  text: string;
  /** Position in the coordinates of the item. */
  pos: Point;
  /** Which point of the text is at pos, from (0, 0) (top left) to (1, 1); see CanvasItemText::set_anchor. */
  anchor: Point;
}

/**
 * A text value (upstream TextParam). The text on the canvas (upstream a CanvasItemText) is
 * kept as canvasText(); drawing it is up to the editor.
 */
export class TextParam extends Parameter {
  protected value: string;
  protected defvalue: string;
  protected anchor_x = 0;
  protected anchor_y = 0;
  protected pos = new Point(0, 0);
  protected canvas_text_hidden = false;

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
  /** Do not show the text on the canvas. */
  param_hide_canvas_text(): void {
    this.canvas_text_hidden = true;
  }
  /** The text on the canvas, or null when it is hidden. */
  canvasText(): CanvasText | null {
    if (this.canvas_text_hidden) return null;
    return { text: this.value, pos: this.pos, anchor: new Point(this.anchor_x, this.anchor_y) };
  }
  setPos(pos: Point): void {
    this.pos = pos;
  }
  /**
   * Put the text at the fraction t of the length of path, `length` away from it on its left
   * (upstream takes the path as Piecewise<D2<SBasis>>), anchored to face the path.
   */
  setPosAndAnchor(path: Path, t: number, length: number): void {
    const total = arcLengthSamples(path, [])?.end;
    if (total === undefined) return;
    const sample = arcLengthSamples(path, [total * t])?.samples[0];
    if (!sample) return;
    const dir = sample.unit;
    const n = dir.rot90().neg();
    const angle = angle_between(dir, new Point(1, 0));
    this.pos = sample.point.add(n.mul(length));
    this.setAnchor(Math.sin(angle), -Math.cos(angle));
  }
  setAnchor(x_value: number, y_value: number): void {
    this.anchor_x = x_value;
    this.anchor_y = y_value;
  }
  get_value(): string {
    return this.value;
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
  paramType(): ParamType {
    return ParamType.TEXT;
  }
}

/**
 * A text that has no widget in the dialog; effects use it for text on the canvas that the user
 * cannot set (upstream TextParamInternal). It is not stored in the SVG.
 */
export class TextParamInternal extends TextParam {
  constructor(effect: Effect) {
    super('', '', '', effect);
    this.widget_is_visible = false;
  }

  override param_newWidget(): ParamWidget | null {
    return null;
  }

  override write_to_SVG(): void {}
}
