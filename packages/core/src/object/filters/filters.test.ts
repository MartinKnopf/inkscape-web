// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/filters/
import { describe, expect, it } from 'vitest';
import {
  FilterColorMatrixType,
  FilterComponentTransferType,
  FilterMorphologyOperator,
  FilterSlotType,
  FilterTurbulenceType,
} from '../../display/nr-filter-types.ts';
import { SPDocument } from '../../document.ts';
import { SPBlendMode } from '../../style-enums.ts';
import type { SPFilter } from '../sp-filter.ts';
import type { SPFeBlend } from './blend.ts';
import type { SPFeColorMatrix } from './colormatrix.ts';
import { SPFeComponentTransfer } from './componenttransfer.ts';
import { SPFeFuncNode } from './componenttransfer-funcnode.ts';
import { FeCompositeOperator, type SPFeComposite } from './composite.ts';
import type { SPFeConvolveMatrix } from './convolvematrix.ts';
import type { SPFeDiffuseLighting } from './diffuselighting.ts';
import type { SPFeDisplacementMap } from './displacementmap.ts';
import type { SPFeDistantLight } from './distantlight.ts';
import type { SPFeMerge } from './merge.ts';
import { SPFeMergeNode } from './mergenode.ts';
import type { SPFeMorphology } from './morphology.ts';
import type { SPFeSpotLight } from './spotlight.ts';
import { SPFeTurbulence } from './turbulence.ts';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg"><defs><filter id="f">
  <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="3" result="noise"/>
  <feColorMatrix type="saturate" values="0.5"/>
  <feComponentTransfer><feFuncR type="table" tableValues="0 0.5 1"/><feFuncA type="linear" slope="2"/></feComponentTransfer>
  <feComposite in="SourceGraphic" in2="noise" operator="arithmetic" k1="0.5" k2="1"/>
  <feBlend in2="noise" mode="multiply" result="blend"/>
  <feConvolveMatrix kernelMatrix="1 2 1 0 0 0 -1 -2 -1"/>
  <feDisplacementMap in2="noise" scale="20" xChannelSelector="R"/>
  <feMorphology operator="dilate" radius="2 3"/>
  <feDiffuseLighting surfaceScale="5"><feDistantLight azimuth="45" elevation="30"/></feDiffuseLighting>
  <feSpecularLighting><feSpotLight x="10" limitingConeAngle="30"/></feSpecularLighting>
  <feMerge><feMergeNode in="blend"/><feMergeNode in="SourceGraphic"/></feMerge>
</filter></defs></svg>`;

function load() {
  const doc = SPDocument.createNewDocFromMem(SVG);
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  const filter = doc.getObjectById('f') as SPFilter;
  return { doc, filter, prims: filter.children };
}

describe('filter primitive objects', () => {
  it('read the attributes of the primitives', () => {
    const { prims } = load();
    const turbulence = prims[0] as SPFeTurbulence;
    expect(turbulence).toBeInstanceOf(SPFeTurbulence);
    expect([turbulence.type, turbulence.numOctaves, turbulence.baseFrequency.getOptNumber()]).toEqual([
      FilterTurbulenceType.TURBULENCE_FRACTALNOISE,
      3,
      0.05,
    ]);
    const cm = prims[1] as SPFeColorMatrix;
    expect([cm.get_type(), cm.get_value()]).toEqual([FilterColorMatrixType.COLORMATRIX_SATURATE, 0.5]);
    const ct = prims[2] as SPFeComponentTransfer;
    expect(ct).toBeInstanceOf(SPFeComponentTransfer);
    const funcR = ct.children[0] as SPFeFuncNode;
    expect([funcR.channel, funcR.type, funcR.tableValues]).toEqual([
      SPFeFuncNode.R,
      FilterComponentTransferType.COMPONENTTRANSFER_TYPE_TABLE,
      [0, 0.5, 1],
    ]);
    expect((ct.children[1] as SPFeFuncNode).slope).toBe(2);
    const comp = prims[3] as SPFeComposite;
    expect([comp.get_composite_operator(), comp.k1, comp.k2, comp.k3]).toEqual([
      FeCompositeOperator.COMPOSITE_ARITHMETIC,
      0.5,
      1,
      0,
    ]);
    expect((prims[4] as SPFeBlend).get_blend_mode()).toBe(SPBlendMode.SP_CSS_BLEND_MULTIPLY);
    const conv = prims[5] as SPFeConvolveMatrix;
    // The divisor is the sum of the kernel, or 1 when it is 0.
    expect([conv.get_order().getNumber(), conv.divisor, conv.targetX]).toEqual([3, 1, 1]);
    expect((prims[6] as SPFeDisplacementMap).scale).toBe(20);
    const morph = prims[7] as SPFeMorphology;
    expect([morph.Operator, morph.radius.getNumber(), morph.radius.getOptNumber()]).toEqual([
      FilterMorphologyOperator.MORPHOLOGY_OPERATOR_DILATE,
      2,
      3,
    ]);
    const diffuse = prims[8] as SPFeDiffuseLighting;
    expect([diffuse.surfaceScale, diffuse.surfaceScale_set, diffuse.diffuseConstant]).toEqual([5, true, 1]);
    const light = diffuse.children[0] as SPFeDistantLight;
    expect([light.azimuth, light.elevation, light.azimuth_set]).toEqual([45, 30, true]);
    const spot = prims[9]?.children[0] as SPFeSpotLight;
    expect([spot.x, spot.limitingConeAngle, spot.specularExponent, spot.specularExponent_set]).toEqual([
      10,
      30,
      1,
      false,
    ]);
    expect((prims[10] as SPFeMerge).children[0]).toBeInstanceOf(SPFeMergeNode);
  });

  it('resolve the input and result names to slots', () => {
    const { filter, prims } = load();
    filter.invalidate_slots();
    filter.ensure_slots();
    expect((prims[0] as SPFeTurbulence).get_out()).toBe(1);
    expect((prims[3] as SPFeComposite).get_in()).toBe(FilterSlotType.NR_FILTER_SOURCEGRAPHIC);
    expect((prims[3] as SPFeComposite).get_in2()).toBe(1);
    const nodes = (prims[10] as SPFeMerge).children as SPFeMergeNode[];
    expect(nodes.map((n) => n.get_in())).toEqual([2, FilterSlotType.NR_FILTER_SOURCEGRAPHIC]);
  });

  it('get_new_result_name gives a result name that is not used', () => {
    const { filter, prims } = load();
    expect(filter.get_new_result_name()).toBe('result1');
    prims[1]?.getRepr().setAttribute('result', 'result7');
    expect(filter.get_new_result_name()).toBe('result8');
  });

  it('composite writes k1..k4 only for arithmetic', () => {
    const { doc, prims } = load();
    const comp = prims[3] as SPFeComposite;
    comp.getRepr().setAttribute('operator', 'over');
    comp.updateRepr();
    expect(comp.getRepr().attribute('k1')).toBeNull();
    expect(comp.getRepr().attribute('operator')).toBe('over');
    doc.ensureUpToDate();
  });
});
