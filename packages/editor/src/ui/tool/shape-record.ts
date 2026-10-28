// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tool/shape-record.h
/* Authors:
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright (C) 2009 Authors
 */
import type { SPObject } from '@inkscape-web/core';
import type { Affine } from '@inkscape-web/geom';

/** Role of the shape in the drawing - affects outline display and color */
export enum ShapeRole {
  SHAPE_ROLE_NORMAL,
  SHAPE_ROLE_CLIPPING_PATH,
  SHAPE_ROLE_MASK,
  /** implies edit_original set to true in ShapeRecord */
  SHAPE_ROLE_LPE_PARAM,
}

/** An object edited by the node tool. Records are equal when object and lpe_key are equal. */
export interface ShapeRecord {
  object: SPObject;
  role: ShapeRole;
  /** name of LPE shape param being edited */
  lpe_key: string;
  /** how to transform controls - used for clipping paths, masks, and markers */
  edit_transform: Affine;
}
