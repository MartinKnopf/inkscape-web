// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/clipboard.cpp
// @vitest-environment happy-dom
import {
  SPDocument,
  SPImage,
  SPItem,
  SPRect,
  SPUse,
  sp_repr_lookup_descendant,
  sp_repr_lookup_name,
} from '@inkscape-web/core';
import { afterEach, describe, expect, it } from 'vitest';
import { sp_selection_paste } from '../actions/actions-edit-window.ts';
import { SPDesktop } from '../desktop.ts';
import { InkscapeApplication } from '../inkscape-application.ts';
import { type ClipboardItemLike, ClipboardManager, type SystemClipboard } from './clipboard.ts';
import { Canvas } from './widget/canvas.ts';

SPDocument.scheduleIdle = () => {};

/** A system clipboard in memory; denied makes every access fail like a denied permission. */
class FakeClipboard implements SystemClipboard {
  data: Record<string, Blob> | null = null;
  denied = false;
  async read(): Promise<ClipboardItemLike[]> {
    if (this.denied) throw new DOMException('denied', 'NotAllowedError');
    const data = this.data;
    if (!data) return [];
    return [{ types: Object.keys(data), getType: async (type) => data[type] as Blob }];
  }
  async write(data: Record<string, Blob>): Promise<void> {
    if (this.denied) throw new DOMException('denied', 'NotAllowedError');
    this.data = data;
  }
}

const NS =
  'xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ' +
  'xmlns:xlink="http://www.w3.org/1999/xlink"';
// The layer is moved by (10, 20); no viewBox, so document = desktop coordinates.
const SVG =
  `<svg ${NS} width="400" height="300">` +
  '<defs><linearGradient id="grad"><stop offset="0" style="stop-color:#f00"/></linearGradient></defs>' +
  '<g id="layer1" inkscape:groupmode="layer" transform="translate(10,20)">' +
  '<rect id="r" width="10" height="10" style="fill:url(#grad)"/>' +
  '<rect id="blue" x="50" width="4" height="4" style="fill:#0000ff"/>' +
  '<use id="u" xlink:href="#r" x="100"/>' +
  '</g></svg>';

const clipboard = new FakeClipboard();
ClipboardManager.get().system = clipboard;

function setup() {
  const doc = SPDocument.createNewDocFromMem(SVG);
  if (!doc) throw new Error('parse failed');
  const host = document.createElement('div');
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const dt = new SPDesktop(new Canvas(host), doc);
  InkscapeApplication.instance().set_active_desktop(dt);
  const item = (id: string) => doc.getObjectById(id) as SPItem;
  const layerItems = () => (doc.getObjectById('layer1')?.children ?? []).filter((c) => c instanceof SPItem);
  const undoSteps = () => doc.undoStack.undo.map((e) => e.description);
  return { doc, dt, item, layerItems, undoSteps };
}

afterEach(() => {
  clipboard.data = null;
  clipboard.denied = false;
  InkscapeApplication.instance().set_active_desktop(null);
});

describe('copy', () => {
  it('writes a clipboard document with the items, their defs and the bounds', async () => {
    const { dt, item } = setup();
    dt.getSelection().set(item('r'));
    await ClipboardManager.get().copy(dt.getSelection());

    const text = await clipboard.data?.['text/plain']?.text();
    expect(await clipboard.data?.['image/svg+xml']?.text()).toBe(text);
    const clipdoc = SPDocument.createNewDocFromMem(text ?? '');
    if (!clipdoc) throw new Error('clipboard is no SVG');
    const root = clipdoc.getReprRoot();
    // One group per parent, with the parent transform; the page is fitted to the items.
    const group = [...root.children()].find((c) => c.name() === 'svg:g');
    expect(group?.attribute('id')).toBe('layer1');
    expect(group?.firstChild()?.attribute('id')).toBe('r');
    expect(root.attribute('width')).toBe('10');
    expect(sp_repr_lookup_name(root, 'svg:linearGradient')?.attribute('id')).toBe('grad');
    const clipnode = sp_repr_lookup_name(root, 'inkscape:clipboard');
    expect(clipnode?.attribute('min')).toBe('10,20');
    expect(clipnode?.attribute('max')).toBe('20,30');
    expect(clipnode?.attribute('style')).toContain('fill:url(#grad)');
  });

  it('puts the original of a copied clone into the clipboard node', async () => {
    const { dt, item } = setup();
    dt.getSelection().set(item('u'));
    await ClipboardManager.get().copy(dt.getSelection());
    const root = ClipboardManager.get().document()?.getReprRoot();
    const clipnode = root && sp_repr_lookup_name(root, 'inkscape:clipboard');
    expect(clipnode?.firstChild()?.attribute('id')).toBe('r');
  });
});

