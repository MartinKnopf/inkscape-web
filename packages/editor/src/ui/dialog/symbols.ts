// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/symbols.cpp, src/ui/dialog/symbols.h
/*
 * Symbols dialog: the logic behind the widgets.
 *
 * Authors:
 *   Tavmjong Bah, Martin Owens
 *
 * Copyright (C) 2012 Tavmjong Bah
 *               2013 Martin Owens
 *               2017 Jabiertxo Arraiza
 */
import {
  _,
  C_,
  DocumentUndo,
  type Node,
  type SPDocument,
  type SPObject,
  SPSymbol,
  SPUse,
  sp_repr_lookup_name_many,
  writeBuf,
} from '@inkscape-web/core';
import { Point, Rect } from '@inkscape-web/geom';
import type { SPDesktop } from '../../desktop.ts';
import { ClipboardManager } from '../clipboard.ts';

/** The id of the set of the symbols of the document (upstream CURRENT_DOC_ID). */
export const CURRENT_DOC_ID = '{?cur-doc?}';
/** The id of the set of the symbols of all symbol sets (upstream ALL_SETS_ID). */
export const ALL_SETS_ID = '{?all-sets?}';

/** A symbol in the list of the dialog (upstream SymbolItem). */
export interface SymbolItem {
  /** The set and the id, which is unique over all sets. */
  uniqueKey: string;
  symbolId: string;
  /** The title and the name of the symbol set, for the tooltip. */
  symbolTitle: string;
  /** The title, shown below the preview, and searched. */
  label: string;
  /** The size of the symbol in px. */
  dimensions: Point;
  /** The document that holds the symbol; null for the document of the dialog. */
  document: SPDocument | null;
  /** The title of the symbol set (for ids in the clipboard). */
  setTitle: string;
}

/** Add to symbols the symbols in the tree of object (upstream collect_symbols). A use hides its tree. */
export function collectSymbols(object: SPObject | null, symbols: SPSymbol[] = []): SPSymbol[] {
  if (!object) return symbols;
  if (object instanceof SPSymbol) symbols.push(object);
  if (object instanceof SPUse) return symbols;
  for (const child of object.children) collectSymbols(child, symbols);
  return symbols;
}

/** The symbol as an item of the list (upstream SymbolsDialog::addSymbol). */
export function symbolItem(symbol: SPSymbol, setTitle: string, document: SPDocument | null): SymbolItem {
  const id = symbol.getId() ?? '';
  const title = symbol.title();
  const shortTitle = title ? C_('Symbol', title) : id;
  // Default to 64x64 px if the size is not available.
  const rect = symbol.documentVisualBounds();
  const dimensions = rect ? rect.dimensions() : new Point(64, 64);
  return {
    uniqueKey: `${symbol.document.documentName ?? 'noname'}\n${id}`,
    symbolId: id,
    symbolTitle: `${shortTitle} (${setTitle})`,
    label: shortTitle,
    dimensions,
    document,
    setTitle,
  };
}

/** Whether the item passes the search text (upstream is_item_visible). */
export function symbolMatches(item: SymbolItem, search: string): boolean {
  return search === '' || item.label.toLowerCase().includes(search.toLowerCase());
}

/**
 * The title of a symbol set document: the svg:title of its root, else
 * the file name without extension (upstream scan_all_symbol_sets).
 */
