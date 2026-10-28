// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/number-opt-number.h
/*
 * <number-opt-number> implementation.
 *
 * Authors:
 *   Hugo Rodrigues <haa.rodrigues@gmail.com>
 *
 * Copyright (C) 2006 Hugo Rodrigues
 */
import { svgNumber } from './svg/stringstream.ts';

/** A number with an optional second number, as in stdDeviation="2 3" (upstream NumberOptNumber). */
export class NumberOptNumber {
  #num = 0;
  #optnum = 0;
  #set = false;
  #optset = false;

  constructor(num?: number, optnum?: number) {
    if (num !== undefined) {
      this.#num = num;
      this.#set = true;
    }
    if (optnum !== undefined) {
      this.#optnum = optnum;
      this.#optset = true;
    }
  }

  /** The number, or -1 if not set. */
  getNumber(): number {
    return this.#set ? this.#num : -1;
  }

  /** The optional number; if not set, the number (or_num) or -1. */
  getOptNumber(or_num = false): number {
    return this.#optset ? this.#optnum : or_num ? this.#num : -1;
  }

  setNumber(num: number): void {
    this.#set = true;
    this.#num = num;
  }

  setOptNumber(optnum: number): void {
    this.#optset = optnum !== -1;
    this.#optnum = optnum;
  }

  numIsSet(): boolean {
    return this.#set;
  }

  optNumIsSet(): boolean {
    return this.#optset;
  }

  getValueString(): string {
    if (!this.#set) return '';
    return this.#optset ? `${svgNumber(this.#num)} ${svgNumber(this.#optnum)}` : svgNumber(this.#num);
  }

  /** Read "num [optnum]"; null keeps the value. */
  set(str: string | null): void {
    if (str === null) return;
    const space = str.indexOf(' ');
    const values = space < 0 ? [str] : [str.slice(0, space), str.slice(space + 1)];
    this.#num = Number.parseFloat(values[0] ?? '') || 0;
    this.#set = true;
    this.#optset = values[1] !== undefined;
    if (this.#optset) this.#optnum = Number.parseFloat(values[1] ?? '') || 0;
  }
}
