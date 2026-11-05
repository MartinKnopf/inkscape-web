// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-lattice2.cpp, src/live_effects/lpe-lattice2.h
/** \file
 * LPE <lattice2> implementation
 */
/*
 * Authors:
 *   Johan Engelen <j.b.c.engelen@utwente.nl>
 *   Steren Giannini
 *   Noé Falzon
 *   Victor Navez
 *   ~suv
 *   Jabiertxo Arraiza
 *
 * Copyright (C) 2007-2008 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { CubicBezier, distance, Path, type PathVector, Point, write_svg_path } from '@inkscape-web/geom';
import { _, C_ } from '../i18n.ts';
import type { SPItem } from '../object/sp-item.ts';
import type { SPLPEItem } from '../object/sp-lpe-item.ts';
import { pathBoolopBackend } from '../path/path-boolop.ts';
import { sp_svg_read_pathv } from '../svg/svg-path.ts';
import { Line } from './lpe-perspective-envelope.ts';
import { GroupBBoxEffect } from './lpegroupbbox.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import type { Parameter, ParamWidget } from './parameter/parameter.ts';
import { PointParam } from './parameter/point.ts';

/** The names of the grid points (gridpoint<name>); the order of the parameters. */
const GRID_NAMES = [
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8x9',
  '10x11',
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '18',
  '19',
  '20x21',
  '22x23',
  '24x26',
  '25x27',
  '28x30',
  '29x31',
  '32x33x34x35',
] as const;
type GridName = (typeof GRID_NAMES)[number];

/** The grid point of each of the 36 handles of the SBasis2d (shared points repeated). */
const HANDLES: readonly GridName[] = [
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8x9',
  '8x9',
  '10x11',
  '10x11',
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '18',
  '19',
  '20x21',
  '20x21',
  '22x23',
  '22x23',
  '24x26',
  '25x27',
  '24x26',
  '25x27',
  '28x30',
  '29x31',
  '28x30',
  '29x31',
  '32x33x34x35',
  '32x33x34x35',
  '32x33x34x35',
  '32x33x34x35',
];

/** The default place of each grid point in quarters of the bounding box (x, y). */
const DEFAULTS: Record<GridName, [number, number]> = {
  '0': [0, 0],
  '1': [4, 0],
  '2': [0, 4],
  '3': [4, 4],
  '4': [1, 0],
  '5': [3, 0],
  '6': [1, 4],
  '7': [3, 4],
  '8x9': [2, 0],
  '10x11': [2, 4],
  '12': [0, 1],
  '13': [4, 1],
  '14': [0, 3],
  '15': [4, 3],
  '16': [1, 1],
  '17': [3, 1],
  '18': [1, 3],
  '19': [3, 3],
  '20x21': [2, 1],
  '22x23': [2, 3],
  '24x26': [0, 2],
  '25x27': [4, 2],
  '28x30': [1, 2],
  '29x31': [3, 2],
  '32x33x34x35': [2, 2],
};

/** The inner points, hidden with "Use only perimeter". */
const INNER: readonly GridName[] = [
  '16',
  '20x21',
  '17',
  '28x30',
  '32x33x34x35',
  '29x31',
  '18',
  '22x23',
  '19',
];

/**
 * Lattice Deformation (upstream LPELattice2): warps the path with a 5x5 grid of control points.
 * The SBasis2d math runs in WASM.
 */
