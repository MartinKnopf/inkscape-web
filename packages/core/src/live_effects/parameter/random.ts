// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/parameter/random.cpp, src/live_effects/parameter/random.h
/*
 * Copyright (C) Johan Engelen 2007 <j.b.c.engelen@utwente.nl>
 */
import { C_ } from '../../i18n.ts';
import { svgNumber } from '../../svg/stringstream.ts';
import { spSvgNumberReadD } from '../../svg/svg-length.ts';
import type { Effect } from '../effect.ts';
import { EffectType, ParamType } from '../effect-enum.ts';
import { Parameter, type ParamWidget, SCALARPARAM_G_MAXDOUBLE } from './parameter.ts';

/* RNG stolen from /display/nr-filter-turbulence.cpp */
const RAND_m = 2147483647; // 2**31 - 1
const RAND_a = 16807; // 7**5; primitive root of m
const RAND_q = 127773; // m / a
const RAND_r = 2836; // m % a
const BSize = 0x100;

/**
 * A number with a seed: reading it as a number gives a new random value in [0, value]
 * (upstream RandomParam). The seed makes the sequence repeatable.
 */
export class RandomParam extends Parameter {
  protected startseed: number;
  protected seed: number;
  protected defseed: number;
  protected value: number;
  protected min = -SCALARPARAM_G_MAXDOUBLE;
  protected max = SCALARPARAM_G_MAXDOUBLE;
  protected integer = false;
  protected _randomsign: boolean;
  protected defvalue: number;

  constructor(
    label: string,
    tip: string,
    key: string,
    effect: Effect,
    default_value = 1.0,
    default_seed = 0,
    randomsign = false,
  ) {
    super(label, tip, key, effect);
    this.defvalue = default_value;
    this.value = default_value;
    this.defseed = default_seed;
    this.startseed = default_seed;
    this.seed = default_seed;
    this._randomsign = randomsign;
  }

  param_readSVGValue(strvalue: string): boolean {
    const [v, s] = strvalue.split(';', 2);
    const newval = spSvgNumberReadD(v);
    if (newval !== null) {
      const newstartseed = spSvgNumberReadD(s);
      if (newstartseed !== null) this.param_set_value(newval, Math.trunc(newstartseed));
      else this.param_set_value(newval, this.defseed);
      return true;
    }
    return false;
  }
  param_getSVGValue(): string {
    return `${svgNumber(this.value)};${svgNumber(this.startseed)}`;
  }
  param_getDefaultSVGValue(): string {
    return `${svgNumber(this.defvalue)};${svgNumber(this.defseed)}`;
  }
  param_set_default(): void {
    this.param_set_value(this.defvalue, this.defseed);
  }
  param_update_default(default_value: number | string): void {
    if (typeof default_value === 'number') {
      this.defvalue = default_value;
      return;
    }
    const newval = spSvgNumberReadD(default_value);
    if (newval !== null) this.defvalue = newval;
  }
  param_set_randomsign(randomsign: boolean): void {
    this._randomsign = randomsign;
  }
  param_set_value(val: number, newseed: number): void {
    this.value = val;
    if (this.integer) this.value = Math.round(this.value);
    if (this.value > this.max) this.value = this.max;
    if (this.value < this.min) this.value = this.min;
    this.startseed = this.#setup_seed(newseed);
    const version = this.param_effect.lpeversion.param_getSVGValue();
    if (
      this.startseed === RAND_m - 1 &&
      ((this.effectType() !== EffectType.ROUGH_HATCHES && this.effectType() !== EffectType.ROUGHEN) ||
        version >= '1.2')
    ) {
      this.startseed = Math.trunc(this.#rand() * this.startseed);
    }
    this.seed = this.startseed;
  }
  param_make_integer(yes = true): void {
    this.integer = yes;
  }
  param_set_range(min: number, max: number): void {
    this.min = Math.max(min, -SCALARPARAM_G_MAXDOUBLE);
    this.max = Math.min(max, SCALARPARAM_G_MAXDOUBLE);
  }
  resetRandomizer(): void {
    this.seed = this.startseed;
  }
  get_value(): number {
    return this.value;
  }
  /** Upstream operator gdouble(): the next random number, scaled by the value. */
  next(): number {
    if (this._randomsign) return this.#rand() * this.value - this.#rand() * this.value;
    return this.#rand() * this.value;
  }
  param_newWidget(): ParamWidget | null {
    return {
      kind: 'random',
      value: this.value,
      seed: this.startseed,
      min: this.min,
      max: this.max,
      integer: this.integer,
    };
  }
  /** Write a value and seed set in the widget. */
  param_set_from_widget(value: number, seed: number): void {
    this.param_write_from_widget(
      `${svgNumber(value)};${svgNumber(seed)}`,
      C_('Undo', 'Change random parameter'),
    );
  }
  paramType(): ParamType {
    return ParamType.RANDOM;
  }

  #setup_seed(lSeed: number): number {
    if (lSeed <= 0) lSeed = -(lSeed % (RAND_m - 1)) + 1;
    if (lSeed > RAND_m - 1) lSeed = RAND_m - 1;
    return lSeed;
  }

  /** generates random number between 0 and 1 */
  #rand(): number {
    let result = RAND_a * (this.seed % RAND_q) - RAND_r * Math.trunc(this.seed / RAND_q);
    if (result <= 0) result += RAND_m;
    this.seed = result;
    return (result % BSize) / BSize;
  }
}
