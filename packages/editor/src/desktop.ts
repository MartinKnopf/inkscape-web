// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/desktop.cpp, src/desktop.h, src/page-manager.cpp
/*
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Frank Felfe <innerspace@iname.com>
 *   MenTaLguY <mental@rydia.net>
 *   bulia byak <buliabyak@users.sf.net>
 *   Ralf Stephan <ralf@ark.in-berlin.de>
 *   John Bintz <jcoswell@coswellproductions.org>
 *   Johan Engelen <j.b.c.engelen@ewi.utwente.nl>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2007 Jon A. Cruz
 * Copyright (C) 2006-2008 Johan Engelen
 * Copyright (C) 2006 John Bintz
 * Copyright (C) 2004 MenTaLguY
 * Copyright (C) 1999-2002 Lauris Kaplinski
 * Copyright (C) 2000-2001 Ximian, Inc.
 */
import {
  LayerMode,
  Preferences,
  Selection,
  Signal,
  SP_ITEM_SHOW_DISPLAY,
  type SPCSSAttr,
  SPDocument,
  SPGroup,
  SPItem,
  spCssAttrUnsetBlacklist,
  spCssAttrUnsetText,
  spCssAttrUnsetUris,
  spReprCssAttrNew,
  spReprCssMerge,
  spReprCssSet,
  type Node as XmlNode,
} from '@inkscape-web/core';
import { Affine, Point, Rect, Scale } from '@inkscape-web/geom';
import { CanvasItemGroup } from './display/control/canvas-item.ts';
import { CanvasPage } from './display/control/canvas-page.ts';
import { SvgDrawing } from './display/drawing.ts';
import { SvgDrawingItem } from './display/drawing-item.ts';
import { LayerManager } from './layer-manager.ts';
import { createTool } from './ui/tool-factory.ts';
import type { ToolBase } from './ui/tools/tool-base.ts';
import type { Canvas } from './ui/widget/canvas.ts';

export const SP_DESKTOP_ZOOM_MAX = 256.0;
export const SP_DESKTOP_ZOOM_MIN = 0.01;

/** Upstream default of the desk color (sp-namedview.cpp default_desk_color). */
const DEFAULT_DESK_COLOR = 0xd1d1d1ff;

/**
 * How the drawing maps to the window (upstream SPDesktop::DesktopAffine).
 * d2w is the scale (with the y-axis direction); the offset is the world
 * point at the top left corner of the window.
 * TODO: rotation and flip.
 */
class DesktopAffine {
  #scale = Scale(1, 1);
  #d2w = Affine.identity();
  #w2d = Affine.identity();
  #offset = new Point(0, 0);

  w2d(): Affine {
    return this.#w2d;
  }
  d2w(): Affine {
    return this.#d2w;
  }
  setScale(scale: Affine): void {
    this.#scale = scale;
    this.#update();
  }
  getZoom(): number {
    return this.#d2w.descrim();
  }
  setOffset(offset: Point): void {
    this.#offset = offset;
  }
  addOffset(offset: Point): void {
    this.#offset = this.#offset.add(offset);
  }
  getOffset(): Point {
    return this.#offset;
  }
  #update(): void {
    this.#d2w = this.#scale;
    this.#w2d = this.#d2w.inverse();
  }
}

/**
 * An editable view of a document on a canvas (upstream SPDesktop): shows the
 * document root in a Drawing, draws the page, owns zoom and scroll, the
 * selection, the current layer and the active tool.
 * TODO: namedview (zoom/center from the document, colors),
 * transform history, rotation, flip, guides, grids, message stack.
 */
export class SPDesktop {
  readonly canvas: Canvas;
  doc!: SPDocument;
  /** The display key of the document root in this desktop. */
  readonly dkey = SPItem.displayKeyNew(1);
  /** Emitted when the zoom factor changes (not when scrolling). The parameter is the new zoom factor. */
  readonly signal_zoom_changed = new Signal<[number]>();
  /** Emitted after the active tool changed (upstream _event_context_changed_signal). */
  readonly #event_context_changed_signal = new Signal<[SPDesktop, ToolBase | null]>();
  /** The slots of connectSetStyle(); the first that returns true intercepts the style. */
  readonly #setStyleSlots = new Set<(css: SPCSSAttr, switchStyle: boolean) => boolean>();
  /** The last used style (upstream SPDesktop::current), from "/desktop/style". */
  current: SPCSSAttr = Preferences.get().getStyle('/desktop/style');

