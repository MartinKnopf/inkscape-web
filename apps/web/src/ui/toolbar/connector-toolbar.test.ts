// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/toolbar/connector-toolbar.cpp
// @vitest-environment happy-dom
import { Preferences, SPDocument } from '@inkscape-web/core';
import { Canvas, SPDesktop } from '@inkscape-web/editor';
import { describe, expect, it } from 'vitest';
import { curvature_changed, orthogonal_toggled, spacing_changed } from './connector-toolbar.tsx';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="400" height="300">' +
  '<path id="c" d="M 0,0 L 100,0" inkscape:connector-type="polyline" inkscape:connector-curvature="0"/></svg>';

function setup() {
  const doc = SPDocument.createNewDocFromMem(SVG);
  if (!doc) throw new Error('parse failed');
  return { doc, dt: new SPDesktop(new Canvas(document.createElement('div')), doc) };
}

describe('connector toolbar', () => {
  it('changes the selected connectors with an undo step', () => {
    const { doc, dt } = setup();
    const c = doc.getObjectById('c')!;
    dt.getSelection().set(c);
    orthogonal_toggled(dt, true);
    curvature_changed(dt, 4);
    expect(c.getAttribute('inkscape:connector-type')).toBe('orthogonal');
    expect(c.getAttribute('inkscape:connector-curvature')).toBe('4');
    expect(doc.undoStack.undo.map((e) => e.description)).toEqual([
      'Set connector type: orthogonal',
      'Change connector curvature',
    ]);
  });

  it('sets the preferences for new connectors without a selected connector', () => {
    const { dt } = setup();
    orthogonal_toggled(dt, true);
    curvature_changed(dt, 7);
    expect(Preferences.get().getBool('/tools/connector/orthogonal')).toBe(true);
    expect(Preferences.get().getDouble('/tools/connector/curvature')).toBe(7);
  });

  it('writes the spacing to the namedview', () => {
    const { doc, dt } = setup();
    spacing_changed(dt, 8);
    expect(doc.getNamedView().connector_spacing).toBe(8);
  });
});
