// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: testfiles/src/svg-affine-test.cpp
/*
 * Authors: see git history
 *
 * Copyright (C) 2010 Authors
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { Affine } from '@inkscape-web/geom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sp_svg_transform_read, sp_svg_transform_write } from './svg-affine.ts';

const DEGREE = Math.PI / 180.0;
const { cos, sin, tan } = Math;

/** Affine of a rotation by `deg` degrees about (cx, cy). */
function rot(deg: number, cx = 0, cy = 0): Affine {
  const a = deg * DEGREE;
  return new Affine(
    cos(a),
    sin(a),
    -sin(a),
    cos(a),
    (1 - cos(a)) * cx + sin(a) * cy,
    (1 - cos(a)) * cy - sin(a) * cx,
  );
}

function expectNear(actual: Affine | null, ref: Affine): void {
  expect(actual).not.toBeNull();
  for (let i = 0; i < 6; i++) {
    expect(Math.abs((actual as Affine).at(i) - ref.at(i))).toBeLessThan(1e-14);
  }
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const readTests: [string, Affine][] = [
  ['matrix(0,0,0,0,0,0)', new Affine(0, 0, 0, 0, 0, 0)],
  [' matrix(1,2,3,4,5,6)', new Affine(1, 2, 3, 4, 5, 6)],
  ['matrix (1 2 -3,-4,5e6,-6e-7)', new Affine(1, 2, -3, -4, 5e6, -6e-7)],
  ['matrix(1,2,3,4,5e6-3)', new Affine(1, 2, 3, 4, 5e6, -3)],
  ['matrix(1,2,3,4,5e6.3)', new Affine(1, 2, 3, 4, 5e6, 0.3)],
  ['translate(1)', new Affine(1, 0, 0, 1, 1, 0)],
  ['translate(-1e3 .123e2)', new Affine(1, 0, 0, 1, -1e3, 0.123e2)],
  ['scale(2)', new Affine(2, 0, 0, 2, 0, 0)],
  ['scale(0.1e-2 -.475e0)', new Affine(0.1e-2, 0, 0, -0.475, 0, 0)],
  ['rotate(13 )', rot(13)],
  ['rotate(373)', rot(13)],
  ['rotate(13,7,11)', rot(13, 7, 11)],
  ['skewX( 30)', new Affine(1, 0, tan(30 * DEGREE), 1, 0, 0)],
  ['skewY(390)', new Affine(1, tan(30 * DEGREE), 0, 1, 0, 0)],
];

const readFailTests = [
  'matrix((1,2,3,4,5,6)',
  'matrix(1,2,3,4,5,6))',
  'matrix(,1,2,3,4,5,6)',
  'matrix(1,2,3,4,5,6,)',
  'matrix(1,2,3,4,5)',
  'translate()',
  'translate(,)',
  'translate(1,)',
  'translate(1,6,0)',
  'scale(1,6,2)',
  'rotate(1,6)',
  'rotate(1,6,3,4)',
  'skewX(-)',
  'skewX(.)',
  'skewY(1,2)',
  'scale(1),',
  'scale(1) foo',
];

const writeTests: [string, Affine][] = [
  ['matrix(1,2,3,4,5,6)', new Affine(1, 2, 3, 4, 5, 6)],
  ['matrix(-1,2123,3,0.4,1e-8,1e20)', new Affine(-1, 2.123e3, 3 + 1e-14, 0.4, 1e-8, 1e20)],
  ['translate(1,1)', new Affine(1, 0, 0, 1, 1, 1)],
  ['translate(1)', new Affine(1, 0, 0, 1, 1, 0)],
  ['translate(-1345,0.123)', new Affine(1, 0, 0, 1, -1.345e3, 0.123)],
  ['scale(0)', new Affine(0, 0, 0, 0, 0, 0)],
  ['scale(7)', new Affine(7, 0, 0, 7, 0, 0)],
  ['scale(2,3)', new Affine(2, 0, 0, 3, 0, 0)],
  ['rotate(13)', rot(13)],
  ['rotate(-13,7,11)', rot(-13, 7, 11)],
  ['rotate(-34.5,6.7,89)', rot(-34.5, 6.7, 89)],
  ['skewX(30)', new Affine(1, 0, tan(30 * DEGREE), 1, 0, 0)],
  ['skewX(-30)', new Affine(1, 0, tan(-30 * DEGREE), 1, 0, 0)],
  ['skewY(30)', new Affine(1, tan(30 * DEGREE), 0, 1, 0, 0)],
];

describe('sp_svg_transform_read', () => {
  it.each([
    '',
    ' ',
    'matrix(1,0,0,1,0,0)',
    'translate(0,0)',
    'scale(1,1)',
    'rotate(0,0,0)',
    'skewX(0)',
    'skewY(0)',
  ])('reads %j as the identity', (str) => {
    expect(sp_svg_transform_read(str)?.equals(new Affine())).toBe(true);
  });

  it.each(readTests)('reads %s', (str, ref) => {
    expectNear(sp_svg_transform_read(str), ref);
  });

  it('concatenates a list', () => {
    // Precomputed using Mathematica
    const ref = new Affine(
      2.0199976232558052,
      1.0674773585906017,
      -0.14125199392774668,
      1.905555061209546,
      14.412730624347654,
      28.499820929377453,
    );
    expectNear(
      sp_svg_transform_read('skewY(17)skewX(9)translate(7,13)scale(2)rotate(13)translate(3,5)'),
      ref,
    );
    expectNear(sp_svg_transform_read('scale(2) , translate(1 2)'), new Affine(2, 0, 0, 2, 2, 4));
  });

  it.each(readFailTests)('rejects %j', (str) => {
    expect(sp_svg_transform_read(str)).toBeNull();
  });
});

describe('sp_svg_transform_write', () => {
  it('writes the identity as an empty string', () => {
    expect(sp_svg_transform_write(new Affine())).toBe('');
  });

  it.each(writeTests)('writes %s', (str, matrix) => {
    expect(sp_svg_transform_write(matrix)).toBe(str);
  });
});