  // Canvas item groups, bottom to top (upstream CanvasItemGroups).
  readonly _canvas_group_pages_bg: SVGGElement;
  readonly _canvas_group_drawing: SVGGElement;
  readonly _canvas_group_pages_fg: SVGGElement;
  readonly _canvas_group_controls: SVGGElement;

  readonly #drawing: SvgDrawing;
  readonly #page = new CanvasPage();
  readonly #controls: CanvasItemGroup;
  readonly #layerManager: LayerManager;
  readonly #selection: Selection;
  #tool: ToolBase | null = null;
  readonly _current_affine = new DesktopAffine();
  #disconnectModified: (() => void) | null = null;
  #disconnectZoomFromDocument: (() => void) | null = null;

  constructor(canvas: Canvas, document: SPDocument) {
    // Run document updates (SPDocument.ensureUpToDate) before the next frame,
    // so that views show changes in the same frame.
    SPDocument.scheduleIdle = (callback) => requestAnimationFrame(callback);
    this.canvas = canvas;
    const dom = canvas.svg.ownerDocument;
    const group = (parent: SVGGElement, name: string) => {
      const g = dom.createElementNS('http://www.w3.org/2000/svg', 'g') as SVGGElement;
      g.setAttribute('class', name);
      parent.append(g);
      return g;
    };
    this._canvas_group_pages_bg = group(canvas.desktopLayer, 'CanvasItemGroup:PagesBg');
    this._canvas_group_drawing = group(canvas.desktopLayer, 'CanvasItemGroup:Drawing');
    this._canvas_group_pages_fg = group(canvas.desktopLayer, 'CanvasItemGroup:PagesFg');
    this._canvas_group_controls = group(canvas.controlsLayer, 'CanvasItemGroup:Controls');
    this.#controls = new CanvasItemGroup(this._canvas_group_controls, canvas);
    canvas.set_desk(DEFAULT_DESK_COLOR);
    this.#layerManager = new LayerManager(this);
    this.#selection = new Selection(this);

    this.#drawing = new SvgDrawing(dom);
    this._canvas_group_drawing.append(this.#drawing.root.element);
    this.#page.add(Rect.fromXywh(0, 0, 0, 0), this._canvas_group_pages_bg, this._canvas_group_pages_fg);

    this.setDocument(document);
    this.set_display_area(false);
    this.setTool('/tools/select');
  }

  /** Release the document view and the canvas content. */
  destroy(): void {
    this.#tool?.destroy();
    this.#tool = null;
    this.#selection.clear();
    this.#controls.destroy();
    this.#detachDocument();
    this.#disconnectZoomFromDocument?.();
    this.#page.remove();
    for (const g of [
      this._canvas_group_pages_bg,
      this._canvas_group_drawing,
      this._canvas_group_pages_fg,
      this._canvas_group_controls,
    ]) {
      g.remove();
    }
  }

  getDocument(): SPDocument {
    return this.doc;
  }
  getCanvas(): Canvas {
    return this.canvas;
  }
  getDrawing(): SvgDrawing {
    return this.#drawing;
  }
  getSelection(): Selection {
    return this.#selection;
  }
  layerManager(): LayerManager {
    return this.#layerManager;
  }
  /** The group for control items (handles, rubberband) above the drawing. */
  getCanvasControls(): CanvasItemGroup {
    return this.#controls;
  }

  getTool(): ToolBase | null {
    return this.#tool;
  }

  /**
   * Activate the tool with the preferences path toolName ("/tools/shapes/rect").
   * Use set_active_tool() (actions-tools.ts) to switch tools by name.
   */
  setTool(toolName: string): void {
    // Tool should be able to be replaced with itself.
    this.#tool?.destroy();
    this.#tool = null;
    if (toolName) this.#tool = createTool(this, toolName);
    this.#event_context_changed_signal.emit(this, this.#tool);
  }

  connectEventContextChanged(slot: (desktop: SPDesktop, tool: ToolBase | null) => void): () => void {
    return this.#event_context_changed_signal.connect(slot);
  }

  /**
   * Let slot see the style that sp_desktop_set_style() applies. If it returns true, the style
   * is not applied to the selection (upstream _set_style_signal, used by tools with own sub-selections).
   */
  connectSetStyle(slot: (css: SPCSSAttr, switchStyle: boolean) => boolean): () => void {
    this.#setStyleSlots.add(slot);
    return () => this.#setStyleSlots.delete(slot);
  }

  /** Emit the set-style signal; true if a slot intercepted the style. */
  emitSetStyle(css: SPCSSAttr, switchStyle: boolean): boolean {
    for (const slot of [...this.#setStyleSlots]) if (slot(css, switchStyle)) return true;
    return false;
  }

  /** Set the style attribute of repr to the style for new objects of a tool, see getCurrentOrToolStyle(). */
  applyCurrentOrToolStyle(repr: XmlNode, tool_path: string, with_text: boolean, use_current = ''): void {
    const css = this.getCurrentOrToolStyle(tool_path, with_text, use_current);
    if (css) spReprCssSet(repr, css, 'style');
  }

  /**
   * The style for new objects of the tool with preferences path tool_path: the
   * tool's own style (tool_path/style), with the last used style on top as
   * tool_path/usecurrent says: "0" none, "1" the last used style
   * (desktop.current), an item type ("rect") the last used style of that type
   * ("/desktop/rect/style"). use_current overrides the preference.
   * Returns null for an empty style.
   */
  getCurrentOrToolStyle(tool_path: string, with_text: boolean, use_current = ''): SPCSSAttr | null {
    const prefs = Preferences.get();
    const css = spReprCssAttrNew();
    if (!use_current) use_current = prefs.getString(`${tool_path}/usecurrent`);

    // Start with per-tool style, then apply current style on top if required
    spReprCssMerge(css, prefs.getInheritedStyle(`${tool_path}/style`));
    if (use_current && use_current !== '0') {
      // use_current should never be empty, but treat empty as "0"
      if (use_current === '1') spReprCssMerge(css, this.current);
      else spReprCssMerge(css, prefs.getStyle(`/desktop/${use_current}/style`));
    }
    if (!css.attributeList().length) return null;

    // Remove unwanted attributes
    spCssAttrUnsetBlacklist(css);
    spCssAttrUnsetUris(css);
    if (!with_text) spCssAttrUnsetText(css);
    return css;
  }

  /** Show doc instead of the current document. */
  setDocument(doc: SPDocument): void {
    if (this.doc === doc) return;
    this.#selection.clear();
    this.#detachDocument();
    this.doc = doc;
    this.#selection.setDocument(doc);
    this.#attachDocument();
  }

  #attachDocument(): void {
    const doc = this.doc;
    doc.ensureUpToDate();
    const ai = doc.getRoot().invokeShow(this.#drawing, this.dkey, SP_ITEM_SHOW_DISPLAY);
    if (ai) this.#drawing.root.appendChild(ai);
    this.#drawing.root.setTransform(this.doc2dt());
    this.#layerManager._setDocument(doc);
    this.#updateLayersFromDocument();
    this.#updatePage();
    this.#disconnectModified = doc.modifiedSignal.connect(() => this.#updatePage());
  }

  /**
   * Make the layer in the namedview's inkscape:current-layer, or else the
   * topmost layer, the current layer (upstream sp_namedview_update_layers_from_document).
   */
  #updateLayersFromDocument(): void {
    const root = this.doc.getRoot();
    const namedview = root.children.find((c) => c.getRepr().name() === 'sodipodi:namedview');
    let layer = this.doc.getObjectById(namedview?.getAttribute('inkscape:current-layer') ?? null);
    // don't use that object if it's not at least group
    if (!(layer instanceof SPGroup)) layer = null;
    // if that didn't work out, look for the topmost layer
    if (!layer) {
      for (const child of root.children) if (this.#layerManager.isLayer(child)) layer = child;
    }
    if (layer) this.#layerManager.setCurrentLayer(layer);
  }

  #detachDocument(): void {
    if (!this.doc) return;
    this.#disconnectModified?.();
    this.#disconnectModified = null;
    this.doc.getRoot().invokeHide(this.dkey);
  }

  #updatePage(): void {
    this.#page.update(this.doc.preferredBounds().transformed(this.doc2dt()));
  }

  // Picking

  /**
   * The topmost item at window point p (upstream getItemAtPoint). Without
   * into_groups, an item inside a group gives the group, but layers and the
   * groups entered as layers are entered. Items after upto (in z-order from
   * the top) are skipped. Hidden and locked items are ignored.
   * The browser does the hit testing (document.elementsFromPoint).
   * TODO: the cursor tolerance (/options/cursortolerance/value), outline mode.
   */
  getItemAtPoint(p: Point, into_groups: boolean, upto: SPItem | null = null): SPItem | null {
    let seen_upto = !upto;
    for (const item of this.#pickCandidates(p, into_groups)) {
      if (!seen_upto) {
        if (item === upto) seen_upto = true;
        continue;
      }
      return item;
    }
    return null;
  }

  /** The topmost non-layer group at window point p (upstream getGroupAtPoint). */
  getGroupAtPoint(p: Point): SPItem | null {
    for (const item of this.#pickCandidates(p, false)) if (item instanceof SPGroup) return item;
    return null;
  }

  /** The pickable items at window point p, topmost first (upstream: the flat item list, picked in z-order). */
  #pickCandidates(p: Point, into_groups: boolean): SPItem[] {
    const svg = this.canvas.svg;
    const r = svg.getBoundingClientRect();
    const result: SPItem[] = [];
    for (const el of svg.ownerDocument.elementsFromPoint(r.left + p.x, r.top + p.y)) {
      if (!this._canvas_group_drawing.contains(el)) continue;
      const hit = SvgDrawingItem.itemFromElement(el)?.item();
      const item = hit ? this.#flatListItem(hit, into_groups) : null;
      if (item && !result.includes(item) && item.isVisibleAndUnlocked()) result.push(item);
    }
    return result;
  }

  /**
   * The entry of the flat item list (upstream _build_flat_item_list) that
   * contains item: the list enters layers (and with into_groups all groups)
   * from the root; its entries are the items that are not entered.
   */
  #flatListItem(item: SPItem, into_groups: boolean): SPItem | null {
    const chain = [item, ...item.ancestorList(false)].reverse();
    if (chain[0] !== this.doc.getRoot()) return null;
    for (const o of chain.slice(1)) {
      if (!(o instanceof SPItem)) return null;
      const entered =
        o instanceof SPGroup && (o.effectiveLayerMode(this.dkey) === LayerMode.LAYER || into_groups);
      if (!entered) return o;
    }
    return null; // a layer or group itself
  }

