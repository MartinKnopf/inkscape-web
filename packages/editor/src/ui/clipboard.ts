// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/clipboard.cpp, src/ui/clipboard.h
/*
 * System-wide clipboard management - implementation.
 *
 * Authors:
 * see git history
 *   Krzysztof Kosiński <tweenk@o2.pl>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Incorporates some code from selection-chemistry.cpp, see that file for more credits.
 *   Abhishek Sharma
 *   Tavmjong Bah
 *
 * Copyright (C) 2018 Authors
 */
import {
  BBoxType,
  Colors,
  gdkpixbuf_input_open,
  type ObjectSet,
  Preferences,
  type SPCSSAttr,
  SPDocument,
  SPGroup,
  SPItem,
  type SPObject,
  SPSymbol,
  SPUse,
  SPViewBox,
  SVG_NS_URI,
  sanitize_id,
  saveBuf,
  sp_object_compare_position,
  sp_repr_lookup_descendant,
  sp_repr_lookup_name,
  sp_svg_transform_write,
  spReprCssAttr,
  spReprCssAttrInherited,
  spReprCssAttrNew,
  spReprCssSet,
  spReprCssSetPropertyDouble,
  spReprCssSetPropertyString,
  type XmlDocument,
  type Node as XmlNode,
} from '@inkscape-web/core';
import { type Point, type Rect, Scale } from '@inkscape-web/geom';
import { have_viable_layer } from '../context-fns.ts';
import type { SPDesktop } from '../desktop.ts';
import { sp_desktop_set_style } from '../desktop-style.ts';
import { file_import, sp_import_document } from '../file.ts';
import { take_style_from_item } from '../selection-chemistry.ts';

/** The representations of one clipboard entry (the part of the browser's ClipboardItem that we use). */
export interface ClipboardItemLike {
  readonly types: readonly string[];
  getType(type: string): Promise<Blob>;
}

/**
 * The system clipboard (the part of navigator.clipboard that we use). Both
 * methods reject when the browser denies the access.
 */
export interface SystemClipboard {
  read(): Promise<readonly ClipboardItemLike[]>;
  /** Write one entry with a representation per MIME type. */
  write(data: Record<string, Blob>): Promise<void>;
}

/** The async Clipboard API of the browser, or null if there is none. */
export function browserClipboard(): SystemClipboard | null {
  if (typeof navigator === 'undefined' || !navigator.clipboard || typeof ClipboardItem === 'undefined')
    return null;
  const clipboard = navigator.clipboard;
  return {
    read: () => clipboard.read(),
    write: (data) => {
      // Write only the types the browser supports (image/svg+xml is newer than text/plain).
      const supported = Object.entries(data).filter(([type]) => ClipboardItem.supports?.(type) ?? true);
      return clipboard.write([new ClipboardItem(Object.fromEntries(supported))]);
    },
  };
}

const CLIPBOARD_TEXT_TARGET = 'text/plain';

/** The target for the clipboard document that we wrote ourselves (upstream: is_local). */
const CLIPBOARD_LOCAL_TARGET = 'image/x-inkscape-svg';

/** List of supported clipboard targets, in order of preference. */
const preferred_targets = ['image/svg+xml'];

/** Bitmap targets; upstream gets them through GdkTexture. */
const image_targets = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/** An empty document for the clipboard (upstream SPDocument::createNewDoc(nullptr)). */
const EMPTY_DOC =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ' +
  'xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns:xlink="http://www.w3.org/1999/xlink"/>';

/** The content read from the system clipboard: MIME type → data. */
type ClipboardContent = Map<string, Blob>;

