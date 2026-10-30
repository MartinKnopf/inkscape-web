// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/toolbar/box3d-toolbar.cpp
// @vitest-environment happy-dom
import { Persp3D, Proj, Pt3, SPBox3D, SPDocument, type SPItem } from '@inkscape-web/core';
import { Canvas, SPDesktop } from '@inkscape-web/editor';
import { describe, expect, it } from 'vitest';
import { angle_value_changed, vp_state_changed } from './box3d-toolbar.tsx';

function setup() {
  const doc = SPDocument.createNewDocFromMem(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><g id="layer"/></svg>',
  );
  if (!doc) throw new Error('parse failed');
  const persp = Persp3D.create_xml_element(doc);
  const box = SPBox3D.createBox3D(doc.getObjectById('layer') as SPItem);
  box.orig_corner0 = new Pt3(0, 0, 0, 1);
  box.orig_corner7 = new Pt3(10, 10, 1, 1);
  box.updateRepr();
  const dt = new SPDesktop(new Canvas(document.createElement('div')), doc);
  dt.getSelection().set(box);
  return { doc, dt, persp };
}

describe('3D box toolbar', () => {
  it('toggles the vanishing points of the selected perspective', () => {
    const { dt, persp } = setup();
    vp_state_changed(dt, Proj.Axis.Z, true);
    expect(Persp3D.VP_is_finite(persp.perspective_impl, Proj.Axis.Z)).toBe(false);
    vp_state_changed(dt, Proj.Axis.Z, false);
    expect(Persp3D.VP_is_finite(persp.perspective_impl, Proj.Axis.Z)).toBe(true);
  });

  it('sets the angle of an infinite vanishing point and writes the perspective', () => {
    const { doc, dt, persp } = setup();
    angle_value_changed(dt, Proj.Axis.Y, 45);
    expect(persp.get_infinite_angle(Proj.Axis.Y)).toBeCloseTo(45, 9);
    // stored with the y axis pointing up
    const [x, y, w] = (persp.getRepr().attribute('inkscape:vp_y') ?? '').split(' : ').map(Number);
    expect([w, Math.round(Math.atan2(-y!, x!) * (180 / Math.PI))]).toEqual([0, 45]);
    expect(doc.undoStack.undo.at(-1)?.description).toBe(
      '3D Box: Change perspective (angle of infinite axis)',
    );
  });
});
