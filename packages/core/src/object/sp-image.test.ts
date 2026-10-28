// SPDX-License-Identifier: GPL-2.0-or-later
import { Scale, Translate } from '@inkscape-web/geom';
import { describe, expect, it } from 'vitest';
import { Pixbuf, sniffImageSize } from '../display/cairo-utils.ts';
import { FakeDrawing, type FakeDrawingImage } from '../display/fake-drawing.ts';
import { SPDocument } from '../document.ts';
import { SPImage } from './sp-image.ts';
import { SPItem } from './sp-item.ts';

SPDocument.scheduleIdle = () => {};

/** A PNG header (signature and IHDR) of a w×h image; enough for the size. */
function pngHeader(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}
const pngUri = (w: number, h: number) =>
  `data:image/png;base64,${btoa(String.fromCharCode(...pngHeader(w, h)))}`;

const open = (body: string) => {
  const doc = SPDocument.createNewDocFromMem(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${body}</svg>`,
  );
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  return doc;
};
const image = (doc: SPDocument) => {
  const o = doc.getObjectById('i');
  if (!(o instanceof SPImage)) throw new Error('no image');
  return o;
};

describe('sniffImageSize', () => {
  it('reads PNG, GIF and SVG sizes', () => {
    expect(sniffImageSize(pngHeader(640, 480))).toMatchObject({ mime: 'image/png', width: 640, height: 480 });
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 3, 1, 2, 0]);
    expect(sniffImageSize(gif)).toMatchObject({ mime: 'image/gif', width: 259, height: 2 });
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1in" viewBox="0 0 5 7">',
    );
    expect(sniffImageSize(svg)).toMatchObject({ mime: 'image/svg+xml', width: 96, height: 7 });
    expect(sniffImageSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('reads the size of a JPEG start-of-frame', () => {
    // SOI, APP0 with 2 bytes of data, SOF0 with height 20 and width 30.
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 20, 0, 30, 3, 0, 0,
    ]);
    expect(sniffImageSize(jpeg)).toMatchObject({ mime: 'image/jpeg', width: 30, height: 20 });
  });
});

describe('SPImage', () => {
  it('takes its size from the pixbuf when width and height are missing', () => {
    const doc = open(`<image id="i" x="5" y="6" xlink:href="${pngUri(40, 30)}"/>`);
    const img = image(doc);
    expect(img.missing).toBe(false);
    expect(img.pixbuf?.width()).toBe(40);
    expect(img.documentGeometricBounds()?.width()).toBe(40);
    expect([img.clipbox.left(), img.clipbox.top(), img.clipbox.width(), img.clipbox.height()]).toEqual([
      5, 6, 40, 30,
    ]);
  });

  it('fits the pixbuf with preserveAspectRatio', () => {
    const doc = open(
      `<image id="i" width="100" height="30" preserveAspectRatio="xMaxYMid" href="${pngUri(40, 30)}"/>`,
    );
    const img = image(doc);
    expect([img.sx, img.sy, img.ox, img.oy]).toEqual([1, 1, 60, 0]);

    img.setAttribute('preserveAspectRatio', 'none');
    doc.ensureUpToDate();
    expect([img.sx, img.sy, img.ox, img.oy]).toEqual([2.5, 1, 0, 0]);
  });

  it('sets up its view and follows href changes', () => {
    const doc = open(`<image id="i" width="10" height="10" xlink:href="${pngUri(10, 10)}"/>`);
    const img = image(doc);
    const view = img.invokeShow(new FakeDrawing(), SPItem.displayKeyNew(1), 1) as FakeDrawingImage;
    expect(view.kind).toBe('image');
    expect(view.pixbuf?.href).toBe(pngUri(10, 10));
    expect(view.clipbox?.width()).toBe(10);

    img.setAttribute('xlink:href', pngUri(20, 10));
    doc.ensureUpToDate();
    expect(view.pixbuf?.width()).toBe(20);
  });

  it('shows the broken image for an unreadable href', () => {
    const doc = open('<image id="i" width="50" height="20" xlink:href="data:image/png;base64,AAAA"/>');
    const img = image(doc);
    expect(img.missing).toBe(true);
    expect(img.pixbuf?.href.startsWith('data:image/svg+xml,')).toBe(true);
    expect(img.description()).toBe('50 &#215; 20: embedded');
  });

  it('loads URLs through the url loader', async () => {
    let resolve: (size: { width: number; height: number }) => void = () => {};
    Pixbuf.urlLoader = () => new Promise((r) => (resolve = r));
    try {
      const doc = open('<image id="i" xlink:href="blob:test-1"/>');
      expect(image(doc).pixbuf?.href.startsWith('data:image/svg+xml')).toBe(true);
      resolve({ width: 12, height: 8 });
      await new Promise((r) => setTimeout(r, 0));
      doc.ensureUpToDate();
      expect(image(doc).pixbuf?.href).toBe('blob:test-1');
      expect(image(doc).documentGeometricBounds()?.width()).toBe(12);
    } finally {
      Pixbuf.urlLoader = null;
    }
  });

  it('embeds translation and scale into x, y, width and height', () => {
    const doc = open(`<image id="i" x="1" y="2" width="10" height="20" xlink:href="${pngUri(10, 20)}"/>`);
    const img = image(doc);
    img.doWriteTransform(Scale(2, 3).multiply(Translate(5, 0)));
    const r = img.getRepr();
    expect([r.attribute('x'), r.attribute('y'), r.attribute('width'), r.attribute('height')]).toEqual([
      '7',
      '6',
      '20',
      '60',
    ]);
    expect(r.attribute('transform')).toBeNull();
  });
});
