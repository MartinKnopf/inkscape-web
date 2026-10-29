// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/widget/scalar-unit.cpp, src/ui/widget/scalar-unit.h, src/ui/widget/unit-menu.cpp, src/ui/widget/unit-menu.h
/*
 * Authors:
 *   Bryce Harrington <bryceharrington@gmail.com>
 *   Derek P. Moore <derekm@hackunix.org>
 *   Bruno Dilly <bruno.dilly@gmail.com>
 *   Johan Engelen <j.b.c.engelen@utwente.nl>
 *   Abhishek Sharma
 *
 * Copyright (C) 2004-2011 Authors
 */
import { getUnit, primaryUnit, UnitType, unitsOfType } from '@inkscape-web/core';

/** A menu of units (upstream UnitMenu). Several ScalarUnits can share one. */
export class UnitMenu {
  /** The abbreviations of the entries. */
  readonly units: readonly string[];
  #unit: string;
  readonly #listeners = new Set<() => void>();

  /** types: the unit types of the entries, in order; the primary unit of the last type is selected. */
  constructor(...types: UnitType[]) {
    this.units = types.flatMap((t) => unitsOfType(t).map((u) => u.abbr));
    this.#unit = primaryUnit(types[types.length - 1] as UnitType);
  }

  get unit(): string {
    return this.#unit;
  }

  /** Select unit; the ScalarUnits of the menu convert their values. */
  setUnit(unit: string): void {
    if (unit === this.#unit) return;
    this.#unit = unit;
    for (const f of [...this.#listeners]) f();
  }

  onChanged(slot: () => void): void {
    this.#listeners.add(slot);
  }

  getUnitType(): UnitType {
    return getUnit(this.#unit).type;
  }

  /** Whether the selected unit is not a percentage. */
  isAbsolute(): boolean {
    return this.getUnitType() !== UnitType.DIMENSIONLESS;
  }

  isRadial(): boolean {
    return this.getUnitType() === UnitType.RADIAL;
  }

  /** Factor from the selected unit (or oldUnit) to newUnit. */
  getConversion(newUnit: string, oldUnit: string = this.#unit): number {
    const oldFactor = getUnit(oldUnit).factor;
    const newFactor = getUnit(newUnit).factor;
    if (oldFactor < 0.0000001 || newFactor < 0.0000001) return 0;
    return oldFactor / newFactor;
  }
}

/**
 * A number with a unit menu (upstream ScalarUnit). The value is in the
 * selected unit of the menu. Percentages work against hundredPercent, a
 * length in px.
 */
export class ScalarUnit {
  value = 0;
  hundredPercent = 0;
  absoluteIsIncrement = false;
  percentageIsIncrement = false;
  #lastUnits: string;

  constructor(readonly menu: UnitMenu) {
    this.#lastUnits = menu.unit;
    menu.onChanged(() => this.#onUnitChanged());
  }

  /** The value in unit, or in the selected unit if unit is undefined. */
  getValue(unit?: string): number {
    return unit === undefined ? this.value : this.menu.getConversion(unit) * this.value;
  }

  /** Set the value; with unit, select it first. The value is not converted. */
  setValue(value: number, unit?: string): void {
    if (unit !== undefined) this.menu.setUnit(unit);
    this.value = value;
  }

  /** The value in the unit that is selected, from a value in px. */
  fromPx(px: number): number {
    return px / this.menu.getConversion('px');
  }

  #percentageToAbsolute(value: number): number {
    const hundredConverted = this.hundredPercent / this.menu.getConversion('px');
    if (this.percentageIsIncrement) value += 100;
    let converted = 0.01 * hundredConverted * value;
    if (this.absoluteIsIncrement) converted -= hundredConverted;
    return converted;
  }

  #absoluteToPercentage(value: number): number {
    if (this.hundredPercent === 0) return this.percentageIsIncrement ? 0 : 100;
    const hundredConverted = this.hundredPercent / this.menu.getConversion('px', this.#lastUnits);
    if (this.absoluteIsIncrement) value += hundredConverted;
    let converted = (100 * value) / hundredConverted;
    if (this.percentageIsIncrement) converted -= 100;
    return converted;
  }

  /** The value as a percentage of hundredPercent, whatever the unit. */
  getAsPercentage(): number {
    return this.#absoluteToPercentage(this.value);
  }

  /** Set the value from a percentage of hundredPercent, in the selected unit. */
  setFromPercentage(percent: number): void {
    this.value = this.#percentageToAbsolute(percent);
  }

  /** Convert the value to the new unit of the menu (upstream on_unit_changed). */
  #onUnitChanged(): void {
    const oldType = getUnit(this.#lastUnits).type;
    const newType = this.menu.getUnitType();
    if (oldType === UnitType.DIMENSIONLESS && newType === UnitType.LINEAR) {
      this.value = this.#percentageToAbsolute(this.value);
    } else if (oldType === UnitType.LINEAR && newType === UnitType.DIMENSIONLESS) {
      this.value = this.#absoluteToPercentage(this.value);
    } else {
      this.value = this.value / this.menu.getConversion(this.#lastUnits);
    }
    this.#lastUnits = this.menu.unit;
  }
}
