// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/colors/printer.cpp, src/colors/printer.h
/*
 * Copyright (C) 2023 AUTHORS
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

import { cssNumber } from '../svg/css-ostringstream.ts';

/** Number of digits after the period, upstream `precision(3)` with `std::fixed`. */
const PRINT_PRECISION = 3;

/**
 * Builds a CSS color function, for example `rgb(1 2 3 / 50%)`. Add numbers with `add`/`addInt`
 * (the upstream `<<` operators), then call `toString()`. Numbers past the channel count are
 * dropped, except the first one after the channels in a function with `_slash_opacity`, which
 * is written as a percentage opacity.
 */
export class CssPrinter {
  protected _slash_opacity = false;
  protected _done = false;
  protected _count = 0;
  protected _channels: number;
  protected _sep: string;
  #out = '';

  constructor(channels: number, prefix: string, ident = '', sep = ' ') {
    this._channels = channels;
    this._sep = sep;
    this.#out = `${prefix}(`;
    if (ident !== '') {
      this.#out += ident;
      this._count = 1;
      this._channels += 1;
    }
  }

  /** Add a number (upstream `operator<<(double)`). */
  add(value: number): this {
    if (!this._done) {
      if (this._count === this._channels && this._slash_opacity) {
        // We print opacity as a percentage
        this.#out += ` / ${Math.trunc(value * 100)}%`;
      } else if (this._count < this._channels) {
        let number = cssNumber(value, PRINT_PRECISION);
        if (number === '-0') number = '0';
        this.#out += (this._count ? this._sep : '') + number;
      }
      this._count++;
    }
    return this;
  }

  /** Add an integer (upstream `operator<<(int)`). */
  addInt(value: number): this {
    if (!this._done && this._count < this._channels) {
      this.#out += (this._count ? this._sep : '') + String(Math.trunc(value));
      this._count++;
    }
    return this;
  }

  /** Add all numbers that fit in the channels (upstream `operator<<(vector<double>)`). */
  addAll(values: readonly number[]): this {
    for (const value of values) {
      if (this._count < this._channels) this.add(value);
    }
    return this;
  }

  /** Add text as it is, for example a unit (upstream `operator<<(const char *)`). */
  addText(value: string): this {
    this.#out += value;
    return this;
  }

  /** Close the function and return it. Returns "" if there were fewer numbers than channels. */
  toString(): string {
    if (!this._done) {
      this._done = true;
      this.#out += ')';
    }
    if (this._count < this._channels) {
      console.error(` Expected ${this._channels} channels but got ${this._count}`);
      return '';
    }
    return this.#out;
  }
}

export class IccColorPrinter extends CssPrinter {
  constructor(channels: number, ident: string) {
    super(channels, 'icc-color', ident, ', ');
  }
}

export class CssLegacyPrinter extends CssPrinter {
  constructor(channels: number, prefix: string, opacity: boolean) {
    super(channels + (opacity ? 1 : 0), prefix + (opacity ? 'a' : ''), '', ', ');
  }
}

export class CssFuncPrinter extends CssPrinter {
  constructor(channels: number, prefix: string) {
    super(channels, prefix);
    this._slash_opacity = true;
  }
}

export class CssColorPrinter extends CssPrinter {
  constructor(channels: number, ident: string) {
    super(channels, 'color', ident);
    this._slash_opacity = true;
  }
}
