// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/clonetiler.cpp
// @vitest-environment happy-dom
import { Preferences } from '@inkscape-web/core';
import { Affine, Point, Rect } from '@inkscape-web/geom';
import { afterEach, describe, expect, it } from 'vitest';
import { setupDesktop } from '../tools/tool-test-utils.ts';
import {
  type CloneTilerOptions,
  clonetiler_apply,
  clonetiler_options,
  clonetiler_remove,
  clonetiler_reset,
  clonetiler_status,
  clonetiler_unclump,
  get_transform,
  PickType,
  prefs_path,
  randomize01,
  TileGroup,
  type TraceBitmap,
  trace_pick,
  transform_rect,
} from './clonetiler.ts';

const params = (patch: Partial<CloneTilerOptions> = {}): CloneTilerOptions => ({
  ...clonetiler_options(),
  ...patch,
});
const GROUPS = Object.values(TileGroup).filter((v): v is number => typeof v === 'number');
const centre = (m: Affine, cx: number, cy: number) => new Point(cx, cy).transformed(m);

describe('get_transform', () => {
  it('has 17 symmetry groups, and the tile at row 0, column 0 stays in place in each', () => {
    expect(GROUPS).toHaveLength(17);
    for (const type of GROUPS) {
      for (const [w, h] of [
        [20, 10],
        [10, 20],
      ] as const) {
        expect(get_transform(type, 0, 0, 5, 5, w, h, params()).equals(Affine.identity())).toBe(true);
      }
    }
  });

  it('only rotates and reflects without shift, scale or rotation: every tile is an isometry', () => {
    for (const type of GROUPS) {
      for (let i = 0; i < 12; i++) {
        for (let j = 0; j < 4; j++) {
          const m = get_transform(type, i, j, 7, 3, 20, 10, params());
          expect(Math.abs(Math.abs(m.det()) - 1)).toBeLessThan(1e-9);
        }
      }
    }
  });

  it('never puts two tiles of a symmetry group at the same place', () => {
    for (const type of GROUPS) {
      for (const [w, h] of [
        [20, 10],
        [10, 20],
      ]) {
        const seen = new Set<string>();
        for (let i = 0; i < 12; i++) {
          for (let j = 0; j < 2; j++) {
            const m = get_transform(type, i, j, 0, 0, w as number, h as number, params());
            // A rotated and reflected unit vector pair identifies the placement of a tile.
            const key = [new Point(0, 0), new Point(3, 1)]
              .map((p) => p.transformed(m))
              .map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`)
              .join(' ');
            expect(seen.has(key), `group ${TileGroup[type]} i=${i} j=${j}`).toBe(false);
            seen.add(key);
          }
        }
      }
    }
  });

  it('P1 translates by whole tiles; PM mirrors every second column about the tile center', () => {
    const p = params();
    const m = get_transform(TileGroup.TILE_P1, 2, 3, 5, 5, 10, 20, p);
    expect(centre(m, 5, 5)).toEqual(new Point(25, 65));
    // A point 2 right of the center of tile i=1 lands 2 left of the center of the next tile.
    const pm = get_transform(TileGroup.TILE_PM, 1, 0, 5, 5, 10, 20, p);
    expect(new Point(7, 5).transformed(pm)).toEqual(new Point(13, 5));
  });

  it('P2 turns every second column by 180 degrees', () => {
    const m = get_transform(TileGroup.TILE_P2, 1, 0, 0, 0, 10, 10, params());
    expect(new Point(2, 3).transformed(m).sub(new Point(8, -3)).length()).toBeLessThan(1e-9);
  });

  it('shifts by a percentage of the tile size per column, cumulated or alternated', () => {
    const p = params({ shiftx_per_i: 0.5 });
    const x = (patch: Partial<CloneTilerOptions>, i: number) =>
      centre(get_transform(TileGroup.TILE_P1, i, 0, 0, 0, 10, 10, { ...p, ...patch }), 0, 0).x;
    expect(x({}, 2)).toBe(10 + 10 * 2); // tile width + 50% of the tile width, two columns
    expect(x({ shiftx_cumulate: true }, 2)).toBe(10 * (2 + 0.5 * 4)); // 1, 1+2, ... columns: i * i
    expect(x({ shiftx_alternate: true }, 2)).toBe(10 * (2 + 0)); // 2 % 2 = 0
    expect(x({ shiftx_alternate: true }, 3)).toBe(10 * (3 + 0.5));
    expect(x({ shiftx_excludew: true }, 2)).toBe(10 * 0.5 * 2);
  });

  it('scales per column, with exponent and logarithmic base', () => {
    const sx = (patch: Partial<CloneTilerOptions>, i: number) => {
      const m = get_transform(TileGroup.TILE_P1, i, 0, 0, 0, 10, 10, params({ scalex_per_i: 0.5, ...patch }));
      return m.c0; // x scale
    };
    expect(sx({}, 2)).toBe(2); // 1 + 0.5 * 2
    expect(sx({ scalex_exp: 2 }, 2)).toBe(4);
    expect(sx({ scalex_log: 2 }, 2)).toBe(2); // 2 ^ (2 - 1)
    expect(sx({ scalex_per_i: -1 }, 3)).toBe(0); // never negative
  });

  it('rotates per row, alternating the direction', () => {
    const m = get_transform(
      TileGroup.TILE_P1,
      0,
      1,
      0,
      0,
      10,
      10,
      params({ rotate_per_j: 90, shifty_exp: 1 }),
    );
    // 90 degrees about the tile center, then the row shift.
    expect(new Point(1, 0).transformed(m).sub(new Point(0, 11)).length()).toBeLessThan(1e-9);
    const alt = get_transform(
      TileGroup.TILE_P1,
      0,
      2,
      0,
      0,
      10,
      10,
      params({ rotate_per_j: 90, rotate_alternatej: true }),
    );
    expect(alt.c0).toBeCloseTo(1, 12); // 2 % 2 = 0: not rotated
  });

  it('randomizes with the given generator and only draws when the amount is not zero', () => {
    const draws: [number, number][] = [];
    const random = (a: number, b: number) => {
      draws.push([a, b]);
      return 1;
    };
    get_transform(TileGroup.TILE_P1, 0, 0, 0, 0, 10, 10, params(), random);
    expect(draws).toEqual([]);
    const m = get_transform(TileGroup.TILE_P1, 0, 0, 0, 0, 10, 10, params({ shiftx_rand: 0.1 }), random);
    expect(draws).toEqual([[-1, 1]]);
    expect(centre(m, 0, 0).x).toBeCloseTo(1, 12);
  });
});

describe('randomize01', () => {
  it('stays in 0..1 and keeps the value without randomness', () => {
    expect(randomize01(0.4, 0, () => 0)).toBe(0.4);
    for (const val of [0, 0.3, 1]) {
      for (const r of [0, 0.5, 1]) {
        for (const rand of [0.1, 0.5, 1]) {
          const v = randomize01(val, rand, (a, b) => a + r * (b - a));
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('transform_rect', () => {
  it('encloses the corners of the rotated rectangle', () => {
    const r = transform_rect(
      new Rect(new Point(0, 0), new Point(2, 1)),
      Affine.identity().multiply(new Affine(0, 1, -1, 0, 0, 0)),
    );
    expect([r.left(), r.top(), r.right(), r.bottom()]).toEqual([-1, 0, 0, 2]);
  });
});

/** A bitmap of the document px area 0..width x 0..height, opaque black where the test says so. */
function bitmap(width: number, height: number, opaque: (x: number, y: number) => boolean): TraceBitmap {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if (opaque(x, y)) data[(y * width + x) * 4 + 3] = 255;
  }
  return { data, width, height, x0: 0, y0: 0, zoom: 1 };
}

describe('trace_pick', () => {
  it('averages the pixels of the box and counts the area outside the bitmap as transparent', () => {
    const bm = bitmap(10, 10, () => true);
    expect(trace_pick(bm, new Rect(new Point(2, 2), new Point(4, 4)))).toBe(0x000000ff);
    // Half of the box is outside: black with half the opacity.
    expect(trace_pick(bm, new Rect(new Point(5, 0), new Point(15, 10)))).toBe(0x00000080);
    expect(trace_pick(bm, new Rect(new Point(20, 20), new Point(30, 30)))).toBe(0);
    expect(trace_pick(null, new Rect(new Point(0, 0), new Point(1, 1)))).toBe(0);
  });
});

// The clone tiler works on a document and the preferences of the dialog.
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">' +
  '<rect id="r" x="10" y="10" width="10" height="20" style="fill:#f00"/>' +
  '<rect id="r2" x="100" y="10" width="10" height="20"/></svg>';
const PREF_KEYS = [
  'imax',
  'jmax',
  'symmetrygroup',
  'dotrace',
  'pick',
  'pick_to_presence',
  'pick_to_opacity',
  'opacity_per_i',
  'shiftx_per_i',
  'fillrect',
  'fillwidth',
  'keepbbox',
  'blur_per_i',
  'initial_color',
  'hue_per_i',
  'rotate_per_i',
  'shiftx_exp',
  'invert_picked',
];

afterEach(() => {
  for (const k of PREF_KEYS) Preferences.get().remove(prefs_path + k);
});

function tiler(imax: number, jmax: number, tool = 'Select') {
  const s = setupDesktop(SVG, tool);
  const prefs = Preferences.get();
  prefs.setInt(`${prefs_path}imax`, imax);
  prefs.setInt(`${prefs_path}jmax`, jmax);
  s.dt.getSelection().set(s.item('r'));
  const clones = () =>
    [...s.doc.getRoot().children].filter((c) => c.getRepr().attribute('inkscape:tiled-clone-of'));
  return { ...s, clones };
}

describe('clonetiler_apply', () => {
  it('creates rows x columns clones of the selection, one over the original, and one undo step', async () => {
    const { dt, clones, undoSteps } = tiler(3, 2);
    expect(await clonetiler_apply(dt)).toBeNull();
    expect(clones()).toHaveLength(6);
    expect(undoSteps()).toEqual(['Create tiled clones']);
    const repr = clones().map((c) => c.getRepr());
    expect(repr[0]?.attribute('xlink:href')).toBe('#r');
    expect(repr[0]?.attribute('inkscape:tiled-clone-of')).toBe('#r');
    // The first clone is right over the original; the second one is the next row (j = 1): one tile height lower.
    expect(repr[0]?.attribute('transform')).toBeNull();
    expect(repr[1]?.attribute('transform')).toBe('translate(0,20)');
    expect(repr[2]?.attribute('transform')).toBe('translate(10)');
    // The tile is saved for the next run.
    expect(dt.getSelection().singleItem()?.getRepr().attribute('inkscape:tile-w')).toBe('10');
  });

  it('replaces the old tiling, keeps the saved tile size and counts the clones', async () => {
    const { dt, clones, item } = tiler(2, 2);
    await clonetiler_apply(dt);
    expect(clonetiler_status(dt)).toEqual({ kind: 'clones', count: 4 });
    item('r').setAttribute('width', '30');
    await clonetiler_apply(dt);
    expect(clones()).toHaveLength(4);
    // keepbbox: the tile is still 10 wide.
    expect(clones()[2]?.getRepr().attribute('transform')).toBe('translate(10)');
    Preferences.get().setBool(`${prefs_path}keepbbox`, false);
    await clonetiler_apply(dt);
    expect(clones()[2]?.getRepr().attribute('transform')).toBe('translate(30)');
  });

  it('warns without a selection and with more than one object', async () => {
    const { dt, item } = tiler(2, 2);
    dt.getSelection().clear();
    expect(await clonetiler_apply(dt)).toContain('Select an <b>object</b> to clone.');
    dt.getSelection().setList([item('r'), item('r2')]);
    expect(await clonetiler_apply(dt)).toContain('group</b> them');
    expect(clonetiler_status(dt)).toEqual({ kind: 'many' });
  });

  it('applies opacity, color, and blur changes of the tabs', async () => {
    const prefs = Preferences.get();
    prefs.setDouble(`${prefs_path}opacity_per_i`, 50);
    prefs.setDouble(`${prefs_path}blur_per_i`, 10);
    prefs.setString(`${prefs_path}initial_color`, '#ff0000ff');
    prefs.setDouble(`${prefs_path}hue_per_i`, 50);
    const { dt, clones } = tiler(3, 1);
    await clonetiler_apply(dt);
    const [c0, c1, c2] = clones().map((c) => c.getRepr());
    expect(c0?.attribute('opacity')).toBeNull();
    expect(c1?.attribute('opacity')).toBe('0.5');
    // Opacity 0 is skipped as invisible: the third column is gone.
    expect(c2).toBeUndefined();
    expect(c0?.attribute('style') ?? '').not.toContain('filter');
    expect(c1?.attribute('style')).toMatch(/filter:url\(#/);
    expect(c0?.attribute('fill')).toBeTruthy();
    expect(c1?.attribute('fill')).not.toBe(c0?.attribute('fill'));
    expect(c1?.attribute('stroke')).toBe(c1?.attribute('fill'));
  });

  it('fills a width and height', async () => {
    const prefs = Preferences.get();
    prefs.setBool(`${prefs_path}fillrect`, true);
    prefs.setDouble(`${prefs_path}fillwidth`, 25);
    prefs.setDouble(`${prefs_path}fillheight`, 30);
    const { dt, clones } = tiler(1, 1);
    await clonetiler_apply(dt);
    // Tiles at x = 0, 10, 20 and y = 0, 20: columns while the shift is under 25, rows under 30.
    expect(clones().map((c) => c.getRepr().attribute('transform'))).toEqual([
      null,
      'translate(0,20)',
      'translate(10)',
      'translate(10,20)',
      'translate(20)',
      'translate(20,20)',
    ]);
    prefs.remove(`${prefs_path}fillrect`);
  });

  it('picks the opacity of the drawing under each clone', async () => {
    const prefs = Preferences.get();
    prefs.setBool(`${prefs_path}dotrace`, true);
    prefs.setInt(`${prefs_path}pick`, PickType.PICK_OPACITY);
    prefs.setBool(`${prefs_path}pick_to_presence`, false);
    prefs.setBool(`${prefs_path}pick_to_opacity`, true);
    const { dt, clones } = tiler(4, 1);
    // Opaque only under the second and third tile (x from 20 to 40).
    const bm = bitmap(400, 300, (x) => x >= 20 && x < 40);
    await clonetiler_apply(dt, undefined, undefined, bm);
    const x = clones().map((c) => c.getRepr().attribute('transform'));
    expect(x).toEqual(['translate(10)', 'translate(20)']);
  });
});

describe('clonetiler_remove, clonetiler_unclump and clonetiler_reset', () => {
  it('removes only the tiled clones of the selected object and gives a warning without selection', async () => {
    const { dt, clones, undoSteps } = tiler(2, 2);
    await clonetiler_apply(dt);
    expect(clonetiler_remove(dt)).toBeNull();
    expect(clones()).toHaveLength(0);
    expect(undoSteps()).toEqual(['Create tiled clones', 'Delete tiled clones']);
    expect(dt.getSelection().singleItem()?.getId()).toBe('r');
    dt.getSelection().clear();
    expect(clonetiler_remove(dt)).toContain('whose tiled clones to remove');
    expect(clonetiler_unclump(dt)).toContain('whose tiled clones to unclump');
  });

  it('unclump adds an undo step', async () => {
    // An exponent of 2 spaces the columns unevenly, which unclump evens out.
    Preferences.get().setDouble(`${prefs_path}shiftx_exp`, 2);
    const { dt, undoSteps } = tiler(4, 1);
    await clonetiler_apply(dt);
    expect(clonetiler_unclump(dt)).toBeNull();
    expect(undoSteps().at(-1)).toBe('Unclump tiled clones');
  });

  it('reset sets the numbers of the tabs to 0 (exponents to 1), unchecks the check boxes and keeps the rest', () => {
    const prefs = Preferences.get();
    prefs.setDouble(`${prefs_path}shiftx_per_i`, 20);
    prefs.setDouble(`${prefs_path}shiftx_exp`, 3);
    prefs.setBool(`${prefs_path}shiftx_alternate`, true);
    prefs.setBool(`${prefs_path}dotrace`, true);
    prefs.setInt(`${prefs_path}imax`, 7);
    prefs.setInt(`${prefs_path}symmetrygroup`, 5);
    clonetiler_reset();
    expect(prefs.getDouble(`${prefs_path}shiftx_per_i`)).toBe(0);
    expect(prefs.getDouble(`${prefs_path}shiftx_exp`)).toBe(1);
    expect(prefs.getBool(`${prefs_path}shiftx_alternate`)).toBe(false);
    expect(prefs.getBool(`${prefs_path}dotrace`)).toBe(false);
    expect(prefs.getInt(`${prefs_path}imax`)).toBe(7);
    expect(prefs.getInt(`${prefs_path}symmetrygroup`)).toBe(5);
    prefs.remove(`${prefs_path}shiftx_alternate`);
  });
});
