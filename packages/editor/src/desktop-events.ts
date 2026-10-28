// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/desktop-events.cpp, src/desktop-events.h
/*
 * Event handlers for SPDesktop
 *
 * Author:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Abhishek Sharma
 *
 * Copyright (C) 1999-2010 authors
 * Copyright (C) 2001-2002 Ximian, Inc.
 */
import { C_, DocumentUndo, Preferences, Signal, type SPGuide } from '@inkscape-web/core';
import { Angle, Point } from '@inkscape-web/geom';
import type { SPDesktop } from './desktop.ts';
import type { CanvasItemGuideLine } from './display/control/canvas-item-guideline.ts';
import { projection } from './snapper.ts';
import { NodeTool } from './ui/tools/node-tool.ts';
import { SelectTool } from './ui/tools/select-tool.ts';
import type { ModifierState } from './ui/tools/tool-base.ts';

enum SPGuideDragType {
  SP_DRAG_TRANSLATE,
  SP_DRAG_ROTATE,
  SP_DRAG_MOVE_ORIGIN,
  SP_DRAG_NONE,
}

/**
 * Emitted on a double click on a guide, to open the guide properties dialog
 * (upstream GuidelinePropertiesDialog::showDialog); the UI connects to it.
 */
export const signal_guide_dialog = new Signal<[SPGuide, SPDesktop]>();

/** The guide under the pointer of each desktop, for Delete. */
const hovered_guides = new WeakMap<SPDesktop, SPGuide>();

/**
 * Handle the events of a guide line (upstream sp_dt_guide_event): drag to
 * move, Shift+drag to rotate, Ctrl+drag to move the origin along the guide,
 * drag out of the canvas or Delete to remove, double click for the
 * properties dialog. Only with the select and node tools. Returns the
 * function that disconnects the handlers.
 * TODO: cursors, the status bar message, the snap delay.
 */
