// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/contextmenu.cpp, src/ui/tools/tool-base.cpp, src/ui/tools/pages-tool.cpp
// @vitest-environment happy-dom
import type { SPGroup } from '@inkscape-web/core';
import { Point } from '@inkscape-web/geom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ContextMenuModel, setContextMenuPresenter } from './contextmenu.ts';
import type { MenuEntry } from './desktop/menubar.ts';
import { popupRowContextMenu } from './dialog/objects.ts';
import { key, mockHitTest, setupDesktop, unmockHitTest } from './tools/tool-test-utils.ts';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="400" height="300">' +
  '<g id="layer1" inkscape:groupmode="layer" inkscape:label="Layer 1">' +
  '<g id="g"><rect id="a" x="10" y="10" width="40" height="40"/></g>' +
  '<rect id="hidden" x="100" y="100" width="40" height="40" style="display:none"/>' +
  '<rect id="locked" x="100" y="100" width="20" height="20" sodipodi:insensitive="true" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"/>' +
  '</g></svg>';

let shown: { menu: ContextMenuModel; at: Point }[] = [];
let off = () => {};
beforeEach(() => {
  shown = [];
  off = setContextMenuPresenter((menu, at) => shown.push({ menu, at }));
});
afterEach(() => {
  off();
  unmockHitTest();
});

/** The labels of the items, in menu order; a submenu as "label > child labels". */
function labels(entries: readonly MenuEntry[]): string[] {
  return entries.flatMap((e) =>
    e.kind === 'item'
      ? [e.label]
      : e.kind === 'section'
        ? labels(e.children)
        : [`${e.label} > ${labels(e.children).join(', ')}`],
  );
}

function setup(tool = 'Select') {
  const t = setupDesktop(SVG, tool);
  mockHitTest(t.doc, t.dt);
  return t;
}

const rightPress = (svg: Element, x: number, y: number) =>
  svg.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, button: 2, buttons: 2, clientX: x, clientY: y }),
  );

describe('canvas context menu', () => {
  it('right-click on the empty canvas: Paste and Document Properties, at the pointer', () => {
    const { svg } = setup();
    rightPress(svg, 300, 250);
    expect(shown).toHaveLength(1);
    const items = labels(shown[0]!.menu.entries);
    expect(items[0]).toBe('_Paste');
    expect(items).toContain('Document Properties...');
    expect(items).not.toContain('Cu_t');
    expect(shown[0]!.at).toEqual(new Point(300, 250));
  });

  it('right-click on a group selects it and offers the group items', () => {
    const { dt, svg, item } = setup();
    rightPress(svg, 20, 20);
    expect(dt.getSelection().items()).toEqual([item('g')]);
    const items = labels(shown[0]!.menu.entries);
    expect(items.slice(0, 3)).toEqual(['Cu_t', '_Copy', '_Paste']);
    expect(items).toContain('_Ungroup');
    expect(items).toContain('Enter Group #g');
    expect(items).toContain('Group to Layer');
    expect(items).toContain('_Fill and Stroke...');
    expect(items).not.toContain('Exit Group');
    expect(items).not.toContain('Unhide Objects Below Cursor');
  });

  it('unhides and unlocks the items below the cursor, each in one undo step', () => {
    const { svg, item, undoSteps } = setup();
    rightPress(svg, 110, 110);
    const { entries, ctx } = shown[0]!.menu;
    expect(labels(entries)).toEqual(
      expect.arrayContaining(['Unhide Objects Below Cursor', 'Unlock Objects Below Cursor']),
    );
    ctx.get('ctx.unhide-objects-below-cursor')!();
    expect(item('hidden').isHidden()).toBe(false);
    ctx.get('ctx.unlock-objects-below-cursor')!();
    expect(item('locked').isLocked()).toBe(false);
    expect(undoSteps().slice(-2)).toEqual(['Unhid objects', 'Unlocked objects']);
  });

  it('the Menu key and Shift+F10 show the menu of the first selected item', () => {
    const { dt, svg, item } = setup();
    dt.getSelection().set(item('g'));
    key(svg, 'ContextMenu');
    key(svg, 'F10', { shiftKey: true });
    key(svg, 'F10');
    expect(shown).toHaveLength(2);
    for (const s of shown) expect(labels(s.menu.entries)).toContain('Enter Group #g');
  });

  it('tools that use the right button do not show it', () => {
    const { svg } = setup('Zoom');
    rightPress(svg, 20, 20);
    expect(shown).toHaveLength(0);
  });
});

