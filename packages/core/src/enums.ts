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

// The enums of enums.h that the core uses. The editor has the others (packages/editor/src/enums.ts).

/** clipPathUnits, maskUnits, maskContentUnits. */
export enum SPContentUnits {
  SP_CONTENT_UNITS_USERSPACEONUSE,
  SP_CONTENT_UNITS_OBJECTBOUNDINGBOX,
}

/** markerUnits */
export enum SPMarkerUnits {
  SP_MARKER_UNITS_STROKEWIDTH,
  SP_MARKER_UNITS_USERSPACEONUSE,
}

/** /options/maskobject/grouping */
export enum PrefsMaskobjectGrouping {
  PREFS_MASKOBJECT_GROUPING_NONE = 0,
  PREFS_MASKOBJECT_GROUPING_SEPARATE = 1,
  PREFS_MASKOBJECT_GROUPING_ALL = 2,
}