/**
 * The clipboard (upstream ClipboardManagerImpl). Copy builds a clipboard
 * document with the copied items and the defs they need, and writes it to
 * the system clipboard as image/svg+xml and text/plain. Paste reads the
 * system clipboard: our own document, SVG from other applications, bitmaps
 * (pasted as embedded images) or text (pasted as a color).
 *
 * When the browser denies the clipboard access, the clipboard document is
 * kept in memory only, and paste uses it.
 *
 * The browser clipboard is asynchronous, so the paste methods return
 * promises; the actions add the undo steps when they resolve.
 * TODO: gradient dragger and dropper colors, text tool, copying and pasting
 * nodes (node tool), path effects, symbols, PNG output, EMF/PDF targets,
 * pasting on page.
 */
export class ClipboardManager {
  static #instance: ClipboardManager | null = null;

  /** The application clipboard manager. */
  static get(): ClipboardManager {
    ClipboardManager.#instance ??= new ClipboardManager();
    return ClipboardManager.#instance;
  }

  /** The system clipboard, replaceable for tests. */
  system: SystemClipboard | null = browserClipboard();

  /** Document that stores the clipboard until someone requests it */
  #clipboardSPDoc: SPDocument | null = null;
  /** Reference to the clipboard document's defs node */
  #defs: XmlNode | null = null;
  /** Reference to the clipboard's root node */
  #root: XmlNode | null = null;
  /** The node that holds extra information */
  #clipnode: XmlNode | null = null;
  /** Reference to the clipboard's XML document */
  #doc: XmlDocument | null = null;
  #cloned_elements = new Set<SPItem>();
  /** Style copied along with plain text fragment */
  #text_style: SPCSSAttr | null = null;
  /** The text that we wrote to the system clipboard last, to recognize our own content. */
  #written_text: string | null = null;
  /** The last write to the system clipboard; reads wait for it. */
  #writing: Promise<void> = Promise.resolve();

  /** The clipboard document, if there is one (for tests and Relink to Copied). */
  document(): SPDocument | null {
    return this.#clipboardSPDoc;
  }

  /** Copy selection contents to the clipboard. */
  copy(set: ObjectSet): Promise<void> {
    if (set.desktop()) {
      // TODO: special cases for the gradient dragger, the dropper, the text tool and node copying.
      if (set.isEmpty()) {
        // check whether something is selected
        this.#userWarn('Nothing was copied.');
        return Promise.resolve();
      }
    }
    this.#createInternalClipboard(); // construct a new clipboard document
    this.#copySelection(set); // copy all items in the selection to the internal clipboard
    return this.#setClipboardTargets();
  }

