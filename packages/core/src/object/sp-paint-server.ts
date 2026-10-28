// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-paint-server.cpp, src/object/sp-paint-server.h
/*
 * Base class for gradients and patterns
 *
 * Author:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Jon A. Cruz <jon@joncruz.org>
 *
 * Copyright (C) 1999-2002 Lauris Kaplinski
 * Copyright (C) 2000-2001 Ximian, Inc.
 * Copyright (C) 2010 Authors
 */
import { Affine } from '@inkscape-web/geom';
import { Color } from '../colors/color.ts';
import { SPObject } from './sp-object.ts';
import {
  PaintServerType,
  SPGradientSpread,
  SPGradientUnits,
  type SPGradientVector,
} from './sp-paint-server-data.ts';
import { SPPaintServerReference } from './sp-paint-server-reference.ts';

/**
 * Base class of the paint servers: gradients (and later patterns, hatches, meshes). The data
 * functions give the rendering data in a neutral form (upstream: for the renderer, without
 * needing to import the objects).
 * TODO: show()/hide()/setBBox() for patterns and hatches (DrawingPattern).
 */
export class SPPaintServer extends SPObject {
  protected swatch = false;

  isSwatch(): boolean {
    return this.swatch;
  }
  isValid(): boolean {
    return true;
  }
  /** Which of the data functions below give valid data. */
  getPaintType(): PaintServerType {
    return PaintServerType.INVALID;
  }
  getSolidColor(): Color {
    return new Color(0x0);
  }
  getGradientVector(): SPGradientVector | null {
    return null;
  }
  getSpread(): SPGradientSpread {
    return SPGradientSpread.SP_GRADIENT_SPREAD_UNDEFINED;
  }
  getUnits(): SPGradientUnits {
    return SPGradientUnits.SP_GRADIENT_UNITS_OBJECTBOUNDINGBOX;
  }
  getGradientTransform(): Affine {
    return Affine.identity();
  }
}

SPPaintServerReference.isPaintServer = (obj): obj is SPPaintServer => obj instanceof SPPaintServer;
