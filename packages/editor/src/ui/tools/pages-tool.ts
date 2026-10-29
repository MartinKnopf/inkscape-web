// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/pages-tool.cpp, src/ui/tools/pages-tool.h
/*
 * Page editing tool
 *
 * Authors:
 *   Martin Owens <doctormo@geek-2.com>
 *
 * Copyright (C) 2021 Martin Owens
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import {
  _,
  C_,
  DocumentUndo,
  PageManager,
  Preferences,
  SnapCandidatePoint,
  SnapSourceType,
  SnapTargetType,
  type SPDocument,
  type SPItem,
  type SPObject,
  SPPage,
  SPShape,
} from '@inkscape-web/core';
import { type Affine, L2, Point, PathVector as PV, Rect, Translate } from '@inkscape-web/geom';
import type { SPDesktop } from '../../desktop.ts';
import { CanvasItemBpath } from '../../display/control/canvas-item-bpath.ts';
import { CanvasItemCtrlType } from '../../display/control/canvas-item-ctrl.ts';
import { CanvasItemRect } from '../../display/control/canvas-item-rect.ts';
import { SPAnchorType } from '../../enums.ts';
import { getBBoxPoints } from '../../object-snapper.ts';
import { PureTranslate } from '../../pure-transform.ts';
import { SPKnot } from '../knot/knot.ts';
import { type ModifierState, mod_trans_confine, ToolBase } from './tool-base.ts';

/** move-no-snapping has no modifier in share/keys/inkscape.xml. */
const mod_move_no_snapping = (_s: ModifierState): boolean => false;

/** The middle of the side of the rectangle (side 0 is the top, then clockwise). */
function middleOfSide(side: number, rect: Rect): Point {
  return rect
    .corner(side)
    .add(rect.corner((side + 1) % 4))
    .div(2);
}

/**
 * The pages tool (upstream PagesTool): drag on the canvas to create a page,
 * click a page to select it, drag a page to move it (with the objects on it,
 * if "move objects with page" is on), drag the corner knots to resize the
 * selected page and the side knots to set its margins. Delete removes the
 * selected page. Without pages, the knots resize the document viewport.
 * TODO: the root offset knot (svg x and y), the context menu, cursors.
 */
export class PagesTool extends ToolBase {
  dragging_viewbox = false;
  mouse_is_pressed = false;
  drag_origin_w = new Point(0, 0);
  drag_origin_dt = new Point(0, 0);
  drag_tolerance = 5;

  readonly resize_knots: SPKnot[] = [];
  readonly margin_knots: SPKnot[] = [];
  highlight_item: SPPage | null = null;
  dragging_item: SPPage | null = null;
  /** On-screen rectangle, in desktop coordinates. */
  on_screen_rect: Rect | null = null;
  readonly #visual_box: CanvasItemRect;
  #drag_shapes: (CanvasItemRect | CanvasItemBpath)[] = [];
  #bbox_points: SnapCandidatePoint[] = [];
  /** The selection before the tool started; restored when it ends (upstream _selection_state). */
  readonly #selection_state: SPItem[];

  #disconnect_selector_changed: (() => void) | null = null;
  #disconnect_page_modified: (() => void) | null = null;
  readonly #disconnect_doc_replaced: () => void;
  readonly #disconnect_zoom: () => void;

  constructor(desktop: SPDesktop) {
    super(desktop, '/tools/pages');
    // Save selection state and clear selection before using the tool
    this.#selection_state = desktop.getSelection().items();
    desktop.getSelection().clear();

    this.drag_tolerance = Math.min(
      Math.max(Preferences.get().getInt('/options/dragtolerance/value', 0), 0),
      100,
    );

    for (let i = 0; i < 4; i++) {
      const knot = new SPKnot(desktop, _('Resize page'), CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_SIZER);
      knot.setAnchor(SPAnchorType.SP_ANCHOR_CENTER);
      knot.hide();
      knot.moved_signal.connect((k, p, state) => this.resizeKnotMoved(k, p, state));
      knot.ungrabbed_signal.connect(() => this.resizeKnotFinished());
      this.resize_knots.push(knot);

      const m_knot = new SPKnot(
        desktop,
        _('Set page margin'),
        CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_MARGIN,
      );
      m_knot.setAnchor(SPAnchorType.SP_ANCHOR_CENTER);
      m_knot.hide();
      m_knot.request = (k, p, state) => this.marginKnotMoved(k, p, state);
      this.margin_knots.push(m_knot);
    }

    this.#visual_box = new CanvasItemRect(desktop.getCanvasControls());
    this.#visual_box.set_stroke(0x0000ff7f);
    this.#visual_box.set_visible(false);

    this.#disconnect_doc_replaced = desktop.connectDocumentReplaced((dt) =>
      this.connectDocument(dt.getDocument()),
    );
    this.connectDocument(desktop.getDocument());

