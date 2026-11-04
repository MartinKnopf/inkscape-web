// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/clonetiler.cpp, src/ui/dialog/clonetiler.h
/*
 * Clone tiling dialog
 *
 * Authors:
 *   bulia byak <buliabyak@users.sf.net>
 *   Johan Engelen <goejendaagh@zonnet.nl>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *   Romain de Bossoreille
 *
 * Copyright (C) 2004-2011 Authors
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import {
  _,
  BBoxType,
  C_,
  Colors,
  cssNumber,
  DocumentUndo,
  getHrefAttribute,
  N_,
  new_filter_gaussian_blur,
  Preferences,
  type SPItem,
  type SPObject,
  SPUse,
  sp_svg_transform_write,
  spStyleSetPropertyUrl,
  unclump,
} from '@inkscape-web/core';
import { Affine, Point, Rect, Rotate, Scale, Translate } from '@inkscape-web/geom';
import type { SPDesktop } from '../../desktop.ts';
import { sp_export_canvas } from '../../helper/png-write.ts';
import { average_color, color_from_average } from '../tools/dropper-tool.ts';

export const prefs_path = '/dialogs/clonetiler/';

/** The 17 symmetry groups (upstream anonymous enum TILE_P1 ...); the value is /dialogs/clonetiler/symmetrygroup. */
export enum TileGroup {
  TILE_P1,
  TILE_P2,
  TILE_PM,
  TILE_PG,
  TILE_CM,
  TILE_PMM,
  TILE_PMG,
  TILE_PGG,
  TILE_CMM,
  TILE_P4,
  TILE_P4M,
  TILE_P4G,
  TILE_P3,
  TILE_P31M,
  TILE_P3M1,
  TILE_P6,
  TILE_P6M,
}

/** The value of the drawing to pick (/dialogs/clonetiler/pick). */
export enum PickType {
  PICK_COLOR,
  PICK_OPACITY,
  PICK_R,
  PICK_G,
  PICK_B,
  PICK_H,
  PICK_S,
  PICK_L,
}

/**
 * The labels of the symmetry groups, in the order of TileGroup (pango markup).
 * TRANSLATORS: For the following 17 symmetry groups, see
 * http://www.bib.ulb.ac.be/coursmath/doc/17.htm (visual examples);
 * http://www.clarku.edu/~djoyce/wallpaper/seventeen.html (English vocabulary); or
 * http://membres.lycos.fr/villemingerard/Geometri/Sym1D.htm (French vocabulary).
 */
export const sym_groups: readonly string[] = [
  // TRANSLATORS: "translation" means "shift" / "displacement" here.
  N_('<b>P1</b>: simple translation'),
  N_('<b>P2</b>: 180&#176; rotation'),
  N_('<b>PM</b>: reflection'),
  // TRANSLATORS: "glide reflection" is a reflection and a translation combined.
  //  For more info, see http://mathforum.org/sum95/suzanne/symsusan.html
  N_('<b>PG</b>: glide reflection'),
  N_('<b>CM</b>: reflection + glide reflection'),
  N_('<b>PMM</b>: reflection + reflection'),
  N_('<b>PMG</b>: reflection + 180&#176; rotation'),
  N_('<b>PGG</b>: glide reflection + 180&#176; rotation'),
  N_('<b>CMM</b>: reflection + reflection + 180&#176; rotation'),
  N_('<b>P4</b>: 90&#176; rotation'),
  N_('<b>P4M</b>: 90&#176; rotation + 45&#176; reflection'),
  N_('<b>P4G</b>: 90&#176; rotation + 90&#176; reflection'),
  N_('<b>P3</b>: 120&#176; rotation'),
  N_('<b>P31M</b>: reflection + 120&#176; rotation, dense'),
  N_('<b>P3M1</b>: reflection + 120&#176; rotation, sparse'),
  N_('<b>P6</b>: 60&#176; rotation'),
  N_('<b>P6M</b>: reflection + 60&#176; rotation'),
];

// The tabs ----------------------------------------------------------------------------------------

/** A number field of the dialog (upstream spinbox()): the preference, the range and the unit. */
export interface TilerSpin {
  kind: 'spin';
  key: string;
  tip: string;
  lower: number;
  upper: number;
  /** Pango markup. */
  suffix: string;
  /** An exponent is reset to 1, all other values to 0. */
  exponent: boolean;
}

/** A check box of the dialog (upstream checkbox()). */
export interface TilerCheck {
  kind: 'check';
  key: string;
  tip: string;
}

export type TilerCell = TilerSpin | TilerCheck;

/** A row of a table of the dialog: a label (pango markup) and the cells for Per row, Per column and Randomize. */
export interface TilerRow {
  label: string;
  cells: readonly (TilerCell | null)[];
}

/** A tab of the dialog that is a table of rows (upstream table_x_y_rand()). */
export interface TilerTab {
  label: string;
  rows: readonly TilerRow[];
}

const spin = (
  key: string,
  tip: string,
  lower: number,
  upper: number,
  suffix: string,
  exponent = false,
): TilerSpin => ({ kind: 'spin', key, tip, lower, upper, suffix, exponent });
const check = (key: string, tip: string): TilerCheck => ({ kind: 'check', key, tip });

const ALTERNATE = N_('<small>Alternate:</small>');
const CUMULATE = N_('<small>Cumulate:</small>');
const EXPONENT = N_('<b>Exponent:</b>');
const DEG = '&#176;';

/**
 * The Shift, Scale, Rotation, Blur & opacity and Color tabs. The cells of a row are in the columns
 * "Per row" (the j index), "Per column" (the i index) and "Randomize". The labels are msgids.
 */