  // Coordinate systems

  /** Transformation from window to desktop coordinates (zoom/rotate). */
  w2d(): Affine;
  w2d(p: Point): Point;
  w2d(p?: Point): Affine | Point {
    return p ? p.transformed(this._current_affine.w2d()) : this._current_affine.w2d();
  }
  /** Transformation from desktop to window coordinates. */
  d2w(): Affine;
  d2w(p: Point): Point;
  d2w(p?: Point): Affine | Point {
    return p ? p.transformed(this._current_affine.d2w()) : this._current_affine.d2w();
  }
  doc2dt(): Affine {
    return this.doc.doc2dt();
  }
  dt2doc(): Affine {
    return this.doc.dt2doc();
  }
  yaxisdir(): number {
    return this.doc2dt().c3;
  }

  // Zoom and scroll

  current_zoom(): number {
    return this._current_affine.getZoom();
  }

  /** The desktop point at the center of the window. */
  current_center(): Point {
    return this.canvas.get_area_world().midpoint().transformed(this._current_affine.w2d());
  }

  /**
   * Apply _current_affine to the canvas (log: TODO transform history).
   * With (c, w): map the drawing so that desktop point c lies at world point w.
   * With (r, border): fit desktop rect r into the window, border screen px inside.
   */
  set_display_area(log?: boolean): void;
  set_display_area(c: Point, w: Point, log?: boolean): void;
  set_display_area(r: Rect, border: number, log?: boolean): void;
  set_display_area(a?: boolean | Point | Rect, b?: Point | number, _log = true): void {
    if (a instanceof Point && b instanceof Point) {
      // The relative offset needed to keep c at w.
      this._current_affine.addOffset(this.d2w(a).sub(b));
    } else if (a instanceof Rect && typeof b === 'number') {
      this.#setDisplayAreaRect(a, b);
      return;
    }
    this.canvas.set_pos(this._current_affine.getOffset());
    this.canvas.set_affine(this._current_affine.d2w());
    this.signal_zoom_changed.emit(this._current_affine.getZoom());
  }