    this.#disconnect_zoom = desktop.signal_zoom_changed.connect(() => {
      // This readjusts the knot on zoom because the viewbox position
      // becomes detached on zoom, likely a precision problem.
      if (!desktop.getDocument().getPageManager().hasPages())
        this.selectionChanged(desktop.getDocument(), null);
    });
  }

  override destroy(): void {
    this.connectDocument(null);
    this.ungrabCanvasEvents();
    this.#visual_box.unlink();
    for (const knot of [...this.resize_knots, ...this.margin_knots]) knot.destroy();
    this.clearDragShapes();
    this.#disconnect_doc_replaced();
    this.#disconnect_zoom();
    // upstream switching_away: restore the selection
    this._desktop.getSelection().setList(this.#selection_state.filter((item) => item.document));
    super.destroy();
  }

  resizeKnotSet(rect: Rect): void {
    this.resize_knots.forEach((knot, i) => {
      knot.moveto(rect.corner(i));
      knot.show();
    });
  }

  /** Place the margin knots on the sides of margin_rect (document coordinates). */
  marginKnotSet(margin_rect: Rect): void {
    this.margin_knots.forEach((knot, i) => {
      knot.moveto(middleOfSide(i, margin_rect).transformed(this._desktop.doc2dt()));
      knot.show();
    });
  }

  resizeKnotMoved(knot: SPKnot, _ppointer: Point, state: ModifierState): void {
    const document = this._desktop.getDocument();
    const page = document.getPageManager().getSelected();
    // Resizing a specific selected page, or the naked viewBox
    let rect = page ? page.getDesktopRect() : document.preferredBounds().transformed(document.doc2dt());

    const index = this.resize_knots.indexOf(knot);
    const start = rect.corner(index);
    const point = this.getSnappedResizePoint(knot.position(), state, start, page);

    if (!point.equals(start)) {
      rect = new Rect(rect.corner((index + 2) % 4), point);
      this.#visual_box.set_visible(true);
      this.#visual_box.set_rect(rect);
      this.on_screen_rect = rect;
      this.mouse_is_pressed = true;
    }
  }

  resizeKnotFinished(): void {
    const document = this._desktop.getDocument();
    const page = document.getPageManager().getSelected();
    if (this.on_screen_rect) {
      document.getPageManager().fitToRect(this.on_screen_rect.transformed(document.dt2doc()), page);
      DocumentUndo.done(document, C_('Undo', 'Resize page'), 'tool-pages');
      this.on_screen_rect = null;
    }
    this.#visual_box.set_visible(false);
    this.mouse_is_pressed = false;
  }

  /** Resize snapping allows knot and tool point snapping consistency. */
  getSnappedResizePoint(
    point: Point,
    state: ModifierState,
    origin: Point | null,
    target: SPObject | null = null,
  ): Point {
    if (mod_move_no_snapping(state)) return point;
    const m = this._desktop.getSnapManager();
    m.setup(this._desktop, true, target);
    const scp = new SnapCandidatePoint(point, SnapSourceType.SNAPSOURCE_PAGE_CORNER);
    if (origin) scp.addOrigin(origin);
    const sp = m.freeSnap(scp);
    m.unSetup();
    return sp.getPoint();
  }

  marginKnotMoved(knot: SPKnot, ppointer: Point, state: ModifierState): boolean {
    const document = this._desktop.getDocument();
    const pm = document.getPageManager();

    // Editing margins creates a page for the margin to be stored in.
    pm.enablePages();

    const page = pm.getSelected();
    if (!page) {
      console.warn("Can't add margin, pages not enabled correctly!");
      return true;
    }
    let point = ppointer.transformed(document.dt2doc());

    // Confine knot to edge
    const confine = mod_trans_confine(state);
    if (!mod_move_no_snapping(state)) point = this.getSnappedResizePoint(point, state, null, page);

    // Calculate what we're acting on, clamp it depending on the side.
    const side = this.margin_knots.indexOf(knot);
    const axis = side & 1 ? 'x' : 'y';
    const delta = point.sub(page.getDocumentRect().corner(side))[axis];
    const value = Math.max(0.0, (side + 1) & 2 ? -delta : delta);
    const scale = document.getDocumentScale()[axis];

    // Set to page and back to to knot to inform confinement.
    page.setMarginSide(side, value / scale, confine);
    knot.setPosition(middleOfSide(side, page.getDocumentMargin()).transformed(document.doc2dt()), state);

    DocumentUndo.maybeDone(document, 'page-margin', C_('Undo', 'Adjust page margin'), 'tool-pages');
    return true;
  }

  override root_handler(event: Event): boolean {
    let ret = false;
    const page_manager = this._desktop.getDocument().getPageManager();

    switch (event.type) {
      case 'pointerdown': {
        const e = event as PointerEvent;
        if (e.button !== 0) break;
        this.mouse_is_pressed = true;
        this.drag_origin_w = this._windowPoint(e);
        this.drag_origin_dt = this._desktopPoint(this.drag_origin_w);
        ret = true;
        const page = this.pageUnder(this.drag_origin_dt, false);
        if (page) {
          // Select the clicked on page. Manager ignores the same-page.
          page_manager.selectPage(page);
        } else if (this.viewboxUnder(this.drag_origin_dt)) {
          this.dragging_viewbox = true;
        } else {
          this.drag_origin_dt = this.getSnappedResizePoint(this.drag_origin_dt, e, null);
        }
        this.grabCanvasEvents(e);
        break;
      }
      case 'pointermove': {
        const e = event as PointerEvent;
        const point_w = this._windowPoint(e);
        let point_dt = this._desktopPoint(point_w);
        const snap = !mod_move_no_snapping(e);

        if (e.buttons & 1) {
          if (!this.mouse_is_pressed) {
            // this sometimes happens if the mouse was off the edge when the event started
            this.drag_origin_w = point_w;
            this.drag_origin_dt = point_dt;
            this.mouse_is_pressed = true;
          }

          if (this.dragging_item || this.dragging_viewbox) {
            // Continue to drag item.
            const tr = this.moveTo(point_dt, snap);
            this.addDragShapes(this.dragging_item, tr);
          } else if (this.on_screen_rect) {
            // Continue to drag new box
            point_dt = this.getSnappedResizePoint(point_dt, e, this.drag_origin_dt);
            this.on_screen_rect = new Rect(this.drag_origin_dt, point_dt);
          } else if (L2(this.drag_origin_w.sub(point_w)) < this.drag_tolerance) {
            // do not start dragging anything new if we're within tolerance from origin.
          } else {
            const page = this.pageUnder(this.drag_origin_dt);
            if (page) {
              // Starting to drag page around the screen, the pageUnder must
              // be the drag_origin as small movements can kill the UX feel.
              this.dragging_item = page;
              page_manager.selectPage(page);
              this.addDragShapes(page, Translate(0, 0));
              this.grabPage(page);
            } else if (this.viewboxUnder(this.drag_origin_dt)) {
              // Special handling of viewbox dragging
              this.dragging_viewbox = true;
            } else {
              // Start making a new page.
              this.dragging_item = null;
              this.on_screen_rect = new Rect(this.drag_origin_dt, this.drag_origin_dt);
            }
          }
        } else {
          this.mouse_is_pressed = false;
          this.drag_origin_dt = point_dt;
        }
        break;
      }
      case 'pointerup': {
        const e = event as PointerEvent;
        if (e.button !== 0) break;
        const point_dt = this._desktopPoint(this._windowPoint(e));
        const snap = !mod_move_no_snapping(e);
        const document = this._desktop.getDocument();

        if (this.dragging_viewbox || this.dragging_item) {
          const dragging_item = this.dragging_item;
          if (this.dragging_viewbox || dragging_item?.isViewportPage()) {
            // Move the document's viewport first
            const page_items = page_manager.getOverlappingItems(this._desktop.dkey, dragging_item);
            const rect = document.preferredBounds();
            const affine = this.moveTo(point_dt, snap);
            document.fitToRect(rect.transformed(affine).transformed(document.dt2doc()), false);
            // Now move the page back to where we expect it.
            if (dragging_item) {
              dragging_item.movePage(affine, false);
              dragging_item.setDesktopRect(rect);
            }
            // We have a custom move object because item detection is fubar after fitToRect
            if (PageManager.move_objects()) SPPage.moveItems(affine, page_items);
          } else if (dragging_item) {
            // Move the page object on the canvas.
            dragging_item.movePage(this.moveTo(point_dt, snap), PageManager.move_objects());
          }
          DocumentUndo.done(document, C_('Undo', 'Move page position'), 'tool-pages');
        } else if (this.on_screen_rect) {
          // conclude box here (make new page)
          page_manager.selectPage(page_manager.newDesktopPage(this.on_screen_rect));
          DocumentUndo.done(document, C_('Undo', 'Create new drawn page'), 'tool-pages');
        }
        this.mouse_is_pressed = false;
        this.drag_origin_dt = point_dt;
        ret = true;
        this.ungrabCanvasEvents(e);
        // Clear snap indication on mouse up.
        this._desktop.getSnapIndicator().remove_snaptarget();
        break;
      }
      case 'keydown': {
        const e = event as KeyboardEvent;
        if (e.key === 'Escape') {
          this.mouse_is_pressed = false;
          ret = true;
        }
        if (e.key === 'Delete') {
          page_manager.deleteSelectedPage(PageManager.move_objects());
          DocumentUndo.done(this._desktop.getDocument(), C_('Undo', 'Delete Page'), 'tool-pages');
          ret = true;
        }
        break;
      }
    }

    // Clean up any finished dragging, doesn't matter how it ends
    if (!this.mouse_is_pressed && (this.dragging_item || this.on_screen_rect || this.dragging_viewbox)) {
      this.dragging_viewbox = false;
      this.dragging_item = null;
      this.on_screen_rect = null;
      this.clearDragShapes();
      this.#visual_box.set_visible(false);
      ret = true;
    } else if (this.on_screen_rect) {
      this.#visual_box.set_visible(true);
      this.#visual_box.set_rect(this.on_screen_rect);
      ret = true;
    }
    return ret || super.root_handler(event);
  }

  /** Creates the right snapping setup for dragging items around. */
  grabPage(target: SPPage): void {
    this.#bbox_points = [];
    getBBoxPoints(
      target.getDesktopRect(),
      this.#bbox_points,
      SnapSourceType.SNAPSOURCE_PAGE_CORNER,
      SnapTargetType.SNAPTARGET_UNDEFINED,
      SnapSourceType.SNAPSOURCE_UNDEFINED,
      SnapTargetType.SNAPTARGET_UNDEFINED,
      SnapSourceType.SNAPSOURCE_PAGE_CENTER,
      SnapTargetType.SNAPTARGET_UNDEFINED,
    );
  }

  /** Generate the movement affine as the page is dragged around (including snapping) */
  moveTo(xy: Point, snap: boolean): Affine {
    let dxy = xy.sub(this.drag_origin_dt);
    if (snap && this.#bbox_points.length) {
      const m = this._desktop.getSnapManager();
      m.setup(this._desktop, true, this.dragging_item);
      const T = SnapTargetType;
      m.snapprefs.clearTargetMask(0); // Disable all snapping targets
      for (const target of [
        T.SNAPTARGET_ALIGNMENT_CATEGORY,
        T.SNAPTARGET_ALIGNMENT_PAGE_EDGE_CORNER,
        T.SNAPTARGET_ALIGNMENT_PAGE_EDGE_CENTER,
        T.SNAPTARGET_PAGE_EDGE_CORNER,
        T.SNAPTARGET_PAGE_EDGE_CENTER,
        T.SNAPTARGET_GRID_INTERSECTION,
        T.SNAPTARGET_GUIDE,
        T.SNAPTARGET_GUIDE_INTERSECTION,
      ]) {
        m.snapprefs.setTargetMask(target, -1);
      }
      const bb = new PureTranslate(dxy);
      m.snapTransformed(this.#bbox_points, this.drag_origin_dt, bb);
      if (bb.best_snapped_point.getSnapped()) {
        dxy = bb.getTranslationSnapped();
        this._desktop.getSnapIndicator().set_new_snaptarget(bb.best_snapped_point);
      }
      m.snapprefs.clearTargetMask(-1); // Reset preferences
      m.unSetup();
    }
    return Translate(dxy);
  }

  /** Add all the shapes needed to see it being dragged. */
  addDragShapes(page: SPPage | null, tr: Affine): void {
    this.clearDragShapes();
    const doc = this._desktop.getDocument();
    const rect = page ? page.getDesktopRect() : doc.preferredBounds();
    this.#addDragRect(rect.transformed(tr));
    if (PageManager.move_objects()) {
      for (const item of doc.getPageManager().getOverlappingItems(this._desktop.dkey, page)) {
        if (!item.isLocked()) this.addDragShape(item, tr);
      }
    }
  }

  /** Add an SPItem to the things being dragged: its path, or else its bounding box. */
  addDragShape(item: SPItem, tr: Affine): void {
    const curve = item instanceof SPShape ? item.curve() : null;
    if (curve) {
      const shape = new CanvasItemBpath(
        this._desktop.getCanvasTemp(),
        PV.transformed(curve, item.i2dtAffine().multiply(tr)),
      );
      shape.set_stroke(0x00ff007f);
      shape.set_fill(0x00000000);
      this.#drag_shapes.push(shape);
    } else {
      const box = item.desktopGeometricBounds();
      if (box) this.#addDragRect(box.transformed(tr));
    }
  }

  #addDragRect(rect: Rect): void {
    const shape = new CanvasItemRect(this._desktop.getCanvasTemp(), rect);
    shape.set_stroke(0x00ff007f);
    this.#drag_shapes.push(shape);
  }

  /** Remove all drag shapes from the canvas. */
  clearDragShapes(): void {
    for (const shape of this.#drag_shapes) shape.unlink();
    this.#drag_shapes = [];
  }

  /** Find a page under the cursor point. */
  pageUnder(pt: Point, retain_selected = true): SPPage | null {
    const pm = this._desktop.getDocument().getPageManager();
    // If the point is still on the selected, favour that one.
    const selected = pm.getSelected();
    if (selected && retain_selected && selected.getSensitiveRect().contains(pt)) return selected;
    return pm.findPageAt(pt);
  }

  /** Returns true if the document contains no pages AND the point is within the document viewbox. */
  viewboxUnder(pt: Point): boolean {
    const document = this._desktop.getDocument();
    const rect = document.preferredBounds().expandBy(-0.1); // see sp-page getSensitiveRect
    return !document.getPageManager().hasPages() && rect.contains(pt);
  }

  connectDocument(doc: SPDocument | null): void {
    this.#disconnect_selector_changed?.();
    this.#disconnect_selector_changed = null;
    if (doc) {
      const page_manager = doc.getPageManager();
      this.#disconnect_selector_changed = page_manager.connectPageSelected((page) =>
        this.selectionChanged(doc, page),
      );
      this.selectionChanged(doc, page_manager.getSelected());
    } else {
      this.selectionChanged(null, null);
    }
  }

  selectionChanged(doc: SPDocument | null, page: SPPage | null): void {
    this.#disconnect_page_modified?.();
    this.#disconnect_page_modified = null;
    for (const knot of [...this.resize_knots, ...this.margin_knots]) knot.hide();

    // Loop existing pages because highlight_item is unsafe.
    for (const possible of this._desktop.getDocument().getPageManager().getPages()) {
      if (this.highlight_item === possible) possible.setSelected(false);
    }
    this.highlight_item = page;
    if (!doc) return;
    if (page) {
      this.#disconnect_page_modified = page.modifiedSignal.connect(() => this.pageModified(page));
      page.setSelected(true);
      this.pageModified(page);
    } else {
      // This is for viewBox editng directly. A special extra feature
      const update = () => {
        this.resizeKnotSet(doc.preferredBounds().transformed(doc.doc2dt()));
        this.marginKnotSet(doc.preferredBounds());
      };
      this.#disconnect_page_modified = doc.modifiedSignal.connect(update);
      update();
    }
  }

  pageModified(page: SPPage): void {
    this.resizeKnotSet(page.getDesktopRect());
    this.marginKnotSet(page.getDocumentMargin());
  }
}
