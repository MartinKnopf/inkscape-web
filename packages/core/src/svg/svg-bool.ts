// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/svg/svg-bool.cpp, src/svg/svg-bool.h
/*
 * Authors:
 *   Martin Owens <doctormo@geek-2.com>
 *
 * Copyright (C) 2021 Martin Owens
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

/**
 * This boolean is not an SVG specification type, but it is something
 * Inkscape uses for many of its internal values.
 */
export class SVGBool {
  #isSet = false;
  #value = false;
  readonly #default: boolean;

  constructor(defaultValue: boolean) {
    this.#default = defaultValue;
  }

  /** The value, or the default when unset. Upstream: operator bool */
  get value(): boolean {
    return this.#isSet ? this.#value : this.#default;
  }

  /** "true", "yes", "y" (any case) and numbers starting with a non-zero integer are true. */
  read(str: string | null | undefined): boolean {
    if (str == null) return false;
    this.#isSet = true;
    // atoi: optional white space, sign, digits.
    const n = Number.parseInt(/^[ \t\n\v\f\r]*[+-]?\d+/.exec(str)?.[0] ?? '0', 10);
    this.#value = /^(true|yes|y)$/i.test(str) || n !== 0;
    return true;
  }

  unset(): void {
    this.#isSet = false;
  }

  readOrUnset(str: string | null | undefined): void {
    if (!this.read(str)) this.unset();
  }
}