export const clonetiler_tabs: readonly TilerTab[] = [
  {
    label: N_('S_hift'),
    rows: [
      {
        // TRANSLATORS: "shift" means: the tiles will be shifted (offset) horizontally by this amount
        label: N_('<b>Shift X:</b>'),
        cells: [
          spin('shiftx_per_j', N_('Horizontal shift per row (in % of tile width)'), -10000, 10000, '%'),
          spin('shiftx_per_i', N_('Horizontal shift per column (in % of tile width)'), -10000, 10000, '%'),
          spin('shiftx_rand', N_('Randomize the horizontal shift by this percentage'), 0, 1000, '%'),
        ],
      },
      {
        // TRANSLATORS: "shift" means: the tiles will be shifted (offset) vertically by this amount
        label: N_('<b>Shift Y:</b>'),
        cells: [
          spin('shifty_per_j', N_('Vertical shift per row (in % of tile height)'), -10000, 10000, '%'),
          spin('shifty_per_i', N_('Vertical shift per column (in % of tile height)'), -10000, 10000, '%'),
          spin('shifty_rand', N_('Randomize the vertical shift by this percentage'), 0, 1000, '%'),
        ],
      },
      {
        label: EXPONENT,
        cells: [
          spin(
            'shifty_exp',
            N_('Whether rows are spaced evenly (1), converge (<1) or diverge (>1)'),
            0,
            10,
            '',
            true,
          ),
          spin(
            'shiftx_exp',
            N_('Whether columns are spaced evenly (1), converge (<1) or diverge (>1)'),
            0,
            10,
            '',
            true,
          ),
        ],
      },
      {
        // TRANSLATORS: "Alternate" is a verb here
        label: ALTERNATE,
        cells: [
          check('shifty_alternate', N_('Alternate the sign of shifts for each row')),
          check('shiftx_alternate', N_('Alternate the sign of shifts for each column')),
        ],
      },
      {
        // TRANSLATORS: "Cumulate" is a verb here
        label: CUMULATE,
        cells: [
          check('shifty_cumulate', N_('Cumulate the shifts for each row')),
          check('shiftx_cumulate', N_('Cumulate the shifts for each column')),
        ],
      },
      {
        label: N_('<small>Exclude tile:</small>'),
        cells: [
          check('shifty_excludeh', N_('Exclude tile height in shift')),
          check('shiftx_excludew', N_('Exclude tile width in shift')),
        ],
      },
    ],
  },
  {
    label: N_('Sc_ale'),
    rows: [
      {
        label: N_('<b>Scale X:</b>'),
        cells: [
          spin('scalex_per_j', N_('Horizontal scale per row (in % of tile width)'), -100, 1000, '%'),
          spin('scalex_per_i', N_('Horizontal scale per column (in % of tile width)'), -100, 1000, '%'),
          spin('scalex_rand', N_('Randomize the horizontal scale by this percentage'), 0, 1000, '%'),
        ],
      },
      {
        label: N_('<b>Scale Y:</b>'),
        cells: [
          spin('scaley_per_j', N_('Vertical scale per row (in % of tile height)'), -100, 1000, '%'),
          spin('scaley_per_i', N_('Vertical scale per column (in % of tile height)'), -100, 1000, '%'),
          spin('scaley_rand', N_('Randomize the vertical scale by this percentage'), 0, 1000, '%'),
        ],
      },
      {
        label: EXPONENT,
        cells: [
          spin(
            'scaley_exp',
            N_('Whether row scaling is uniform (1), converge (<1) or diverge (>1)'),
            0,
            10,
            '',
            true,
          ),
          spin(
            'scalex_exp',
            N_('Whether column scaling is uniform (1), converge (<1) or diverge (>1)'),
            0,
            10,
            '',
            true,
          ),
        ],
      },
      {
        // Logarithmic (as in logarithmic spiral)
        label: N_('<b>Base:</b>'),
        cells: [
          spin(
            'scaley_log',
            N_('Base for a logarithmic spiral: not used (0), converge (<1), or diverge (>1)'),
            0,
            10,
            '',
          ),
          spin(
            'scalex_log',
            N_('Base for a logarithmic spiral: not used (0), converge (<1), or diverge (>1)'),
            0,
            10,
            '',
          ),
        ],
      },
      {
        label: ALTERNATE,
        cells: [
          check('scaley_alternate', N_('Alternate the sign of scales for each row')),
          check('scalex_alternate', N_('Alternate the sign of scales for each column')),
        ],
      },
      {
        label: CUMULATE,
        cells: [
          check('scaley_cumulate', N_('Cumulate the scales for each row')),
          check('scalex_cumulate', N_('Cumulate the scales for each column')),
        ],
      },
    ],
  },
  {
    label: N_('_Rotation'),
    rows: [
      {
        label: N_('<b>Angle:</b>'),
        cells: [
          spin('rotate_per_j', N_('Rotate tiles by this angle for each row'), -180, 180, DEG),
          spin('rotate_per_i', N_('Rotate tiles by this angle for each column'), -180, 180, DEG),
          spin('rotate_rand', N_('Randomize the rotation angle by this percentage'), 0, 100, '%'),
        ],
      },
      {
        label: ALTERNATE,
        cells: [
          check('rotate_alternatej', N_('Alternate the rotation direction for each row')),
          check('rotate_alternatei', N_('Alternate the rotation direction for each column')),
        ],
      },
      {
        label: CUMULATE,
        cells: [
          check('rotate_cumulatej', N_('Cumulate the rotation for each row')),
          check('rotate_cumulatei', N_('Cumulate the rotation for each column')),
        ],
      },
    ],
  },
  {
    label: N_('_Blur & opacity'),
    rows: [
      {
        label: N_('<b>Blur:</b>'),
        cells: [
          spin('blur_per_j', N_('Blur tiles by this percentage for each row'), 0, 100, '%'),
          spin('blur_per_i', N_('Blur tiles by this percentage for each column'), 0, 100, '%'),
          spin('blur_rand', N_('Randomize the tile blur by this percentage'), 0, 100, '%'),
        ],
      },
      {
        label: ALTERNATE,
        cells: [
          check('blur_alternatej', N_('Alternate the sign of blur change for each row')),
          check('blur_alternatei', N_('Alternate the sign of blur change for each column')),
        ],
      },
      {
        label: N_('<b>Opacity:</b>'),
        cells: [
          spin('opacity_per_j', N_('Decrease tile opacity by this percentage for each row'), 0, 100, '%'),
          spin('opacity_per_i', N_('Decrease tile opacity by this percentage for each column'), 0, 100, '%'),
          spin('opacity_rand', N_('Randomize the tile opacity by this percentage'), 0, 100, '%'),
        ],
      },
      {
        label: ALTERNATE,
        cells: [
          check('opacity_alternatej', N_('Alternate the sign of opacity change for each row')),
          check('opacity_alternatei', N_('Alternate the sign of opacity change for each column')),
        ],
      },
    ],
  },
  {
    // The initial color is above the table in the dialog.
    label: N_('Co_lor'),
    rows: [
      {
        label: N_('<b>H:</b>'),
        cells: [
          spin('hue_per_j', N_('Change the tile hue by this percentage for each row'), -100, 100, '%'),
          spin('hue_per_i', N_('Change the tile hue by this percentage for each column'), -100, 100, '%'),
          spin('hue_rand', N_('Randomize the tile hue by this percentage'), 0, 100, '%'),
        ],
      },
      {
        label: N_('<b>S:</b>'),
        cells: [
          spin(
            'saturation_per_j',
            N_('Change the color saturation by this percentage for each row'),
            -100,
            100,
            '%',
          ),
          spin(
            'saturation_per_i',
            N_('Change the color saturation by this percentage for each column'),
            -100,
            100,
            '%',
          ),
          spin('saturation_rand', N_('Randomize the color saturation by this percentage'), 0, 100, '%'),
        ],
      },
      {
        label: N_('<b>L:</b>'),
        cells: [
          spin(
            'lightness_per_j',
            N_('Change the color lightness by this percentage for each row'),
            -100,
            100,
            '%',
          ),
          spin(
            'lightness_per_i',
            N_('Change the color lightness by this percentage for each column'),
            -100,
            100,
            '%',
          ),
          spin('lightness_rand', N_('Randomize the color lightness by this percentage'), 0, 100, '%'),
        ],
      },
      {
        label: N_('<small>Alternate:</small>'),
        cells: [
          check('color_alternatej', N_('Alternate the sign of color changes for each row')),
          check('color_alternatei', N_('Alternate the sign of color changes for each column')),
        ],
      },
    ],
  },
];

/** The controls of the Trace tab that the Reset button resets, see clonetiler_reset(). */
export const trace_controls: readonly TilerCell[] = [
  spin(
    'gamma_picked',
    N_('Shift the mid-range of the picked value upwards (>0) or downwards (<0)'),
    -10,
    10,
    '',
  ),
  spin('rand_picked', N_('Randomize the picked value by this percentage'), 0, 100, '%'),
  check('invert_picked', N_('Invert the picked value')),
];

/**
 * Reset all shifts, scales, rotates, opacity and color changes to zero (upstream reset()): the
 * number fields to 0 (exponents to 1), the check boxes of the tabs and the trace check box to off.
 * The rows and columns, the size, the symmetry group and the other check boxes are kept.
 */
export function clonetiler_reset(): void {
  const prefs = Preferences.get();
  for (const cell of [...clonetiler_tabs.flatMap((t) => t.rows.flatMap((r) => r.cells)), ...trace_controls]) {
    if (!cell) continue;
    if (cell.kind === 'spin') prefs.setDouble(prefs_path + cell.key, cell.exponent ? 1 : 0);
    else prefs.setBool(prefs_path + cell.key, false);
  }
  prefs.setBool(`${prefs_path}dotrace`, false);
}

// Transforms --------------------------------------------------------------------------------------

/** A random double in [min, max) (upstream g_random_double_range). */
export type RandomRange = (min: number, max: number) => number;
const default_random: RandomRange = (min, max) => min + Math.random() * (max - min);

/** The values of the Shift, Scale and Rotation tabs, in the units of get_transform() (fractions, not percent). */
export interface TransformParams {
  shiftx_per_i: number;
  shifty_per_i: number;
  shiftx_per_j: number;
  shifty_per_j: number;
  shiftx_rand: number;
  shifty_rand: number;
  shiftx_exp: number;
  shifty_exp: number;
  shiftx_alternate: boolean;
  shifty_alternate: boolean;
  shiftx_cumulate: boolean;
  shifty_cumulate: boolean;
  shiftx_excludew: boolean;
  shifty_excludeh: boolean;
  scalex_per_i: number;
  scaley_per_i: number;
  scalex_per_j: number;
  scaley_per_j: number;
  scalex_rand: number;
  scaley_rand: number;
  scalex_exp: number;
  scaley_exp: number;
  scalex_log: number;
  scaley_log: number;
  scalex_alternate: boolean;
  scaley_alternate: boolean;
  scalex_cumulate: boolean;
  scaley_cumulate: boolean;
  rotate_per_i: number;
  rotate_per_j: number;
  rotate_rand: number;
  rotate_alternatei: boolean;
  rotate_alternatej: boolean;
  rotate_cumulatei: boolean;
  rotate_cumulatej: boolean;
}