  /**
   * Copy a symbol to the clipboard document, as a symbol in the defs and a use of it.
   * Upstream: ClipboardManagerImpl::copySymbol.
   *
   * @param symbol The symbol repr, in source.
   * @param style The style for the use (the default style of the symbol).
   * @param symbol_set The name of the symbol set, to tell the symbols of different sets apart.
   * @param bbox The bounding box of the symbol on the page, in desktop coordinates.
   * @param set_clipboard Whether to write the clipboard document to the system clipboard.
   * TODO: scaling for documents with a viewBox scale other than 1.
   */
  copySymbol(
    symbol: XmlNode,
    style: string | null,
    source: SPDocument,
    symbol_set: string | null,
    bbox: Rect,
    set_clipboard: boolean,
  ): Promise<void> {
    this.#createInternalClipboard();
    const doc = this.#doc;
    const defs = this.#defs;
    const root = this.#root;
    const clipnode = this.#clipnode;
    const clipdoc = this.#clipboardSPDoc;
    if (!doc || !defs || !root || !clipnode || !clipdoc) return Promise.resolve();

    // We add "_inkscape_duplicate" to have a well defined symbol name that bypasses the
    // prevent_id_clashes routine. SPDocument.importDefs() removes it when the symbol is pasted.
    const original = source.getObjectByRepr(symbol);
    if (original instanceof SPItem) {
      this.#cloned_elements.clear();
      this.#copyUsedDefs(original);
    }
    const repr = symbol.duplicate(doc);
    // Disambiguate the symbols of different symbol sets.
    const prefix = symbol_set ? `${sanitize_id(`${symbol_set}:`)}` : '';
    const symbol_name = `${prefix}${symbol.attribute('id')}_inkscape_duplicate`;
    repr.setAttribute('id', symbol_name);
    defs.appendChild(repr);

    const nsymbol = clipdoc.getObjectById(symbol_name);
    if (nsymbol instanceof SPSymbol) {
      if (original instanceof SPItem) this.#copyCompleteStyle(original, repr, true);
      if (nsymbol.title() === null) nsymbol.setTitle(nsymbol.label() ?? nsymbol.getId());
      const href = `#${symbol_name.replace('_inkscape_duplicate', '')}`;
      const use_repr = doc.createElement('svg:use');
      use_repr.setAttribute('xlink:href', href);

      // If the symbol has a viewBox but no width or height, then take the width and height from the
      // viewBox and set them on the use. Otherwise, the use would have 100% of the document width
      // and height.
      const viewBoxAttr = symbol.attribute('viewBox');
      if (viewBoxAttr && !(symbol.attribute('height') || symbol.attribute('width'))) {
        const vb = new SPViewBox();
        vb.set_viewBox(viewBoxAttr);
        if (vb.viewBox_set) {
          use_repr.setAttributeSvgDouble('width', vb.viewBox.width());
          use_repr.setAttributeSvgDouble('height', vb.viewBox.height());
        }
      }
      // Set a default style in the use rather than the symbol, so it can be changed.
      use_repr.setAttribute('style', style);
      root.appendChild(use_repr);

      // Set min and max offsets based on the bounding rectangle.
      clipnode.setAttributePoint('min', bbox.min());
      clipnode.setAttributePoint('max', bbox.max());
    }
    return set_clipboard ? this.#setClipboardTargets() : Promise.resolve();
  }

  /**
   * Insert the symbol of copySymbol() into the document of desktop (upstream
   * insertSymbol, for the end of a drag) shifted by shift_dt, in desktop coordinates.
   */
  insertSymbol(desktop: SPDesktop, shift_dt: Point): void {
    if (!have_viable_layer(desktop)) return;
    const symbol = this.#clipboardSPDoc;
    if (!symbol) return;
    // Synthesize a clipboard position in order to paste the symbol where it got dropped.
    const clipnode = sp_repr_lookup_name(symbol.getReprRoot(), 'inkscape:clipboard', 1);
    if (clipnode) {
      clipnode.setAttributePoint('min', clipnode.getAttributePoint('min').add(shift_dt));
      clipnode.setAttributePoint('max', clipnode.getAttributePoint('max').add(shift_dt));
    }
    sp_import_document(desktop, symbol, true);
  }

  /**
   * Paste from the system clipboard into the desktop.
   * @param in_place Whether to put the contents where they were when copied.
   * @returns whether something was pasted.
   */
  async paste(desktop: SPDesktop, in_place: boolean, on_page = false): Promise<boolean> {
    // do any checking whether we really are able to paste before requesting the contents
    if (!have_viable_layer(desktop)) return false;

    const content = await this.#readSystem();
    const target = await this.#getBestTargetAsync(content);

    // Special cases of clipboard content handling go here
    // if there is an image on the clipboard, paste it
    if (!on_page && content && image_targets.includes(target)) {
      return this.#pasteImage(desktop, content.get(target));
    }
    let text: string | null = null;
    if (!on_page && content && target === CLIPBOARD_TEXT_TARGET) {
      text = (await content.get(target)?.text()) ?? null;
      // It was text, and we did paste it. If not, continue on.
      if (text !== null && this.#pasteText(desktop, text)) return true;
      // If the clipboard contains text/plain, but is an svg document
      // then we'll try and detect it and then paste it if possible.
    }

    await this.#retrieveClipboard(content, target);
    const tempdoc = this.#clipboardSPDoc;
    if (!tempdoc) {
      this.#userWarn(
        target === CLIPBOARD_TEXT_TARGET
          ? "Can't paste text outside of the text tool."
          : 'Nothing on the clipboard.',
      );
      return false;
    }

    // TODO: _pasteNodes (node tool).

    // copy definitions
    sp_import_document(desktop, tempdoc, in_place, on_page);

    // _copySelection() has put all items in groups, now ungroup them (preserves transform
    // relationships of clones, text-on-path, etc.)
    if (target === CLIPBOARD_LOCAL_TARGET) {
      const selection = desktop.getSelection();
      selection.ungroup(true);
      const vec2 = selection.items();
      for (const item of vec2) {
        // just a bit beauty on paste hidden items unselect
        if (vec2.length > 1 && item.isHidden()) selection.remove(item);
      }
    }
    return true;
  }

