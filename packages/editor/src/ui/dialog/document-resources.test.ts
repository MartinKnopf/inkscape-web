// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/document-resources.cpp
// @vitest-environment happy-dom
import { DocumentUndo, SPDocument } from '@inkscape-web/core';
import { describe, expect, it } from 'vitest';
import {
  collect_page,
  collect_statistics,
  delete_object,
  get_resource_count,
  gimp_palette,
  has_external_ref,
  is_resource_present,
  matches_search,
  Resources,
} from './document-resources.ts';

SPDocument.scheduleIdle = () => {};

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="100" height="100">' +
  '<defs>' +
  '<linearGradient id="g1" inkscape:label="Sky"><stop offset="0" style="stop-color:#ff0000"/><stop offset="1" style="stop-color:#0000ff"/></linearGradient>' +
  '<linearGradient id="sw" inkscape:swatch="solid"><stop offset="0" style="stop-color:#00ff00"/></linearGradient>' +
  '<linearGradient id="empty"/>' +
  '<pattern id="pt" width="5" height="5" patternUnits="userSpaceOnUse"><rect width="2" height="2"/></pattern>' +
  '<marker id="m"><path d="M0 0L2 2"/></marker>' +
  '</defs>' +
  '<g id="l" inkscape:groupmode="layer"><rect id="r" width="10" height="10" style="fill:#ff0000;stroke:#0000ff"/><rect id="r2" width="5" height="5" style="fill:#ff0000"/>' +
  '<path id="p" d="M0 0L5 5" style="stroke:#0000ff"/></g>' +
  '<image id="i1" width="4" height="4" xlink:href="data:image/png;base64,AAAA"/>' +
  '<image id="i2" width="4" height="4" xlink:href="http://example.org/x.png"/></svg>';

const open = () => {
  const doc = SPDocument.createNewDocFromMem(SVG) as SPDocument;
  doc.ensureUpToDate();
  return doc;
};

describe('document resources', () => {
  it('counts what the document has', () => {
    const doc = open();
    const stats = collect_statistics(doc.getRoot());
    expect(stats).toMatchObject({
      colors: 2, // red and blue, however often they are used
      gradients: 1, // the empty gradient has no stops
      swatches: 1,
      patterns: 1,
      markers: 1,
      images: 2,
      layers: 1,
      paths: 2, // the marker has one too
      external_uris: 1, // the data: URI is inside the document
      styles: 6, // three stops, two rectangles and a path
    });
    expect(is_resource_present(Resources.Gradients, stats)).toBe(true);
    expect(is_resource_present(Resources.Symbols, stats)).toBe(false);
    expect(get_resource_count(Resources.Stats, stats)).toBe(1);
  });

  it('lists the resources of a category', () => {
    const doc = open();
    const stats = collect_statistics(doc.getRoot());
    const colors = collect_page(doc, Resources.Colors, stats);
    expect(colors.kind === 'items' && colors.items.map((i) => [i.label, i.color])).toEqual([
      ['#0000ff', 0x0000ff], // the stroke of the first rectangle comes before its fill
      ['#ff0000', 0xff0000],
    ]);
    const gradients = collect_page(doc, Resources.Gradients, stats);
    expect(gradients.kind === 'items' && gradients.items.map((i) => i.label)).toEqual(['Sky']);
    const images = collect_page(doc, Resources.Images, stats);
    expect(images.kind === 'items' && images.items.map((i) => i.id)).toEqual(['i1', 'i2']);
    const external = collect_page(doc, Resources.External, stats);
    expect(external.kind === 'info' && external.rows.map((r) => [r.item, r.value])).toEqual([
      ['#i2', 'http://example.org/x.png'],
    ]);
    const styles = collect_page(doc, Resources.Styles, stats);
    expect(styles.kind === 'info' && styles.rows).toHaveLength(6); // all different
  });

  it('the overview lists the counts, "-" for none', () => {
    const doc = open();
    const page = collect_page(doc, Resources.Stats, collect_statistics(doc.getRoot()));
    const rows = page.kind === 'info' ? Object.fromEntries(page.rows.map((r) => [r.item, r.value])) : {};
    expect(rows).toMatchObject({ Images: '2', Layers: '1', Symbols: '-', Fonts: '-' });
  });

  it('deletes a gradient with an undo step', () => {
    const doc = open();
    delete_object(doc.getObjectById('g1'), null);
    expect(doc.getObjectById('g1')).toBeNull();
    expect(doc.undoStack.undo.at(-1)?.description).toBe('Delete gradient');
    void DocumentUndo;
  });

  it('knows external references, matches searches and writes GIMP palettes', () => {
    const doc = open();
    expect(has_external_ref(doc.getObjectById('i1') as never)).toBe(false);
    expect(has_external_ref(doc.getObjectById('i2') as never)).toBe(true);
    expect(matches_search('Sky Blue', 'sky')).toBe(true);
    expect(matches_search('Sky Blue', 'red')).toBe(false);
    expect(gimp_palette([0xff8000, 0x000001], 'Doc')).toBe('GIMP Palette\nName: Doc\n#\n255 128 0\n0 0 1\n');
  });
});