/** The product of the transforms, applied from left to right (upstream operator* of Geom::Affine). */
const mul = (...m: Affine[]): Affine => m.reduce((a, b) => a.multiply(b));
const T = Translate;
const pow = Math.pow;
/** The integer division of C++ for non-negative numbers. */
const idiv = (a: number, b: number): number => Math.trunc(a / b);

/**
 * The transform of the tile in row j and column i of a tiling with the symmetry group `type`,
 * for a tile with center (cx, cy), width w and height h (upstream CloneTiler::get_transform).
 */
export function get_transform(
  type: number,
  i: number,
  j: number,
  cx: number,
  cy: number,
  w: number,
  h: number,
  p: TransformParams,
  random: RandomRange = default_random,
): Affine {
  // Shift (in units of tile width or height) -------------
  let delta_shifti: number;
  let delta_shiftj: number;
  if (p.shiftx_alternate) delta_shifti = i % 2;
  // Should the delta shifts be cumulative (i.e. 1, 1+2, 1+2+3, ...)
  else delta_shifti = p.shiftx_cumulate ? i * i : i;
  if (p.shifty_alternate) delta_shiftj = j % 2;
  else delta_shiftj = p.shifty_cumulate ? j * j : j;

  // Random shift, only calculate if non-zero.
  let delta_shiftx_rand = 0.0;
  let delta_shifty_rand = 0.0;
  if (p.shiftx_rand !== 0.0) delta_shiftx_rand = p.shiftx_rand * random(-1, 1);
  if (p.shifty_rand !== 0.0) delta_shifty_rand = p.shifty_rand * random(-1, 1);

  // Delta shift (units of tile width/height)
  const di = p.shiftx_per_i * delta_shifti + p.shiftx_per_j * delta_shiftj + delta_shiftx_rand;
  const dj = p.shifty_per_i * delta_shifti + p.shifty_per_j * delta_shiftj + delta_shifty_rand;

  // Shift in actual x and y, used below
  const dx = w * di;
  const dy = h * dj;

  let shifti = di;
  let shiftj = dj;

  // Include tile width and height in shift if required
  if (!p.shiftx_excludew) shifti += i;
  if (!p.shifty_excludeh) shiftj += j;

  // Add exponential shift if necessary
  const shifti_sign = shifti > 0.0 ? 1.0 : -1.0;
  shifti = shifti_sign * pow(Math.abs(shifti), p.shiftx_exp);
  const shiftj_sign = shiftj > 0.0 ? 1.0 : -1.0;
  shiftj = shiftj_sign * pow(Math.abs(shiftj), p.shifty_exp);

  // Final shift
  const rect_translate = T(w * shifti, h * shiftj);

  // Rotation (in degrees) ------------
  let delta_rotationi: number;
  let delta_rotationj: number;
  if (p.rotate_alternatei) delta_rotationi = i % 2;
  else delta_rotationi = p.rotate_cumulatei ? (i * i + i) / 2.0 : i;
  if (p.rotate_alternatej) delta_rotationj = j % 2;
  else delta_rotationj = p.rotate_cumulatej ? (j * j + j) / 2.0 : j;

  let delta_rotate_rand = 0.0;
  if (p.rotate_rand !== 0.0) delta_rotate_rand = p.rotate_rand * 180.0 * random(-1, 1);

  const dr = p.rotate_per_i * delta_rotationi + p.rotate_per_j * delta_rotationj + delta_rotate_rand;

  // Scale (times the original) -----------
  let delta_scalei: number;
  let delta_scalej: number;
  if (p.scalex_alternate) delta_scalei = i % 2;
  // Should the delta scales be cumulative (i.e. 1, 1+2, 1+2+3, ...)
  else delta_scalei = p.scalex_cumulate ? (i * i + i) / 2.0 : i;
  if (p.scaley_alternate) delta_scalej = j % 2;
  else delta_scalej = p.scaley_cumulate ? (j * j + j) / 2.0 : j;

  // Random scale, only calculate if non-zero.
  let delta_scalex_rand = 0.0;
  let delta_scaley_rand = 0.0;
  if (p.scalex_rand !== 0.0) delta_scalex_rand = p.scalex_rand * random(-1, 1);
  if (p.scaley_rand !== 0.0) delta_scaley_rand = p.scaley_rand * random(-1, 1);
  // But if random factors are same, scale x and y proportionally
  if (p.scalex_rand === p.scaley_rand) delta_scalex_rand = delta_scaley_rand;

  // Total delta scale
  let scalex = 1.0 + p.scalex_per_i * delta_scalei + p.scalex_per_j * delta_scalej + delta_scalex_rand;
  let scaley = 1.0 + p.scaley_per_i * delta_scalei + p.scaley_per_j * delta_scalej + delta_scaley_rand;

  if (scalex < 0.0) scalex = 0.0;
  if (scaley < 0.0) scaley = 0.0;

  // Add exponential scale if necessary
  if (p.scalex_exp !== 1.0) scalex = pow(scalex, p.scalex_exp);
  if (p.scaley_exp !== 1.0) scaley = pow(scaley, p.scaley_exp);

  // Add logarithmic factor if necessary
  if (p.scalex_log > 0.0) scalex = pow(p.scalex_log, scalex - 1.0);
  if (p.scaley_log > 0.0) scaley = pow(p.scaley_log, scaley - 1.0);

  // Calculate transformation matrices, translating back to "center of tile" (rotation center) before transforming
  const about = (m: Affine): Affine => mul(T(-cx, -cy), m, T(cx, cy));
  const drot_c = about(Rotate((Math.PI * dr) / 180));
  const dscale_c = about(Scale(scalex, scaley));

  const d_s_r = mul(dscale_c, drot_c);

  const rotate_180_c = about(Rotate(Math.PI));
  const rotate_90_c = about(Rotate(-Math.PI / 2));
  const rotate_m90_c = about(Rotate(Math.PI / 2));
  const rotate_120_c = about(Rotate((-2 * Math.PI) / 3));
  const rotate_m120_c = about(Rotate((2 * Math.PI) / 3));
  const rotate_60_c = about(Rotate(-Math.PI / 3));
  const rotate_m60_c = about(Rotate(Math.PI / 3));

  const flip_x = about(Scale(-1, 1));
  const flip_y = about(Scale(1, -1));

  // Create tile with required symmetry
  const cos60 = Math.cos(Math.PI / 3);
  const sin60 = Math.sin(Math.PI / 3);
  const cos30 = Math.cos(Math.PI / 6);
  const sin30 = Math.sin(Math.PI / 6);

  switch (type) {
    case TileGroup.TILE_P1:
      return mul(d_s_r, rect_translate);

    case TileGroup.TILE_P2:
      return i % 2 === 0 ? mul(d_s_r, rect_translate) : mul(d_s_r, rotate_180_c, rect_translate);

    case TileGroup.TILE_PM:
      return i % 2 === 0 ? mul(d_s_r, rect_translate) : mul(d_s_r, flip_x, rect_translate);

    case TileGroup.TILE_PG:
      return j % 2 === 0 ? mul(d_s_r, rect_translate) : mul(d_s_r, flip_x, rect_translate);

    case TileGroup.TILE_CM:
      return (i + j) % 2 === 0 ? mul(d_s_r, rect_translate) : mul(d_s_r, flip_x, rect_translate);

    case TileGroup.TILE_PMM:
      if (j % 2 === 0) {
        return i % 2 === 0 ? mul(d_s_r, rect_translate) : mul(d_s_r, flip_x, rect_translate);
      }
      return i % 2 === 0 ? mul(d_s_r, flip_y, rect_translate) : mul(d_s_r, flip_x, flip_y, rect_translate);

    case TileGroup.TILE_PMG:
      if (j % 2 === 0) {
        return i % 2 === 0 ? mul(d_s_r, rect_translate) : mul(d_s_r, rotate_180_c, rect_translate);
      }
      return i % 2 === 0
        ? mul(d_s_r, flip_y, rect_translate)
        : mul(d_s_r, rotate_180_c, flip_y, rect_translate);

    case TileGroup.TILE_PGG:
      if (j % 2 === 0) {
        return i % 2 === 0 ? mul(d_s_r, rect_translate) : mul(d_s_r, flip_y, rect_translate);
      }
      return i % 2 === 0
        ? mul(d_s_r, rotate_180_c, rect_translate)
        : mul(d_s_r, rotate_180_c, flip_y, rect_translate);

    case TileGroup.TILE_CMM:
      if (j % 4 === 0) {
        return i % 2 === 0 ? mul(d_s_r, rect_translate) : mul(d_s_r, flip_x, rect_translate);
      }
      if (j % 4 === 1) {
        return i % 2 === 0 ? mul(d_s_r, flip_y, rect_translate) : mul(d_s_r, flip_x, flip_y, rect_translate);
      }
      if (j % 4 === 2) {
        return i % 2 === 1 ? mul(d_s_r, rect_translate) : mul(d_s_r, flip_x, rect_translate);
      }
      return i % 2 === 1 ? mul(d_s_r, flip_y, rect_translate) : mul(d_s_r, flip_x, flip_y, rect_translate);

    case TileGroup.TILE_P4: {
      const ori = T(
        (w + h) * pow(idiv(i, 2), p.shiftx_exp) + dx,
        (h + w) * pow(idiv(j, 2), p.shifty_exp) + dy,
      );
      const dia1 = T(w / 2 + h / 2, -h / 2 + w / 2);
      const dia2 = T(-w / 2 + h / 2, h / 2 + w / 2);
      if (j % 2 === 0) {
        return i % 2 === 0 ? mul(d_s_r, ori) : mul(d_s_r, rotate_m90_c, dia1, ori);
      }
      return i % 2 === 0 ? mul(d_s_r, rotate_90_c, dia2, ori) : mul(d_s_r, rotate_180_c, dia1, dia2, ori);
    }

    case TileGroup.TILE_P4M: {
      const max = Math.max(w, h);
      const ori = T(
        (max + max) * pow(idiv(i, 4), p.shiftx_exp) + dx,
        (max + max) * pow(idiv(j, 2), p.shifty_exp) + dy,
      );
      const dia1 = T(w / 2 - h / 2, h / 2 - w / 2);
      const dia2 = T(-h / 2 + w / 2, w / 2 - h / 2);
      if (j % 2 === 0) {
        if (i % 4 === 0) return mul(d_s_r, ori);
        if (i % 4 === 1) return mul(d_s_r, flip_y, rotate_m90_c, dia1, ori);
        if (i % 4 === 2) return mul(d_s_r, rotate_m90_c, dia1, T(h, 0), ori);
        return mul(d_s_r, flip_x, T(w, 0), ori);
      }
      if (i % 4 === 0) return mul(d_s_r, flip_y, T(0, h), ori);
      if (i % 4 === 1) return mul(d_s_r, rotate_90_c, dia2, T(0, h), ori);
      if (i % 4 === 2) return mul(d_s_r, flip_y, rotate_90_c, dia2, T(h, 0), T(0, h), ori);
      return mul(d_s_r, flip_y, flip_x, T(w, 0), T(0, h), ori);
    }

    case TileGroup.TILE_P4G: {
      const max = Math.max(w, h);
      const ori = T(
        (max + max) * pow(idiv(i, 4), p.shiftx_exp) + dx,
        (max + max) * pow(j, p.shifty_exp) + dy,
      );
      const dia1 = T(w / 2 + h / 2, h / 2 - w / 2);
      const dia2 = T(-h / 2 + w / 2, w / 2 + h / 2);
      if ((idiv(i, 4) + j) % 2 === 0) {
        if (i % 4 === 0) return mul(d_s_r, ori);
        if (i % 4 === 1) return mul(d_s_r, rotate_m90_c, dia1, ori);
        if (i % 4 === 2) return mul(d_s_r, rotate_90_c, dia2, ori);
        return mul(d_s_r, rotate_180_c, dia1, dia2, ori);
      }
      if (i % 4 === 0) return mul(d_s_r, flip_y, T(0, h), ori);
      if (i % 4 === 1) return mul(d_s_r, flip_y, rotate_m90_c, dia1, T(-h, 0), ori);
      if (i % 4 === 2) return mul(d_s_r, flip_y, rotate_90_c, dia2, T(h, 0), ori);
      return mul(d_s_r, flip_x, T(w, 0), ori);
    }

    case TileGroup.TILE_P3: {
      let width: number;
      let height: number;
      let dia1: Affine;
      let dia2: Affine;
      if (w > h) {
        width = w + w * cos60;
        height = 2 * w * sin60;
        dia1 = T(w / 2 + (w / 2) * cos60, -((w / 2) * sin60));
        dia2 = mul(dia1, T(0, 2 * ((w / 2) * sin60)));
      } else {
        width = h * Math.cos(Math.PI / 6);
        height = h;
        dia1 = T((h / 2) * cos30, -((h / 2) * sin30));
        dia2 = mul(dia1, T(0, h / 2));
      }
      const ori = T(
        width * pow(2 * idiv(i, 3) + (j % 2), p.shiftx_exp) + dx,
        (height / 2) * pow(j, p.shifty_exp) + dy,
      );
      if (i % 3 === 0) return mul(d_s_r, ori);
      if (i % 3 === 1) return mul(d_s_r, rotate_m120_c, dia1, ori);
      return mul(d_s_r, rotate_120_c, dia2, ori);
    }

    case TileGroup.TILE_P31M: {
      let ori: Affine;
      let dia1: Affine;
      let dia2: Affine;
      let dia3: Affine;
      let dia4: Affine;
      if (w > h) {
        ori = T(
          w * pow(idiv(i, 6) + 0.5 * (j % 2), p.shiftx_exp) + dx,
          w * cos30 * pow(j, p.shifty_exp) + dy,
        );
        dia1 = mul(
          T(0, h / 2),
          T(w / 2, 0),
          T((w / 2) * cos60, (-w / 2) * sin60),
          T((-h / 2) * cos30, (-h / 2) * sin30),
        );
        dia2 = mul(dia1, T(h * cos30, h * sin30));
        dia3 = mul(dia2, T(0, 2 * ((w / 2) * sin60 - (h / 2) * sin30)));
        dia4 = mul(dia3, T(-h * cos30, h * sin30));
      } else {
        ori = T(
          2 * h * cos30 * pow(idiv(i, 6) + 0.5 * (j % 2), p.shiftx_exp) + dx,
          (2 * h - h * sin30) * pow(j, p.shifty_exp) + dy,
        );
        dia1 = mul(T(0, -h / 2), T((h / 2) * cos30, (h / 2) * sin30));
        dia2 = mul(dia1, T(h * cos30, h * sin30));
        dia3 = mul(dia2, T(0, h / 2));
        dia4 = mul(dia3, T(-h * cos30, h * sin30));
      }
      if (i % 6 === 0) return mul(d_s_r, ori);
      if (i % 6 === 1) return mul(d_s_r, flip_y, rotate_m120_c, dia1, ori);
      if (i % 6 === 2) return mul(d_s_r, rotate_m120_c, dia2, ori);
      if (i % 6 === 3) return mul(d_s_r, flip_y, rotate_120_c, dia3, ori);
      if (i % 6 === 4) return mul(d_s_r, rotate_120_c, dia4, ori);
      return mul(d_s_r, flip_y, T(0, h), ori);
    }

    case TileGroup.TILE_P3M1: {
      let width: number;
      let height: number;
      let dia1: Affine;
      let dia2: Affine;
      let dia3: Affine;
      let dia4: Affine;
      if (w > h) {
        width = w + w * cos60;
        height = 2 * w * sin60;
        dia1 = mul(
          T(0, h / 2),
          T(w / 2, 0),
          T((w / 2) * cos60, (-w / 2) * sin60),
          T((-h / 2) * cos30, (-h / 2) * sin30),
        );
        dia2 = mul(dia1, T(h * cos30, h * sin30));
        dia3 = mul(dia2, T(0, 2 * ((w / 2) * sin60 - (h / 2) * sin30)));
        dia4 = mul(dia3, T(-h * cos30, h * sin30));
      } else {
        width = 2 * h * Math.cos(Math.PI / 6);
        height = 2 * h;
        dia1 = mul(T(0, -h / 2), T((h / 2) * cos30, (h / 2) * sin30));
        dia2 = mul(dia1, T(h * cos30, h * sin30));
        dia3 = mul(dia2, T(0, h / 2));
        dia4 = mul(dia3, T(-h * cos30, h * sin30));
      }
      const ori = T(
        width * pow(2 * idiv(i, 6) + (j % 2), p.shiftx_exp) + dx,
        (height / 2) * pow(j, p.shifty_exp) + dy,
      );
      if (i % 6 === 0) return mul(d_s_r, ori);
      if (i % 6 === 1) return mul(d_s_r, flip_y, rotate_m120_c, dia1, ori);
      if (i % 6 === 2) return mul(d_s_r, rotate_m120_c, dia2, ori);
      if (i % 6 === 3) return mul(d_s_r, flip_y, rotate_120_c, dia3, ori);
      if (i % 6 === 4) return mul(d_s_r, rotate_120_c, dia4, ori);
      return mul(d_s_r, flip_y, T(0, h), ori);
    }

    case TileGroup.TILE_P6: {
      let ori: Affine;
      let dia1: Affine;
      let dia2: Affine;
      let dia3: Affine;
      let dia4: Affine;
      let dia5: Affine;
      if (w > h) {
        ori = T(
          w * pow(2 * idiv(i, 6) + (j % 2), p.shiftx_exp) + dx,
          2 * w * sin60 * pow(j, p.shifty_exp) + dy,
        );
        dia1 = T((w / 2) * cos60, (-w / 2) * sin60);
        dia2 = mul(dia1, T(w / 2, 0));
        dia3 = mul(dia2, T((w / 2) * cos60, (w / 2) * sin60));
        dia4 = mul(dia3, T((-w / 2) * cos60, (w / 2) * sin60));
        dia5 = mul(dia4, T(-w / 2, 0));
      } else {
        ori = T(
          2 * h * cos30 * pow(idiv(i, 6) + 0.5 * (j % 2), p.shiftx_exp) + dx,
          (h + h * sin30) * pow(j, p.shifty_exp) + dy,
        );
        dia1 = mul(
          T(-w / 2, -h / 2),
          T((h / 2) * cos30, (-h / 2) * sin30),
          T((w / 2) * cos60, (w / 2) * sin60),
        );
        dia2 = mul(
          dia1,
          mul(
            T((-w / 2) * cos60, (-w / 2) * sin60),
            T((h / 2) * cos30, (-h / 2) * sin30),
            T((h / 2) * cos30, (h / 2) * sin30),
            T((-w / 2) * cos60, (w / 2) * sin60),
          ),
        );
        dia3 = mul(
          dia2,
          mul(T((w / 2) * cos60, (-w / 2) * sin60), T((h / 2) * cos30, (h / 2) * sin30), T(-w / 2, h / 2)),
        );
        dia4 = mul(dia3, dia1.inverse());
        dia5 = mul(dia3, dia2.inverse());
      }
      if (i % 6 === 0) return mul(d_s_r, ori);
      if (i % 6 === 1) return mul(d_s_r, rotate_m60_c, dia1, ori);
      if (i % 6 === 2) return mul(d_s_r, rotate_m120_c, dia2, ori);
      if (i % 6 === 3) return mul(d_s_r, rotate_180_c, dia3, ori);
      if (i % 6 === 4) return mul(d_s_r, rotate_120_c, dia4, ori);
      return mul(d_s_r, rotate_60_c, dia5, ori);
    }

    case TileGroup.TILE_P6M: {
      let ori: Affine;
      let dia1: Affine;
      let dia2: Affine;
      let dia3: Affine;
      let dia4: Affine;
      let dia5: Affine;
      let dia6: Affine;
      if (w > h) {
        ori = T(
          w * pow(2 * idiv(i, 12) + (j % 2), p.shiftx_exp) + dx,
          2 * w * sin60 * pow(j, p.shifty_exp) + dy,
        );
        dia1 = mul(
          T(w / 2, h / 2),
          T((-w / 2) * cos60, (-w / 2) * sin60),
          T((-h / 2) * cos30, (h / 2) * sin30),
        );
        dia2 = mul(dia1, T(h * cos30, -h * sin30));
        dia3 = mul(
          dia2,
          mul(T((-h / 2) * cos30, (h / 2) * sin30), T(w * cos60, 0), T((-h / 2) * cos30, (-h / 2) * sin30)),
        );
        dia4 = mul(dia3, T(h * cos30, h * sin30));
        dia5 = mul(
          dia4,
          mul(T((-h / 2) * cos30, (-h / 2) * sin30), T((-w / 2) * cos60, (w / 2) * sin60), T(w / 2, -h / 2)),
        );
        dia6 = mul(dia5, T(0, h));
      } else {
        ori = T(
          4 * h * cos30 * pow(idiv(i, 12) + 0.5 * (j % 2), p.shiftx_exp) + dx,
          (2 * h + 2 * h * sin30) * pow(j, p.shifty_exp) + dy,
        );
        dia1 = mul(
          T(-w / 2, -h / 2),
          T((h / 2) * cos30, (-h / 2) * sin30),
          T((w / 2) * cos60, (w / 2) * sin60),
        );
        dia2 = mul(dia1, T(h * cos30, -h * sin30));
        dia3 = mul(
          dia2,
          mul(T((-w / 2) * cos60, (-w / 2) * sin60), T(h * cos30, 0), T((-w / 2) * cos60, (w / 2) * sin60)),
        );
        dia4 = mul(dia3, T(h * cos30, h * sin30));
        dia5 = mul(
          dia4,
          mul(T((w / 2) * cos60, (-w / 2) * sin60), T((h / 2) * cos30, (h / 2) * sin30), T(-w / 2, h / 2)),
        );
        dia6 = mul(dia5, T(0, h));
      }
      const dia7 = mul(dia6, dia1.inverse());
      const dia8 = mul(dia6, dia2.inverse());
      const dia9 = mul(dia6, dia3.inverse());
      const dia10 = mul(dia6, dia4.inverse());
      if (i % 12 === 0) return mul(d_s_r, ori);
      if (i % 12 === 1) return mul(d_s_r, flip_y, rotate_m60_c, dia1, ori);
      if (i % 12 === 2) return mul(d_s_r, rotate_m60_c, dia2, ori);
      if (i % 12 === 3) return mul(d_s_r, flip_y, rotate_m120_c, dia3, ori);
      if (i % 12 === 4) return mul(d_s_r, rotate_m120_c, dia4, ori);
      if (i % 12 === 5) return mul(d_s_r, flip_x, dia5, ori);
      if (i % 12 === 6) return mul(d_s_r, flip_x, flip_y, dia6, ori);
      if (i % 12 === 7) return mul(d_s_r, flip_y, rotate_120_c, dia7, ori);
      if (i % 12 === 8) return mul(d_s_r, rotate_120_c, dia8, ori);
      if (i % 12 === 9) return mul(d_s_r, flip_y, rotate_60_c, dia9, ori);
      if (i % 12 === 10) return mul(d_s_r, rotate_60_c, dia10, ori);
      return mul(d_s_r, flip_y, T(0, h), ori);
    }

    default:
      break;
  }
  return Affine.identity();
}

