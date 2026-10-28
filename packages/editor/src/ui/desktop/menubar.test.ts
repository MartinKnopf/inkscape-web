// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/desktop/menubar.cpp
import { describe, expect, it } from 'vitest';
import { build_menu, parse_mnemonic } from './menubar.ts';

const MENUS = `<?xml version="1.0" encoding="UTF-8"?>
<interface>
  <requires lib="gtk" version="4.0"/>
  <menu id="menus">
    <submenu id="file-menu">
      <attribute name="label" translatable="yes">_File</attribute>
      <section>
        <item>
          <attribute name="label" translatable="yes">_New</attribute>
          <attribute name="action">app.document-new</attribute>
          <attribute name="icon">document-new</attribute>
        </item>
      </section>
      <submenu id="recent-files">
        <attribute name="label" translatable="yes">Open _Recent</attribute>
      </submenu>
      <section>
        <item>
          <attribute name="label" translatable="yes">_Export...</attribute>
          <attribute name="action">win.dialog-open</attribute>
          <attribute name="target">Export</attribute>
        </item>
        <item>
          <attribute name="label" translatable="yes">_Outline</attribute>
          <attribute name="action">win.canvas-display-mode</attribute>
          <attribute name="target" type="i">1</attribute>
        </item>
      </section>
    </submenu>
  </menu>
</interface>`;

describe('build_menu', () => {
  it('builds submenus, sections and items with detailed action names', () => {
    expect(build_menu(MENUS)).toEqual([
      {
        kind: 'submenu',
        id: 'file-menu',
        label: '_File',
        children: [
          {
            kind: 'section',
            id: null,
            children: [{ kind: 'item', label: '_New', action: 'app.document-new', icon: 'document-new' }],
          },
          { kind: 'submenu', id: 'recent-files', label: 'Open _Recent', children: [] },
          {
            kind: 'section',
            id: null,
            children: [
              { kind: 'item', label: '_Export...', action: "win.dialog-open('Export')", icon: null },
              { kind: 'item', label: '_Outline', action: 'win.canvas-display-mode(1)', icon: null },
            ],
          },
        ],
      },
    ]);
    expect(build_menu('<not xml')).toEqual([]);
  });
});

describe('parse_mnemonic', () => {
  it('removes the mnemonic marker and keeps literal underscores', () => {
    expect(parse_mnemonic('Save _As...')).toEqual({ text: 'Save As...', mnemonic: 5 });
    expect(parse_mnemonic('Filter_s')).toEqual({ text: 'Filters', mnemonic: 6 });
    expect(parse_mnemonic('a__b')).toEqual({ text: 'a_b', mnemonic: -1 });
  });
});
