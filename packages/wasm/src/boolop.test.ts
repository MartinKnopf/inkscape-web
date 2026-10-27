// SPDX-License-Identifier: GPL-2.0-or-later
// Boolean ops must give the same geometry as Inkscape (fixture: scripts/make-boolop-fixture.ts).
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/boolop.json' with { type: 'json' };
import { BooleanOp, FillRule, loadGeom } from './index.ts';

const geom = await loadGeom();

const OPS: Record<string, BooleanOp> = {
  'path-union': BooleanOp.Union,
  'path-intersection': BooleanOp.Intersection,
  'path-difference': BooleanOp.Difference,
  'path-exclusion': BooleanOp.Exclusion,
};

/** Compare as a set of subpaths: the order of subpaths and number format may differ. */
const subpaths = (d: string) =>
  geom
    .normalizePath(d, 5)
    .split(/(?=M)/)
    .map((s) => s.trim())
    .sort();

describe(`boolop matches ${fixture.generatedBy}`, () => {
  it.each(fixture.cases)('$name $action', ({ bottom, top, action, result }) => {
    const op = OPS[action]!;
    // Same operand order as upstream's selection code: (top, bottom).
    const d = geom.boolop(top, bottom, op, FillRule.NonZero, FillRule.NonZero);
    expect(subpaths(d)).toEqual(subpaths(result!));
  });
});