  /** Implements the Paste Style action. Returns whether a style was pasted. */
  async pasteStyle(desktop: SPDesktop): Promise<boolean> {
    const set = desktop.getSelection();
    // check whether something is selected
    if (set.isEmpty()) {
      this.#userWarn('Select object(s) to paste style to.');
      return false;
    }

    await this.#retrieveDocument();
    const tempdoc = this.#clipboardSPDoc;
    if (!tempdoc) {
      // no document, but we can try _text_style
      if (this.#text_style) {
        this.#cleanStyle(this.#text_style);
        sp_desktop_set_style(desktop, this.#text_style);
        return true;
      }
      this.#userWarn('No style on the clipboard.');
      return false;
    }

    const copy_computed = Preferences.get().getBool('/options/copycomputedstyle/value', true);
    const clipnode = sp_repr_lookup_name(tempdoc.getReprRoot(), 'inkscape:clipboard', 1);
    if (!clipnode) {
      this.#userWarn('No style on the clipboard.');
      return false;
    }

    let pasted = false;
    if (copy_computed) {
      sp_desktop_set_style(desktop, spReprCssAttr(clipnode, 'style'));
      pasted = true;
    } else {
      for (const node of set.xmlNodes()) {
        for (const name of ['class', 'style']) {
          const value = clipnode.attribute(name);
          if (value === null) continue;
          node.setAttribute(name, value);
          pasted = true;
        }
      }
    }

    // pasted style might depend on defs from the source
    if (pasted) set.document()?.importDefs(tempdoc);
    return pasted;
  }

  /**
   * Resize the selection or each object in the selection to match the clipboard's size.
   * @param separately Whether to scale each object in the selection separately
   * @param apply_x Whether to scale the width of objects / selection
   * @param apply_y Whether to scale the height of objects / selection
   */
  async pasteSize(set: ObjectSet, separately: boolean, apply_x: boolean, apply_y: boolean): Promise<boolean> {
    if (!apply_x && !apply_y) return false; // pointless parameters
    if (set.isEmpty()) {
      this.#userWarn('Select object(s) to paste size to.');
      return false;
    }

    // FIXME: actually, this should accept arbitrary documents
    await this.#retrieveDocument();
    const tempdoc = this.#clipboardSPDoc;
    if (!tempdoc) {
      this.#userWarn('No size on the clipboard.');
      return false;
    }

    // retrieve size information from the clipboard
    const clipnode = sp_repr_lookup_name(tempdoc.getReprRoot(), 'inkscape:clipboard', 1);
    if (!clipnode) return false;

    const visual_bbox = !Preferences.get().getInt('/tools/bounding_box');
    const min = clipnode.getAttributePoint(visual_bbox ? 'min' : 'geom-min');
    const max = clipnode.getAttributePoint(visual_bbox ? 'max' : 'geom-max');

    if (separately) {
      // resize each object in the selection
      for (const item of set.items()) {
        const obj_size = item.desktopPreferredBounds();
        if (obj_size) item.scale_rel(this.#getScale(min.x, min.y, max.x, max.y, obj_size, apply_x, apply_y));
      }
    } else {
      // resize the selection as a whole
      const sel_size = set.preferredBounds();
      if (sel_size) {
        const s = this.#getScale(min.x, min.y, max.x, max.y, sel_size, apply_x, apply_y);
        set.scaleRelative(sel_size.midpoint(), s.c0, s.c3);
      }
    }
    return true;
  }

  /** Returns the id of the first visible copied object, or '' (for Relink to Copied). */
  getFirstObjectID(): string {
    const root = this.#clipboardSPDoc?.getReprRoot();
    if (!root) return '';
    // now clipboard is wrapped on copy since 202d57ea fix
    for (let ch = root.firstChild(); ch; ch = ch.next()) {
      if (ch.name() !== 'svg:g') continue;
      const id = ch.firstChild()?.attribute('id');
      if (id) return id;
    }
    return '';
  }

  /** Remove certain css elements which are not useful for pasteStyle */
  #cleanStyle(style: SPCSSAttr): void {
    /* Clean text 'position' properties */
    for (const name of [
      'text-anchor',
      'shape-inside',
      'shape-subtract',
      'shape-padding',
      'shape-margin',
      'inline-size',
    ]) {
      style.removeAttribute(name);
    }
  }

  /** Iterate over a list of items and copy them to the clipboard. */
  #copySelection(selection: ObjectSet): void {
    const doc = this.#doc;
    const root = this.#root;
    const clipnode = this.#clipnode;
    const clipdoc = this.#clipboardSPDoc;
    if (!doc || !root || !clipnode || !clipdoc) return;
    const copy_computed = Preferences.get().getBool('/options/copycomputedstyle/value', true);

    // copy the defs used by all items
    // TODO: LPE satellites, pages.
    const items = selection.items();
    this.#cloned_elements.clear();
    for (const item of items) this.#copyUsedDefs(item);

    // copy the representation of the items
    // TODO: external text references.
    const sorted_items: SPItem[] = [...items].sort(sp_object_compare_position);

    //remove already copied elements from cloned_elements
    for (const item of sorted_items) this.#cloned_elements.delete(item);

    // One group per shared parent
    const groups = new Map<SPObject | null, XmlNode>();

    sorted_items.push(...this.#cloned_elements);
    for (const item of sorted_items) {
      // Create a group with the parent transform. This group will be ungrouped when pasting
      // und takes care of transform relationships of clones, text-on-path, etc.
      let group = groups.get(item.parent);
      if (!group) {
        group = doc.createElement('svg:g');
        group.setAttribute('id', item.parent?.getId() ?? null); // avoid getting a clashing id
        root.appendChild(group);
        groups.set(item.parent, group);
        if (item.parent instanceof SPItem) {
          group.setAttributeOrRemoveIfEmpty('transform', sp_svg_transform_write(item.parent.i2docAffine()));
        }
      }

      const obj = item.getRepr();
      const obj_copy = this.#cloned_elements.has(item)
        ? this.#copyNode(obj, doc, clipnode)
        : this.#copyNode(obj, doc, group);

      // copy complete inherited style
      if (copy_computed) this.#copyCompleteStyle(item, obj_copy);
    }

    // copy style for Paste Style action
    const item = selection.singleItem();
    if (item) {
      if (copy_computed) {
        const style = take_style_from_item(item);
        this.#cleanStyle(style);
        spReprCssSet(clipnode, style, 'style');
      } else {
        clipnode.setAttribute('class', item.getRepr().attribute('class'));
        clipnode.setAttribute('style', item.getRepr().attribute('style'));
      }
      // copy path effect from the first path
      const effect = item.getRepr().attribute('inkscape:path-effect');
      if (effect) clipnode.setAttribute('inkscape:path-effect', effect);
    }

    const size = selection.visualBounds();
    if (size) {
      clipnode.setAttributePoint('min', size.min());
      clipnode.setAttributePoint('max', size.max());
    }
    const geom_size = selection.geometricBounds();
    if (geom_size) {
      clipnode.setAttributePoint('geom-min', geom_size.min());
      clipnode.setAttributePoint('geom-max', geom_size.max());
    }
    // Preferably set bounds based on original doc.
    // Some of the objects like <use> referring to objects which are not part of selection don't have proper bounds
    // at this stage.
    const bounds = selection.documentBounds(BBoxType.VISUAL_BBOX);
    if (bounds) {
      clipdoc.fitToRect(bounds);
    } else {
      clipdoc.ensureUpToDate();
      const drawing = clipdoc.getRoot().documentVisualBounds();
      if (drawing) clipdoc.fitToRect(drawing);
    }
  }

  /** Copies the style of the item, with the inherited style (child: only its own style). */
  #copyCompleteStyle(item: SPItem, target: XmlNode, child = false): void {
    const source = item.getRepr();
    // Child styles shouldn't copy their parent's existing cascaded style.
    const css = child ? spReprCssAttr(source, 'style') : spReprCssAttrInherited(source, 'style');
    // TODO: properties from style sheets (SPStyleSrc::STYLE_SHEET).
    spReprCssSet(target, css, 'style');

    if (item instanceof SPGroup) {
      // Recursively go through chldren too
      let source_child = source.firstChild();
      let target_child = target.firstChild();
      while (source_child && target_child) {
        const child_item = item.document.getObjectByRepr(source_child);
        if (child_item instanceof SPItem) this.#copyCompleteStyle(child_item, target_child, true);
        source_child = source_child.next();
        target_child = target_child.next();
      }
    }
  }

