// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/extensions-gallery.cpp
import { describe, expect, it } from 'vitest';
import { filters_load_file } from '../../extension/internal/filter/filter-file.ts';
import {
  add_categories,
  add_effects,
  get_thumbnail_size,
  is_item_visible,
  render_icon_svg,
} from './extensions-gallery.ts';

const FILTERS = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"><defs>
<filter id="b" inkscape:label="Soft" inkscape:menu="Blurs" inkscape:menu-tooltip="Blur a bit"><feGaussianBlur stdDeviation="2"/></filter>
<filter id="a" inkscape:label="Alpha" inkscape:menu="Color"><feColorMatrix type="saturate" values="0"/></filter>
<filter id="c" inkscape:label="Blur More" inkscape:menu="Blurs"><feGaussianBlur stdDeviation="5"/></filter>
</defs></svg>`;

const TEST_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="84" height="84"><defs id="defs1"/>' +
  '<g id="test-object"><rect width="40" height="40"/></g></svg>';

describe('Filter Gallery model', () => {
  const items = add_effects(filters_load_file(FILTERS, 'Bundled'));

  it('sorts the effects by menu and name, with the access path', () => {
    expect(items.map((i) => i.access)).toEqual(['Blurs ▸ Blur More', 'Blurs ▸ Soft', 'Color ▸ Alpha']);
    expect(items[1]?.description).toBe('Blur a bit');
    expect(add_categories(items)).toEqual(['all', 'Blurs', 'Color']);
  });

  it('shows the items of the category that match the search', () => {
    const visible = (category: string, search: string) =>
      items.filter((i) => is_item_visible(i, category, search)).map((i) => i.name);
    expect(visible('Blurs', '')).toEqual(['Blur More', 'Soft']);
    expect(visible('all', 'blur')).toEqual(['Blur More', 'Soft']);
    expect(visible('all', 'color')).toEqual(['Alpha']);
  });

  it('the thumbnail is the test document with the filter on the test object', () => {
    const svg = render_icon_svg(items[1]?.effect as NonNullable<(typeof items)[1]>['effect'], TEST_SVG) ?? '';
    const id = /<filter[^>]*\sid="([^"]+)"/.exec(svg)?.[1];
    expect(svg).toMatch(/<feGaussianBlur\s+stdDeviation="2"/);
    expect(svg).toMatch(new RegExp(`id="test-object"\\s+style="filter:url\\(#${id}\\)"`));
    expect([get_thumbnail_size(0), get_thumbnail_size(6)]).toEqual([50, 100]);
  });
});
