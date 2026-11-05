// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-element-image.cpp, src/object/sp-image.cpp
// @vitest-environment happy-dom
import { type SPImage, SPUse } from '@inkscape-web/core';
import { Rect } from '@inkscape-web/geom';
import { afterEach, describe, expect, it } from 'vitest';
import { InkscapeApplication } from '../inkscape-application.ts';
import { setupDesktop } from '../ui/tools/tool-test-utils.ts';
import { image_pixel_area } from './actions-element-image.ts';
import { output_signal } from './actions-helper.ts';

/** A data: URI of a PNG header with the pixel size (enough for the size of the image). */
function png_uri(width: number, height: number): string {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
}

// A 200 x 100 pixel image shown at 100 x 50 px at (10, 20); a clone of it; one with a file name.
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="300" height="200">' +
  `<image id="i" x="10" y="20" width="100" height="50" xlink:href="${png_uri(200, 100)}"/>` +
  '<use id="u" xlink:href="#i" x="0" y="100"/>' +
  '<image id="f" width="10" height="10" xlink:href="photo.png"/>' +
  '<image id="h" width="10" height="10" xlink:href="https://example.org/photo.png"/>' +
  '</svg>';

function setup() {
  const s = setupDesktop(SVG, 'Select');
  const app = InkscapeApplication.instance();
  app.set_active_desktop(s.dt);
  return { ...s, app, image: s.item('i') as SPImage };
}

afterEach(() => InkscapeApplication.instance().set_active_desktop(null));

describe('image_pixel_area', () => {
  it('converts an area in document coordinates to the pixels of the image', () => {
    const { image } = setup();
    // Document (35, 30) - (85, 55) is 25..75 px right and 10..35 px down of the image: 2 px per document px.
    expect(image_pixel_area(image, new Rect(35, 30, 85, 55))).toEqual({
      left: 50,
      top: 20,
      width: 100,
      height: 50,
    });
  });

  it('keeps more pixels when the area is between pixels, and stays inside the image', () => {
    const { image } = setup();
    expect(image_pixel_area(image, new Rect(10.2, 20.2, 20.2, 30.2))).toEqual({
      left: 0,
      top: 0,
      width: 21,
      height: 21,
    });
    expect(image_pixel_area(image, new Rect(0, 0, 40, 30))).toEqual({
      left: 0,
      top: 0,
      width: 60,
      height: 20,
    });
  });

  it('has nothing to crop if the area has all pixels or none', () => {
    const { image } = setup();
    expect(image_pixel_area(image, new Rect(0, 0, 300, 200))).toBeNull();
    expect(image_pixel_area(image, new Rect(200, 100, 250, 150))).toBeNull();
  });
});

describe('app.element-image-edit', () => {
  const messages = (action: () => void) => {
    const lines: string[] = [];
    const off = output_signal.connect((l) => lines.push(l));
    action();
    off();
    return lines;
  };

  it('refuses embedded images and other schemes like upstream', () => {
    const { app, dt, item } = setup();
    dt.getSelection().setList([item('i'), item('h')]);
    expect(messages(() => app.activate_action('app.element-image-edit'))).toEqual([
      'Edit Externally: Editing embedded images (data URL) is not supported',
      "Edit Externally: Cannot edit image (scheme 'https' not supported)",
    ]);
  });

  it('edits the original of a clone, and reports that the browser cannot start an editor', () => {
    const { app, dt, item } = setup();
    expect(item('u')).toBeInstanceOf(SPUse);
    dt.getSelection().setList([item('u'), item('f')]);
    const lines = messages(() => app.activate_action('app.element-image-edit'));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Editing embedded images');
    expect(lines[1]).toContain('Failed to edit external image.');
  });

  it('does nothing without selection', () => {
    const { app } = setup();
    expect(messages(() => app.activate_action('app.element-image-edit'))).toEqual([]);
  });
});
