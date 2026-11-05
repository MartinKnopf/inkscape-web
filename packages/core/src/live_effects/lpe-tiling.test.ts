// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: testfiles/src/lpe-test.cpp
// Tests of the Tiling LPE.
import { PathVector as PV } from '@inkscape-web/geom';
import { loadGeom } from '@inkscape-web/wasm';
import { describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';
import { SPLPEItem, sp_lpe_item_update_patheffect } from '../object/sp-lpe-item.ts';
import type { SPShape } from '../object/sp-shape.ts';
import { setPathBoolopBackend } from '../path/path-boolop.ts';
import { Effect } from './effect.ts';
import { EffectType } from './effect-enum.ts';

setPathBoolopBackend(await loadGeom());
SPDocument.scheduleIdle = () => {};

const NS =
  'xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"';

/** The square "p" (10..50) with Tiling applied and params set. */
function tiled(params: Record<string, string> = {}): SPShape {
  const doc = SPDocument.createNewDocFromMem(
    `<svg xmlns="http://www.w3.org/2000/svg" ${NS}><defs/><path id="p" d="M 10,10 H 50 V 50 H 10 Z"/></svg>`,
  );
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  const shape = doc.getObjectById('p') as SPShape;
  Effect.createAndApply('tiling', doc, shape);
  const repr = shape.getCurrentLPE()?.getRepr();
  for (const [k, v] of Object.entries(params)) repr?.setAttribute(k, v);
  doc.ensureUpToDate();
  return shape;
}

const bounds = (s: SPShape) => {
  const r = PV.boundsExact(s.curve() ?? []);
  return r && [r.left(), r.top(), r.right(), r.bottom()].map((v) => Math.round(v * 1000) / 1000);
};

describe('Tiling', () => {
  it('makes rows times columns copies side by side', () => {
    const s = tiled({ num_rows: '2', num_cols: '3' });
    expect(s.curve()).toHaveLength(6);
    expect(bounds(s)).toEqual([10, 10, 130, 90]);
  });

  it('adds the gaps between the copies', () => {
    const s = tiled({ num_rows: '2', num_cols: '2', gapx: '10', gapy: '5' });
    expect(bounds(s)).toEqual([10, 10, 100, 95]);
  });

  it('offsets alternate rows by a percentage of the tile width', () => {
    const s = tiled({ num_rows: '2', num_cols: '1', offset: '50' });
    expect(bounds(s)).toEqual([10, 10, 70, 90]);
  });

  it('mirrors alternate columns', () => {
    const s = tiled({ num_rows: '1', num_cols: '2', mirrorcolsx: 'true' });
    expect(bounds(s)).toEqual([10, 10, 90, 50]);
    // the mirrored copy is reversed, so the fill keeps the same winding
    const [, second] = s.curve() ?? [];
    expect(second?.initialPoint().x).toBeCloseTo(90);
  });

  it('shows the gap knots at the right and bottom edge of the tile', () => {
    const s = tiled({ num_rows: '2', num_cols: '2', gapx: '10' });
    const lpe = s.getCurrentLPE() as unknown as { gapToKnot(g: number): number };
    expect(lpe.gapToKnot(10)).toBeCloseTo(10);
  });
});

/** The documents of the upstream tiling tests (gaps in mm). */
const unitDoc = (gapx: string, gapy: string) =>
  `<svg width='200' height='200' ${NS}>
  <defs>
    <inkscape:path-effect id='path-effect1' effect='tiling' lpeversion='1.3.1' unit='mm'
      num_rows='2' num_cols='2' gapx='${gapx}' gapy='${gapy}' offset='0' offset_type='false'
      scale='0' rotate='0' mirrorrowsx='false' mirrorrowsy='false' mirrorcolsx='false'
      mirrorcolsy='false' mirrortrans='false' shrink_interp='true' random_scale='false'
      random_rotate='false' random_gap_x='false' random_gap_y='false' seed='1;1' lpesatellites='' />
  </defs>
  <path id='path1' inkscape:path-effect='#path-effect1' d='M 10,10 H 50 V 50 H 10 Z' />
</svg>`;

function loadTiling(svg: string) {
  const doc = SPDocument.createNewDocFromMem(svg);
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  const lpe_item = doc.getObjectById('path1');
  if (!(lpe_item instanceof SPLPEItem)) throw new Error('no item');
  sp_lpe_item_update_patheffect(lpe_item, true, true, true);
  const tiling = lpe_item.getFirstPathEffectOfType(EffectType.TILING);
  if (!tiling) throw new Error('no tiling');
  const gap = (key: string) => Number(tiling.getParameter(key)?.param_getSVGValue());
  return { lpe_item, tiling, gap };
}

describe('Tiling units (upstream lpe-test.cpp)', () => {
  it('preserves the gap values on load with a non-px unit', () => {
    const { gap } = loadTiling(unitDoc('10', '5'));
    expect(gap('gapx')).toBeCloseTo(10, 6);
    expect(gap('gapy')).toBeCloseTo(5, 6);
  });

  it('converts the gaps when the unit changes after load', () => {
    const { lpe_item, tiling, gap } = loadTiling(unitDoc('25.4', '12.7'));
    expect(gap('gapx')).toBeCloseTo(25.4, 6);
    expect(gap('gapy')).toBeCloseTo(12.7, 6);
    // prev_unit is "mm" (set during the is_load pass), so the conversion uses the correct source unit.
    tiling.setParameter('unit', 'in');
    sp_lpe_item_update_patheffect(lpe_item, true, true, true);
    expect(gap('gapx')).toBeCloseTo(1.0, 6);
    expect(gap('gapy')).toBeCloseTo(0.5, 6);
  });
});
