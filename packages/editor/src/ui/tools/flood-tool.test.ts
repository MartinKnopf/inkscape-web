// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/flood-tool.cpp
// @vitest-environment happy-dom
import { Preferences, type SPItem } from '@inkscape-web/core';
import { Affine, Point, Rect } from '@inkscape-web/geom';
import { afterEach, describe, expect, it } from 'vitest';
import {
  compare_pixels,
  type FloodBitmap,
  flood_fill_bitmap,
  PaintBucketChannels,
  sp_flood_do_flood_fill,
} from './flood-tool.ts';
import { mockHitTest, pointer, setupDesktop, unmockHitTest, useWasmBackend } from './tool-test-utils.ts';

await useWasmBackend();

const WHITE = 0xffffffff;
const BLACK = 0xff000000;
const TRANSPARENT = 0;

/**
 * A 40 x 40 bitmap with a black square outline from 10 to 29 on transparent; gap opens
 * the right side over that many pixels.
 */
function ring(gap = 0): FloodBitmap {
  const w = 40;
  const px = new Uint32Array(w * w).fill(TRANSPARENT);
  for (let i = 10; i < 30; i++) {
    px[i + 10 * w] = BLACK;
    px[i + 29 * w] = BLACK;
    px[10 + i * w] = BLACK;
    if (i < 20 || i >= 20 + gap) px[29 + i * w] = BLACK;
  }
  return {
    px,
    width: w,
    height: w,
    world2img: Affine.identity(),
    doc2img: Affine.identity(),
    screen: new Rect(0, 0, 40, 40),
    dtc: WHITE & 0x00ffffff,
  };
}

const colored = (trace_px: Uint8Array) => trace_px.filter((t) => t & 16).length;
const RGB = PaintBucketChannels.FLOOD_CHANNELS_RGB;

describe('flood_fill_bitmap', () => {
  it('fills the inside of a closed outline', () => {
    const fill = flood_fill_bitmap(ring(), [new Point(20, 20)], new Rect(10, 10, 30, 30), false, RGB, 15, 0);
    expect(fill.aborted).toBe(false);
    expect(colored(fill.trace_px)).toBe(18 * 18);
    // As upstream, the scanlines include the outline pixel where they stop.
    expect([fill.min_x, fill.max_x, fill.min_y, fill.max_y]).toEqual([10, 29, 11, 28]);
  });

  it('a fill that leaks to the bitmap edge is not bounded when the drawing is on screen', () => {
    const fill = flood_fill_bitmap(ring(3), [new Point(20, 20)], new Rect(10, 10, 30, 30), false, RGB, 15, 0);
    expect(fill.aborted).toBe(true);
  });

  it('close gaps (autogap) keeps the fill inside an outline with a small gap', () => {
    const fill = flood_fill_bitmap(ring(2), [new Point(20, 20)], new Rect(10, 10, 30, 30), false, RGB, 15, 2);
    expect(fill.aborted).toBe(false);
    expect(colored(fill.trace_px)).toBeGreaterThan(17 * 17);
  });
});

describe('compare_pixels', () => {
  const red = 0xffff0000;
  const darkRed = 0xffc80000;
  it('compares visible colors over the background within the threshold', () => {
    expect(compare_pixels(darkRed, red, red, WHITE, 40, RGB)).toBe(true);
    expect(compare_pixels(darkRed, red, red, WHITE, 10, RGB)).toBe(false);
  });
  it('compares a channel, hue or alpha', () => {
    expect(compare_pixels(darkRed, red, red, WHITE, 10, PaintBucketChannels.FLOOD_CHANNELS_G)).toBe(true);
    expect(compare_pixels(darkRed, red, red, WHITE, 1, PaintBucketChannels.FLOOD_CHANNELS_H)).toBe(true);
    expect(compare_pixels(0x80800000, red, red, WHITE, 100, PaintBucketChannels.FLOOD_CHANNELS_ALPHA)).toBe(
      false,
    );
  });
});

describe('sp_flood_do_flood_fill', () => {
  const SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="400" height="300">' +
    '<g id="layer1" inkscape:groupmode="layer"><rect id="r" x="10" y="10" width="20" height="20" style="fill:none;stroke:black"/></g></svg>';

  afterEach(() => Preferences.get().remove('/tools/paintbucket/offset'));

  it('traces the filled area as a path with the tool style, selected, in one undo step', () => {
    const { doc, dt, undoSteps } = setupDesktop(SVG, 'PaintBucket');
    expect(sp_flood_do_flood_fill(dt, ring(), [new Point(20, 20)], false, false)).toBeNull();
    const layer = [...(doc.getObjectById('layer1')?.getRepr().children() ?? [])];
    expect(layer).toHaveLength(2);
    const path = doc.getObjectByRepr(layer[1] ?? null) as SPItem;
    expect(path.getRepr().attribute('style')).toContain('fill:#a0a0a0');
    expect(dt.getSelection().items()).toEqual([path]);
    const b = path.documentGeometricBounds();
    expect([b?.left(), b?.top(), b?.right(), b?.bottom()]).toEqual([11, 11, 29, 29]);
    expect(undoSteps()).toEqual(['Fill bounded area']);
  });

  it('grow/shrink offsets the result', () => {
    const { doc, dt } = setupDesktop(SVG, 'PaintBucket');
    Preferences.get().setDouble('/tools/paintbucket/offset', 2);
    sp_flood_do_flood_fill(dt, ring(), [new Point(20, 20)], false, false);
    const path = doc.getObjectById('layer1')?.lastChild() as SPItem;
    expect(path.documentGeometricBounds()?.width()).toBeCloseTo(22, 0);
  });

  it('an unbounded area is not filled', () => {
    const { doc, dt, undoSteps } = setupDesktop(SVG, 'PaintBucket');
    expect(sp_flood_do_flood_fill(dt, ring(3), [new Point(20, 20)], false, false)).toBe(
      '<b>Area is not bounded</b>, cannot fill.',
    );
    expect(doc.getObjectById('layer1')?.getRepr().childCount()).toBe(1);
    expect(undoSteps()).toEqual([]);
  });
});

describe('FloodTool', () => {
  afterEach(() => unmockHitTest());

  it('Ctrl+click sets the tool style on the clicked object', () => {
    const { doc, dt, svg, item, undoSteps } = setupDesktop(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect id="r" x="10" y="10" width="20" height="20" style="fill:blue"/></svg>',
      'PaintBucket',
    );
    mockHitTest(doc, dt);
    pointer(svg, 'pointerdown', 20, 20, 1, { ctrlKey: true });
    pointer(svg, 'pointerup', 20, 20, 0, { ctrlKey: true });
    expect(item('r').getRepr().attribute('style')).toContain('fill:#a0a0a0');
    expect(undoSteps()).toEqual(['Set style on object']);
  });
});
