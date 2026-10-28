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
  '/options/rotationsnapsperpi/value': '12.0',
  '/options/dragtolerance/value': '4.0',
  '/options/clonecompensation/value': '1',
  '/options/cloneorphans/value': '0',
  '/options/maskobject/topmost': '1',
  '/options/maskobject/remove': '1',

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
  '/tools/nodes/selcue': '1',
  '/tools/nodes/gradientdrag': '1',
  '/tools/nodes/show_handles': '1',
  '/tools/nodes/show_outline': '0',
  '/tools/nodes/single_node_transform_handles': '0',
  '/tools/nodes/show_transform_handles': '0',
  '/tools/nodes/live_outline': '1',
  '/tools/nodes/live_objects': '1',
  '/tools/nodes/edit_clipping_paths': '0',
  '/tools/nodes/edit_masks': '0',

  '/tools/zoom/selcue': '1',
  '/tools/zoom/gradientdrag': '0',
  '/tools/dropper/selcue': '1',
  '/tools/dropper/gradientdrag': '1',
  '/tools/dropper/pick': '1',
  '/tools/dropper/setalpha': '1',

  '/tools/freehand/style':
    'fill:none;stroke:black;stroke-opacity:1;stroke-linejoin:miter;stroke-linecap:butt;',
  '/tools/freehand/pencil/tolerance': '15.0',
  '/tools/freehand/pencil/selcue': '1',
  '/tools/freehand/pencil/style': 'stroke-width:1px;',
  '/tools/freehand/pencil/usecurrent': 'path',
  '/tools/freehand/pencil/average_all_sketches': '1',
  '/tools/freehand/pen/mode': 'drag',
  '/tools/freehand/pen/selcue': '1',
  '/tools/freehand/pen/style': 'stroke-width:1px;',
  '/tools/freehand/pen/usecurrent': 'path',
};