export function symbolSetTitle(doc: SPDocument, filename: string): string {
  const title = sp_repr_lookup_name_many(doc.getReprRoot(), 'svg:title')[0];
  const text = title?.firstChild()?.content();
  if (text) return C_('Symbol', text);
  const name = filename.slice(filename.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return (dot > 0 ? name.slice(0, dot) : name) || _('Unnamed Symbols');
}

/** The first style of a use that references id (upstream styleFromUse: a last ditch effort to find a style). */
function styleFromUse(id: string, doc: SPDocument): string | null {
  let found: string | null = null;
  const walk = (o: SPObject) => {
    if (found !== null) return;
    if (o instanceof SPUse) {
      const href = o.getRepr().attribute('href') ?? o.getRepr().attribute('xlink:href');
      const style = o.getRepr().attribute('style');
      if (href === `#${id}` && style !== null) found = style;
    }
    for (const c of o.children) walk(c);
  };
  walk(doc.getRoot());
  return found;
}

/** Copy the symbol to the clipboard document (upstream sendToClipboard). */
export function symbolToClipboard(
  desktop: SPDesktop,
  item: SymbolItem,
  bbox: Rect,
  setClipboard: boolean,
): Promise<void> {
  if (!item.symbolId) return Promise.resolve();
  // A symbol of the current document, or of a symbol set.
  const symbolDocument = item.document ?? desktop.getDocument();
  const symbol = symbolDocument.getObjectById(item.symbolId);
  if (!symbol) return Promise.resolve();
  // First look for the default style stored in the symbol.
  let style = symbol.getAttribute('inkscape:symbol-style');
  if (style === null) {
    // If there is no default style in the symbol, look in the documents.
    style =
      symbolDocument === desktop.getDocument()
        ? styleFromUse(item.symbolId, symbolDocument)
        : symbolDocument.getReprRoot().attribute('style');
  }
  return ClipboardManager.get().copySymbol(
    symbol.getRepr(),
    style,
    symbolDocument,
    item.document ? item.setTitle : null,
    bbox,
    setClipboard,
  );
}

/**
 * Insert a use of the symbol into the document, in the middle of the visible
 * area (upstream: the drop of a symbol; the symbol is copied into the defs as
 * pasting does). The new use is selected. One undo step "Paste".
 */
export async function insertSymbolInDocument(
  desktop: SPDesktop,
  item: SymbolItem,
  where: Point = desktop.current_center(),
): Promise<void> {
  const half = item.dimensions.mul(0.5);
  await symbolToClipboard(desktop, item, new Rect(half.neg(), half), false);
  ClipboardManager.get().insertSymbol(desktop, where);
  DocumentUndo.done(desktop.getDocument(), C_('Undo', 'Paste'), 'edit-paste');
}

/** Convert the selected symbol to a group (upstream revertSymbol). */
export function revertSymbol(desktop: SPDesktop, item: SymbolItem): void {
  const doc = desktop.getDocument();
  const symbol = doc.getObjectById(item.symbolId);
  if (symbol instanceof SPSymbol) {
    symbol.unSymbol();
    DocumentUndo.done(doc, C_('Undo', 'Group from symbol'), '');
  }
}

/**
 * The SVG of a preview of the symbol: the symbol with the defs it uses and a
 * use that scales it to its size (upstream drawSymbol, which renders a preview
 * document). Standalone, so it renders as an image without leaking into the page.
 */
export function symbolPreviewSvg(symbol: SPSymbol): string {
  const doc = symbol.document;
  const repr = symbol.getRepr();
  const dims = symbol.documentVisualBounds()?.dimensions() ?? new Point(64, 64);
  const vb = symbol.vb.viewBox_set ? symbol.vb.viewBox : null;
  const w = vb ? vb.width() : dims.x;
  const h = vb ? vb.height() : dims.y;
  // The defs that the symbol uses, and the defs they use.
  const used = new Map<string, Node>();
  const scan = (node: Node) => {
    const text = [...node.attributeList().map(([, v]) => v)].join(' ');
    for (const m of text.matchAll(/url\(\s*['"]?#([^'")]+)['"]?\s*\)|^#([^\s]+)$/gm)) {
      const id = m[1] ?? m[2];
      if (!id || used.has(id)) continue;
      const target = doc.getObjectById(id)?.getRepr();
      if (target && target !== repr) {
        used.set(id, target);
        scan(target);
        for (let c = target.firstChild(); c; c = c.next()) if (c.type() === 'element') scanTree(c);
      }
    }
    const href = node.attribute('href') ?? node.attribute('xlink:href');
    if (href?.startsWith('#') && !used.has(href.slice(1))) {
      const target = doc.getObjectById(href.slice(1))?.getRepr();
      if (target && target !== repr) {
        used.set(href.slice(1), target);
        scanTree(target);
      }
    }
  };
  const scanTree = (node: Node) => {
    scan(node);
    for (let c = node.firstChild(); c; c = c.next()) if (c.type() === 'element') scanTree(c);
  };
  scanTree(repr);
  const serialize = (n: Node) => writeBuf(n);
  const rootStyle = doc.getReprRoot().attribute('style');
  const style = rootStyle ? ` style="${escapeAttr(rootStyle)}"` : '';
  const x = vb ? 0 : (symbol.documentVisualBounds()?.left() ?? 0);
  const y = vb ? 0 : (symbol.documentVisualBounds()?.top() ?? 0);
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="http://www.w3.org/2000/svg" ' +
    'xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:cc="http://creativecommons.org/ns#" ' +
    'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" ' +
    `width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}"${style}>` +
    `<defs>${[...used.values()].map(serialize).join('')}${serialize(repr)}</defs>` +
    `<use xlink:href="#${escapeAttr(symbol.getId() ?? '')}"${vb ? ` width="${w}" height="${h}"` : ''}/></svg>`
  );
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