describe('items below the cursor', () => {
  // A hidden circle (center 100,100, radius 50), and a locked rect in a hidden group.
  const HIDDEN =
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" width="400" height="300">' +
    '<circle id="c" cx="100" cy="100" r="50" style="display:none"/>' +
    '<g id="hg" style="display:none"><rect id="r" x="250" y="50" width="40" height="40" sodipodi:insensitive="true"/></g>' +
    '</svg>';

  /** The labels of the canvas menu at (x, y). */
  function menuAt(x: number, y: number): string[] {
    const t = setupDesktop(HIDDEN, 'Select');
    // Hidden items are not drawn, so the browser finds nothing at the point.
    mockHitTest();
    shown = [];
    rightPress(t.svg, x, y);
    return labels(shown[0]!.menu.entries);
  }

  it('a hidden shape is below the cursor in its fill, not in the corner of its bounding box', () => {
    expect(menuAt(100, 100)).toContain('Unhide Objects Below Cursor');
    expect(menuAt(55, 55)).not.toContain('Unhide Objects Below Cursor');
  });

  it('a locked item in a hidden group is below the cursor', () => {
    expect(menuAt(270, 70)).toContain('Unlock Objects Below Cursor');
  });
  it('the stroke counts in the coordinates of the shape; a shape without paint is not below the cursor', () => {
    const at = (svg: string, x: number, y: number) => {
      const t = setupDesktop(
        `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="300">${svg}</svg>`,
        'Select',
      );
      mockHitTest();
      shown = [];
      rightPress(t.svg, x, y);
      return labels(shown[0]!.menu.entries).includes('Unhide Objects Below Cursor');
    };
    // The stroke is 10 wide in the path's coordinates, 100 wide on the canvas (x 450 to 550).
    const wide =
      '<path d="M 50 20 V 30" transform="scale(10,1)" style="display:none;fill:none;stroke:#000;stroke-width:10"/>';
    expect(at(wide, 530, 25)).toBe(true);
    expect(at(wide, 600, 25)).toBe(false);
    const unpainted = '<circle cx="100" cy="100" r="50" style="display:none;fill:none;stroke:none"/>';
    expect(at(unpainted, 149.5, 100)).toBe(false);
  });

  it('a hidden shape with markers is below the cursor in its bounding box, which includes the markers', () => {
    const t = setupDesktop(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><defs>' +
        '<marker id="m" markerUnits="userSpaceOnUse" markerWidth="40" markerHeight="40" refX="0" refY="0" overflow="visible">' +
        '<rect width="40" height="40"/></marker></defs>' +
        '<path d="M 10 50 H 100" style="display:none;fill:none;stroke:#000;stroke-width:2;marker-end:url(#m)"/></svg>',
      'Select',
    );
    mockHitTest();
    rightPress(t.svg, 120, 70);
    expect(labels(shown[0]!.menu.entries)).toContain('Unhide Objects Below Cursor');
  });
});

describe('page context menu', () => {
  it('right-click on a page in the pages tool selects the page and shows the page items', () => {
    const t = setupDesktop(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="400" height="300">' +
        '<sodipodi:namedview xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd">' +
        '<inkscape:page id="p1" x="0" y="0" width="100" height="100"/>' +
        '<inkscape:page id="p2" x="200" y="0" width="100" height="100"/>' +
        '</sodipodi:namedview></svg>',
      'Pages',
    );
    mockHitTest(t.doc, t.dt);
    rightPress(t.dt.getCanvas().svg, 250, 50);
    expect(t.doc.getPageManager().getSelected()?.getId()).toBe('p2');
    expect(labels(shown[0]!.menu.entries)).toEqual([
      '_New Page',
      'Duplicate Page',
      '_Delete Page',
      'Move Page _Backward',
      'Move Page _Forward',
    ]);
  });
});

describe('Layers and Objects context menu', () => {
  it('a layer row makes the layer current and shows the layer items, without "Layers and Objects..."', () => {
    const { dt, item } = setup();
    const layer = item('layer1') as SPGroup;
    popupRowContextMenu(dt, layer, new Point(5, 5));
    expect(dt.layerManager().currentLayer()).toBe(layer);
    const items = labels(shown[0]!.menu.entries);
    expect(items[0]).toBe('_Add Layer...');
    expect(items).toContain('_Unlock All Layers');
    expect(items).not.toContain('Layers and Objects...');
  });

  it('an item row selects the item; its menu has no "Layers and Objects..."', () => {
    const { dt, item } = setup();
    popupRowContextMenu(dt, item('a'), new Point(5, 5));
    expect(dt.getSelection().items()).toEqual([item('a')]);
    const items = labels(shown[0]!.menu.entries);
    expect(items).toContain('_Object Properties...');
    expect(items).toContain('Exit Group');
    expect(items).not.toContain('Layers and Objects...');
  });

  it('Ctrl+right-click on an item row adds it to the selection', () => {
    const { dt, item } = setup();
    dt.getSelection().set(item('hidden'));
    popupRowContextMenu(dt, item('a'), new Point(5, 5), true);
    expect(dt.getSelection().items()).toEqual([item('hidden'), item('a')]);
  });
});