  /**
   * Recursively copy all the definitions used by a given item to the clipboard defs.
   * Upstream copies paint servers, markers, clip paths, masks, filters, text
   * paths and path effects by their types. These are not all ported yet, so
   * every object that a url() of the style or of a clip-path, mask or marker
   * attribute references is copied, with the objects it references through href.
   * TODO: 3D box perspectives, text paths, shape-inside, LPE stacks.
   */
  #copyUsedDefs(item: SPItem): void {
    let recurse = true;
    if (item instanceof SPUse) {
      const original = item.get_original();
      if (original) {
        if (original.document !== item.document) recurse = false;
        else this.#cloned_elements.add(original);
      }
    }

    const css = spReprCssAttrNew();
    const style = item.style.write();
    for (const decl of style.split(';')) {
      const colon = decl.indexOf(':');
      if (colon > 0) css.setAttribute(decl.slice(0, colon).trim(), decl.slice(colon + 1).trim());
    }
    const urls = [
      ...css.attributeList().map(([, value]) => value),
      ...['clip-path', 'mask', 'marker-start', 'marker-mid', 'marker-end', 'filter'].map((a) =>
        item.getAttribute(a),
      ),
    ];
    for (const value of urls) {
      const id = value ? /url\(\s*['"]?#([^'")]+)['"]?\s*\)/.exec(value)?.[1] : undefined;
      if (id && id !== item.getId()) this.#copyDef(item.document, id);
    }

