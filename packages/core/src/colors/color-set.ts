// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/colors/color-set.cpp, src/colors/color-set.h
/** @file
 * A set of colors which can be modified together used for color pickers
 */ /*
 * Copyright (C) 2024 Authors
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

import { Signal } from '../util/signal.ts';
import { Color } from './color.ts';
import { ColorError } from './forward.ts';
import type { AnySpace } from './spaces/base.ts';
import type { Component, Components } from './spaces/components.ts';

/** The colors of a set, with an id for each. */
export type IdColors = [string, Color][];

/**
 * A set of colors that are changed together. The set can be constrained to a color space and to
 * having or not having opacity; the colors in it are converted when they are added.
 */
export class ColorSet {
  // Signals allow the set to be tied into various interfaces
  readonly signal_grabbed = new Signal<[]>();
  readonly signal_released = new Signal<[]>();
  readonly signal_changed = new Signal<[]>();
  readonly signal_cleared = new Signal<[]>();

  #colors: IdColors = [];
  // Utility container for very fast id lookup
  #colors_index = new Map<string, number>();

  // Constraints can only be set up at construction so are immutable.
  readonly #space_constraint: AnySpace | undefined;
  readonly #alpha_constraint: boolean | undefined;

  // States which are set during the lifetime of the set
  #grabbed = false;
  #blocked = false;

  constructor(space?: AnySpace, alpha?: boolean) {
    this.#space_constraint = space;
    this.#alpha_constraint = alpha;
  }

  [Symbol.iterator](): Iterator<[string, Color]> {
    return this.#colors[Symbol.iterator]();
  }

  isBlocked(): boolean {
    return this.#blocked;
  }
  isGrabbed(): boolean {
    return this.#grabbed;
  }

  grab(): void {
    if (!this.#blocked && !this.#grabbed) {
      this.block();
      this.signal_grabbed.emit();
      this.unblock();
      this.#grabbed = true;
    }
  }

  release(): void {
    if (!this.#blocked && this.#grabbed) {
      this.#grabbed = false;
      this.block();
      this.signal_released.emit();
      this.unblock();
    }
  }

  block(): void {
    this.#blocked = true;
  }
  unblock(): void {
    this.#blocked = false;
  }

  /** Information about the color set's meta data */
  getComponents(): Components {
    if (!this.#space_constraint) {
      throw new ColorError('Components are only available on a color space constrained ColorSet.');
    }
    return this.#space_constraint.getComponents(this.#alpha_constraint === true);
  }

  getSpaceConstraint(): AnySpace | undefined {
    return this.#space_constraint;
  }

  getAlphaConstraint(): boolean | undefined {
    return this.#alpha_constraint;
  }

  /** Remove all colors. */
  clear(): void {
    if (this.#colors.length > 0) {
      this.#colors = [];
      this.#colors_index.clear();
      this.#colors_cleared();
    }
  }

