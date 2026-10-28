// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/widget/canvas-grid.cpp, src/ui/widget/canvas-grid.h
/*
 * Author:
 *   Tavmjong Bah
 *
 * Rewrite of code originally in desktop-widget.cpp.
 *
 * Copyright (C) 2020 Tavmjong Bah
 */
import { C_, convertUnit, DocumentUndo, Preferences, SnapTargetType, SPGuide } from '@inkscape-web/core';
import { Point } from '@inkscape-web/geom';
import type { SPDesktop } from '../../desktop.ts';
import { CanvasItemGuideLine } from '../../display/control/canvas-item-guideline.ts';
import { Canvas } from './canvas.ts';
import { RULER_SIZE, Ruler } from './ink-ruler.ts';

/**
 * The canvas with its rulers (upstream CanvasGrid, without the scrollbars):
 * a corner, the horizontal ruler on top, the vertical ruler on the left and
 * the canvas. The rulers show the display unit, the page and the pointer
 * position; dragging from a ruler creates a guide.
 * TODO: scrollbars, the sticky zoom and lock buttons, the ruler context menu,
 * hiding the rulers (win.canvas-rulers).
 */
export class CanvasGrid {
  readonly element: HTMLDivElement;
  readonly canvas: Canvas;
  readonly #hruler: Ruler;
  readonly #vruler: Ruler;
  #desktop: SPDesktop | null = null;
  #disconnect: (() => void)[] = [];

  // Ruler drag state (guide creation)
  #ruler_clicked = false;
  #ruler_dragged = false;
  #ruler_drag_origin = new Point(0, 0);
  #normal = new Point(0, 1);
  #active_guide: CanvasItemGuideLine | null = null;

