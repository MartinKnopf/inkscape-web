// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/trace/trace.cpp
import { loadGeom } from '@inkscape-web/wasm';
import { afterEach, describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';
import { ObjectSet } from '../object/object-set.ts';
import type { SPItem } from '../object/sp-item.ts';
import type { RgbaImage } from './imagemap-gdk.ts';
import { PotraceTracingEngine, TraceType } from './potrace/inkscape-potrace.ts';
import { preview, setImagePixelsLoader, trace } from './trace.ts';
import { setTraceBackend } from './trace-backend.ts';

setTraceBackend(await loadGeom());

/** The header of a 40 x 40 PNG: enough for the image size. */
function pngUri(): string {
  const b = new Uint8Array(24);
  b.set([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0,
    40,
  ]);
  return `data:image/png;base64,${btoa(String.fromCharCode(...b))}`;
}

/** 40 x 40 pixels: black square from 10 to 30 on white. */
function pixels(): RgbaImage {
  const data = new Uint8ClampedArray(4 * 40 * 40).fill(255);
  for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) data.set([0, 0, 0, 255], 4 * (x + y * 40));
  return { width: 40, height: 40, data };
}

function setup() {
  const doc = SPDocument.createNewDocFromMem(
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="400" height="300">' +
      `<rect id="r" width="5" height="5"/><image id="img" x="100" y="50" width="80" height="80" xlink:href="${pngUri()}"/></svg>`,
  );
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  setImagePixelsLoader(async () => pixels());
  const set = new ObjectSet(doc);
  const item = (id: string) => doc.getObjectById(id) as SPItem;
  return { doc, set, item };
}

afterEach(() => setImagePixelsLoader(null));

describe('trace', () => {
  it('puts the traced path above the image, in document coordinates, selected', async () => {
    const { doc, set, item } = setup();
    set.set(item('img'));
    expect(await trace(new PotraceTracingEngine(), set)).toEqual({ nodes: 8, paths: 1 });
    const path = set.singleItem();
    expect(path?.getRepr().prev()).toBe(item('img').getRepr());
    expect(path?.getRepr().attribute('style')).toBe('fill:#000000');
    const b = path?.documentGeometricBounds();
    expect([b?.left(), b?.top(), b?.right(), b?.bottom()]).toEqual([120, 70, 160, 110]);
    expect(doc.undoStack.undo.map((e) => e.description)).toEqual(['Trace bitmap']);
  });

  it('several scans make a group', async () => {
    const { set, item } = setup();
    set.set(item('img'));
    const engine = new PotraceTracingEngine(TraceType.BRIGHTNESS_MULTI, false, 8, 0.45, 0, 0.65, 2);
    expect(await trace(engine, set)).toMatchObject({ paths: 2 });
    expect(set.singleItem()?.getRepr().name()).toBe('svg:g');
  });

  it('needs one selected image', async () => {
    const { set, item } = setup();
    set.set(item('r'));
    expect(await trace(new PotraceTracingEngine(), set)).toEqual({
      error: 'Select an <b>image</b> to trace',
    });
    expect(await preview(new PotraceTracingEngine(), set)).toBeNull();
  });
});