export function sp_dt_guide_event(
  desktop: SPDesktop,
  guide_item: CanvasItemGuideLine,
  guide: SPGuide,
): () => void {
  let drag_type = SPGuideDragType.SP_DRAG_NONE;
  let guide_moved = false;
  const el = guide_item.element;
  const canvas = desktop.getCanvas();

  // Limit to select/node tools only.
  const active = () => {
    const tool = desktop.getTool();
    return tool instanceof SelectTool || tool instanceof NodeTool;
  };
  const event_dt = (event: MouseEvent) => desktop.w2d(canvas.canvas_to_world(canvas.windowPoint(event)));

  const apply_snap = (p: Point, modifiers: ModifierState): Point => {
    // This is for snapping while dragging existing guidelines. New guidelines,
    // which are dragged off the ruler, are being snapped in the ruler
    const m = desktop.getSnapManager();
    m.setup(desktop, true, guide);
    if (drag_type === SPGuideDragType.SP_DRAG_MOVE_ORIGIN) {
      // If we snap in guideConstrainedSnap() below, then motion_dt will
      // be forced to be on the guide. If we don't snap however, then
      // the origin should still be constrained to the guide. So let's do
      // that explicitly first:
      const g = guide.getPoint();
      p = projection(p, g, g.add(guide.getNormal().cw()));
      if (!modifiers.shiftKey) p = m.guideConstrainedSnap(p, guide);
    } else if (!(drag_type === SPGuideDragType.SP_DRAG_ROTATE && (modifiers.ctrlKey || modifiers.metaKey))) {
      // Cannot use shift here to disable snapping, because we already use it for rotating the guide.
      if (drag_type === SPGuideDragType.SP_DRAG_ROTATE) {
        const r = m.guideFreeSnap(p, guide.getPoint(), true, false);
        p = r.p;
        guide.moveto(r.origin_or_vector, false);
      } else {
        const r = m.guideFreeSnap(p, guide.getNormal(), false, true);
        p = r.p;
        guide.set_normal(r.origin_or_vector, false);
      }
    }
    m.unSetup();
    return p;
  };

  const move_guide = (p: Point, modifiers: ModifierState, commit: boolean) => {
    switch (drag_type) {
      case SPGuideDragType.SP_DRAG_TRANSLATE:
      case SPGuideDragType.SP_DRAG_MOVE_ORIGIN:
        guide.moveto(p, commit);
        break;
      case SPGuideDragType.SP_DRAG_ROTATE: {
        let angle = new Angle(Math.atan2(p.y - guide.getPoint().y, p.x - guide.getPoint().x)).radians0();
        if (modifiers.ctrlKey || modifiers.metaKey) {
          const prefs = Preferences.get();
          const snaps = Math.min(
            Math.max(prefs.getDouble('/options/rotationsnapsperpi/value', 12.0), 0.1),
            1800,
          );
          if (prefs.getBool('/options/relativeguiderotationsnap/value', false)) {
            const orig_angle = new Angle(Math.atan2(guide.getNormal().y, guide.getNormal().x)).radians0();
            const sections = Math.floor(((angle - orig_angle) * snaps) / Math.PI + 0.5);
            angle = (Math.PI / snaps) * sections + orig_angle;
          } else {
            const sections = Math.floor((angle * snaps) / Math.PI + 0.5);
            angle = (Math.PI / snaps) * sections;
          }
        }
        guide.set_normal(Point.polar(angle).cw(), commit);
        break;
      }
      default:
        break;
    }
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!active() || event.button !== 0) return;
    // The guide takes the event, the tool does not see it; the canvas takes the keyboard focus (for Delete).
    event.stopPropagation();
    canvas.svg.focus({ preventScroll: true });
    if (guide.getLocked()) return;
    drag_type = event.shiftKey
      ? SPGuideDragType.SP_DRAG_ROTATE // with shift we rotate the guide
      : event.ctrlKey || event.metaKey
        ? SPGuideDragType.SP_DRAG_MOVE_ORIGIN
        : SPGuideDragType.SP_DRAG_TRANSLATE;
    el.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (drag_type === SPGuideDragType.SP_DRAG_NONE) return;
    event.stopPropagation();
    move_guide(apply_snap(event_dt(event), event), event, false);
    guide_moved = true;
  };

  const onPointerUp = (event: PointerEvent) => {
    if (drag_type === SPGuideDragType.SP_DRAG_NONE || event.button !== 0) return;
    event.stopPropagation();
    if (guide_moved) {
      const p = apply_snap(event_dt(event), event);
      const w = canvas.windowPoint(event);
      const size = canvas.get_dimensions();
      if (w.x >= 0 && w.y >= 0 && w.x < size.x && w.y < size.y) {
        move_guide(p, event, true);
        DocumentUndo.done(desktop.getDocument(), C_('Undo', 'Move guide'), '');
      } else {
        // Undo movement of any attached shapes.
        guide.moveto(guide.getPoint(), false);
        guide.set_normal(guide.getNormal(), false);
        guide.remove();
        DocumentUndo.done(desktop.getDocument(), C_('Undo', 'Delete guide'), '');
      }
      guide_moved = false;
    }
    drag_type = SPGuideDragType.SP_DRAG_NONE;
    if (el.hasPointerCapture?.(event.pointerId)) el.releasePointerCapture(event.pointerId);
  };

  const onDoubleClick = (event: MouseEvent) => {
    if (!active()) return;
    event.stopPropagation();
    drag_type = SPGuideDragType.SP_DRAG_NONE;
    signal_guide_dialog.emit(guide, desktop);
  };

  const onEnter = () => {
    if (!active()) return;
    if (!guide.getLocked()) guide_item.set_stroke(guide.getHiColor());
    hovered_guides.set(desktop, guide);
  };
  const onLeave = () => {
    guide_item.set_stroke(guide.getColor());
    if (hovered_guides.get(desktop) === guide) hovered_guides.delete(desktop);
  };

  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointercancel', onPointerUp);
  el.addEventListener('dblclick', onDoubleClick);
  el.addEventListener('pointerenter', onEnter);
  el.addEventListener('pointerleave', onLeave);
  return () => {
    if (hovered_guides.get(desktop) === guide) hovered_guides.delete(desktop);
    el.removeEventListener('pointerdown', onPointerDown);
    el.removeEventListener('pointermove', onPointerMove);
    el.removeEventListener('pointerup', onPointerUp);
    el.removeEventListener('pointercancel', onPointerUp);
    el.removeEventListener('dblclick', onDoubleClick);
    el.removeEventListener('pointerenter', onEnter);
    el.removeEventListener('pointerleave', onLeave);
  };
}

/**
 * Delete the guide under the pointer on Delete or Backspace (the key part of
 * upstream sp_dt_guide_event). Returns true if the key was handled.
 */
export function sp_dt_guide_key_event(desktop: SPDesktop, event: KeyboardEvent): boolean {
  if (event.key !== 'Delete' && event.key !== 'Backspace') return false;
  const guide = hovered_guides.get(desktop);
  if (!guide || guide.getLocked()) return false;
  const doc = guide.document;
  guide.remove();
  hovered_guides.delete(desktop);
  DocumentUndo.done(doc, C_('Undo', 'Delete guide'), '');
  return true;
}