describe('paste', () => {
  it('pastes in place with new ids and the undo step "Paste"', async () => {
    const { doc, dt, item, layerItems, undoSteps } = setup();
    dt.getSelection().set(item('r'));
    await ClipboardManager.get().copy(dt.getSelection());
    await sp_selection_paste(dt, true);

    const pasted = dt.getSelection().singleItem();
    expect(pasted).toBeInstanceOf(SPRect);
    expect(pasted?.getId()).not.toBe('r');
    expect(pasted?.parent?.getId()).toBe('layer1');
    expect(pasted?.documentVisualBounds()?.min().x).toBeCloseTo(10);
    expect(pasted?.documentVisualBounds()?.min().y).toBeCloseTo(20);
    expect(layerItems()).toHaveLength(4);
    expect(undoSteps().at(-1)).toBe('Paste');
    // The gradient is pasted with a new id, and the copy uses it.
    const gradId = /url\(#([^)]+)\)/.exec(pasted?.getAttribute('style') ?? '')?.[1];
    expect(gradId).toMatch(/^grad-\d+$/);
    expect(sp_repr_lookup_descendant(doc.getReprRoot(), 'id', gradId ?? null)?.name()).toBe(
      'svg:linearGradient',
    );
  });

  it('pastes at the pointer', async () => {
    const { dt, item } = setup();
    dt.getSelection().set(item('blue'));
    await ClipboardManager.get().copy(dt.getSelection());
    await sp_selection_paste(dt, false);
    const center = dt.getSelection().singleItem()?.desktopVisualBounds()?.midpoint();
    expect(center?.x).toBeCloseTo(dt.point().x);
    expect(center?.y).toBeCloseTo(dt.point().y);
  });

  it('pastes a clone without its original as a clone of the existing original', async () => {
    const { doc, dt, item, layerItems } = setup();
    dt.getSelection().set(item('u'));
    await ClipboardManager.get().copy(dt.getSelection());
    await sp_selection_paste(dt, true);
    const pasted = dt.getSelection().singleItem();
    expect(pasted).toBeInstanceOf(SPUse);
    expect((pasted as SPUse).get_original()).toBe(doc.getObjectById('r'));
    expect(layerItems()).toHaveLength(4);
  });

  it('pastes a clone with its original as a new pair', async () => {
    const { doc, dt, item } = setup();
    dt.getSelection().setList([item('r'), item('u')]);
    await ClipboardManager.get().copy(dt.getSelection());
    await sp_selection_paste(dt, true);
    const pasted = dt.getSelection().items();
    const use = pasted.find((i) => i instanceof SPUse) as SPUse;
    const rect = pasted.find((i) => i instanceof SPRect);
    expect(use.get_original()).toBe(rect);
    expect(rect).not.toBe(doc.getObjectById('r'));
  });

  it('keeps the clipboard in memory when the access is denied', async () => {
    const { dt, item, layerItems } = setup();
    clipboard.denied = true;
    dt.getSelection().set(item('blue'));
    await ClipboardManager.get().copy(dt.getSelection());
    await sp_selection_paste(dt, true);
    expect(layerItems()).toHaveLength(4);
  });

  it('pastes SVG from another application', async () => {
    const { dt, layerItems } = setup();
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><circle id="c" r="5"/><rect id="r" width="1" height="1"/></svg>';
    clipboard.data = { 'image/svg+xml': new Blob([svg]), 'text/plain': new Blob([svg]) };
    await sp_selection_paste(dt, false);
    expect(layerItems()).toHaveLength(5);
    expect(dt.getSelection().size()).toBe(2);
  });

  it('pastes a PNG as an embedded image', async () => {
    const { dt } = setup();
    const png = new Uint8Array(33);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(png.buffer).setUint32(16, 30);
    new DataView(png.buffer).setUint32(20, 20);
    clipboard.data = { 'image/png': new Blob([png], { type: 'image/png' }) };
    await sp_selection_paste(dt, false);
    const image = dt.getSelection().singleItem();
    expect(image).toBeInstanceOf(SPImage);
    expect(image?.getAttribute('xlink:href')?.startsWith('data:image/png;base64,')).toBe(true);
    expect(image?.documentVisualBounds()?.width()).toBeCloseTo(30);
  });

  it('pastes a color text as the fill of the selection', async () => {
    const { dt, item } = setup();
    clipboard.data = { 'text/plain': new Blob(['#00ff00']) };
    dt.getSelection().set(item('r'));
    await sp_selection_paste(dt, false);
    expect(item('r').getRepr().attribute('style')).toContain('fill:#00ff00');
  });
});

describe('paste style and size', () => {
  it('applies the copied style with the undo step "Paste style"', async () => {
    const { doc, dt, item, undoSteps } = setup();
    dt.getSelection().set(item('blue'));
    await ClipboardManager.get().copy(dt.getSelection());
    dt.getSelection().set(item('r'));
    InkscapeApplication.instance().activate_action('app.paste-style');
    await new Promise((r) => setTimeout(r, 0));
    doc.ensureUpToDate();
    expect(item('r').getRepr().attribute('style')).toContain('fill:#0000ff');
    expect(undoSteps().at(-1)).toBe('Paste style');
  });

  it('scales the selection to the copied size', async () => {
    const { doc, dt, item } = setup();
    dt.getSelection().set(item('blue'));
    await ClipboardManager.get().copy(dt.getSelection());
    dt.getSelection().set(item('r'));
    await ClipboardManager.get().pasteSize(dt.getSelection(), false, true, true);
    doc.ensureUpToDate();
    expect(item('r').documentVisualBounds()?.width()).toBeCloseTo(4);
    expect(item('r').documentVisualBounds()?.height()).toBeCloseTo(4);
  });
});