  #colors_changed(): void {
    // Send signals about this change
    if (!this.#blocked) {
      this.block();
      this.signal_changed.emit();
      this.unblock();
    }
  }

  #colors_cleared(): void {
    if (!this.#blocked) {
      this.block();
      this.signal_cleared.emit();
      this.unblock();
    }
  }

  /** True if all colors are the same. */
  isSame(): boolean {
    if (this.#colors.length === 0) return true;
    for (const [, color] of this.#colors) {
      if (!color.equals(this.#colors[0]![1])) return false;
    }
    return true;
  }

  /**
   * Set a single color (i.e. not a list of colors), or the color with the given id.
   * Returns true if the set changed.
   */
  set(color: Color): boolean;
  set(id: string, color: Color): boolean;
  set(a: Color | string, b?: Color): boolean {
    if (typeof a === 'string') {
      if (this.#set(a, b!)) {
        this.#colors_changed();
        return true;
      }
      return false;
    }
    // Always clear the colors if it's being used differently
    if (this.#colors.length !== 1 || this.#colors[0]![0] !== 'single') {
      this.#colors = [];
      this.#colors_index.clear();
    }
    return this.set('single', a);
  }

  /** The single color, or the color with the given id (normalized). */
  get(id = 'single'): Color | undefined {
    const index = this.#colors_index.get(id);
    if (index !== undefined) {
      return this.#colors[index]![1].normalized();
    }
    return undefined;
  }

  #set(id: string, other: Color): boolean {
    const index = this.#colors_index.get(id);
    if (index !== undefined) {
      const color = this.#colors[index]![1];
      const was = color.clone();
      color.set(other, true);
      return !was.equals(color);
    }

    // Add a new entry for this id
    const copy = other.clone();

    // Enforce constraints on space and alpha if any
    if (this.#space_constraint) copy.convert(this.#space_constraint);
    if (this.#alpha_constraint !== undefined) {
      copy.enableOpacity(this.#alpha_constraint);
    }

    const pos = this.#colors.length;
    this.#colors.push([id, copy]);
    this.#colors_index.set(id, pos);
    return true;
  }

  /**
   * Change the colors in some way and send signals. Returns the number of colors that changed.
   * With a set, its colors are set by id; with a color, all colors are set to it (keeping
   * their space); with a component, that channel of all colors is set to the value.
   */
  setAll(other: ColorSet | Color | Component, value?: number): number {
    let changed = 0;
    if (other instanceof ColorSet) {
      for (const [id, color] of other) {
        changed += Number(this.#set(id, color));
      }
    } else if (other instanceof Color) {
      for (const [, color] of this.#colors) {
        const was = color.clone();
        color.set(other, true);
        // Comparison after possible color space conversion
        changed += Number(!was.equals(color));
      }
    } else {
      if (!this.isValid(other)) {
        throw new ColorError('Incompatible color component used in ColorSet::set.');
      }
      for (const [, color] of this.#colors) {
        const was = color.clone();
        color.set(other.index, value!);
        // Comparison after possible color space conversion
        changed += Number(!was.equals(color));
      }
    }
    if (changed) {
      this.#colors_changed();
    }
    return changed;
  }

  /** The values of a component of all colors, normalized. */
  getAll(c: Component): number[] {
    if (!this.isValid(c)) {
      throw new ColorError('Incompatible color component used in ColorSet::getAll.');
    }
    return this.#colors.map(([, color]) => c.normalize(color.get(c.index)));
  }

  /** Move the average of a component to the value, by moving all colors by the same amount. */
  setAverage(c: Component, value: number): void {
    if (!this.#space_constraint || this.#space_constraint.getComponentType() !== c.type) {
      throw new ColorError('Incompatible color component used in ColorSet::moveAverageTo.');
    }
    const delta = value - this.getAverage(c);
    for (const [, color] of this.#colors) {
      color.set(c.index, color.get(c.index) + delta);
    }
    this.#colors_changed();
  }

  /** The average of a component, normalized. */
  getAverage(c: Component): number;
  /** The average color, in the best space of the set. */
  getAverage(): Color;
  getAverage(c?: Component): Color | number {
    if (c) {
      if (!this.isValid(c)) {
        throw new ColorError('Incompatible color component used in ColorSet::get.');
      }
      let value = 0.0;
      for (const [, color] of this.#colors) {
        value += color.get(c.index);
      }
      return c.normalize(value / this.#colors.length);
    }
    if (this.isEmpty()) {
      throw new ColorError("Can't get the average color of no colors.");
    }
    const avg_space = this.getBestSpace()!;
    const avg_alpha = this.#alpha_constraint ?? true;
    const values = new Array<number>(avg_space.getComponentCount() + Number(avg_alpha)).fill(0);
    for (const [, color] of this.#colors) {
      // Colors::Color will return the alpha channel as 1.0 if it doesn't exist.
      const copy = color.getSpace() === avg_space ? color : color.converted(avg_space);
      if (copy) {
        for (let i = 0; i < values.length; i++) {
          values[i] = values[i]! + copy.get(i);
        }
      }
    }
    for (let i = 0; i < values.length; i++) {
      values[i] = values[i]! / this.#colors.length;
    }
    return new Color(avg_space, values);
  }

  /** Ask for information about the whole set of colors */
  size(): number {
    return this.#colors.length;
  }

  isEmpty(): boolean {
    return this.#colors.length === 0;
  }

  /** The constrained space, or else the space most colors are in. */
  getBestSpace(): AnySpace | undefined {
    if (this.#space_constraint) return this.#space_constraint;
    let biggest = 0;
    let ret: AnySpace | undefined;
    const counts = new Map<AnySpace, number>();
    for (const [, color] of this.#colors) {
      const space = color.getSpace();
      const count = (counts.get(space) ?? 0) + 1;
      counts.set(space, count);
      if (count > biggest) {
        biggest = count;
        ret = space;
      }
    }
    return ret;
  }

  isValid(component: Component): boolean {
    return this.#space_constraint?.getComponentType() === component.type;
  }
}
