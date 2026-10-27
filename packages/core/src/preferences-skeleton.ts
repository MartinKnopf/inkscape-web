// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/preferences-skeleton.h
/*
 * Authors: see git history
 *
 * Copyright (C) 2018 Authors
 */

/**
 * Default preference values, by path, from the upstream skeleton
 * (`<group id="tools"><group id="shapes" style="..."/>` is "/tools/shapes/style").
 * Preferences returns them when the user has not set a value.
 * TODO: the other groups of the skeleton.
 */
export const preferences_skeleton: Readonly<Record<string, string>> = {
  '/tools/bounding_box': '0',

  '/tools/shapes/style': 'fill-rule:evenodd;',
  '/tools/shapes/selcue': '1',
  '/tools/shapes/gradientdrag': '1',
  '/tools/shapes/rect/style': 'fill:blue;',
  '/tools/shapes/rect/usecurrent': 'rect',
  '/tools/shapes/arc/style': 'fill:red;',
  '/tools/shapes/arc/end': '0',
  '/tools/shapes/arc/start': '0',
  '/tools/shapes/arc/usecurrent': 'arc',
  '/tools/shapes/star/magnitude': '5',
  '/tools/shapes/star/style': 'fill:yellow;',
  '/tools/shapes/star/usecurrent': 'star',
  '/tools/shapes/spiral/style': 'fill:none;stroke:black',
  '/tools/shapes/spiral/expansion': '1',
  '/tools/shapes/spiral/usecurrent': 'spiral',
};
