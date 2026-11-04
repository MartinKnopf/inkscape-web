// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/path/path-offset.cpp, src/object/sp-offset.cpp
import { loadGeom } from '@inkscape-web/wasm';
import { describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';
import { ObjectSet } from '../object/object-set.ts';
import type { SPItem } from '../object/sp-item.ts';
import { SPOffset, sp_offset_distance_to_original } from '../object/sp-offset.ts';
import { setPathBoolopBackend } from './path-boolop.ts';
import {
  sp_selected_path_create_offset_object,
  sp_selected_path_do_offset,
  sp_selected_path_inset_screen,
} from './path-offset.ts';

setPathBoolopBackend(await loadGeom());
SPDocument.scheduleIdle = () => {};

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">' +
  '<rect id="r" x="10" y="10" width="40" height="40" style="fill:red;stroke:none"/></svg>';

function load() {
  const doc = SPDocument.createNewDocFromMem(SVG) as SPDocument;
  doc.ensureUpToDate();
  const set = new ObjectSet(doc);
  set.set(doc.getObjectById('r') as SPItem);
  return { doc, set };
}

const bounds = (item: SPItem | null) => {
  item?.document.ensureUpToDate();
  const b = item?.documentVisualBounds();
  return b ? [b.left(), b.top(), b.right(), b.bottom()].map((v) => Math.round(v * 100) / 100) : null;
};

describe('outset and inset', () => {
  it('grows a rectangle by the offset on every side, with one undo step', () => {
    const { doc, set } = load();
    sp_selected_path_do_offset(set, true, 5);
    const item = set.singleItem();
    expect(item?.getRepr().name()).toBe('svg:path');
    expect(bounds(item)).toEqual([5, 5, 55, 55]);
    expect(doc.undoStack.undo.map((e) => e.description)).toEqual(['Outset path']);
    // The style of the original stays.
    expect(item?.getAttribute('style')).toContain('fill:red');
  });

  it('shrinks it, and the screen variants divide by the zoom', () => {
    const { set } = load();
    sp_selected_path_do_offset(set, false, 5);
    expect(bounds(set.singleItem())).toEqual([15, 15, 45, 45]);
    sp_selected_path_inset_screen(set, 10, 2); // 5 px at zoom 2
    expect(bounds(set.singleItem())).toEqual([20, 20, 40, 40]);
  });

  it('removes the path when nothing is left', () => {
    const { doc, set } = load();
    sp_selected_path_do_offset(set, false, 30);
    expect(doc.getObjectById('r')).toBeNull();
    expect(set.isEmpty()).toBe(true);
  });
});

describe('dynamic and linked offsets', () => {
  it('a dynamic offset replaces the path and keeps its radius', () => {
    const { doc, set } = load();
    sp_selected_path_create_offset_object(set, 1, false, 4);
    const offset = set.singleItem();
    expect(offset).toBeInstanceOf(SPOffset);
    expect(offset?.getAttribute('sodipodi:type')).toBe('inkscape:offset');
    expect(offset?.getAttribute('inkscape:radius')).toBe('4');
    // The offset takes the place and the id of the original.
    expect(doc.getObjectById('r')).toBe(offset);
    expect(bounds(offset)).toEqual([6, 6, 54, 54]);
    // The radius is an attribute: changing it changes the shape.
    offset?.setAttribute('inkscape:radius', '10');
    expect(bounds(offset)).toEqual([0, 0, 60, 60]);
    expect(doc.undoStack.undo.map((e) => e.description)).toEqual(['Create dynamic offset']);
  });

  it('a linked offset follows its source', () => {
    const { doc, set } = load();
    sp_selected_path_create_offset_object(set, -1, true, 2);
    const offset = set.singleItem() as SPOffset;
    expect(offset.getAttribute('xlink:href')).toBe('#r');
    expect(bounds(offset)).toEqual([12, 12, 48, 48]);
    // Resizing the source changes the linked offset.
    doc.getObjectById('r')?.setAttribute('width', '60');
    doc.ensureUpToDate();
    expect(bounds(offset)).toEqual([12, 12, 68, 48]);
    expect(offset.displayName()).toBe('Linked Offset');
  });

  it('the distance to the original is positive outside and negative inside', () => {
    const { set } = load();
    sp_selected_path_create_offset_object(set, 1, false, 4);
    const offset = set.singleItem() as SPOffset;
    expect(sp_offset_distance_to_original(offset, new Point(60, 30))).toBeCloseTo(10, 0);
    expect(sp_offset_distance_to_original(offset, new Point(15, 30))).toBeCloseTo(-5, 0);
  });
});

import { Point } from '@inkscape-web/geom';
