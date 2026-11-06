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
  DEFAULT_BLEED_COLOR,
  DEFAULT_MARGIN_COLOR,
  DocumentUndo,
  LayerMode,
  Preferences,
  Selection,
  Signal,
  SP_ITEM_SHOW_DISPLAY,
  type SPCSSAttr,
  SPDocument,
  type SPGrid,
  SPGroup,
  type SPGuide,
  SPItem,
  type SPNamedView,
  type SPObject,
  type SPPage,
  SPShape,
  type SPStop,
  SPWindRule,
  spCssAttrUnsetBlacklist,
  spCssAttrUnsetText,
  spCssAttrUnsetUris,
  spReprCssAttrNew,
  spReprCssMerge,
  spReprCssSet,
  TextParam,
  type Node as XmlNode,
} from '@inkscape-web/core';
import {
  Affine,
  PathVector,
  Point,
  pathv_nearest_time,
  pathv_point_at,
  Rect,
  Rotate,
  Scale,
} from '@inkscape-web/geom';
import { get_snapping_preferences } from './actions/actions-canvas-snapping.ts';
import { CanvasFlip } from './canvas-flip.ts';
import { sp_dt_guide_event, sp_dt_guide_key_event } from './desktop-events.ts';
import { CanvasItemGroup } from './display/control/canvas-item.ts';
import { CanvasItemGridXY } from './display/control/canvas-item-grid.ts';
import { CanvasItemGuideLine } from './display/control/canvas-item-guideline.ts';
import { CanvasPage } from './display/control/canvas-page.ts';
import { SnapIndicator } from './display/control/snap-indicator.ts';
import { RenderMode, SvgDrawing } from './display/drawing.ts';
import { SvgDrawingItem } from './display/drawing-item.ts';
import { LPECanvasTexts } from './display/lpe-canvas-text.ts';
import { LayerManager } from './layer-manager.ts';
import { SnapManager } from './snap.ts';
import { createTool } from './ui/tool-factory.ts';
import type { ToolBase } from './ui/tools/tool-base.ts';
import type { Canvas } from './ui/widget/canvas.ts';

export { CanvasFlip };

export const SP_DESKTOP_ZOOM_MAX = 256.0;
export const SP_DESKTOP_ZOOM_MIN = 0.01;

/** Upstream default of the desk color (sp-namedview.cpp default_desk_color). */
const DEFAULT_DESK_COLOR = 0xd1d1d1ff;

/** How the canvas shows an outline view beside the normal drawing (upstream Inkscape::SplitMode). */
export enum SplitMode {
  NORMAL,
  /** The right half of the window in outline mode. */
  SPLIT,
  /** A circle around the pointer in outline mode. */
  XRAY,
}

/**
 * How the drawing maps to the window (upstream SPDesktop::DesktopAffine).
 * d2w is the scale (with the y-axis direction) times the rotation times the flip; the offset is
 * the world point at the top left corner of the window. Scale and rotation are kept apart so that
 * they need not be extracted from the affine.
 */