export class LPELattice2 extends GroupBBoxEffect {
  readonly horizontal_mirror: BoolParam;
  readonly vertical_mirror: BoolParam;
  readonly perimetral: BoolParam;
  readonly live_update: BoolParam;
  readonly grid = new Map<GridName, PointParam>();

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.horizontal_mirror = new BoolParam(
      _('Mirror movements in horizontal'),
      _('Mirror movements in horizontal'),
      'horizontal_mirror',
      this,
      false,
    );
    this.vertical_mirror = new BoolParam(
      _('Mirror movements in vertical'),
      _('Mirror movements in vertical'),
      'vertical_mirror',
      this,
      false,
    );
    this.perimetral = new BoolParam(
      _('Use only perimeter'),
      _('Use only perimeter'),
      'perimetral',
      this,
      false,
    );
    this.live_update = new BoolParam(
      _('Update while moving knots (maybe slow)'),
      _('Update while moving knots (maybe slow)'),
      'live_update',
      this,
      true,
    );
    for (const name of GRID_NAMES) {
      this.grid.set(
        name,
        new PointParam(
          _(`Control ${name}:`),
          _(`Control ${name} - <b>Ctrl+Alt+Click</b>: reset, <b>Ctrl</b>: move along axes`),
          `gridpoint${name}`,
          this,
        ),
      );
    }
    // register all your parameters here, so Inkscape knows which parameters this effect has:
    this.registerParameter(this.horizontal_mirror);
    this.registerParameter(this.vertical_mirror);
    this.registerParameter(this.perimetral);
    this.registerParameter(this.live_update);
    for (const p of this.grid.values()) this.registerParameter(p);
    this.apply_to_clippath_and_mask = true;
  }

  #g(name: GridName): PointParam {
    return this.grid.get(name) as PointParam;
  }

  protected override doEffect_path(path_in: PathVector): PathVector {
    const handles = HANDLES.flatMap((name) => [this.#g(name).x, this.#g(name).y]);
    const d = pathBoolopBackend().lattice2Path(write_svg_path(path_in), handles, [
      this.boundingbox_X.min(),
      this.boundingbox_X.max(),
      this.boundingbox_Y.min(),
      this.boundingbox_Y.max(),
    ]);
    return sp_svg_read_pathv(d);
  }

  /** The widgets with the "Reset grid" button first (upstream: the points are in an expander). */
  override newWidget(): { param: Parameter | null; widget: ParamWidget }[] {
    return [
      {
        param: null,
        widget: {
          kind: 'buttons',
          buttons: [{ label: _('Reset grid'), onClick: () => this.#onResetGrid() }],
        },
      },
      ...super.newWidget(),
    ];
  }

  #onResetGrid(): void {
    this.resetGrid();
    this.makeUndoDone(C_('Undo', 'Change point parameter'));
  }

  vertical(param_one: PointParam, param_two: PointParam, vert: Line): void {
    let A = param_one.value;
    let B = param_two.value;
    const Y = (A.y + B.y) / 2;
    A = new Point(A.x, Y);
    B = new Point(B.x, Y);
    const nearest = vert.pointAt(vert.nearestTime(A));
    const distance_one = distance(A, nearest);
    const distance_two = distance(B, nearest);
    let distance_middle = (distance_one + distance_two) / 2;
    if (A.x > B.x) distance_middle *= -1;
    param_one.param_setValue(new Point(nearest.x - distance_middle, A.y), this.live_update.get_value());
    param_two.param_setValue(new Point(nearest.x + distance_middle, B.y), this.live_update.get_value());
  }

  horizontal(param_one: PointParam, param_two: PointParam, horiz: Line): void {
    let A = param_one.value;
    let B = param_two.value;
    const X = (A.x + B.x) / 2;
    A = new Point(X, A.y);
    B = new Point(X, B.y);
    const nearest = horiz.pointAt(horiz.nearestTime(A));
    const distance_one = distance(A, nearest);
    const distance_two = distance(B, nearest);
    let distance_middle = (distance_one + distance_two) / 2;
    if (A.y > B.y) distance_middle *= -1;
    param_one.param_setValue(new Point(A.x, nearest.y - distance_middle), this.live_update.get_value());
    param_two.param_setValue(new Point(B.x, nearest.y + distance_middle), this.live_update.get_value());
  }

  protected override doBeforeEffect(lpeitem: SPLPEItem): void {
    this.original_bbox(lpeitem, false, true);
    this.setDefaults();
    if (this.is_applied) this.resetGrid();
    const g = (n: GridName) => this.#g(n);
    const vert = new Line(g('8x9').param_get_default(), g('10x11').param_get_default());
    const horiz = new Line(g('24x26').param_get_default(), g('25x27').param_get_default());
    if (this.vertical_mirror.get_value()) {
      this.vertical(g('0'), g('1'), vert);
      this.vertical(g('2'), g('3'), vert);
      this.vertical(g('4'), g('5'), vert);
      this.vertical(g('6'), g('7'), vert);
      this.vertical(g('12'), g('13'), vert);
      this.vertical(g('14'), g('15'), vert);
      this.vertical(g('16'), g('17'), vert);
      this.vertical(g('18'), g('19'), vert);
      this.vertical(g('24x26'), g('25x27'), vert);
      this.vertical(g('28x30'), g('29x31'), vert);
    }
    if (this.horizontal_mirror.get_value()) {
      this.horizontal(g('0'), g('2'), horiz);
      this.horizontal(g('1'), g('3'), horiz);
      this.horizontal(g('4'), g('6'), horiz);
      this.horizontal(g('5'), g('7'), horiz);
      this.horizontal(g('8x9'), g('10x11'), horiz);
      this.horizontal(g('12'), g('14'), horiz);
      this.horizontal(g('13'), g('15'), horiz);
      this.horizontal(g('16'), g('18'), horiz);
      this.horizontal(g('17'), g('19'), horiz);
      this.horizontal(g('20x21'), g('22x23'), horiz);
    }
    const perimetral = this.perimetral.get_value();
    for (const name of INNER) g(name).param_hide_knot(perimetral);
    if (perimetral) for (const name of INNER) g(name).param_set_default();
  }

  setDefaults(): void {
    const X = this.boundingbox_X;
    const Y = this.boundingbox_Y;
    for (const name of GRID_NAMES) {
      const [qx, qy] = DEFAULTS[name];
      const p = this.#g(name);
      p.param_update_default(
        new Point(((X.max() - X.min()) / 4) * qx + X.min(), ((Y.max() - Y.min()) / 4) * qy + Y.min()),
      );
      p.param_set_liveupdate(this.live_update.get_value());
    }
  }

  resetGrid(): void {
    for (const p of this.grid.values()) p.param_set_default();
  }

  override resetDefaults(item: SPItem): void {
    super.resetDefaults(item);
    this.original_bbox(item as SPLPEItem, false, true);
    this.setDefaults();
    this.resetGrid();
  }

  #calculateCurve(a: Point, b: Point, c: Path[], horizontal: boolean, move: boolean): void {
    if (move) c.push(new Path(a));
    const path = c[c.length - 1] as Path;
    const cubic1 = a.add(b.sub(a).mul(1 / 3));
    const cubic2 = b.add(a.sub(b).mul(1 / 3));
    if (horizontal) {
      path.appendCurve(new CubicBezier(a, new Point(cubic1.x, a.y), new Point(cubic2.x, b.y), b));
    } else {
      path.appendCurve(new CubicBezier(a, new Point(a.x, cubic1.y), new Point(b.x, cubic2.y), b));
    }
  }

  protected override addCanvasIndicators(_lpeitem: SPLPEItem, hp_vec: PathVector[]): void {
    hp_vec.length = 0;
    const c: Path[] = [];
    // [from, to, horizontal, move] per curve of the grid lines
    const lines: [GridName, GridName, boolean, boolean][] = this.perimetral.get_value()
      ? [
          ['0', '4', true, true],
          ['4', '8x9', true, false],
          ['8x9', '5', true, false],
          ['5', '1', true, false],
          ['1', '13', false, true],
          ['13', '25x27', false, false],
          ['25x27', '15', false, false],
          ['15', '3', false, false],
          ['2', '6', true, true],
          ['6', '10x11', true, false],
          ['10x11', '7', true, false],
          ['7', '3', true, false],
          ['0', '12', false, true],
          ['12', '24x26', false, false],
          ['24x26', '14', false, false],
          ['14', '2', false, false],
        ]
      : [
          ['0', '4', true, true],
          ['4', '8x9', true, false],
          ['8x9', '5', true, false],
          ['5', '1', true, false],
          ['12', '16', true, true],
          ['16', '20x21', true, false],
          ['20x21', '17', true, false],
          ['17', '13', true, false],
          ['24x26', '28x30', true, true],
          ['28x30', '32x33x34x35', true, false],
          ['32x33x34x35', '29x31', true, false],
          ['29x31', '25x27', true, false],
          ['14', '18', true, true],
          ['18', '22x23', true, false],
          ['22x23', '19', true, false],
          ['19', '15', true, false],
          ['2', '6', true, true],
          ['6', '10x11', true, false],
          ['10x11', '7', true, false],
          ['7', '3', true, false],
          ['0', '12', false, true],
          ['12', '24x26', false, false],
          ['24x26', '14', false, false],
          ['14', '2', false, false],
          ['4', '16', false, true],
          ['16', '28x30', false, false],
          ['28x30', '18', false, false],
          ['18', '6', false, false],
          ['8x9', '20x21', false, true],
          ['20x21', '32x33x34x35', false, false],
          ['32x33x34x35', '22x23', false, false],
          ['22x23', '10x11', false, false],
          ['5', '17', false, true],
          ['17', '29x31', false, false],
          ['29x31', '19', false, false],
          ['19', '7', false, false],
          ['1', '13', false, true],
          ['13', '25x27', false, false],
          ['25x27', '15', false, false],
          ['15', '3', false, false],
        ];
    for (const [a, b, horizontal, move] of lines) {
      this.#calculateCurve(this.#g(a).value, this.#g(b).value, c, horizontal, move);
    }
    hp_vec.push(c);
  }
}
