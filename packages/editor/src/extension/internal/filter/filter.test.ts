// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/filter/filter.cpp, src/extension/internal/filter/filter-file.cpp, src/actions/actions-effect.cpp
// @vitest-environment happy-dom
import { ObjectSet, SPDocument, type SPItem } from '@inkscape-web/core';
import { describe, expect, it } from 'vitest';
import { removeFilter } from '../../../selection-chemistry.ts';
import { add_filter_effects_to_menu, type MenuEntry } from '../../../ui/desktop/menubar.ts';
import { filters_load_file } from './filter-file.ts';

const FILTERS = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"><defs>
<filter id="f001" inkscape:label="Soft" inkscape:menu="Blurs" inkscape:menu-tooltip="Blur a bit" style="color-interpolation-filters:sRGB">
  <feGaussianBlur stdDeviation="2" result="blur"/><feComposite in="SourceGraphic" in2="blur"/></filter>
<filter id="f002" inkscape:label="Alpha" inkscape:menu="Blurs"><feColorMatrix in="SourceAlpha" type="saturate" values="0"/></filter>
<filter id="f003"><feFlood/></filter>
</defs></svg>`;

function setup() {
  const doc = SPDocument.createNewDocFromMem(
    '<svg xmlns="http://www.w3.org/2000/svg"><defs id="defs"><filter id="old"><feOffset dx="3" result="moved"/></filter></defs>' +
      '<rect id="a" width="10" height="10"/><rect id="b" width="10" height="10" style="filter:url(#old)"/></svg>',
  );
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  const item = (id: string) => doc.getObjectById(id) as SPItem;
  const set = new ObjectSet(doc);
  return { doc, item, set };
}

describe('filters_load_file', () => {
  it('makes an effect of each filter, in its menu', () => {
    const effects = filters_load_file(FILTERS, 'Bundled');
    expect(effects.map((e) => [e.id, e.name, e.menu, e.menu_tip])).toEqual([
      ['org.inkscape.effect.filter.f001', 'Soft', ['Blurs'], 'Blur a bit'],
      ['org.inkscape.effect.filter.f002', 'Alpha', ['Blurs'], 'Alpha'],
      ['org.inkscape.effect.filter.f003', 'f003', ['Bundled'], 'f003'],
    ]);
  });

  it('the effects go into the Filters menu by menu and name', () => {
    const menu: MenuEntry[] = [
      {
        kind: 'submenu',
        id: 'filter-menu',
        label: 'Filter_s',
        children: [{ kind: 'section', id: 'filter-menu-filters', children: [] }],
      },
    ];
    add_filter_effects_to_menu(menu, filters_load_file(FILTERS, 'Bundled'));
    const section = (menu[0] as { children: MenuEntry[] }).children[0] as { children: MenuEntry[] };
    const blurs = section.children[0] as { label: string; children: MenuEntry[] };
    expect(section.children.map((e) => (e.kind === 'submenu' ? e.label : ''))).toEqual(['Blurs', 'Bundled']);
    expect(blurs.children.map((e) => (e.kind === 'item' ? [e.label, e.action] : null))).toEqual([
      ['Alpha', 'app.org.inkscape.effect.filter.f002'],
      ['Soft', 'app.org.inkscape.effect.filter.f001'],
    ]);
  });
});

describe('Filter.effect', () => {
  it('gives an item without filter a copy of the preset', () => {
    const { doc, item, set } = setup();
    const [soft] = filters_load_file(FILTERS, 'Bundled');
    set.set(item('a'));
    soft?.effect(set, 'Soft');
    const url = /url\(#(.+)\)/.exec(item('a').getRepr().attribute('style') ?? '')?.[1];
    const filter = doc.getObjectById(url ?? '')?.getRepr();
    expect(filter?.attribute('inkscape:label')).toBe('Soft');
    expect([...(filter?.children() ?? [])].map((c) => c.name())).toEqual([
      'svg:feGaussianBlur',
      'svg:feComposite',
    ]);
    expect(doc.undoStack.undo.map((e) => e.description)).toEqual(['Soft']);
  });

  it('chains the preset after the primitives of an existing filter', () => {
    const { doc, item, set } = setup();
    const [soft] = filters_load_file(FILTERS, 'Bundled');
    set.set(item('b'));
    soft?.effect(set, 'Soft');
    const prims = [...(doc.getObjectById('old')?.getRepr().children() ?? [])];
    expect(
      prims.map((c) => [c.name(), c.attribute('in'), c.attribute('in2'), c.attribute('result')]),
    ).toEqual([
      ['svg:feOffset', null, null, 'fbSourceGraphic'],
      ['svg:feColorMatrix', 'fbSourceGraphic', null, 'fbSourceGraphicAlpha'],
      ['svg:feGaussianBlur', 'fbSourceGraphic', null, 'blur'],
      ['svg:feComposite', 'fbSourceGraphic', 'blur', null],
    ]);
  });
});

describe('removeFilter', () => {
  it('removes the filters of the selection in one undo step', () => {
    const { doc, item, set } = setup();
    set.set(item('b'));
    expect(removeFilter(set, null)).toBe(true);
    expect(item('b').getRepr().attribute('style') ?? '').not.toContain('filter');
    expect(doc.undoStack.undo.map((e) => e.description)).toEqual(['Remove filter']);
    set.clear();
    expect(removeFilter(set, null)).toBe(false);
  });
});