  constructor(host: HTMLElement) {
    const doc = host.ownerDocument;
    this.element = doc.createElement('div');
    this.element.className = 'canvas-grid';
    Object.assign(this.element.style, {
      display: 'grid',
      gridTemplateColumns: `${RULER_SIZE}px 1fr`,
      gridTemplateRows: `${RULER_SIZE}px 1fr`,
      width: '100%',
      height: '100%',
    });
    const cell = (className: string) => {
      const div = doc.createElement('div');
      div.className = className;
      Object.assign(div.style, { position: 'relative', overflow: 'hidden', minWidth: '0', minHeight: '0' });
      this.element.append(div);
      return div;
    };
    const corner = cell('ruler-corner');
    corner.style.background = '#f4f4f4';
    const htop = cell('ruler-horz');
    const vleft = cell('ruler-vert');
    const canvas_host = cell('canvas-host');
    this.#hruler = new Ruler(doc, true);
    this.#vruler = new Ruler(doc, false);
    htop.append(this.#hruler.element);
    vleft.append(this.#vruler.element);
    host.append(this.element);
    this.canvas = new Canvas(canvas_host);

    for (const [ruler, horiz] of [
      [this.#hruler, true],
      [this.#vruler, false],
    ] as const) {
      const el = ruler.element;
      el.addEventListener('pointerdown', (e) => this.#rulerButtonPress(e, horiz));
      el.addEventListener('pointermove', (e) => this.#rulerMotion(e, horiz));
      el.addEventListener('pointerup', (e) => this.#rulerButtonRelease(e, horiz));
      el.addEventListener('pointercancel', (e) => this.#rulerButtonRelease(e, horiz));
    }
  }

  destroy(): void {
    this.set_desktop(null);
    this.canvas.destroy();
    this.element.remove();
  }

  /** Show the rulers for desktop (the desktop of this canvas). */
  set_desktop(desktop: SPDesktop | null): void {
    for (const f of this.#disconnect) f();
    this.#disconnect = [];
    this.#desktop = desktop;
    if (!desktop) return;
    const update = () => this.updateRulers();
    const svg = this.canvas.svg;
    const onMove = (e: PointerEvent) => {
      const w = this.canvas.windowPoint(e);
      this.#hruler.set_position(w.x);
      this.#vruler.set_position(w.y);
    };
    const onLeave = () => {
      this.#hruler.set_position(Number.NaN);
      this.#vruler.set_position(Number.NaN);
    };
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerleave', onLeave);
    this.#disconnect.push(
      this.canvas.connectAffine(update),
      this.canvas.connectPos(update),
      this.canvas.connectResize(update),
      desktop.connectDocumentReplaced(update),
      () => svg.removeEventListener('pointermove', onMove),
      () => svg.removeEventListener('pointerleave', onLeave),
    );
    // The display unit and the page size come from the document.
    let off_doc: (() => void)[] = [];
    const follow_doc = () => {
      for (const f of off_doc) f();
      const doc = desktop.getDocument();
      off_doc = [doc.getNamedView().changedSignal.connect(update), doc.modifiedSignal.connect(update)];
      update();
    };
    this.#disconnect.push(desktop.connectDocumentReplaced(follow_doc), () => {
      for (const f of off_doc) f();
    });
    follow_doc();
  }

  /** Set the ranges of the rulers from the visible area (upstream updateRulers). */
  updateRulers(): void {
    const desktop = this.#desktop;
    if (!desktop) return;
    const unit = desktop.getNamedView().getDisplayUnit();
    const size = this.canvas.get_dimensions();
    const pos = this.canvas.get_pos();
    const lower = desktop.w2d(pos);
    const upper = desktop.w2d(pos.add(size));
    const u = (px: number) => convertUnit(px, 'px', unit);
    this.#hruler.set_unit(unit);
    this.#vruler.set_unit(unit);
    this.#hruler.set_range(u(lower.x), u(upper.x));
    this.#vruler.set_range(u(lower.y), u(upper.y));
    // The page, in px along the rulers.
    const page = desktop
      .getDocument()
      .preferredBounds()
      .transformed(desktop.doc2dt())
      .transformed(desktop.d2w());
    this.#hruler.set_page(page.left() - pos.x, page.right() - pos.x);
    this.#vruler.set_page(page.top() - pos.y, page.bottom() - pos.y);
  }

  /** The canvas window point of a pointer event on a ruler. */
  #canvasPoint(event: PointerEvent): Point {
    return this.canvas.windowPoint(event);
  }

  #rulerButtonPress(event: PointerEvent, _horiz: boolean): void {
    if (event.button !== 0 || !this.#desktop) return;
    this.#ruler_clicked = true;
    this.#ruler_dragged = false;
    this.#ruler_drag_origin = new Point(Math.floor(event.offsetX), Math.floor(event.offsetY));
    (event.target as Element).setPointerCapture?.(event.pointerId);
  }

  /** Create the temporary guide shown while dragging from a ruler (upstream _createGuideItem). */
  #createGuideItem(pos: Point, horiz: boolean): void {
    const desktop = this.#desktop;
    if (!desktop) return;
    // Ensure new guide is visible
    desktop.getNamedView().setShowGuides(true);
    // Calculate the normal of the guidelines when dragged from the edges of rulers.
    const y_dir = desktop.yaxisdir();
    const normal_bl_to_tr = new Point(1, y_dir).normalized(); // Bottom-left to top-right
    const normal_tr_to_bl = new Point(-1, y_dir).normalized(); // Top-right to bottom-left
    const size = this.canvas.get_dimensions();
    if (horiz) {
      if (pos.x < 50) this.#normal = normal_bl_to_tr;
      else if (pos.x > size.x - 50) this.#normal = normal_tr_to_bl;
      else this.#normal = new Point(0, 1);
    } else {
      if (pos.y < 50) this.#normal = normal_bl_to_tr;
      else if (pos.y > size.y - 50) this.#normal = normal_tr_to_bl;
      else this.#normal = new Point(1, 0);
    }
    this.#active_guide = new CanvasItemGuideLine(
      desktop.getCanvasGuides(),
      '',
      new Point(0, 0),
      this.#normal,
    );
    this.#active_guide.set_stroke(desktop.getNamedView().getGuideHiColor().toRGBA());
  }

  #rulerMotion(event: PointerEvent, horiz: boolean): void {
    if (!this.#ruler_clicked) return;
    const pos = this.#canvasPoint(event);
    if (!this.#ruler_dragged) {
      // Discard small movements without starting a drag.
      const tolerance = Math.min(
        Math.max(Preferences.get().getInt('/options/dragtolerance/value', 0), 0),
        100,
      );
      const d = new Point(Math.floor(event.offsetX), Math.floor(event.offsetY)).sub(this.#ruler_drag_origin);
      if (Math.max(Math.abs(d.x), Math.abs(d.y)) < tolerance) return;
      this.#createGuideItem(pos, horiz);
      this.#ruler_dragged = true;
    }
    const { event_dt, normal } = this.#snappedGuide(pos, event.shiftKey);
    // Apply the position and normal to the guide.
    this.#active_guide?.set_normal(normal);
    this.#active_guide?.set_origin(event_dt);
  }

  /** The desktop point and normal of the new guide at window point pos, snapped unless no_snap (Shift). */
  #snappedGuide(pos: Point, no_snap: boolean): { event_dt: Point; normal: Point } {
    const desktop = this.#desktop as SPDesktop;
    let event_dt = desktop.w2d(this.canvas.canvas_to_world(pos));
    let normal = this.#normal;
    if (!no_snap) [event_dt, normal] = ruler_snap_new_guide(desktop, event_dt, normal);
    return { event_dt, normal };
  }

  /** End guide creation (upstream _rulerButtonRelease). */
  #rulerButtonRelease(event: PointerEvent, _horiz: boolean): void {
    if (!this.#ruler_clicked) return;
    this.#ruler_clicked = false;
    const desktop = this.#desktop;
    if (!this.#active_guide || !desktop) return;
    const pos = this.#canvasPoint(event);
    const { event_dt, normal } = this.#snappedGuide(pos, event.shiftKey);
    this.#active_guide.unlink();
    this.#active_guide = null;
    desktop.getSnapIndicator().remove_snaptarget();
    const size = this.canvas.get_dimensions();
    // Only create the guide if the pointer is over the canvas.
    if (pos.x >= 0 && pos.y >= 0 && pos.x < size.x && pos.y < size.y) {
      this.#createGuide(event_dt, normal);
    }
    this.#ruler_dragged = false;
  }

  /** Add a guide at origin with normal (desktop coordinates) to the document (upstream _createGuide). */
  #createGuide(origin: Point, normal: Point): void {
    const desktop = this.#desktop;
    if (!desktop) return;
    const nv = desktop.getNamedView();
    // This condition occurs when guides are locked. TODO: blink the lock button.
    if (nv.getLockGuides()) nv.setLockGuides(false);
    // A second point on the line: rot90 of the direction is the normal.
    SPGuide.createSPGuide(desktop.getDocument(), origin, origin.add(new Point(normal.y, -normal.x)));
    DocumentUndo.done(desktop.getDocument(), C_('Undo', 'Create guide'), '');
  }
}

/**
 * Snap a new guide that is dragged off the rulers: its position, and its
 * normal when it snaps to a path with tangential or perpendicular snapping.
 * Returns the snapped point and normal.
 */
function ruler_snap_new_guide(desktop: SPDesktop, event_dt: Point, normal: Point): [Point, Point] {
  const m = desktop.getSnapManager();
  m.setup(desktop);
  // We're dragging a brand new guide, just pulled out of the rulers seconds ago. When snapping to a
  // path this guide will change it slope to become either tangential or perpendicular to that path. It's
  // therefore not useful to try tangential or perpendicular snapping, so this will be disabled temporarily
  const pref_perp = m.snapprefs.isTargetSnappable(SnapTargetType.SNAPTARGET_PATH_PERPENDICULAR);
  const pref_tang = m.snapprefs.isTargetSnappable(SnapTargetType.SNAPTARGET_PATH_TANGENTIAL);
  m.snapprefs.setTargetSnappable(SnapTargetType.SNAPTARGET_PATH_PERPENDICULAR, false);
  m.snapprefs.setTargetSnappable(SnapTargetType.SNAPTARGET_PATH_TANGENTIAL, false);
  // We only have a temporary guide which is not stored in our document yet.
  // Because the guide snapper only looks in the document for guides to snap to,
  // we don't have to worry about a guide snapping to itself here
  const r = m.guideFreeSnap(event_dt, normal, false, false);
  let new_normal = r.origin_or_vector;
  // After snapping, both event_dt and normal have been modified accordingly; we'll take the normal (of the
  // curve we snapped to) to set the normal the guide. And rotate it by 90 deg. if needed
  if (r.changed && pref_perp) new_normal = new Point(-new_normal.y, new_normal.x);
  // if we don't want to snap either perpendicularly or tangentially, then we must restore the normal
  if (!(pref_tang || pref_perp)) new_normal = normal;
  // Restore the preferences
  m.snapprefs.setTargetSnappable(SnapTargetType.SNAPTARGET_PATH_PERPENDICULAR, pref_perp);
  m.snapprefs.setTargetSnappable(SnapTargetType.SNAPTARGET_PATH_TANGENTIAL, pref_tang);
  m.unSetup();
  return [r.p, new_normal];
}
