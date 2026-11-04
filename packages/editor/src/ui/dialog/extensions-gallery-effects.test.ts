// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/extensions-gallery.cpp
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Effect } from '../../extension/effect.ts';
import { build_from_mem } from '../../extension/system.ts';
import { add_categories, add_effects, prepare_effects, render_icon_svg } from './extensions-gallery.ts';

const INX = (id: string, name: string, menu: string, hidden = false, param = '') =>
  `<inkscape-extension xmlns="http://www.inkscape.org/namespace/inkscape/extension"><name>${name}</name><id>${id}</id>${param}` +
  `<effect><effects-menu${hidden ? ' hidden="true"' : ''}><submenu name="${menu}"/></effects-menu><menu-tip>Tip of ${name}</menu-tip></effect>` +
  `<script><command location="inx" interpreter="python">x.py</command></script></inkscape-extension>`;

const effects = [
  build_from_mem(
    INX('org.test.b', 'Beta', 'Render', false, '<param name="n" type="int" gui-text="N">1</param>'),
  ),
  build_from_mem(INX('org.test.a', 'Alpha', 'Color')),
  build_from_mem(INX('org.test.h', 'Hidden', 'Color', true)),
].filter((e): e is Effect => e instanceof Effect);

describe('Extensions Gallery model', () => {
  it('lists the extensions that are not hidden by menu and name, and tells which take input', () => {
    expect(effects).toHaveLength(3);
    const items = add_effects(prepare_effects(effects));
    expect(items.map((i) => [i.access, i.takes_input, i.description])).toEqual([
      ['Color ▸ Alpha', false, 'Tip of Alpha'],
      ['Render ▸ Beta', true, 'Tip of Beta'],
    ]);
    expect(add_categories(items)).toEqual(['all', 'Color', 'Render']);
  });

  it('the thumbnail of an extension is the placeholder document', () => {
    const [item] = add_effects(prepare_effects(effects));
    const doc = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    expect(render_icon_svg(item?.effect as Effect, doc)).toBe(doc);
  });
});