/** The smallest rectangle that contains the corners of the rectangle r transformed by m. */
export function transform_rect(r: Rect, m: Affine): Rect {
  const ps = [r.corner(0), r.corner(1), r.corner(2), r.corner(3)].map((c) => c.transformed(m));
  const xs = ps.map((p) => p.x);
  const ys = ps.map((p) => p.y);
  return new Rect(new Point(Math.min(...xs), Math.min(...ys)), new Point(Math.max(...xs), Math.max(...ys)));
}

/**
 * Randomizes val by rand, with 0 < val < 1 and all values (including 0, 1) having the same
 * probability of being displaced.
 */
export function randomize01(val: number, rand: number, random: RandomRange = default_random): number {
  let base = Math.min(val - rand, 1 - 2 * rand);
  if (base < 0) base = 0;
  val = base + random(0, Math.min(2 * rand, 1 - base));
  return Math.min(Math.max(val, 0), 1); // this should be unnecessary with the above provisions, but just in case...
}

// Clones ------------------------------------------------------------------------------------------

/** Whether tile is a tiled clone of obj, or of any object if obj is null. */
export function is_a_clone_of(tile: SPObject, obj: SPObject | null): boolean {
  const id_href = obj ? `#${obj.getRepr().attribute('id')}` : null;
  const href = getHrefAttribute(tile.getRepr())[1];
  const tiled = tile.getRepr().attribute('inkscape:tiled-clone-of');
  return (
    tile instanceof SPUse &&
    !!href &&
    (id_href === null || id_href === href) &&
    !!tiled &&
    (id_href === null || id_href === tiled)
  );
}

