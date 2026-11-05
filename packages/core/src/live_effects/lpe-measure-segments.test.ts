// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-measure-segments.cpp
import { loadGeom } from '@inkscape-web/wasm';
import { describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';
import type { SPShape } from '../object/sp-shape.ts';
import { setPathBoolopBackend } from '../path/path-boolop.ts';
import { Effect } from './effect.ts';
import type { LPEMeasureSegments } from './lpe-measure-segments.ts';

setPathBoolopBackend(await loadGeom());
SPDocument.scheduleIdle = () => {};

describe('Measure Segments', () => {
  it('shows "<" in the label of the small values option, not the markup', () => {
    const doc = SPDocument.createNewDocFromMem(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"><defs/><path id="p" d="M 0,0 L 30,40"/></svg>',
    );
    if (!doc) throw new Error('parse failed');
    doc.ensureUpToDate();
    const shape = doc.getObjectById('p') as SPShape;
    Effect.createAndApply('measure_segments', doc, shape);
    const lpe = shape.getCurrentLPE() as LPEMeasureSegments;
    expect(lpe.smallx100.param_label).toBe('Multiply values < 1');
  });
});
