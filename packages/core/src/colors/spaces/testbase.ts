// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: testfiles/src/colors/spaces-testbase.h
/*
 * Shared test helpers for testing color spaces
 *
 * Copyright (C) 2024 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

import { expect, it } from 'vitest';
import { Color } from '../color.ts';
import { Manager } from '../manager.ts';
import { SpaceType } from './enum.ts';

/** Expect two lists of numbers to have the same length and values no more than `eps` apart. */
export function expectNear(actual: readonly number[], expected: readonly number[], eps: number): void {
  expect(actual.length, `${actual} vs ${expected}`).toBe(expected.length);
  actual.forEach((v, i) => {
    expect(Math.abs(v - expected[i]!), `${actual} vs ${expected}`).toBeLessThan(eps);
  });
}

/** Expect two numbers to be no more than `eps` apart (gtest EXPECT_NEAR). */
export function expectClose(actual: number, expected: number, eps: number): void {
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(eps);
}

const hex = (n: number) => `0x${n.toString(16).padStart(8, '0')}`;

/** `[string, expected values, expected 0xRRGGBBAA]` */
export type FromStringCase = readonly [string, readonly number[], number];

/** Tests that strings parse to the values and rgba (upstream fromString). */
export function fromStringTests(cases: readonly FromStringCase[]): void {
  for (const [val, out, rgba] of cases) {
    it(`parses ${JSON.stringify(val)}`, () => {
      const color = Color.parse(val);
      expect(color).toBeDefined();
      expectNear(color!.getValues(), out, 0.001);
      expect(hex(color!.toRGBA(1.0))).toBe(hex(rgba));
    });
  }
}

/** Tests that strings do not parse (upstream badColorString). */
export function badColorStringTests(cases: readonly string[]): void {
  for (const val of cases) {
    it(`does not parse ${JSON.stringify(val)}`, () => {
      expect(Color.parse(val)).toBeUndefined();
    });
  }
}

/** `[space, values, expected string, opacity (default true)]` */
export type ToStringCase = readonly [SpaceType, readonly number[], string, boolean?];

/** Tests the printed strings (upstream toString). */
export function toStringTests(cases: readonly ToStringCase[]): void {
  for (const [space, val, out, opacity = true] of cases) {
    it(`prints ${SpaceType[space]} ${JSON.stringify(val)} as ${JSON.stringify(out)}`, () => {
      expect(new Color(space, [...val]).toString(opacity)).toBe(out);
    });
  }
}

/** `[space in, values in, space out, values out, both directions (default true)]` */
export type ConvertCase = readonly [SpaceType, readonly number[], SpaceType, readonly number[], boolean?];

function convertForward(inplace: boolean, [spaceIn, vin, spaceOut, vout]: ConvertCase): void {
  const color = new Color(spaceIn, [...vin]);
  let result: Color;
  if (inplace) {
    color.convert(spaceOut);
    result = color;
  } else {
    result = color.converted(spaceOut)!;
  }
  expectNear(result.getValues(), vout, 0.005);
}

/** Tests conversions, in place and as a copy, and back (upstream convertColorSpace). */
export function convertTests(cases: readonly ConvertCase[]): void {
  for (const c of cases) {
    it(`converts ${SpaceType[c[0]]} ${JSON.stringify(c[1])} to ${SpaceType[c[2]]} ${JSON.stringify(c[3])}`, () => {
      const back: ConvertCase = [c[2], c[3], c[0], c[1]];
      for (const inplace of [false, true]) {
        convertForward(inplace, c);
        if (c[4] ?? true) convertForward(inplace, back);
      }
    });
  }
}

/** `[space, values, space, expected values after normalize]` */
export type NormalizeCase = readonly [SpaceType, readonly number[], readonly number[]];

/** Tests Color.normalize (upstream normalize). */
export function normalizeTests(cases: readonly NormalizeCase[]): void {
  for (const [space, val, out] of cases) {
    it(`normalizes ${SpaceType[space]} ${JSON.stringify(val)}`, () => {
      const color = new Color(space, [...val]);
      color.normalize();
      expectNear(color.getValues(), out, 0.001);
    });
  }
}

/** Tests the ids of the components of a space. */
export function componentIds(space: SpaceType): string[] {
  return Manager.get()
    .find(space)!
    .getComponents()
    .getAll()
    .map((c) => c.id);
}

/** A seeded random generator for repeatable tests (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Convert random colors from one space to the other and back, in place, to guarantee stability
 * in both directions (upstream RandomPassthrough). Returns the sum of the values that went
 * outside of 0..1 if `normalCheck` is set.
 */
export function randomPassthrough(from: SpaceType, to: SpaceType, count = 1000, normalCheck = false): void {
  const rand = seededRandom(13375336);
  const space = Manager.get().find(from)!;
  const n = space.getComponentCount();
  let outside = 0;
  for (let i = 0; i < count; i++) {
    const values = Array.from({ length: n }, rand);
    const color = new Color(from, [...values]);
    color.convert(to);
    if (normalCheck) {
      for (const v of color.getValues()) outside += v < 0 ? -v : v > 1 ? v - 1 : 0;
    }
    color.convert(from);
    expectNear(color.getValues(), values, 0.005);
  }
  if (normalCheck) expect(outside).toBeLessThanOrEqual(1.0);
}

/** Run a function on random input and its inverse (upstream RandomPassFunc). */
export function randomPassFunc(
  fromFunc: (i: ArrayLike<number>, o: number[]) => void,
  toFunc: (i: ArrayLike<number>, o: number[]) => void,
  count = 1000,
): void {
  const rand = seededRandom(13375336);
  for (let i = 0; i < count; i++) {
    const values = [rand(), rand(), rand()];
    const expected = [...values];
    fromFunc(values, values);
    toFunc(values, values);
    expectNear(values, expected, 0.005);
  }
}
