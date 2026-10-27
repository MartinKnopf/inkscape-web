// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/enums.h
/*
 * Main program enumerated types
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *
 * Copyright (C) 1999-2003 Lauris Kaplinski
 */

/** Anchor types (imported from Gtk). Clockwise from east; CanvasItemCtrl uses the order for angles. */
export enum SPAnchorType {
  SP_ANCHOR_EAST,
  SP_ANCHOR_SOUTH_EAST,
  SP_ANCHOR_SOUTH,
  SP_ANCHOR_SOUTH_WEST,
  SP_ANCHOR_WEST,
  SP_ANCHOR_NORTH_WEST,
  SP_ANCHOR_NORTH,
  SP_ANCHOR_NORTH_EAST,
  SP_ANCHOR_CENTER,
  SP_ANCHOR_E = SP_ANCHOR_EAST,
  SP_ANCHOR_SE = SP_ANCHOR_SOUTH_EAST,
  SP_ANCHOR_S = SP_ANCHOR_SOUTH,
  SP_ANCHOR_SW = SP_ANCHOR_SOUTH_WEST,
  SP_ANCHOR_W = SP_ANCHOR_WEST,
  SP_ANCHOR_NW = SP_ANCHOR_NORTH_WEST,
  SP_ANCHOR_N = SP_ANCHOR_NORTH,
  SP_ANCHOR_NE = SP_ANCHOR_NORTH_EAST,
}

// TODO: the other enums of enums.h when they are used.