    if (!recurse) return;
    // recurse
    for (const o of item.children) if (o instanceof SPItem) this.#copyUsedDefs(o);
  }

  /**
   * Copy the definition with id and the definitions in its href chain
   * (gradient vectors, patterns). Definitions without object (not ported
   * types) are found by their repr.
   */
  #copyDef(document: SPDocument, id: string): void {
    const defs = this.#defs;
    const doc = this.#doc;
    if (!defs || !doc) return;
    for (let def_id: string | null = id; def_id; ) {
      const obj = document.getObjectById(def_id);
      const repr: XmlNode | null =
        obj?.getRepr() ?? sp_repr_lookup_descendant(document.getReprRoot(), 'id', def_id);
      // Ignore dups here as gradients can point at each other and we want to preserve that structure
      if (!repr || !this.#copyIgnoreDup(repr, doc, defs)) break;
      // items in the definition may also use gradients and other patterns, so recurse
      for (const child of obj?.children ?? []) if (child instanceof SPItem) this.#copyUsedDefs(child);
      const href: string | null = repr.attribute('href') ?? repr.attribute('xlink:href');
      def_id = href?.startsWith('#') ? href.slice(1) : null;
    }
  }

  /** Copy a single XML node from one document to another. */
  #copyNode(node: XmlNode, target_doc: XmlDocument, parent: XmlNode): XmlNode {
    const dup = node.duplicate(target_doc);
    parent.appendChild(dup);
    return dup;
  }

  #copyIgnoreDup(node: XmlNode, target_doc: XmlDocument, parent: XmlNode): XmlNode | null {
    const root = this.#root;
    if (root && sp_repr_lookup_descendant(root, 'id', node.attribute('id'))) {
      // node already copied
      return null;
    }
    return this.#copyNode(node, target_doc, parent);
  }

  /** Paste a bitmap from the clipboard into the document as an embedded image. */
  async #pasteImage(desktop: SPDesktop, blob: Blob | undefined): Promise<boolean> {
    if (!blob) return false;
    const doc = gdkpixbuf_input_open(new Uint8Array(await blob.arrayBuffer()));
    if (!doc) return false;
    // Upstream saves the texture as PNG and imports it with link=embed.
    file_import(desktop.getDocument(), doc, false, desktop);
    return true;
  }

  /** Paste text: a color (shorter than 30 characters) becomes the fill of the selection. */
  #pasteText(desktop: SPDesktop, clip_text: string): boolean {
    // TODO: paste into the text tool.
    if (clip_text.length < 30) {
      // Zero makes it impossible to paste a 100% transparent black, but it's useful.
      const color = Colors.Color.parse(clip_text.trim());
      if (color) {
        const color_css = spReprCssAttrNew();
        spReprCssSetPropertyString(color_css, 'fill', color.toString(false));
        spReprCssSetPropertyDouble(color_css, 'fill-opacity', color.getOpacity());
        sp_desktop_set_style(desktop, color_css);
        return true;
      }
    }
    return false;
  }

  /** Read the system clipboard; null if there is none or the access is denied. */
  async #readSystem(): Promise<ClipboardContent | null> {
    // A paste right after a copy must see the copied content.
    await this.#writing;
    if (!this.system) return null;
    try {
      const content: ClipboardContent = new Map();
      for (const item of await this.system.read()) {
        for (const type of item.types) {
          if (!content.has(type)) content.set(type, await item.getType(type));
        }
      }
      return content;
    } catch {
      return null;
    }
  }

  /**
   * Make the clipboard document from the content of target. Our own content
   * (and any content when the clipboard cannot be read) keeps the internal document.
   */
  async #retrieveClipboard(content: ClipboardContent | null, target: string): Promise<void> {
    // Nothing needs to be done, just use existing clipboard document.
    if (!content || target === CLIPBOARD_LOCAL_TARGET) return;
    this.#discardInternalClipboard();
    const blob = content.get(target);
    if (!blob) return;
    // there is no specific plain SVG input extension, so text/plain is read as SVG too
    const doc = SPDocument.createNewDocFromMem(await blob.text());
    if (doc) this.#clipboardSPDoc = doc;
  }

  /** Make the clipboard document from the system clipboard, if it holds SVG (upstream _retrieveClipboard("image/x-inkscape-svg")). */
  async #retrieveDocument(): Promise<void> {
    const content = await this.#readSystem();
    const target = await this.#getBestTargetAsync(content);
    await this.#retrieveClipboard(content, image_targets.includes(target) ? '' : target);
  }

  /** Whether content is what we wrote last. */
  async #isLocal(content: ClipboardContent): Promise<boolean> {
    if (!this.#clipboardSPDoc || this.#written_text === null) return false;
    const text = await content.get(CLIPBOARD_TEXT_TARGET)?.text();
    return text === this.#written_text;
  }

  /** Creates an internal clipboard document from scratch. */
  #createInternalClipboard(): void {
    const doc = SPDocument.createNewDocFromMem(EMPTY_DOC);
    if (!doc) throw new Error('cannot create the clipboard document');
    this.#clipboardSPDoc = doc;
    this.#defs = doc.getDefs()?.getRepr() ?? null;
    this.#doc = doc.getReprDoc();
    this.#root = doc.getReprRoot();

    // Preserve ANY copied text kerning
    this.#root.setAttribute('xml:space', 'preserve');

    this.#clipnode = this.#doc.createElement('inkscape:clipboard');
    this.#root.appendChild(this.#clipnode);

    // once we create a SVG document, style will be stored in it, so flush _text_style
    this.#text_style = null;
  }

  /** Deletes the internal clipboard document. */
  #discardInternalClipboard(): void {
    this.#clipboardSPDoc = null;
    this.#defs = null;
    this.#doc = null;
    this.#root = null;
    this.#clipnode = null;
    this.#written_text = null;
  }

  /** Get the scale to resize an item, based on the command and desktop state. */
  #getScale(
    minx: number,
    miny: number,
    maxx: number,
    maxy: number,
    obj_rect: Rect,
    apply_x: boolean,
    apply_y: boolean,
  ) {
    let scale_x = 1.0;
    let scale_y = 1.0;
    if (apply_x) scale_x = (maxx - minx) / obj_rect.width();
    if (apply_y) scale_y = (maxy - miny) / obj_rect.height();
    // If the "lock aspect ratio" button is pressed and we paste only a single coordinate,
    // resize the second one by the same ratio too
    if (Preferences.get().getBool('/tools/select/lock_aspect_ratio', false)) {
      if (apply_x && !apply_y) scale_y = scale_x;
      if (apply_y && !apply_x) scale_x = scale_y;
    }
    return Scale(scale_x, scale_y);
  }

  /**
   * Find the most suitable clipboard target: our own document first, then
   * SVG, bitmaps and text. Without content (no access), our own document.
   */
  async #getBestTargetAsync(content: ClipboardContent | null): Promise<string> {
    if (!content || (await this.#isLocal(content))) return CLIPBOARD_LOCAL_TARGET;
    return this.#getBestTarget(content);
  }

  #getBestTarget(content: ClipboardContent | null): string {
    if (!content) return CLIPBOARD_LOCAL_TARGET;
    for (const tgt of preferred_targets) if (content.has(tgt)) return tgt;
    for (const tgt of image_targets) if (content.has(tgt)) return tgt;
    if (content.has(CLIPBOARD_TEXT_TARGET)) return CLIPBOARD_TEXT_TARGET;
    return '';
  }

  /** Write the clipboard document to the system clipboard as SVG and text. */
  #setClipboardTargets(): Promise<void> {
    const doc = this.#clipboardSPDoc;
    if (!doc) return Promise.resolve();
    const text = saveBuf(doc.getReprDoc(), SVG_NS_URI);
    this.#written_text = text;
    if (!this.system) return Promise.resolve();
    // Write now: the browser allows it only while the user action (key press) is active.
    this.#writing = this.system
      .write({
        'image/svg+xml': new Blob([text], { type: 'image/svg+xml' }),
        [CLIPBOARD_TEXT_TARGET]: new Blob([text], { type: CLIPBOARD_TEXT_TARGET }),
      })
      .catch(() => {
        // Access denied: the clipboard stays in memory.
      });
    return this.#writing;
  }

  /** Show a canvas notice. TODO: desktop notices (showNotice). */
  #userWarn(msg: string): void {
    console.warn(msg);
  }
}