/** The number of tiled clones of obj, among its siblings. */
export function number_of_clones(obj: SPObject): number {
  return (obj.parent?.children ?? []).filter((child) => is_a_clone_of(child, obj)).length;
}

/** What the status line of the dialog says about the selection. */
export type CloneTilerStatus = { kind: 'nothing' } | { kind: 'many' } | { kind: 'clones'; count: number };

/** The state of the selection for the dialog (upstream _update()): the status and whether Unclump and Remove are enabled. */
export function clonetiler_status(desktop: SPDesktop): CloneTilerStatus {
  const items = desktop.getSelection().items();
  if (items.length === 0) return { kind: 'nothing' };
  if (items.length > 1) return { kind: 'many' };
  return { kind: 'clones', count: number_of_clones(items[0] as SPItem) };
}

/** The status line, as plain text. */
export function clonetiler_status_text(s: CloneTilerStatus): string {
  switch (s.kind) {
    case 'nothing':
      return _('Nothing selected.');
    case 'many':
      return _('More than one object selected.');
    case 'clones':
      return s.count > 0
        ? _('Object has %1 tiled clones.').replace('%1', String(s.count))
        : _('Object has no tiled clones.');
  }
}

const UNDO_ICON = 'dialog-tile-clones';

/**
 * Remove the tiled clones of the selected object (siblings only). Returns a warning for the
 * status bar, or null.
 */
