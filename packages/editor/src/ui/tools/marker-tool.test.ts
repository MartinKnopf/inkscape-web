// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/marker-tool.cpp
// @vitest-environment happy-dom
import { type SPMarker, SPMarkerLoc } from '@inkscape-web/core';
import { Point } from '@inkscape-web/geom';
import { describe, expect, it } from 'vitest';
import type { KnotHolder } from '../knot/knot-holder.ts';
import { edit_marker, type MarkerTool } from './marker-tool.ts';
import { setupDesktop } from './tool-test-utils.ts';

// A path going down-right at 45 degrees with a 10 x 10 square marker at the end.
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">' +
  '<defs><marker id="m" orient="auto"><rect x="0" y="0" width="10" height="10"/></marker></defs>' +
  '<path id="p" d="M 10,10 L 100,100" style="stroke:#000;stroke-width:2;marker-end:url(#m)"/></svg>';

function setup() {
  const s = setupDesktop(SVG, 'Select');
  s.dt.getSelection().set(s.item('p'));
  edit_marker(SPMarkerLoc.SP_MARKER_LOC_END, s.dt);
  const tool = s.dt.getTool() as MarkerTool;
  const holder = [...tool._shape_editors.values()][0]?.knotholder as KnotHolder;
  return { ...s, tool, holder, marker: s.doc.getObjectById('m') as SPMarker };
}

describe('MarkerTool', () => {
  it('edits the marker of the selected path at the chosen location with five knots', () => {
    const { tool, holder } = setup();
    expect(tool._shape_editors.size).toBe(1);
    expect(holder.entity).toHaveLength(5);
    // Without the location nothing is edited.
    tool.editMarkerMode = -1;
    tool.selection_changed(tool._desktop.getSelection());
    expect(tool._shape_editors.size).toBe(0);
  });

  it('validates the marker: viewBox from its content, size and aspect ratio', () => {
    const { marker } = setup();
    expect(marker.getAttribute('viewBox')).toBe('0 0 10 10');
    expect(marker.getAttribute('markerWidth')).toBe('10');
    expect(marker.getAttribute('preserveAspectRatio')).toBe('xMidYMid');
  });

  it('places the edit transform at the end of the path, rotated along it and scaled by the stroke width', () => {
    const { tool, item, marker } = setup();
    const sr = tool.get_marker_transform(
      item('p') as never,
      item('p'),
      marker,
      SPMarkerLoc.SP_MARKER_LOC_END,
    );
    expect(sr.edit_rotation).toBeCloseTo(45, 9);
    // One marker unit is 2 px (stroke width) along the path.
    const p = new Point(1, 0).transformed(sr.edit_transform);
    expect(p.x).toBeCloseTo(100 + Math.SQRT2, 9);
    expect(p.y).toBeCloseTo(100 + Math.SQRT2, 9);
  });

  it('the orient knot switches an auto marker to a fixed angle', () => {
    const { holder, marker } = setup();
    const orient = holder.entity[1];
    const before = holder.entity[0]?.knot_get() as Point;
    expect(marker.orient_mode).not.toBe(0);
    // Drag the knot to the right of the marker center: the angle is the tangent of the path.
    const center = before;
    orient?.knot_set(new Point(center.x + 10, center.y), new Point(0, 0), {
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
    });
    expect(marker.orient_mode).toBe(0);
    expect(marker.orient_set).toBe(true);
  });

  it('the scale knot resizes the marker and releases the aspect ratio unless Ctrl is held', () => {
    const { holder, marker } = setup();
    const state = { shiftKey: false, ctrlKey: false, metaKey: false, altKey: false };
    const scale = holder.entity[2];
    const w0 = marker.markerWidth.computed;
    const origin = scale?.knot_get() as Point;
    scale?.knot_set(new Point(origin.x * 2, origin.y * 2), origin, { ...state, ctrlKey: true });
    expect(marker.markerWidth.computed).toBeGreaterThan(w0);
    expect(marker.markerWidth.computed).toBeCloseTo(marker.markerHeight.computed, 9);
    scale?.knot_set(new Point(origin.x * 2, origin.y * 3), origin, state);
    expect(marker.getAttribute('preserveAspectRatio')).toBe('none');
  });
});
