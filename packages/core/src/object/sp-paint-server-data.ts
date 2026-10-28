// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-paint-server-data.h
/*
 * Data for paint server objects useful for renderers.
 *
 * Authors: see git history
 *
 * Copyright (C) 2026 Authors
 */
import type { Color } from '../colors/color.ts';

export enum PaintServerType {
  INVALID,
  SOLID_COLOR,
  HATCH_PATTERN,
  LINEAR_GRADIENT,
  RADIAL_GRADIENT,
  MESH_GRADIENT,
}

export enum SPGradientSpread {
  SP_GRADIENT_SPREAD_PAD,
  SP_GRADIENT_SPREAD_REFLECT,
  SP_GRADIENT_SPREAD_REPEAT,
  SP_GRADIENT_SPREAD_UNDEFINED = 0x7fffffff,
}

export enum SPGradientUnits {
  SP_GRADIENT_UNITS_OBJECTBOUNDINGBOX,
  SP_GRADIENT_UNITS_USERSPACEONUSE,
}

/**
 * Differs from SPStop in that SPStop mirrors the <stop> element in the document, whereas
 * SPGradientStop shows more the effective stop color.
 *
 * For example, SPGradientStop has no currentColor option: currentColor refers to the color
 * property value of the gradient where currentColor appears, so we interpret currentColor before
 * copying from SPStop to SPGradientStop.
 */
export interface SPGradientStop {
  color?: Color | undefined;
  offset: number;
}

/** The effective gradient vector, after copying stops from the referenced gradient if necessary. */
export interface SPGradientVector {
  built: boolean;
  stops: SPGradientStop[];
  /** For linear geometry is x1,y1,x2,y2; for radial it's cx,cy,r,fx,fy,fr */
  geom: number[];
}