export function clonetiler_remove(desktop: SPDesktop, do_undo = true): string | null {
  const obj = desktop.getSelection().singleItem();
  // check if something is selected
  if (!obj) return _('Select <b>one object</b> whose tiled clones to remove.');
  const parent = obj.parent;
  // remove old tiling
  const to_delete = (parent?.children ?? []).filter((child) => is_a_clone_of(child, obj));
  for (const o of to_delete) o.deleteObject();
  if (do_undo) DocumentUndo.done(desktop.getDocument(), C_('Undo', 'Delete tiled clones'), UNDO_ICON);
  return null;
}

/**
 * Spread out the tiled clones of the selected object to reduce clumping; can be applied
 * repeatedly. Returns a warning for the status bar, or null.
 */
export function clonetiler_unclump(desktop: SPDesktop): string | null {
  // check if something is selected
  const obj = desktop.getSelection().singleItem();
  if (!obj) return _('Select <b>one object</b> whose tiled clones to unclump.');
  const to_unclump = (obj.parent?.children ?? [])
    .filter((child): child is SPItem => is_a_clone_of(child, obj))
    .reverse(); // not including the original
  desktop.getDocument().ensureUpToDate();
  unclump(to_unclump);
  DocumentUndo.done(desktop.getDocument(), C_('Undo', 'Unclump tiled clones'), UNDO_ICON);
  return null;
}

// Tracing -----------------------------------------------------------------------------------------

/**
 * The drawing without the tiled clones and the original, rendered to a bitmap (upstream
 * trace_setup(): a Drawing with the root shown with those items hidden). The bitmap covers the
 * drawing and the page; pixel (x, y) is the point (x0 + x, y0 + y) / zoom of the document in px.
 */
