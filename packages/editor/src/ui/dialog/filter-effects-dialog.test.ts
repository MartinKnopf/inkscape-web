// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/filter-effects-dialog.cpp, src/filter-chemistry.cpp
// @vitest-environment happy-dom
import {
  FilterComponentTransferType,
  FilterPrimitiveType,
  LightSource,
  SPDocument,
  SPFeComponentTransfer,
  type SPFilter,
  type SPFilterPrimitive,
  type SPItem,
} from '@inkscape-web/core';
import { describe, expect, it } from 'vitest';
import { SPDesktop } from '../../desktop.ts';
import { Canvas } from '../widget/canvas.ts';
import {
  add_filter,
  add_filter_primitive,
  duplicate_filter,
  duplicate_primitive,
  filter_selection_counts,
  func_type,
  get_filter_name,
  get_filters,
  get_input,
  get_light_source,
  input_count,
  input_sources,
  matrix_values,
  move_primitive,
  primitive_rows,
  read_color,
  read_dual,
  remove_filter,
  remove_primitive,
  rename_filter,
  select_filter_elements,
  selection_toggled,
  set_func_type,
  set_input,
  set_light_source,
} from './filter-effects-dialog.ts';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="400" height="300">' +
  '<defs id="defs"><filter id="f1" inkscape:label="Glow"><feGaussianBlur stdDeviation="2 3" result="blur"/>' +
  '<feOffset in="blur" dx="2"/></filter><filter id="f2"><feFlood flood-color="red"/></filter></defs>' +
  '<g id="l1" inkscape:groupmode="layer"><rect id="a" width="20" height="20" style="filter:url(#f1)"/>' +
  '<rect id="b" x="40" width="20" height="20"/></g></svg>';

function setup() {
  const doc = SPDocument.createNewDocFromMem(SVG);
  if (!doc) throw new Error('parse failed');
  const host = document.createElement('div');
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const dt = new SPDesktop(new Canvas(host), doc);
  doc.ensureUpToDate();
  const obj = <T>(id: string) => doc.getObjectById(id) as T;
  dt.layerManager().setCurrentLayer(obj<SPItem>('l1'));
  const lastUndo = () => doc.undoStack.undo.at(-1)?.description;
  const xml = (f: SPFilter) =>
    [...f.getRepr().children()].map(
      (c) =>
        `${c.name()}[${c
          .attributeList()
          .filter(([k]) => k !== 'id')
          .map(([k, v]) => `${k}=${v}`)
          .join(',')}]`,
    );
  return { doc, dt, obj, lastUndo, xml };
}

describe('Filter Editor: filters', () => {
  it('lists, adds, renames, duplicates and removes filters with undo steps', () => {
    const { doc, dt, obj, lastUndo } = setup();
    expect(get_filters(doc).map(get_filter_name)).toEqual(['Glow', 'f2']);

    const added = add_filter(doc, 2);
    expect(lastUndo()).toBe('Add filter');
    expect(get_filter_name(added)).toBe('filter2');
    rename_filter(added, 'Mine');
    expect(lastUndo()).toBe('Rename filter');

    const copy = duplicate_filter(obj<SPFilter>('f1'));
    expect(lastUndo()).toBe('Duplicate filter');
    expect(copy && primitive_rows(copy).map((r) => r.type)).toEqual(['Gaussian Blur', 'Offset']);
    expect(get_filters(doc).map(get_filter_name)).toEqual(['Glow', 'f2', 'Mine', 'Glow']);

    remove_filter(dt, obj<SPFilter>('f1'));
    expect(lastUndo()).toBe('Remove filter');
    expect(obj<SPItem>('a').getAttribute('style') ?? '').not.toContain('filter');
    expect(get_filters(doc).map(get_filter_name)).toEqual(['f2', 'Mine', 'Glow']);
  });

  it('applies a filter to the selection, toggles it off, and selects its items', () => {
    const { dt, obj, lastUndo } = setup();
    const f2 = obj<SPFilter>('f2');
    const sel = dt.getSelection();
    sel.setList([obj<SPItem>('a'), obj<SPItem>('b')]);
    expect([...filter_selection_counts(sel.items()).values()]).toEqual([1]);

    selection_toggled(dt, f2, false);
    expect(lastUndo()).toBe('Apply filter');
    expect(filter_selection_counts(sel.items()).get(f2)).toBe(1);
    expect(obj<SPItem>('b').style.getFilter()).toBe(f2);

    // The only filter of the selection: toggling removes it.
    selection_toggled(dt, f2, true);
    expect(filter_selection_counts(sel.items()).size).toBe(0);

    selection_toggled(dt, obj<SPFilter>('f1'), false);
    sel.clear();
    select_filter_elements(dt, obj<SPFilter>('f1'));
    expect(
      sel
        .items()
        .map((i) => i.getId())
        .sort(),
    ).toEqual(['a', 'b']);
  });
});

