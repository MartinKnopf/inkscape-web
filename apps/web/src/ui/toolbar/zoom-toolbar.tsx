// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/toolbar/zoom-toolbar.cpp, src/ui/toolbar/zoom-toolbar.h, share/ui/toolbar-zoom.ui
/*
 * Zoom aux toolbar
 *
 * Authors:
 *   Tavmjong Bah
 *   Mike Kowalski
 *
 * Copyright (C) 2023 authors
 */
import { _ } from '@inkscape-web/core';
import { Fragment } from 'react';
import { runAction } from '../../app/actions.ts';
import { IconButton } from './toolbar.tsx';

/**
 * The buttons of toolbar-zoom.ui in groups: action, icon and tooltip.
 * TODO: Zoom Previous and Zoom Next (win.canvas-zoom-prev and -next: the
 * desktop has no transform history yet).
 */
const BUTTONS: readonly (readonly [action: string, icon: string, tooltip: string][])[] = [
  [
    ['win.canvas-zoom-in', 'zoom-in', 'Zoom In'],
    ['win.canvas-zoom-out', 'zoom-out', 'Zoom Out'],
  ],
  [
    ['win.canvas-zoom-1-1', 'zoom-original', 'Zoom 1-1'],
    ['win.canvas-zoom-1-2', 'zoom-half-size', 'Zoom 1-2'],
    ['win.canvas-zoom-2-1', 'zoom-double-size', 'Zoom 2-1'],
  ],
  [
    ['win.canvas-zoom-selection', 'zoom-fit-selection', 'Zoom Selection'],
    ['win.canvas-zoom-drawing', 'zoom-fit-drawing', 'Zoom Drawing'],
    ['win.canvas-zoom-page', 'zoom-fit-page', 'Zoom Page'],
    ['win.canvas-zoom-page-width', 'zoom-fit-width', 'Zoom Page Width'],
    ['win.canvas-zoom-center-page', 'zoom-center-page', 'Center Page'],
  ],
];

/** Controls of the zoom tool: the buttons that run the win.canvas-zoom-* actions. */
export function ZoomToolbar() {
  return (
    <>
      {BUTTONS.map((group, i) => (
        <Fragment key={group[0]?.[0]}>
          {i > 0 && <span className="toolbar-separator" />}
          {group.map(([action, icon, tooltip]) => (
            <IconButton key={action} icon={icon} tooltip={_(tooltip)} onClick={() => runAction(action)} />
          ))}
        </Fragment>
      ))}
    </>
  );
}