export interface TraceBitmap {
  /** RGBA, not premultiplied. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
  x0: number;
  y0: number;
  zoom: number;
}

/** The largest side of the bitmap in px; the zoom is reduced for larger drawings. */
const MAX_TRACE_SIZE = 4096;

/**
 * Render the drawing of the document, without the original and the tiled clones, to be picked
 * from with trace_pick(). The rendering is async (the browser renders the serialized document).
 */
export async function trace_setup(
  desktop: SPDesktop,
  original: SPItem,
  zoom_wanted = 1.0,
): Promise<TraceBitmap | null> {
  const doc = desktop.getDocument();
  doc.ensureUpToDate();
  const dims = doc.getDimensions();
  let area = new Rect(new Point(0, 0), new Point(dims.x, dims.y));
  const bounds = doc.getRoot().documentVisualBounds();
  if (bounds) area = area.unionWith(bounds);
  if (!(area.width() > 0 && area.height() > 0)) return null;

  const zoom = Math.min(zoom_wanted, MAX_TRACE_SIZE / Math.max(area.width(), area.height()));
  const x0 = Math.floor(area.left() * zoom);
  const y0 = Math.floor(area.top() * zoom);
  const width = Math.ceil(area.right() * zoom) - x0;
  const height = Math.ceil(area.bottom() * zoom) - y0;
  const id = original.getId();
  const canvas = await sp_export_canvas(
    doc,
    new Rect(new Point(x0 / zoom, y0 / zoom), new Point((x0 + width) / zoom, (y0 + height) / zoom)),
    width,
    height,
    {
      // hide the (current) original and any tiled clones, we only want to pick the background
      hide: (el) =>
        (id !== null && el.getAttribute('id') === id) || el.hasAttribute('inkscape:tiled-clone-of'),
    },
  );
  const data = canvas.getContext('2d')?.getImageData(0, 0, width, height).data;
  return data ? { data, width, height, x0, y0, zoom } : null;
}

/**
 * The average color of the box (document px) in the bitmap as 0xRRGGBBAA (upstream trace_pick(),
 * which renders the box to a surface and takes ink_cairo_surface_average_color()); 0 if the box
 * is empty. Pixels outside the bitmap are transparent.
 */
export function trace_pick(bitmap: TraceBitmap | null, box: Rect): number {
  if (!bitmap) return 0;
  // Item integer bbox in points
  const left = Math.floor(box.left() * bitmap.zoom);
  const top = Math.floor(box.top() * bitmap.zoom);
  const right = Math.ceil(box.right() * bitmap.zoom);
  const bottom = Math.ceil(box.bottom() * bitmap.zoom);
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return 0;
  const data = new Uint8ClampedArray(width * height * 4);
  const bx0 = Math.max(left, bitmap.x0);
  const bx1 = Math.min(right, bitmap.x0 + bitmap.width);
  for (let y = Math.max(top, bitmap.y0); y < Math.min(bottom, bitmap.y0 + bitmap.height); y++) {
    if (bx1 <= bx0) break;
    const src = ((y - bitmap.y0) * bitmap.width + (bx0 - bitmap.x0)) * 4;
    data.set(bitmap.data.subarray(src, src + (bx1 - bx0) * 4), ((y - top) * width + (bx0 - left)) * 4);
  }
  const avg = average_color(data, width, height);
  return avg ? color_from_average(avg).toRGBA() : 0;
}

// Options -----------------------------------------------------------------------------------------

/** The values of the dialog as apply() uses them (upstream: the locals of CloneTiler::apply()). */
export interface CloneTilerOptions extends TransformParams {
  blur_per_i: number;
  blur_per_j: number;
  blur_alternatei: boolean;
  blur_alternatej: boolean;
  blur_rand: number;
  opacity_per_i: number;
  opacity_per_j: number;
  opacity_alternatei: boolean;
  opacity_alternatej: boolean;
  opacity_rand: number;
  initial_color: Colors.Color;
  hue_per_j: number;
  hue_per_i: number;
  hue_rand: number;
  saturation_per_j: number;
  saturation_per_i: number;
  saturation_rand: number;
  lightness_per_j: number;
  lightness_per_i: number;
  lightness_rand: number;
  color_alternatej: boolean;
  color_alternatei: boolean;
  type: number;
  keepbbox: boolean;
  imax: number;
  jmax: number;
  fillrect: boolean;
  /** Fill width and height in px (not scaled by the document scale). */
  fillwidth: number;
  fillheight: number;
  dotrace: boolean;
  pick: PickType;
  pick_to_presence: boolean;
  pick_to_size: boolean;
  pick_to_color: boolean;
  pick_to_opacity: boolean;
  rand_picked: number;
  invert_picked: boolean;
  gamma_picked: number;
}

/** Read the options from the preferences, with the limits and defaults of upstream. */
export function clonetiler_options(): CloneTilerOptions {
  const prefs = Preferences.get();
  const dbl = (key: string, def: number, min: number, max: number, scale = 1) =>
    scale * prefs.getDoubleLimited(prefs_path + key, def, min, max);
  const bool = (key: string, def = false) => prefs.getBool(prefs_path + key, def);
  const initial = Colors.Color.parse(prefs.getString(`${prefs_path}initial_color`, '#000000ff'));
  return {
    shiftx_per_i: dbl('shiftx_per_i', 0, -10000, 10000, 0.01),
    shifty_per_i: dbl('shifty_per_i', 0, -10000, 10000, 0.01),
    shiftx_per_j: dbl('shiftx_per_j', 0, -10000, 10000, 0.01),
    shifty_per_j: dbl('shifty_per_j', 0, -10000, 10000, 0.01),
    shiftx_rand: dbl('shiftx_rand', 0, 0, 1000, 0.01),
    shifty_rand: dbl('shifty_rand', 0, 0, 1000, 0.01),
    shiftx_exp: dbl('shiftx_exp', 1, 0, 10),
    shifty_exp: dbl('shifty_exp', 1, 0, 10),
    shiftx_alternate: bool('shiftx_alternate'),
    shifty_alternate: bool('shifty_alternate'),
    shiftx_cumulate: bool('shiftx_cumulate'),
    shifty_cumulate: bool('shifty_cumulate'),
    shiftx_excludew: bool('shiftx_excludew'),
    shifty_excludeh: bool('shifty_excludeh'),

    scalex_per_i: dbl('scalex_per_i', 0, -100, 1000, 0.01),
    scaley_per_i: dbl('scaley_per_i', 0, -100, 1000, 0.01),
    scalex_per_j: dbl('scalex_per_j', 0, -100, 1000, 0.01),
    scaley_per_j: dbl('scaley_per_j', 0, -100, 1000, 0.01),
    scalex_rand: dbl('scalex_rand', 0, 0, 1000, 0.01),
    scaley_rand: dbl('scaley_rand', 0, 0, 1000, 0.01),
    scalex_exp: dbl('scalex_exp', 1, 0, 10),
    scaley_exp: dbl('scaley_exp', 1, 0, 10),
    scalex_log: dbl('scalex_log', 0, 0, 10),
    scaley_log: dbl('scaley_log', 0, 0, 10),
    scalex_alternate: bool('scalex_alternate'),
    scaley_alternate: bool('scaley_alternate'),
    scalex_cumulate: bool('scalex_cumulate'),
    scaley_cumulate: bool('scaley_cumulate'),

    rotate_per_i: dbl('rotate_per_i', 0, -180, 180),
    rotate_per_j: dbl('rotate_per_j', 0, -180, 180),
    rotate_rand: dbl('rotate_rand', 0, 0, 100, 0.01),
    rotate_alternatei: bool('rotate_alternatei'),
    rotate_alternatej: bool('rotate_alternatej'),
    rotate_cumulatei: bool('rotate_cumulatei'),
    rotate_cumulatej: bool('rotate_cumulatej'),

    blur_per_i: dbl('blur_per_i', 0, 0, 100, 0.01),
    blur_per_j: dbl('blur_per_j', 0, 0, 100, 0.01),
    blur_alternatei: bool('blur_alternatei'),
    blur_alternatej: bool('blur_alternatej'),
    blur_rand: dbl('blur_rand', 0, 0, 100, 0.01),

    opacity_per_i: dbl('opacity_per_i', 0, 0, 100, 0.01),
    opacity_per_j: dbl('opacity_per_j', 0, 0, 100, 0.01),
    opacity_alternatei: bool('opacity_alternatei'),
    opacity_alternatej: bool('opacity_alternatej'),
    opacity_rand: dbl('opacity_rand', 0, 0, 100, 0.01),

    initial_color: initial ?? new Colors.Color(0x000000ff),
    hue_per_j: dbl('hue_per_j', 0, -100, 100, 0.01),
    hue_per_i: dbl('hue_per_i', 0, -100, 100, 0.01),
    hue_rand: dbl('hue_rand', 0, 0, 100, 0.01),
    saturation_per_j: dbl('saturation_per_j', 0, -100, 100, 0.01),
    saturation_per_i: dbl('saturation_per_i', 0, -100, 100, 0.01),
    saturation_rand: dbl('saturation_rand', 0, 0, 100, 0.01),
    lightness_per_j: dbl('lightness_per_j', 0, -100, 100, 0.01),
    lightness_per_i: dbl('lightness_per_i', 0, -100, 100, 0.01),
    lightness_rand: dbl('lightness_rand', 0, 0, 100, 0.01),
    color_alternatej: bool('color_alternatej'),
    color_alternatei: bool('color_alternatei'),

    type: prefs.getInt(`${prefs_path}symmetrygroup`, 0),
    keepbbox: bool('keepbbox', true),
    imax: prefs.getInt(`${prefs_path}imax`, 2),
    jmax: prefs.getInt(`${prefs_path}jmax`, 2),
    fillrect: bool('fillrect'),
    fillwidth: dbl('fillwidth', 50, 0, 1e6),
    fillheight: dbl('fillheight', 50, 0, 1e6),

    dotrace: bool('dotrace'),
    pick: prefs.getInt(`${prefs_path}pick`, 0),
    pick_to_presence: bool('pick_to_presence', true),
    pick_to_size: bool('pick_to_size'),
    pick_to_color: bool('pick_to_color'),
    pick_to_opacity: bool('pick_to_opacity'),
    rand_picked: dbl('rand_picked', 0, 0, 100, 0.01),
    invert_picked: bool('invert_picked'),
    gamma_picked: dbl('gamma_picked', 0, -10, 10),
  };
}

/** The picked value for the pick type from the color of the drawing. */
function picked_value(pick: PickType, rgba: Colors.Color, hsl: Colors.Color): number {
  switch (pick) {
    case PickType.PICK_COLOR:
      return 1 - hsl.get(2); // inverse lightness; to match other picks where black = max
    case PickType.PICK_OPACITY:
      return rgba.getOpacity();
    case PickType.PICK_R:
      return rgba.get(0);
    case PickType.PICK_G:
      return rgba.get(1);
    case PickType.PICK_B:
      return rgba.get(2);
    case PickType.PICK_H:
      return hsl.get(0);
    case PickType.PICK_S:
      return hsl.get(1);
    case PickType.PICK_L:
      return 1 - hsl.get(2);
    default:
      return 0;
  }
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/**
 * Create the tiled clones of the selected object with the options (upstream CloneTiler::apply()):
 * remove the old ones and add an svg:use for each tile. Async because the drawing is rendered
 * first when tracing (trace_bitmap is that rendering if the caller has it). Returns a warning for
 * the status bar, or null.
 */
export async function clonetiler_apply(
  desktop: SPDesktop,
  o: CloneTilerOptions = clonetiler_options(),
  random: RandomRange = default_random,
  trace_bitmap?: TraceBitmap | null,
): Promise<string | null> {
  const selection = desktop.getSelection();
  const doc = desktop.getDocument();

  // check if something is selected
  if (selection.isEmpty()) return _('Select an <b>object</b> to clone.');

  // Check if more than one object is selected.
  if (selection.items().length > 1) {
    return _('If you want to clone several objects, <b>group</b> them and <b>clone the group</b>.');
  }

  const item = selection.singleItem();
  if (!item) return null; // Should never happen (empty selection checked above).
  const obj_repr = item.getRepr();
  const id_href = `#${obj_repr.attribute('id')}`;
  const parent = item.parent;
  if (!parent) return null;

  // Render the background first: the document is not changed while waiting.
  const bitmap = !o.dotrace
    ? null
    : trace_bitmap !== undefined
      ? trace_bitmap
      : await trace_setup(desktop, item);

  remove_clones_before_apply(desktop);

  const scale_units = 1 / doc.getDocumentScale().x; // Use just x direction....
  const fillwidth = scale_units * o.fillwidth;
  const fillheight = scale_units * o.fillheight;

  let center = new Point(0, 0);
  let w = 0;
  let h = 0;
  let x0 = 0;
  let y0 = 0;

  const attrs = ['w', 'h', 'x0', 'y0', 'cx', 'cy'].map((n) => obj_repr.attribute(`inkscape:tile-${n}`));
  if (o.keepbbox && attrs.every((a) => a !== null)) {
    const num = (name: string, def: number) => {
      const v = Number.parseFloat(obj_repr.attribute(`inkscape:tile-${name}`) ?? '');
      return Number.isNaN(v) ? def : v;
    };
    center = new Point(num('cx', 0), num('cy', 0));
    w = num('w', w);
    h = num('h', h);
    x0 = num('x0', x0);
    y0 = num('y0', y0);
  } else {
    const prefs_bbox = Preferences.get().getBool('/tools/bounding_box', false);
    const bbox_type = !prefs_bbox ? BBoxType.VISUAL_BBOX : BBoxType.GEOMETRIC_BBOX;
    const r = item.documentBounds(bbox_type);
    if (r) {
      w = scale_units * r.dimensions().x;
      h = scale_units * r.dimensions().y;
      x0 = scale_units * r.min().x;
      y0 = scale_units * r.min().y;
      center = item.getCenter().transformed(doc.dt2doc()).mul(scale_units);
      obj_repr.setAttributeSvgDouble('inkscape:tile-cx', center.x);
      obj_repr.setAttributeSvgDouble('inkscape:tile-cy', center.y);
      obj_repr.setAttributeSvgDouble('inkscape:tile-w', w);
      obj_repr.setAttributeSvgDouble('inkscape:tile-h', h);
      obj_repr.setAttributeSvgDouble('inkscape:tile-x0', x0);
      obj_repr.setAttributeSvgDouble('inkscape:tile-y0', y0);
    }
  }

  let cur = new Point(0, 0);
  const bbox_original = new Rect(new Point(x0, y0), new Point(x0 + w, y0 + h));
  const perimeter_original = (w + h) / 4;

  const parent_transform = (parent as SPItem).i2docAffine().multiply(doc.getRoot().c2p.inverse());
  const has_center =
    obj_repr.attribute('inkscape:transform-center-x') || obj_repr.attribute('inkscape:transform-center-y');

  // The integers i and j are reserved for tile column and row.
  // The doubles x and y are used for coordinates
  // The number of rows and columns is limited to prevent "freezing" with too large fillrect.
  for (let i = 0; o.fillrect ? Math.abs(cur.x) < fillwidth && i < 200 : i < o.imax; i++) {
    for (let j = 0; o.fillrect ? Math.abs(cur.y) < fillheight && j < 200 : j < o.jmax; j++) {
      // Note: We create a clone at 0,0 too, right over the original, in case our clones are colored

      // Get transform from symmetry, shift, scale, rotation
      const orig_t = get_transform(o.type, i, j, center.x, center.y, w, h, o, random);

      let t = mul(parent_transform, orig_t, parent_transform.inverse());
      cur = center.transformed(t).sub(center);

      if (o.fillrect && (cur.x > fillwidth || cur.y > fillheight)) continue; // off limits

      // Color tab
      const eff_ci = o.color_alternatei ? i % 2 : i;
      const eff_cj = o.color_alternatej ? j % 2 : j;
      const hsl = o.initial_color.converted(Colors.SpaceType.HSL) ?? o.initial_color.clone();
      hsl.set(0, hsl.get(0) + o.hue_per_i * eff_ci + o.hue_per_j * eff_cj + o.hue_rand * random(-1, 1));
      hsl.set(
        1,
        hsl.get(1) +
          o.saturation_per_i * eff_ci +
          o.saturation_per_j * eff_cj +
          o.saturation_rand * random(-1, 1),
      );
      hsl.set(
        2,
        hsl.get(2) +
          o.lightness_per_i * eff_ci +
          o.lightness_per_j * eff_cj +
          o.lightness_rand * random(-1, 1),
      );
      hsl.normalize();
      // We could convert to RGB here, but we shouldn't actually need to.
      let color_string = hsl.toString();

      // Blur
      const eff_bi = o.blur_alternatei ? i % 2 : i;
      const eff_bj = o.blur_alternatej ? j % 2 : j;
      const blur = clamp(o.blur_per_i * eff_bi + o.blur_per_j * eff_bj + o.blur_rand * random(-1, 1), 0, 1);

      // Opacity
      const eff_oi = o.opacity_alternatei ? i % 2 : i;
      const eff_oj = o.opacity_alternatej ? j % 2 : j;
      let opacity = clamp(
        1 - (o.opacity_per_i * eff_oi + o.opacity_per_j * eff_oj + o.opacity_rand * random(-1, 1)),
        0,
        1,
      );

      // Trace tab
      if (o.dotrace) {
        const bbox_t = transform_rect(bbox_original, mul(t, Scale(1.0 / scale_units)));
        const rgba = new Colors.Color(trace_pick(bitmap, bbox_t));
        const picked_hsl = rgba.converted(Colors.SpaceType.HSL) ?? rgba;

        let val = picked_value(o.pick, rgba, picked_hsl);

        if (o.rand_picked > 0) {
          val = randomize01(val, o.rand_picked, random);
          for (let c = 0; c < 3; c++) rgba.set(c, randomize01(rgba.get(c), o.rand_picked, random));
        }

        if (o.gamma_picked !== 0) {
          const power =
            o.gamma_picked > 0 ? 1 / (1 + Math.abs(o.gamma_picked)) : 1 + Math.abs(o.gamma_picked);
          val = pow(val, power);
          for (let c = 0; c < 3; c++) rgba.set(c, pow(rgba.get(c), power));
        }

        if (o.invert_picked) {
          val = 1 - val;
          rgba.invert();
        }

        val = clamp(val, 0, 1);
        rgba.normalize();

        // Skip!
        if (o.pick_to_presence && random(0, 1) > val) continue;
        if (o.pick_to_size) {
          t = mul(
            parent_transform,
            T(-center.x, -center.y),
            Scale(val, val),
            T(center.x, center.y),
            parent_transform.inverse(),
            t,
          );
        }
        if (o.pick_to_opacity) opacity *= val;
        if (o.pick_to_color) color_string = rgba.toString();
      }

      if (opacity < 1e-6) continue; // invisibly transparent, skip
      if (Math.abs(t.c0) + Math.abs(t.c1) + Math.abs(t.c2) + Math.abs(t.c3) < 1e-6) continue; // too small, skip

      // Create the clone
      const clone = obj_repr.document().createElement('svg:use');
      clone.setAttribute('x', '0');
      clone.setAttribute('y', '0');
      clone.setAttribute('inkscape:tiled-clone-of', id_href);
      clone.setAttribute('xlink:href', id_href);

      let new_center = new Point(0, 0);
      let center_set = false;
      if (has_center) {
        new_center = item.getCenter().transformed(doc.dt2doc()).mul(scale_units).transformed(orig_t);
        center_set = true;
      }

      clone.setAttributeOrRemoveIfEmpty('transform', sp_svg_transform_write(t));

      if (opacity < 1.0) clone.setAttribute('opacity', cssNumber(opacity));

      if (color_string) {
        clone.setAttribute('fill', color_string);
        clone.setAttribute('stroke', color_string);
      }

      // add the new clone to the top of the original's parent
      parent.getRepr().appendChild(clone);

      if (blur > 0.0) {
        const clone_object = doc.getObjectByRepr(clone);
        const radius = blur * perimeter_original * t.descrim();
        // this is necessary for all newly added clones to have correct bboxes,
        // otherwise filters won't work:
        doc.ensureUpToDate();
        const constructed = new_filter_gaussian_blur(doc, radius, t.descrim());
        if (clone_object) {
          constructed.update_filter_region(clone_object as SPItem);
          spStyleSetPropertyUrl(clone_object, 'filter', constructed, false);
        }
      }

      if (center_set) {
        const clone_object = doc.getObjectByRepr(clone);
        if (clone_object) {
          clone_object.requestDisplayUpdate(1 /* SP_OBJECT_MODIFIED_FLAG */);
          (clone_object as SPItem).setCenter(new_center.transformed(desktop.doc2dt()));
          clone_object.updateRepr();
        }
      }
    }
    cur = new Point(cur.x, 0);
  }

  DocumentUndo.done(doc, C_('Undo', 'Create tiled clones'), UNDO_ICON);
  return null;
}

/** remove(false): the removal of the old tiling in apply(). */
function remove_clones_before_apply(desktop: SPDesktop): void {
  clonetiler_remove(desktop, false);
}