describe('Filter Editor: primitives', () => {
  it('adds primitives with their defaults, duplicates, reorders and removes them', () => {
    const { doc, obj, lastUndo, xml } = setup();
    const f2 = obj<SPFilter>('f2');
    add_filter_primitive(f2, FilterPrimitiveType.NR_FILTER_CONVOLVEMATRIX);
    expect(lastUndo()).toBe('Add filter primitive');
    const blur = add_filter_primitive(f2, FilterPrimitiveType.NR_FILTER_GAUSSIANBLUR);
    expect(xml(f2)).toEqual([
      'svg:feFlood[flood-color=red]',
      'svg:feConvolveMatrix[order=3 3,kernelMatrix=0 0 0 0 0 0 0 0 0]',
      'svg:feGaussianBlur[stdDeviation=1]',
    ]);
    duplicate_primitive(f2, blur);
    expect(lastUndo()).toBe('Duplicate filter primitive');
    const rows = primitive_rows(f2);
    remove_primitive(rows[3]?.primitive as SPFilterPrimitive);
    expect(lastUndo()).toBe('Remove filter primitive');
    expect(primitive_rows(f2).map((r) => r.type)).toEqual(['Flood', 'Convolve Matrix', 'Gaussian Blur']);
    expect(doc.getObjectById('f2')).toBe(f2);
  });

  it('a reorder removes the connections that point forward', () => {
    const { obj, lastUndo, xml } = setup();
    const f1 = obj<SPFilter>('f1');
    const [blur, offset] = primitive_rows(f1).map((r) => r.primitive);
    move_primitive(f1, offset as SPFilterPrimitive, 0);
    expect(lastUndo()).toBe('Reorder filter primitive');
    expect(xml(f1)).toEqual(['svg:feOffset[dx=2]', 'svg:feGaussianBlur[stdDeviation=2 3,result=blur]']);
    expect(primitive_rows(f1)[1]?.primitive).toBe(blur);
  });

  it('connects inputs to standard inputs and earlier primitives, and merge nodes', () => {
    const { obj, xml } = setup();
    const f2 = obj<SPFilter>('f2');
    const comp = add_filter_primitive(f2, FilterPrimitiveType.NR_FILTER_COMPOSITE);
    const flood = primitive_rows(f2)[0]?.primitive as SPFilterPrimitive;
    expect(input_count(comp)).toBe(2);
    expect(input_sources(f2, comp).map((s) => s.label)).toEqual([
      'Source Graphic',
      'Source Alpha',
      'Background Image',
      'Background Alpha',
      'Fill Paint',
      'Stroke Paint',
      'Flood',
    ]);
    set_input(f2, comp, 0, { primitive: flood });
    set_input(f2, comp, 1, { input: 'SourceAlpha' });
    expect(flood.getAttribute('result')).toMatch(/^result\d+$/);
    expect([get_input(comp, 0), get_input(comp, 1)]).toEqual([flood.getAttribute('result'), 'SourceAlpha']);
    set_input(f2, comp, 1, null);
    expect(comp.getAttribute('in2')).toBe(null);

    const merge = add_filter_primitive(f2, FilterPrimitiveType.NR_FILTER_MERGE);
    expect(input_count(merge)).toBe(1);
    set_input(f2, merge, 0, { input: 'SourceGraphic' });
    set_input(f2, merge, 1, { primitive: comp });
    expect(input_count(merge)).toBe(3);
    expect(xml(f2).at(-1)).toBe('svg:feMerge[]');
    set_input(f2, merge, 0, null);
    expect(input_count(merge)).toBe(2);
    expect(get_input(merge, 0)).toBe(comp.getAttribute('result'));
  });

  it('reads the settings values of primitives', () => {
    const { obj } = setup();
    const f1 = obj<SPFilter>('f1');
    const blur = primitive_rows(f1)[0]?.primitive as SPFilterPrimitive;
    expect(read_dual(blur, 'stdDeviation', 0)).toEqual({ v1: 2, v2: 3, linked: false });
    const flood = primitive_rows(obj<SPFilter>('f2'))[0]?.primitive as SPFilterPrimitive;
    expect(read_color(flood, 'flood-color', '#000000')).toBe('#ff0000');
    const conv = add_filter_primitive(f1, FilterPrimitiveType.NR_FILTER_CONVOLVEMATRIX);
    conv.setAttribute('order', '2');
    conv.setAttribute('kernelMatrix', '1 2');
    expect(matrix_values(conv)).toEqual([1, 2, 0, 1]);
  });

  it('sets transfer function types and light sources', () => {
    const { obj, lastUndo, xml } = setup();
    const f2 = obj<SPFilter>('f2');
    const ct = add_filter_primitive(
      f2,
      FilterPrimitiveType.NR_FILTER_COMPONENTTRANSFER,
    ) as SPFeComponentTransfer;
    expect(ct).toBeInstanceOf(SPFeComponentTransfer);
    expect(func_type(ct, 2)).toBe(FilterComponentTransferType.COMPONENTTRANSFER_TYPE_IDENTITY);
    set_func_type(f2, ct, 2, FilterComponentTransferType.COMPONENTTRANSFER_TYPE_GAMMA);
    expect(lastUndo()).toBe('New transfer function type');
    expect(func_type(ct, 2)).toBe(FilterComponentTransferType.COMPONENTTRANSFER_TYPE_GAMMA);
    expect(ct.getRepr().firstChild()?.name()).toBe('svg:feFuncB');

    const light = add_filter_primitive(f2, FilterPrimitiveType.NR_FILTER_DIFFUSELIGHTING);
    expect(get_light_source(light)).toBe(null);
    set_light_source(light, LightSource.LIGHT_SPOT);
    expect(lastUndo()).toBe('New light source');
    set_light_source(light, LightSource.LIGHT_DISTANT);
    expect(get_light_source(light)).toBe(LightSource.LIGHT_DISTANT);
    expect([...light.getRepr().children()].map((c) => c.name())).toEqual(['svg:feDistantLight']);
    expect(xml(f2)).toHaveLength(3);
  });
});
