// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/grid.cpp, src/extension/internal/grid.h
/*
 * A plug-in to add a grid creation effect into Inkscape.
 *
 * Copyright (C) 2004-2005  Ted Gould <ted@gould.cx>
 * Copyright (C) 2007  MenTaLguY <mental@rydia.net>
 *   Abhishek Sharma
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { N_, PathString, type SPDocument } from '@inkscape-web/core';
import { Point, Rect } from '@inkscape-web/geom';
import type { SPDesktop } from '../../desktop.ts';
import type { Effect } from '../effect.ts';
import type { ExecutionEnv } from '../execution-env.ts';
import { Implementation } from '../implementation/implementation.ts';
import { INKSCAPE_EXTENSION_URI } from '../prefdialog/widget.ts';
import { build_from_mem } from '../system.ts';

/** The path data of the lines of the grid in bounding_area (upstream build_lines). */
export function build_lines(bounding_area: Rect, offset: Point, spacing: Point): string {
  let point_offset = new Point(0.0, 0.0);
  const path_data = new PathString();
  for (const axis of ['x', 'y'] as const) {
    const other = axis === 'x' ? 'y' : 'x';
    point_offset = axis === 'x' ? new Point(offset.x, point_offset.y) : new Point(point_offset.x, offset.y);
    const min = bounding_area.min();
    const max = bounding_area.max();
    for (let start = min[axis]; start + offset[axis] <= max[axis]; start += spacing[axis]) {
      const start_point = axis === 'x' ? new Point(start, min.y) : new Point(min.x, start);
      const end_point = other === 'y' ? new Point(start, max.y) : new Point(max.x, start);
      path_data
        .moveTo(start_point.x + point_offset.x, start_point.y + point_offset.y)
        .lineTo(end_point.x + point_offset.x, end_point.y + point_offset.y);
    }
  }
  return path_data.string();
}

/** The effect that draws a grid as one path (upstream Grid). */
export class Grid extends Implementation {
  /** Draw the grid over the selection, else over the page, in the current layer. */
  override async effect(
    module: Effect,
    _executionEnv: ExecutionEnv | null,
    desktop: SPDesktop | null,
    _document: SPDocument,
  ): Promise<void> {
    if (!desktop) return;
    const selection = desktop.getSelection();
    const doc = desktop.getDocument();

    let bounding_area = new Rect(new Point(0, 0), new Point(100, 100));
    if (selection.isEmpty()) {
      // get page size
      bounding_area = doc.preferredBounds();
    } else {
      const bounds = selection.visualBounds();
      if (bounds) bounding_area = bounds;
      // As upstream does, although the bounds are in desktop coordinates already.
      bounding_area = bounding_area.transformed(desktop.doc2dt());
    }

    const scale = 1 / doc.getDocumentScale().x;
    bounding_area = new Rect(
      bounding_area.min().x * scale,
      bounding_area.min().y * scale,
      bounding_area.max().x * scale,
      bounding_area.max().y * scale,
    );

    const spacings = new Point(
      scale * module.get_param_float('xspacing'),
      scale * module.get_param_float('yspacing'),
    );
    const line_width = scale * module.get_param_float('lineWidth');
    const offsets = new Point(
      scale * module.get_param_float('xoffset'),
      scale * module.get_param_float('yoffset'),
    );

    const path_data = build_lines(bounding_area, offsets, spacings);

    const xml_doc = doc.getReprDoc();
    // XML Tree being used directly here while it shouldn't be.
    const current_layer = desktop.layerManager().currentLayer()?.getRepr();
    if (!current_layer) return;
    const path = xml_doc.createElement('svg:path');
    path.setAttribute('d', path_data);
    // An ostringstream writes six significant digits.
    path.setAttribute(
      'style',
      `fill:none;stroke:#000000;stroke-width:${Number(line_width.toPrecision(6))}px`,
    );
    current_layer.appendChild(path);
  }

  static init(): void {
    build_from_mem(
      `<inkscape-extension xmlns="${INKSCAPE_EXTENSION_URI}">\n` +
        `<name>${N_('Grid')}</name>\n` +
        '<id>org.inkscape.effect.grid</id>\n' +
        `<param name="lineWidth" gui-text="${N_('Line Width:')}" type="float">1.0</param>\n` +
        `<param name="xspacing" gui-text="${N_('Horizontal Spacing:')}" type="float" min="0.1" max="1000">10.0</param>\n` +
        `<param name="yspacing" gui-text="${N_('Vertical Spacing:')}" type="float" min="0.1" max="1000">10.0</param>\n` +
        `<param name="xoffset" gui-text="${N_('Horizontal Offset:')}" type="float" min="0.0" max="1000">0.0</param>\n` +
        `<param name="yoffset" gui-text="${N_('Vertical Offset:')}" type="float" min="0.0" max="1000">0.0</param>\n` +
        '<effect>\n' +
        '<object-type>all</object-type>\n' +
        '<effects-menu>\n' +
        `<submenu name="${N_('Render')}">\n` +
        `<submenu name="${N_('Grids')}" />\n` +
        '</submenu>\n' +
        '</effects-menu>\n' +
        `<menu-tip>${N_('Draw a path which is a grid')}</menu-tip>\n` +
        '</effect>\n' +
        '</inkscape-extension>\n',
      new Grid(),
    );
  }
}
