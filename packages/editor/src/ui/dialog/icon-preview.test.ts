// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/icon-preview.cpp
// @vitest-environment happy-dom
import { Preferences } from '@inkscape-web/core';
import { Point, Rect } from '@inkscape-web/geom';
import { afterEach, describe, expect, it } from 'vitest';
import { setupDesktop } from '../tools/tool-test-utils.ts';
import {
  icon_geometry,
  icon_preview_label,
  icon_preview_sizes,
  icon_preview_target,
} from './icon-preview.ts';

const box = (x0: number, y0: number, x1: number, y1: number) =>
  new Rect(new Point(x0, y0), new Point(x1, y1));
const parts = (r: Rect) => [r.left(), r.top(), r.right(), r.bottom()];

describe('icon_geometry', () => {
  it('scales the longer side of the object to the icon and centers the other', () => {
    const g = icon_geometry(box(0, 0, 20, 10), 40);
    expect(g.scale).toBe(2);
    expect(parts(g.visible)).toEqual([0, 10, 40, 30]); // 40 x 20 px in the middle of the icon
    expect(parts(g.area)).toEqual([0, -5, 20, 15]); // the square of the document that the icon shows
  });

  it('rounds the box outwards before it scales and keeps the scale of an object of the size of the icon', () => {
    const g = icon_geometry(box(10.2, 10.2, 41.8, 41.8), 32);
    expect(g.scale).toBe(1); // 10 to 42 is 32 px
    expect(parts(g.visible)).toEqual([0, 0, 32, 32]);
    expect(parts(g.area)).toEqual([10, 10, 42, 42]);
  });
});

describe('icon preview sizes and target', () => {
  afterEach(() => Preferences.get().remove('/iconpreview/selectionHold'));

  it('shows the sizes of the preferences that are shown, as "N x N"', () => {
    const sizes = icon_preview_sizes();
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.every((s) => s > 0)).toBe(true);
    expect(icon_preview_label(48)).toBe('48 x 48');
  });

  it('previews the root, or the last selected item and holds it', () => {
    const { dt, doc, item } = setupDesktop(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect id="a" width="5" height="5"/><rect id="b" x="9" width="5" height="5"/></svg>',
      'Select',
    );
    expect(icon_preview_target(dt, false, '').target).toBe(doc.getRoot());
    dt.getSelection().set(item('a'));
    expect(icon_preview_target(dt, true, '')).toEqual({ target: item('a'), id: 'a' });
    // The held object stays the target while the selection changes.
    dt.getSelection().set(item('b'));
    expect(icon_preview_target(dt, true, 'a').id).toBe('a');
    Preferences.get().setBool('/iconpreview/selectionHold', false);
    expect(icon_preview_target(dt, true, 'a').id).toBe('b');
  });
});
