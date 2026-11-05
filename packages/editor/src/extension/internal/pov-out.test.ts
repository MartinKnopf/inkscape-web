// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/pov-out.cpp
import { SPDocument } from '@inkscape-web/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../db.ts';
import type { Output } from '../output.ts';
import { PovOutput } from './pov-out.ts';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">' +
  '<g opacity="0.5"><rect id="r" x="10" y="20" width="30" height="40" style="fill:#ff8000;fill-opacity:0.5"/></g>' +
  '<path id="c" d="M 0,0 C 10,0 20,10 20,20 Z" style="fill:none"/>' +
  '</svg>';

async function save(): Promise<string> {
  PovOutput.init();
  const doc = SPDocument.createNewDocFromMem(SVG)!;
  doc.ensureUpToDate();
  const data = await (db.get('org.inkscape.output.pov') as Output).save(doc, 'a.pov');
  return new TextDecoder().decode(data!);
}

describe('PovRay output', () => {
  let pov = '';
  beforeAll(async () => {
    pov = await save();
  });

  it('writes a prism of four line segments for a rectangle, with its extent and color', () => {
    expect(pov).toContain('#declare r = prism {');
    expect(pov).toContain('    16 //nr points');
    expect(pov).toContain(
      '    /*   0*/ <10.00000000, 20.00000000>, <10.00000000, 20.00000000>, <40.00000000, 20.00000000>, <40.00000000, 20.00000000>',
    );
    expect(pov).toContain('#declare r_MIN_X    = 10.00000000;');
    expect(pov).toContain('#declare r_HEIGHT   = 40.00000000;');
    // fill opacity 0.5 times the group opacity 0.5: transparency 0.75
    expect(pov).toContain('#declare r_COLOR    = rgbf <1.00000000, 0.50196078, 0.00000000, 0.75000000>;');
  });

  it('writes the curve and the closing line of a path, and no color without a fill', () => {
    // one cubic and the closing line
    expect(pov).toContain('    8 //nr points');
    expect(pov).toContain(
      '<0.00000000, 0.00000000>, <10.00000000, 0.00000000>, <20.00000000, 10.00000000>, <20.00000000, 20.00000000>',
    );
    expect(pov).not.toContain('c_COLOR');
    expect(pov).toContain('##    Shapes   : 2');
    expect(pov).toContain('##    Segments : 6');
  });

  it('puts all shapes in a union with a black default pigment', () => {
    expect(pov).toContain('#declare AllShapes = union {');
    expect(pov).toContain('pigment { rgb <0,0,0> }');
    expect(pov).toContain('#declare AllShapes_Z_Increment = 0.10000000;');
    expect(pov).toContain('#declare AllShapes_WIDTH    = 40.00000000;');
  });
});