  #setDisplayAreaRect(r: Rect, border: number): void {
    // A rectangle the size of the window aligned with origin, shrunk by the border.
    const w = new Rect(new Point(0, 0), this.canvas.get_dimensions()).expandBy(-border);
    // Determine which direction limits scale.
    let zoom =
      r.width() * w.height() > r.height() * w.width() ? w.width() / r.width() : w.height() / r.height();
    zoom = clamp(zoom, SP_DESKTOP_ZOOM_MIN, SP_DESKTOP_ZOOM_MAX);
    this._current_affine.setScale(Scale(zoom, this.yaxisdir() * zoom));
    // Zero offset, actual offset calculated later.
    this._current_affine.setOffset(new Point(0, 0));
    this.set_display_area(r.midpoint(), w.midpoint());
  }

  /**
   * Zoom to the given absolute zoom level (1 is 100%) around desktop point
   * center. keep_point keeps center fixed in the window; otherwise center
   * moves to the middle of the window.
   */
  zoom_absolute(center: Point, zoom: number, keep_point = true): void {
    const w = keep_point ? this.d2w(center) : this.canvas.get_area_world().midpoint(); // Must be before zoom changed.
    zoom = clamp(zoom, SP_DESKTOP_ZOOM_MIN, SP_DESKTOP_ZOOM_MAX);
    this._current_affine.setScale(Scale(zoom, this.yaxisdir() * zoom));
    this.set_display_area(center, w);
  }

  /** Zoom relative to the current zoom (at 50%, 0.5 gives 25%). */
  zoom_relative(center: Point, zoom: number, keep_point = true): void {
    this.zoom_absolute(center, this._current_affine.getZoom() * zoom, keep_point);
  }

  /** Zoom to an absolute real-world ratio, e.g. 1:1 physical screen units. */
  zoom_realworld(center: Point, ratio: number): void {
    const correction = Preferences.get().getDouble('/options/zoomcorrection/value', 1.0);
    this.zoom_absolute(center, ratio * correction, false);
  }

  /** Zoom to the whole drawing. */
  zoom_drawing(): void {
    const docitem = this.doc.getRoot();
    docitem.bbox_valid = false;
    const d = docitem.desktopVisualBounds();
    // The second condition means that there are no items in the drawing.
    if (!d || d.minExtent() < 0.1) return;
    this.set_display_area(d, 10);
  }

  /**
   * Zoom to fit the page in the window (upstream PageManager::zoomToPage
   * with the document bounds; there are no multiple pages yet).
   */
  zoom_page(): void {
    const rect = this.doc.preferredBounds().transformed(this.doc2dt());
    if (rect.minExtent() < 1.0) return;
    this.set_display_area(rect, 10);
  }

  /**
   * Apply the zoom of the document once the canvas has a size.
   * TODO: inkscape:zoom, cx, cy from the namedview (sp_namedview_zoom_and_view_from_document);
   * for now always zoom to the page.
   */
  schedule_zoom_from_document(): void {
    this.#disconnectZoomFromDocument?.();
    const apply = () => {
      this.#disconnectZoomFromDocument?.();
      this.#disconnectZoomFromDocument = null;
      this.zoom_page();
    };
    const dims = this.canvas.get_dimensions();
    if (dims.x > 0 && dims.y > 0) apply();
    else this.#disconnectZoomFromDocument = this.canvas.connectResize(apply);
  }

  /** Scroll so that world point is at the top left corner of the window. */
  scroll_absolute(point: Point): void {
    this.canvas.set_pos(point);
    this._current_affine.setOffset(point);
  }

  /** Scroll by delta in window coordinates. */
  scroll_relative(delta: Point): void {
    this.scroll_absolute(this.canvas.get_area_world().min().sub(delta));
  }

  /** Scroll by (dx, dy) in svg (desktop) units. */
  scroll_relative_in_svg_coords(dx: number, dy: number): void {
    const scale = this._current_affine.getZoom();
    this.scroll_relative(new Point(dx * scale, dy * scale));
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}
