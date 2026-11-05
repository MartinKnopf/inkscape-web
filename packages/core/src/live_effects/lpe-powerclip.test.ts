// SPDX-License-Identifier: GPL-2.0-or-later
// Tests of the Power clip effect.
import { PathVector as PV } from '@inkscape-web/geom';
import { loadGeom } from '@inkscape-web/wasm';
import { describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';
import type { SPShape } from '../object/sp-shape.ts';
import { setPathBoolopBackend } from '../path/path-boolop.ts';
import { sp_svg_read_pathv } from '../svg/svg-path.ts';
import { Effect } from './effect.ts';

setPathBoolopBackend(await loadGeom());
SPDocument.scheduleIdle = () => {};

const NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"';

const bounds = (pv: PV) => {
  const r = PV.boundsExact(pv);
  return r && [r.left(), r.top(), r.right(), r.bottom()].map((v) => Math.round(v * 1000) / 1000);
};

/** A 100x100 square "a" clipped by the 40x40 square "c" in its middle, with Power clip applied. */
function clipped(params: Record<string, string> = {}) {
  const doc = SPDocument.createNewDocFromMem(
    `<svg ${NS}><defs><clipPath id="clip"><path id="c" d="M 30,30 H 70 V 70 H 30 Z"/></clipPath></defs>
     <path id="a" d="M 0,0 H 100 V 100 H 0 Z" clip-path="url(#clip)"/></svg>`,
  );
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  const shape = doc.getObjectById('a') as SPShape;
  Effect.createAndApply('powerclip', doc, shape);
  const repr = shape.getCurrentLPE()?.getRepr();
  for (const [k, v] of Object.entries(params)) repr?.setAttribute(k, v);
  doc.ensureUpToDate();
  const lpeid = shape.getCurrentLPE()?.getLPEObj().getId();
  return { doc, shape, powerclip: doc.getObjectById(`lpe_${lpeid}`) };
}

describe('Power clip', () => {
  it('adds the inverse clip: the bounding box with the clip as a hole, and hides the clip', () => {
    const { doc, powerclip } = clipped();
    expect(powerclip?.getAttribute('class')).toBe('powerclip');
    expect(powerclip?.parent?.getId()).toBe('clip');
    const pv = sp_svg_read_pathv(powerclip?.getAttribute('d') ?? '');
    expect(pv).toHaveLength(2);
    // the bounding box of the item, expanded by 5
    expect(bounds(pv.slice(0, 1))).toEqual([-5, -5, 105, 105]);
    expect(bounds(pv.slice(1))).toEqual([30, 30, 70, 70]);
    expect(doc.getObjectById('c')?.getAttribute('display')).toBe('none');
  });

  it('uses only the clip paths without inverse', () => {
    const { powerclip } = clipped({ inverse: 'false' });
    expect(bounds(sp_svg_read_pathv(powerclip?.getAttribute('d') ?? ''))).toEqual([30, 30, 70, 70]);
  });

  it('cuts the path to the clip with flatten', () => {
    const { shape } = clipped({ inverse: 'false', flatten: 'true' });
    expect(bounds(shape.curve() ?? [])).toEqual([30, 30, 70, 70]);
    // inverse: the square with a hole
    const inv = clipped({ flatten: 'true' }).shape.curve() ?? [];
    expect(inv).toHaveLength(2);
    expect(bounds(inv)).toEqual([0, 0, 100, 100]);
  });

  it('removes the powerclip path and shows the clip again on remove', () => {
    const { doc, shape, powerclip } = clipped();
    const id = powerclip?.getId() ?? '';
    shape.removeCurrentPathEffect(false);
    expect(doc.getObjectById(id)).toBeNull();
    expect(doc.getObjectById('c')?.getAttribute('display')).toBe('block');
  });
});
