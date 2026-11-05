// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/gimpgrad.cpp
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../db.ts';
import type { Input } from '../input.ts';
import { GimpGrad, gimpgrad_to_svg } from './gimpgrad.ts';

// Red to blue in the first segment, blue to transparent green in the second (the middle of the
// second one is off center).
const GGR = [
  'GIMP Gradient',
  'Name: test',
  '2',
  '0.000000 0.250000 0.500000 1.000000 0.000000 0.000000 1.000000 0.000000 0.000000 1.000000 1.000000 0 0',
  '0.500000 0.600000 1.000000 0.000000 0.000000 1.000000 1.000000 0.000000 1.000000 0.000000 0.500000 0 0',
  '',
].join('\n');

beforeAll(() => GimpGrad.init());

describe('GIMP gradient import', () => {
  it('makes stops, and drops the stop that repeats the previous color', () => {
    const svg = gimpgrad_to_svg(GGR)!;
    expect(svg.match(/<stop /g)).toHaveLength(4);
    expect(svg).toContain('<stop stop-color="#ff0000" offset="0"/>');
    expect(svg).toContain('<stop stop-color="#0000ff" offset="0.5"/>');
    // The second segment: the middle is not at 0.75, so it gets a stop with the average color.
    expect(svg).toContain('offset="0.6"');
    expect(svg).toContain('<stop stop-color="#00ff00" stop-opacity="0.5" offset="1"/>');
  });

  it('rejects other files and wrong segment counts', () => {
    expect(gimpgrad_to_svg('not a gradient\n')).toBeNull();
    expect(gimpgrad_to_svg(GGR.replace('\n2\n', '\n3\n'))).toBeNull();
    expect(gimpgrad_to_svg(GGR.replace('0.500000 0.600000', '0.400000 0.600000'))).toBeNull();
  });

  it('opens a linear gradient with the stops', async () => {
    const doc = await (db.get('org.inkscape.input.gimpgrad') as Input).open(
      't.ggr',
      new TextEncoder().encode(GGR),
    );
    expect(doc).not.toBeNull();
    const defs = [...doc!.getReprRoot().children()].find((c) => c.name() === 'svg:defs')!;
    const grad = [...defs.children()][0]!;
    expect(grad.name()).toBe('svg:linearGradient');
    expect([...grad.children()]).toHaveLength(4);
  });
});
