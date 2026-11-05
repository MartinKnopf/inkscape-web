// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: testfiles/src/lpe-test.cpp
// Tests of the Boolean operation effect.
import { PathVector as PV } from '@inkscape-web/geom';
import { loadGeom } from '@inkscape-web/wasm';
import { describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';
import { SPGenericEllipse } from '../object/sp-ellipse.ts';
import { type SPLPEItem, sp_lpe_item_update_patheffect } from '../object/sp-lpe-item.ts';
import type { SPShape } from '../object/sp-shape.ts';
import { setPathBoolopBackend } from '../path/path-boolop.ts';
import { EffectType } from './effect-enum.ts';
import type { LPEBool } from './lpe-bool.ts';

setPathBoolopBackend(await loadGeom());
SPDocument.scheduleIdle = () => {};

const NS =
  "xmlns='http://www.w3.org/2000/svg' xmlns:sodipodi='http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd' xmlns:inkscape='http://www.inkscape.org/namespaces/inkscape'";

function load(svg: string): SPDocument {
  const doc = SPDocument.createNewDocFromMem(svg);
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  return doc;
}

const bounds = (pv: PV) => {
  const r = PV.boundsExact(pv);
  return r && [r.left(), r.top(), r.right(), r.bottom()].map((v) => Math.round(v * 1000) / 1000);
};

/** A 100x100 square "a" with the operation on the 100x100 square "b" at (50,50). */
function squares(operation: string, extra = ''): SPDocument {
  const doc = load(`<svg ${NS}><defs>
    <inkscape:path-effect id='e' effect='bool_op' operation='${operation}' operand-path='#b' lpeversion='1' ${extra}/>
  </defs>
  <path id='a' inkscape:path-effect='#e' inkscape:original-d='M 0,0 H 100 V 100 H 0 Z' d='M 0,0 H 100 V 100 H 0 Z'/>
  <path id='b' d='M 50,50 H 150 V 150 H 50 Z'/>
</svg>`);
  sp_lpe_item_update_patheffect(doc.getObjectById('a') as SPLPEItem, true, true);
  return doc;
}

describe('Boolean operation', () => {
  it('can be applied to non-sibling paths', () => {
    const doc = load(`<svg width='100' height='100' ${NS}>
  <defs>
    <inkscape:path-effect id='path-effect1' effect='bool_op' operation='diff' operand-path='#circle1'
      lpeversion='1' hide-linked='true' />
  </defs>
  <path id='rect1' inkscape:path-effect='#path-effect1' sodipodi:type='rect' width='100' height='100' fill='#ff0000' />
  <g id='group1'>
    <circle id='circle1' r='40' cy='50' cx='50' fill='#ffffff' style='display:inline'/>
  </g>
</svg>`);
    const lpe_item = doc.getObjectById('rect1') as SPLPEItem;
    const lpe = lpe_item.getFirstPathEffectOfType(EffectType.BOOL_OP) as LPEBool | null;
    expect(lpe).toBeTruthy();
    const operand_path = lpe?.getParameter('operand-path')?.param_getSVGValue() ?? '';
    expect(doc.getObjectById(operand_path.slice(1))).toBeInstanceOf(SPGenericEllipse);
  });

  it('computes the union, intersection and difference with the operand', () => {
    expect(bounds((squares('union').getObjectById('a') as SPShape).curve() ?? [])).toEqual([0, 0, 150, 150]);
    expect(bounds((squares('inters').getObjectById('a') as SPShape).curve() ?? [])).toEqual([
      50, 50, 100, 100,
    ]);
    // difference: this path minus the operand, an L shape
    const diff = (squares('diff').getObjectById('a') as SPShape).curve() ?? [];
    expect(bounds(diff)).toEqual([0, 0, 100, 100]);
    expect(diff[0]?.size()).toBe(6);
    // swapped: the operand minus this path
    const swapped = (squares('diff', "swap-operands='true'").getObjectById('a') as SPShape).curve() ?? [];
    expect(bounds(swapped)).toEqual([50, 50, 150, 150]);
  });

  it('keeps both parts with division both', () => {
    const pv = (squares('cut-both').getObjectById('a') as SPShape).curve() ?? [];
    expect(pv).toHaveLength(2);
  });

  it('hides the operand with the selectable hidder filter', () => {
    const doc = squares('union');
    expect(doc.getObjectById('selectable_hidder_filter')).toBeTruthy();
    expect(doc.getObjectById('b')?.getAttribute('style')).toContain('url(#selectable_hidder_filter)');
  });
});