export class DesktopAffine {
  #scale = Scale(1, 1);
  #rotate = Affine.identity();
  #angle = 0;
  #flip = Affine.identity();
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
  /** Set the rotation, an angle in radians (clockwise on the screen). */
  setRotate(angle: number): void {
    this.#angle = angle;
    this.#rotate = Rotate(angle);
    this.#update();
  }
  addRotate(angle: number): void {
    this.setRotate(this.#angle + angle);
  }
  /** The rotation in radians. */
  getRotation(): number {
    return this.#angle;
  }
  setFlip(flip: CanvasFlip): void {
    this.#flip = Affine.identity();
    this.addFlip(flip);
  }
  addFlip(flip: CanvasFlip): void {
    if (flip & CanvasFlip.FLIP_HORIZONTAL) this.#flip = this.#flip.multiply(Scale(-1, 1));
    if (flip & CanvasFlip.FLIP_VERTICAL) this.#flip = this.#flip.multiply(Scale(1, -1));
    this.#update();
  }
  isFlipped(flip: CanvasFlip): boolean {
    return (
      !!(flip & CanvasFlip.FLIP_HORIZONTAL && Math.abs(this.#flip.c0 + 1) < 1e-6) ||
      !!(flip & CanvasFlip.FLIP_VERTICAL && Math.abs(this.#flip.c3 + 1) < 1e-6)
    );
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
  clone(): DesktopAffine {
    const c = new DesktopAffine();
    c.#scale = this.#scale;
    c.#rotate = this.#rotate;
    c.#angle = this.#angle;
    c.#flip = this.#flip;
    c.#d2w = this.#d2w;
    c.#w2d = this.#w2d;
    c.#offset = this.#offset;
    return c;
  }
  /** Copy the state of other into this one. */
  assign(other: DesktopAffine): void {
    const c = other.clone();
    this.#scale = c.#scale;
    this.#rotate = c.#rotate;
    this.#angle = c.#angle;
    this.#flip = c.#flip;
    this.#d2w = c.#d2w;
    this.#w2d = c.#w2d;
    this.#offset = c.#offset;
  }
  #update(): void {
    this.#d2w = this.#scale.multiply(this.#rotate).multiply(this.#flip);
    this.#w2d = this.#d2w.inverse();
  }
}

/**
 * An editable view of a document on a canvas (upstream SPDesktop): shows the
 * document root in a Drawing, draws the page, owns zoom and scroll, the
 * selection, the current layer and the active tool.
 * Shows the guides and grids of the namedview and owns the snap manager.
 * TODO: namedview (zoom/center from the document),
 * transform history, rotation, flip, message stack.
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
  /** Emitted after setDocument() showed another document. */
  readonly #document_replaced_signal = new Signal<[SPDesktop, SPDocument]>();
  /** Emitted when a gradient stop is selected on the canvas or in a dialog (null: none). */
  readonly #gradient_stop_selected_signal = new Signal<[SPStop | null]>();
  /** The slots of connectSetStyle(); the first that returns true intercepts the style. */
  readonly #setStyleSlots = new Set<(css: SPCSSAttr, switchStyle: boolean) => boolean>();
  /** The last used style (upstream SPDesktop::current), from "/desktop/style". */
  current: SPCSSAttr = Preferences.get().getStyle('/desktop/style');

  // Canvas item groups, bottom to top (upstream CanvasItemGroups).
  /** The page backgrounds and borders, in world coordinates below and above the drawing. */
  readonly _canvas_group_pages_bg: SVGGElement;
  readonly _canvas_group_drawing: SVGGElement;
  readonly _canvas_group_pages_fg: SVGGElement;
  readonly _canvas_group_grids: SVGGElement;
  readonly _canvas_group_guides: SVGGElement;
  readonly _canvas_group_temp: SVGGElement;
  readonly _canvas_group_controls: SVGGElement;

  readonly #drawing: SvgDrawing;
  /** A second view of the document in outline mode for the split modes, shown through a clip. */
  #outline: { drawing: SvgDrawing; key: number; group: SVGGElement; clip: SVGPathElement } | null = null;
  #splitMode = SplitMode.NORMAL;
  #disconnectSplit: (() => void)[] = [];
  readonly #pages_bg: CanvasItemGroup;
  readonly #pages_fg: CanvasItemGroup;
  /** The document viewport, drawn as a page when no page covers it (upstream SPNamedView::_viewport). */
  readonly #viewport = new CanvasPage();
  /** The canvas items of the pages of the PageManager (upstream SPPage::_canvas_item). */
  #page_views = new Map<SPPage, CanvasPage>();
  readonly #controls: CanvasItemGroup;
  readonly #grids: CanvasItemGroup;
  readonly #guides: CanvasItemGroup;
  readonly #temp: CanvasItemGroup;
  readonly #snap_indicator: SnapIndicator;
  /** Upstream the namedview owns the snap manager; the snapping preferences are global. */
  readonly #snap_manager = new SnapManager(get_snapping_preferences());
  /** The canvas items of the guides and grids of the namedview, with their disconnect functions. */
  #guide_views = new Map<SPGuide, { item: CanvasItemGuideLine; disconnect: () => void }>();
  #grid_views = new Map<SPGrid, { item: CanvasItemGridXY; disconnect: () => void }>();
  #disconnectNamedView: (() => void) | null = null;
  readonly #layerManager: LayerManager;
  readonly #selection: Selection;
  #tool: ToolBase | null = null;
  readonly _current_affine = new DesktopAffine();
  #disconnectModified: (() => void) | null = null;
  #reconstruction_old_layer_id = '';
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
    this._canvas_group_drawing = group(canvas.desktopLayer, 'CanvasItemGroup:Drawing');
    // The pages are drawn in world coordinates (screen-sized borders, shadows and labels).
    this._canvas_group_pages_bg = group(canvas.desktopLayer, 'CanvasItemGroup:PagesBg');
    canvas.desktopLayer.before(this._canvas_group_pages_bg);
    this._canvas_group_pages_fg = group(canvas.desktopLayer, 'CanvasItemGroup:PagesFg');
    canvas.desktopLayer.after(this._canvas_group_pages_fg);
    this.#pages_bg = new CanvasItemGroup(this._canvas_group_pages_bg, canvas);
    this.#pages_fg = new CanvasItemGroup(this._canvas_group_pages_fg, canvas);
    this._canvas_group_grids = group(canvas.controlsLayer, 'CanvasItemGroup:Grids');
    this._canvas_group_guides = group(canvas.controlsLayer, 'CanvasItemGroup:Guides');
    this._canvas_group_temp = group(canvas.controlsLayer, 'CanvasItemGroup:Temp');
    this._canvas_group_controls = group(canvas.controlsLayer, 'CanvasItemGroup:Controls');
    this.#grids = new CanvasItemGroup(this._canvas_group_grids, canvas);
    this.#guides = new CanvasItemGroup(this._canvas_group_guides, canvas);
    this.#temp = new CanvasItemGroup(this._canvas_group_temp, canvas);
    this.#controls = new CanvasItemGroup(this._canvas_group_controls, canvas);
    this.#snap_indicator = new SnapIndicator(this);
    // Delete the guide under the pointer (before the tools and the shortcuts see the key).
    canvas.svg.addEventListener('keydown', this.#onKeyDown, true);
    canvas.set_desk(DEFAULT_DESK_COLOR);
    this.#layerManager = new LayerManager(this);
    this.#selection = new Selection(this);

    this.#drawing = new SvgDrawing(dom);
    this._canvas_group_drawing.append(this.#drawing.root.element, this.#drawing.defs);
    this.#viewport.add(Rect.fromXywh(0, 0, 0, 0), this.#pages_bg, this.#pages_fg);

    this.setDocument(document);
    this.set_display_area(false);
    this.setTool('/tools/select');
  }

  /** Release the document view and the canvas content. */
  destroy(): void {
    this.#tool?.destroy();
    this.#tool = null;
    this.#selection.clear();
    this.#snap_indicator.destroy();
    this.canvas.svg.removeEventListener('keydown', this.#onKeyDown, true);
    this.#detachDocument();
    for (const g of [this.#controls, this.#temp, this.#guides, this.#grids]) g.destroy();
    this.#disconnectZoomFromDocument?.();
    this.#viewport.remove();
    for (const view of this.#page_views.values()) view.remove();
    this.#page_views.clear();
    this.#pages_bg.destroy();
    this.#pages_fg.destroy();
    for (const g of [
      this._canvas_group_pages_bg,
      this._canvas_group_drawing,
      this._canvas_group_pages_fg,
      this._canvas_group_grids,
      this._canvas_group_guides,
      this._canvas_group_temp,
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
  /** The group of the grids, above the drawing. */
  getCanvasGrids(): CanvasItemGroup {
    return this.#grids;
  }
  /** The group of the guides, above the grids. */
  getCanvasGuides(): CanvasItemGroup {
    return this.#guides;
  }
  /** The group of temporary items (snap indicator), below the controls. */
  getCanvasTemp(): CanvasItemGroup {
    return this.#temp;
  }
  getNamedView(): SPNamedView {
    return this.doc.getNamedView();
  }
  getSnapIndicator(): SnapIndicator {
    return this.#snap_indicator;
  }
  /** The snap manager (upstream desktop->getNamedView()->snap_manager). */
  getSnapManager(): SnapManager {
    return this.#snap_manager;
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
    if (this.#tool) {
      this.#tool.switching_away(toolName);
      this.#tool.destroy();
      this.#tool = null;
    }
    if (toolName) {
      this.#tool = createTool(this, toolName);
      // Switch back, though we don't know what the tool was
      if (!this.#tool.is_ready()) {
        this.setTool('/tools/select');
        return;
      }
    }
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

  emit_gradient_stop_selected(stop: SPStop | null): void {
    this.#gradient_stop_selected_signal.emit(stop);
  }

  connect_gradient_stop_selected(slot: (stop: SPStop | null) => void): () => void {
    return this.#gradient_stop_selected_signal.connect(slot);
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
    this.#document_replaced_signal.emit(this, doc);
  }

  connectDocumentReplaced(slot: (desktop: SPDesktop, doc: SPDocument) => void): () => void {
    return this.#document_replaced_signal.connect(slot);
  }

  #attachDocument(): void {
    const doc = this.doc;
    doc.ensureUpToDate();
    const ai = doc.getRoot().invokeShow(this.#drawing, this.dkey, SP_ITEM_SHOW_DISPLAY);
    if (ai) this.#drawing.root.appendChild(ai);
    this.#drawing.root.setTransform(this.doc2dt());
    if (this.#splitMode !== SplitMode.NORMAL) this.setSplitMode(this.#splitMode);
    this.#layerManager._setDocument(doc);
    this.#updateLayersFromDocument();
    this.#updatePage();
    this.#showNamedView(doc.getNamedView());
    const lpe_texts = new LPECanvasTexts(this, doc);
    lpe_texts.update();
    const disconnectModified = doc.modifiedSignal.connect(() => {
      this.#updatePage();
      lpe_texts.update();
      if (this.#drawing.getRenderMode() === RenderMode.VISIBLE_HAIRLINES) this.#drawing.updateHairlines();
    });
    // The effects change their text while the document updates, and the undo steps end with a commit.
    const disconnectCommit = doc.commitSignal.connect(() => lpe_texts.update());
    const disconnectText = TextParam.canvasTextChanged.connect(() => lpe_texts.update());
    const disconnectNamedView = doc.getNamedView().changedSignal.connect(() => this.#updatePage());
    const disconnectPages = doc.getPageManager().connectPagesChanged(() => this.#updatePage());
    const disconnectStart = doc.reconstructionStartSignal.connect(() => this.reconstruction_start());
    const disconnectFinish = doc.reconstructionFinishSignal.connect(() => this.reconstruction_finish());
    this.#disconnectModified = () => {
      lpe_texts.destroy();
      disconnectModified();
      disconnectCommit();
      disconnectText();
      disconnectNamedView();
      disconnectPages();
      disconnectStart();
      disconnectFinish();
    };
  }

  /** Before the document is rebuilt: keep the id of the current layer (upstream reconstruction_start). */
  reconstruction_start(): void {
    this.#reconstruction_old_layer_id = this.#layerManager.currentLayer()?.getId() ?? '';
    this.#layerManager.reset();
    this.#selection.clear();
  }

  /** After the document is rebuilt: the layer with the kept id is the current layer again. */
  reconstruction_finish(): void {
    if (this.#reconstruction_old_layer_id) {
      const newLayer = this.doc.getObjectById(this.#reconstruction_old_layer_id);
      if (newLayer) this.#layerManager.setCurrentLayer(newLayer);
      this.#reconstruction_old_layer_id = '';
    }
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
    this.#hideNamedView();
    for (const view of this.#page_views.values()) view.remove();
    this.#page_views.clear();
    this.#hideOutline();
    this.doc.getRoot().invokeHide(this.dkey);
    this.#drawing.paintServers.clear();
  }

  /**
   * Show the pages of the PageManager (or the viewport without pages) with the colors of the
   * namedview and set the desk color (upstream SPNamedView::updateViewPort, SPPage::update and
   * set_desk_color).
   */
  #updatePage(): void {
    const nv = this.doc.getNamedView();
    const pm = this.doc.getPageManager();
    const desk = nv.getDeskColor();
    desk.setOpacity(nv.checkerboard.value ? 0 : 1);
    this.canvas.set_desk(desk.toRGBA());

    if (nv.updateViewPort()) {
      this.#setDefaultAttributes(this.#viewport);
      this.#viewport.show();
      this.#viewport.update(
        this.doc.preferredBounds().transformed(this.doc2dt()),
        null,
        null,
        '',
        pm.hasPages(),
      );
    } else {
      this.#viewport.hide();
    }

    // Clip to page (upstream SPNamedView::set_clip_to_page): to the selected page, else the viewport.
    const clip = nv.clip_to_page.value ? (pm.getSelectedPageRect() ?? this.doc.preferredBounds()) : null;
    const clip_dt = clip?.transformed(this.doc2dt());
    this.#drawing.setClipToRect(
      clip_dt
        ? { x: clip_dt.left(), y: clip_dt.top(), width: clip_dt.width(), height: clip_dt.height() }
        : null,
    );

    const pages = new Set(pm.getPages());
    for (const [page, view] of this.#page_views) {
      if (pages.has(page)) continue;
      view.remove();
      this.#page_views.delete(page);
    }
    for (const page of pages) {
      let view = this.#page_views.get(page);
      if (!view) {
        view = new CanvasPage();
        view.add(page.getDesktopRect(), this.#pages_bg, this.#pages_fg);
        this.#page_views.set(page, view);
      }
      this.#setDefaultAttributes(view);
      view.is_selected = page.is_selected;
      view.update(
        page.getDesktopRect(),
        page.getDesktopMargin(),
        page.getDesktopBleed(),
        page.getCanvasLabel(),
        false,
        this.doc.yaxisdir() > 0,
      );
    }
  }

  /** Update the canvas item with the display attributes of the namedview (upstream PageManager::setDefaultAttributes). */
  #setDefaultAttributes(item: CanvasPage): void {
    const nv = this.doc.getNamedView();
    const border = nv.getBorderColor();
    if (!nv.border_show.value) border.setOpacity(0);
    // note: page background color doesn't have configurable transparency; it is considered to be opaque;
    // here alpha gets manipulated to reveal checkerboard pattern, if needed
    const bg = nv.getBackgroundColor();
    bg.setOpacity(nv.checkerboard.value ? 0 : 1);
    item.setOnTop(nv.border_on_top.value);
    // fixed shadow size, not configurable; shadow changes size with zoom
    item.setShadow(nv.border_show.value && nv.shadow_show.value ? 2 : 0);
    item.setPageColor(
      border.toRGBA(),
      bg.toRGBA(),
      nv.getDeskColor().toRGBA(),
      DEFAULT_MARGIN_COLOR,
      DEFAULT_BLEED_COLOR,
      this.doc.getPageManager().getShadowColor(),
    );
    item.setLabelStyle(nv.label_style);
  }

  // Guides and grids (upstream SPNamedView::show and hide)

  /** Show the guides and grids of nv and follow their changes. */
  #showNamedView(nv: SPNamedView): void {
    const sync = () => this.#syncNamedView(nv);
    const off = [nv.guidesAndGridsChangedSignal.connect(sync), nv.changedSignal.connect(sync)];
    this.#disconnectNamedView = () => {
      for (const f of off) f();
    };
    sync();
  }

  #hideNamedView(): void {
    this.#disconnectNamedView?.();
    this.#disconnectNamedView = null;
    for (const { item, disconnect } of [...this.#guide_views.values(), ...this.#grid_views.values()]) {
      disconnect();
      item.unlink();
    }
    this.#guide_views.clear();
    this.#grid_views.clear();
  }

  /** Create and remove the views of the guides and grids of nv, and show or hide the guides. */
  #syncNamedView(nv: SPNamedView): void {
    for (const [guide, view] of this.#guide_views) {
      if (nv.guides.includes(guide)) continue;
      view.disconnect();
      view.item.unlink();
      this.#guide_views.delete(guide);
    }
    for (const guide of nv.guides) {
      if (this.#guide_views.has(guide)) continue;
      const item = new CanvasItemGuideLine(
        this.#guides,
        guide.label() ?? '',
        guide.getPoint(),
        guide.getNormal(),
      );
      item.set_stroke(guide.getColor());
      item.set_locked(guide.getLocked());
      guide.views.push(item);
      const off = sp_dt_guide_event(this, item, guide);
      const disconnect = () => {
        off();
        guide.views = guide.views.filter((v) => v !== item);
      };
      this.#guide_views.set(guide, { item, disconnect });
    }
    const show = nv.getShowGuides() && nv.editable;
    for (const { item } of this.#guide_views.values()) item.set_visible(show);

    for (const [grid, view] of this.#grid_views) {
      if (nv.grids.includes(grid)) continue;
      view.disconnect();
      view.item.unlink();
      this.#grid_views.delete(grid);
    }
    for (const grid of nv.grids) {
      if (this.#grid_views.has(grid)) continue;
      const item = new CanvasItemGridXY(this.#grids);
      const update = () => {
        // upstream SPGrid::update
        const { origin, spacing } = grid.getEffectiveOriginAndSpacing();
        item.set_visible(grid.isVisible() && grid.isEnabled());
        item.set_origin(origin.transformed(this.doc2dt()));
        item.set_spacing(spacing);
        item.set_major_color(grid.getMajorColor().toRGBA());
        item.set_minor_color(grid.getMinorColor().toRGBA());
        item.set_dotted(grid.getDotted());
        item.set_major_line_interval(grid.getMajorLineInterval());
      };
      update();
      this.#grid_views.set(grid, { item, disconnect: grid.changedSignal.connect(update) });
    }
  }

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (sp_dt_guide_key_event(this, event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  /** The visible area in desktop coordinates. */
  get_display_area(): Rect {
    return this.canvas.get_area_world().transformed(this._current_affine.w2d());
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

  /**
   * The items at the points (world coordinates, as upstream), each once, in
   * the order found (upstream getItemsAtPoints): groups are entered;
   * topmost_only takes the topmost item at each point; without all_layers
   * only items in the current layer count; limit 0 is no limit. Without
   * active_only, hidden and locked items count too (see #hiddenItemsAt()).
   */
  getItemsAtPoints(
    points: readonly Point[],
    all_layers = true,
    topmost_only = true,
    limit = 0,
    active_only = true,
  ): SPItem[] {
    const result: SPItem[] = [];
    const current_layer = this.#layerManager.currentLayer();
    const window_origin = this.canvas.get_area_world().min();
    for (const point of points) {
      const items = this.#pickCandidates(point.sub(window_origin), true, active_only);
      if (!active_only)
        items.push(...this.#hiddenItemsAt(point.transformed(this.w2d()).transformed(this.dt2doc())));
      for (const item of topmost_only ? items.slice(0, 1) : items) {
        if (result.includes(item)) continue;
        if (!all_layers && this.#layerManager.layerForObject(item) !== current_layer) continue;
        result.push(item);
        //limit 0 = no limit
        if (result.length === limit) return result;
      }
    }
    return result;
  }

  /**
   * The items of the flat item list (groups entered) that the browser does not draw, because they
   * or a group above them are hidden, and that are at p (document coordinates): a shape when p
   * is in its fill or on its stroke, another item when p is in its visual bounding box
   * (upstream: sticky picking of the drawing).
   */
  #hiddenItemsAt(p: Point): SPItem[] {
    const result: SPItem[] = [];
    const visit = (o: SPObject, hidden: boolean): void => {
      for (const child of o.children) {
        if (!(child instanceof SPItem)) continue;
        const child_hidden = hidden || child.isHidden();
        if (child instanceof SPGroup) visit(child, child_hidden);
        else if (child_hidden && hiddenItemContains(child, p)) result.push(child);
      }
    };
    visit(this.doc.getRoot(), false);
    return result;
  }

  /** The topmost non-layer group at window point p (upstream getGroupAtPoint). */
  getGroupAtPoint(p: Point): SPItem | null {
    for (const item of this.#pickCandidates(p, false)) if (item instanceof SPGroup) return item;
    return null;
  }

  /** The pickable items at window point p, topmost first (upstream: the flat item list, picked in z-order). Without active_only, locked items count too. */
  #pickCandidates(p: Point, into_groups: boolean, active_only = true): SPItem[] {
    const svg = this.canvas.svg;
    const r = svg.getBoundingClientRect();
    const result: SPItem[] = [];
    for (const el of svg.ownerDocument.elementsFromPoint(r.left + p.x, r.top + p.y)) {
      if (!this._canvas_group_drawing.contains(el)) continue;
      // Display items without item (the spans of a text) give the item of their parent.
      let di = SvgDrawingItem.itemFromElement(el);
      while (di && !di.item()) di = SvgDrawingItem.itemFromElement(di.element.parentElement);
      const hit = di?.item();
      const item = hit ? this.#flatListItem(hit, into_groups) : null;
      if (item && !result.includes(item) && (!active_only || item.isVisibleAndUnlocked())) result.push(item);
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

  /** The pointer position in desktop coordinates, or the center of the window if the pointer is outside. */
  point(): Point {
    const pt = this.canvas.get_last_mouse() ?? this.canvas.get_dimensions().div(2.0);
    return this.w2d(this.canvas.canvas_to_world(pt));
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
  set_display_area(a?: boolean | Point | Rect, b?: Point | number, log = true): void {
    if (a instanceof Point && b instanceof Point) {
      // The relative offset needed to keep c at w.
      this._current_affine.addOffset(this.d2w(a).sub(b));
      this.#applyDisplayArea(log);
      return;
    }
    if (a instanceof Rect && typeof b === 'number') {
      this.#setDisplayAreaRect(a, b, log);
      return;
    }
    this.#applyDisplayArea(typeof a === 'boolean' ? a : true);
  }

  /** Apply _current_affine (complete, with the offset) to the canvas; with log, remember it for zoom previous/next. */
  #applyDisplayArea(log: boolean): void {
    if (log) {
      this.#transforms_past.unshift(this._current_affine.clone());
      // a logged transform invalidates the transforms that came after
      this.#transforms_future.length = 0;
    }
    this.canvas.set_pos(this._current_affine.getOffset());
    this.canvas.set_affine(this._current_affine.d2w());
    this.signal_zoom_changed.emit(this._current_affine.getZoom());
  }

  /** The transforms that were shown, the current one first (upstream transforms_past). */
  readonly #transforms_past: DesktopAffine[] = [];
  readonly #transforms_future: DesktopAffine[] = [];

  /** Go back to the previous transform of the history (upstream prev_transform); false if there is none. */
  prev_transform(): boolean {
    if (this.#transforms_past.length <= 1) return false; // "No previous transform."
    const current = this.#transforms_past.shift();
    if (current) this.#transforms_future.unshift(current);
    const prev = this.#transforms_past[0];
    if (prev) this._current_affine.assign(prev);
    this.#applyDisplayArea(false);
    return true;
  }

  /** Go to the next transform of the history (upstream next_transform); false if there is none. */
  next_transform(): boolean {
    const next = this.#transforms_future.shift();
    if (!next) return false; // "No next transform."
    this._current_affine.assign(next);
    this.#applyDisplayArea(false);
    this.#transforms_past.unshift(next.clone());
    return true;
  }

  clear_transform_history(): void {
    this.#transforms_past.length = 0;
    this.#transforms_future.length = 0;
  }

  /** Render the drawing in the mode (upstream setRenderMode). */
  setRenderMode(mode: RenderMode): void {
    this.#drawing.setRenderMode(mode);
    // The thin strokes depend on the zoom.
    this.#disconnectHairlines?.();
    this.#disconnectHairlines =
      mode === RenderMode.VISIBLE_HAIRLINES
        ? this.canvas.connectAffine(() => this.#drawing.updateHairlines())
        : null;
  }
  #disconnectHairlines: (() => void) | null = null;
  getRenderMode(): RenderMode {
    return this.#drawing.getRenderMode();
  }

  getSplitMode(): SplitMode {
    return this.#splitMode;
  }

  /**
   * Show part of the canvas in outline mode (upstream Canvas::set_split_mode): the outline view is
   * a second view of the document, clipped to the right half of the window or to a circle around
   * the pointer.
   */
  setSplitMode(mode: SplitMode): void {
    this.#splitMode = mode;
    if (mode === SplitMode.NORMAL) {
      this.#hideOutline();
      return;
    }
    this.#showOutline();
    this.#updateSplitClip();
  }

  #showOutline(): void {
    if (this.#outline || !this.doc) return;
    const dom = this.canvas.svg.ownerDocument;
    const drawing = new SvgDrawing(dom);
    drawing.setRenderMode(RenderMode.OUTLINE);
    const key = SPItem.displayKeyNew(1);
    const ai = this.doc.getRoot().invokeShow(drawing, key, SP_ITEM_SHOW_DISPLAY);
    if (ai) drawing.root.appendChild(ai);
    drawing.root.setTransform(this.doc2dt());
    const group = dom.createElementNS('http://www.w3.org/2000/svg', 'g') as SVGGElement;
    // The outline view hides the normal one below it: it needs the page color behind its lines.
    const clipPath = dom.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
    const clip = dom.createElementNS('http://www.w3.org/2000/svg', 'path') as SVGPathElement;
    const id = drawing.uniqueId('split');
    clipPath.setAttribute('id', id);
    clipPath.append(clip);
    group.setAttribute('clip-path', `url(#${id})`);
    const backdrop = dom.createElementNS('http://www.w3.org/2000/svg', 'rect');
    backdrop.setAttribute('x', '-1e6');
    backdrop.setAttribute('y', '-1e6');
    backdrop.setAttribute('width', '2e6');
    backdrop.setAttribute('height', '2e6');
    backdrop.setAttribute('fill', '#fff');
    group.append(clipPath, drawing.defs, backdrop, drawing.root.element);
    this._canvas_group_drawing.after(group);
    this.#outline = { drawing, key, group, clip };
    this.#disconnectSplit = [
      this.canvas.connectAffine(() => this.#updateSplitClip()),
      this.canvas.connectPos(() => this.#updateSplitClip()),
      this.canvas.connectResize(() => this.#updateSplitClip()),
    ];
    const move = () => this.#updateSplitClip();
    this.canvas.svg.addEventListener('pointermove', move);
    this.#disconnectSplit.push(() => this.canvas.svg.removeEventListener('pointermove', move));
  }

  #hideOutline(): void {
    for (const f of this.#disconnectSplit) f();
    this.#disconnectSplit = [];
    const outline = this.#outline;
    if (!outline) return;
    this.doc?.getRoot().invokeHide(outline.key);
    outline.group.remove();
    this.#outline = null;
  }

  /** The clip of the outline view in desktop coordinates: the window area for the mode mapped by w2d. */
  #updateSplitClip(): void {
    const outline = this.#outline;
    if (!outline) return;
    const size = this.canvas.get_dimensions();
    const toDesktop = (p: Point) => this.w2d(this.canvas.canvas_to_world(p));
    const poly = (pts: Point[]) => `M ${pts.map((p) => `${toDesktop(p).x},${toDesktop(p).y}`).join(' L ')} Z`;
    if (this.#splitMode === SplitMode.SPLIT) {
      outline.clip.setAttribute(
        'd',
        poly([
          new Point(size.x / 2, 0),
          new Point(size.x, 0),
          new Point(size.x, size.y),
          new Point(size.x / 2, size.y),
        ]),
      );
    } else {
      const radius = Preferences.get().getDouble('/options/rendering/xray-radius', 100);
      const c = this.canvas.get_last_mouse() ?? size.div(2);
      const n = 48;
      outline.clip.setAttribute(
        'd',
        poly(
          Array.from({ length: n }, (_, i) =>
            c.add(new Point(Math.cos((2 * Math.PI * i) / n), Math.sin((2 * Math.PI * i) / n)).mul(radius)),
          ),
        ),
      );
    }
  }

  /** The rotation of the canvas in radians. */
  current_rotation(): number {
    return this._current_affine.getRotation();
  }

  /** Whether the rotation is locked (upstream set_rotation_lock; /options/rotationlock). */
  rotation_lock = Preferences.get().getBool('/options/rotationlock', false);

  /** Set the rotation (radians), keeping desktop point c fixed in the window. */
  rotate_absolute_keep_point(c: Point, rotate: number): void {
    const w = this.d2w(c); // Must be before rotate changed.
    this._current_affine.setRotate(rotate);
    this.set_display_area(c, w);
  }
  rotate_relative_keep_point(c: Point, rotate: number): void {
    const w = this.d2w(c);
    this._current_affine.addRotate(rotate);
    this.set_display_area(c, w);
  }
  /** Set the rotation (radians), aligning desktop point c to the center of the window. */
  rotate_absolute_center_point(c: Point, rotate: number): void {
    this._current_affine.setRotate(rotate);
    this.set_display_area(c, this.canvas.get_area_world().midpoint());
  }
  rotate_relative_center_point(c: Point, rotate: number): void {
    this._current_affine.addRotate(rotate);
    this.set_display_area(c, this.canvas.get_area_world().midpoint());
  }

  flip_absolute_keep_point(c: Point, flip: CanvasFlip): void {
    const w = this.d2w(c);
    this._current_affine.setFlip(flip);
    this.set_display_area(c, w);
  }
  flip_relative_keep_point(c: Point, flip: CanvasFlip): void {
    const w = this.d2w(c);
    this._current_affine.addFlip(flip);
    this.set_display_area(c, w);
  }
  flip_absolute_center_point(c: Point, flip: CanvasFlip): void {
    this._current_affine.setFlip(flip);
    this.set_display_area(c, this.canvas.get_area_world().midpoint());
  }
  flip_relative_center_point(c: Point, flip: CanvasFlip): void {
    this._current_affine.addFlip(flip);
    this.set_display_area(c, this.canvas.get_area_world().midpoint());
  }
  is_flipped(flip: CanvasFlip): boolean {
    return this._current_affine.isFlipped(flip);
  }

  #setDisplayAreaRect(r: Rect, border: number, log: boolean): void {
    // A rectangle the size of the window aligned with origin, shrunk by the border.
    const w = new Rect(new Point(0, 0), this.canvas.get_dimensions()).expandBy(-border);
    // Determine which direction limits scale.
    let zoom =
      r.width() * w.height() > r.height() * w.width() ? w.width() / r.width() : w.height() / r.height();
    zoom = clamp(zoom, SP_DESKTOP_ZOOM_MIN, SP_DESKTOP_ZOOM_MAX);
    this._current_affine.setScale(Scale(zoom, this.yaxisdir() * zoom));
    // Zero offset, actual offset calculated later.
    this._current_affine.setOffset(new Point(0, 0));
    this.set_display_area(r.midpoint(), w.midpoint(), log);
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

  /** Zoom to fit the selected page, or the document without pages, in the window (upstream PageManager::zoomToSelectedPage). */
  zoom_page(): void {
    const rect = this.doc.getPageManager().getSelectedPageRect();
    if (rect.minExtent() < 1.0) return;
    this.set_display_area(rect, 10);
  }

  /** Zoom to fit the width of the page (upstream PageManager::zoomToSelectedPage with width_only). */
  zoom_page_width(): void {
    const rect = this.doc.getPageManager().getSelectedPageRect();
    if (rect.minExtent() < 1.0) return;
    this.set_display_width(rect, 10);
  }

  /** Center the page without zooming (upstream PageManager::centerToSelectedPage). */
  center_page(): void {
    this.set_display_center(this.doc.getPageManager().getSelectedPageRect());
  }

  /** Zoom to the visual bounding box of the selection. */
  zoom_selection(): void {
    const d = this.#selection.visualBounds();
    if (!d || d.minExtent() < 0.1) return;
    this.set_display_area(d, 10);
  }

  /**
   * Set the display area in only the width dimension (upstream
   * set_display_width; upstream takes the width as the right edge, which is
   * wrong unless left is 0).
   */
  set_display_width(rect: Rect, border: number): void {
    if (rect.width() < 1.0) return;
    const center_y = this.current_center().y;
    this.set_display_area(
      new Rect(new Point(rect.left(), center_y), new Point(rect.right(), center_y)),
      border,
    );
  }

  /** Center rect without zooming. */
  set_display_center(rect: Rect): void {
    this.zoom_absolute(rect.midpoint(), this.current_zoom(), false);
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

/**
 * Write the view of desktop into the namedview: zoom, center and current layer (upstream
 * sp_namedview_document_from_window, in sp-namedview.cpp). The extensions read them, e.g. to
 * place new objects in the middle of the view. Not undoable.
 * TODO: the window geometry (/options/savewindowgeometry/value), the rotation.
 */
export function sp_namedview_document_from_window(desktop: SPDesktop): void {
  const save_viewport_in_file = Preferences.get().getBool('/options/savedocviewport/value', true);
  const view = desktop.getNamedView().getRepr();
  // saving window geometry is not undoable
  DocumentUndo.scopedInsensitive(desktop.getDocument(), () => {
    if (save_viewport_in_file) {
      view.setAttributeSvgDouble('inkscape:zoom', desktop.current_zoom());
      const center = desktop.current_center();
      view.setAttributeSvgDouble('inkscape:cx', center.x);
      view.setAttributeSvgDouble('inkscape:cy', center.y);
    }
    view.setAttribute('inkscape:current-layer', desktop.layerManager().currentLayer()?.getId() ?? null);
  });
}

/**
 * Whether the item is at p (document coordinates), see SPDesktop.#hiddenItemsAt(). A shape is
 * at p when p is in its fill or on its stroke, and inside the bounding box of its clip and mask;
 * a shape with markers, and any other item, when p is in its visual bounding box (which includes
 * the markers).
 */
function hiddenItemContains(item: SPItem, p: Point): boolean {
  if (!(item instanceof SPShape) || item.hasMarkers()) return !!item.documentVisualBounds()?.contains(p);
  // The visual bounding box is cut by the clip and the mask.
  if ((item.getClipObject() || item.getMaskObject()) && !item.documentVisualBounds()?.contains(p))
    return false;
  const curve = item.curve();
  if (!curve) return false;
  const i2doc = item.i2docAffine();
  const local = p.transformed(i2doc.inverse());
  const style = item.style;
  if (!style.fill.isNone()) {
    const wind = PathVector.winding(curve, local);
    if (style.fill_rule.computed === SPWindRule.SP_WIND_RULE_EVENODD ? wind % 2 !== 0 : wind !== 0)
      return true;
  }
  if (style.stroke.isNone()) return false;
  // On the stroke: nearer to the outline than half the stroke width (in the item's coordinates),
  // or than 1 px.
  const t = pathv_nearest_time(curve, local);
  if (!t) return false;
  const nearest = pathv_point_at(curve, t);
  return (
    nearest.sub(local).length() <= style.stroke_width.computed / 2 ||
    nearest.transformed(i2doc).sub(p).length() <= 1
  );
}
