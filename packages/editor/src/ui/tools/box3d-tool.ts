// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/box3d-tool.cpp, src/ui/tools/box3d-tool.h
/*
 * 3D box drawing context
 *
 * Author:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2007      Maximilian Albert <Anhalter42@gmx.de>
 * Copyright (C) 2006      Johan Engelen <johan@shouraizou.nl>
 * Copyright (C) 2000-2006 Authors
 * Copyright (C) 2000-2001 Ximian, Inc.
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import {
  Box3D,
  Box3DSide,
  C_,
  DocumentUndo,
  getCurrentPersp3D,
  Persp3D,
  PerspectiveLine,
  Preferences,
  Proj,
  type Pt3,
  perspList,
  SnapSourceType,
  SPBox3D,
  type SPDocument,
  setCurrentPersp3D,
} from '@inkscape-web/core';
import type { Point } from '@inkscape-web/geom';
import { have_viable_layer } from '../../context-fns.ts';
import type { SPDesktop } from '../../desktop.ts';
import { VPDrag } from '../../vanishing-point.ts';
import { Box3DKnotHolder } from '../shape-editor-knotholders.ts';
import {
  type ModifierState,
  mod_alt,
  mod_ctrl,
  mod_ctrl_only,
  mod_select_add_to,
  mod_shift,
  mod_shift_only,
  ToolBase,
} from './tool-base.ts';

/** box3d-extrude-one: Shift (upstream Modifiers). */
const mod_box3d_extrude_one = (s: ModifierState): boolean => mod_shift(s) && !mod_ctrl(s);
/** box3d-extrude-two: Shift+Ctrl */
const mod_box3d_extrude_two = (s: ModifierState): boolean => mod_shift(s) && mod_ctrl(s);

/* Create a default perspective in document defs if none is present (which can happen, among other
 * circumstances, after 'vacuum defs' or when a pre-0.46 file is opened).
 */
function ensure_persp_in_defs(document: SPDocument): void {
  if (document.getDefs()?.children.some((c) => c instanceof Persp3D)) return;
  setCurrentPersp3D(document, Persp3D.create_xml_element(document));
}

/**
 * The 3D box tool (upstream Box3dTool): drag to draw a box in the current perspective; with
 * Shift extrude it along the Z axis, with Shift+Ctrl in two dimensions. The selected box shows
 * its corner and center knots and the vanishing points and perspective lines of its
 * perspective. [ ] ( ) { } rotate the infinite vanishing points, Shift+X/Y/Z toggle the
 * vanishing points between finite and infinite.
 * TODO: Shift+G (convert to guides), status messages, cursors.
 */
export class Box3dTool extends ToolBase {
  box3d: SPBox3D | null = null;
  dragging = false;
  extruded = false;
  two_dimension_dragged = false;
  center: Point | null = null;
  _vpdrag: VPDrag;
  #knotholder: Box3DKnotHolder | null = null;

  /* Position of the 3D box during dragging */
  drag_origin: Point | null = null;
  drag_ptB: Point | null = null;
  drag_ptC: Point | null = null;
  drag_origin_proj: Pt3 | null = null;
  drag_ptB_proj: Pt3 | null = null;
  drag_ptC_proj: Pt3 | null = null;

  readonly #disconnect: (() => void)[];

  constructor(desktop: SPDesktop) {
    super(desktop, '/tools/shapes/3dbox');
    this.#selection_changed();
    this._vpdrag = new VPDrag(desktop);
    this._vpdrag.onBoxHandles = () => this.#knotholder?.update_knots();
    this.#disconnect = [
      desktop.getSelection().connectChanged(() => this.#selection_changed()),
      // Upstream: Persp3D::set() updates the draggers of the active 3D box tool.
      desktop.getDocument().modifiedSignal.connect(() => {
        if (this._vpdrag.dragging) return;
        this._vpdrag.updateDraggers();
        this._vpdrag.updateLines();
        this.#knotholder?.update_knots();
      }),
    ];
    const prefs = Preferences.get();
    if (prefs.getBool('/tools/shapes/selcue')) this.enableSelectionCue();
    if (prefs.getBool('/tools/shapes/gradientdrag')) this.enableGrDrag();
  }

  override destroy(): void {
    this.ungrabCanvasEvents();
    this.finishItem();
    for (const f of this.#disconnect) f();
    this.#knotholder?.clear();
    this.#knotholder = null;
    this._vpdrag.destroy();
    super.destroy();
  }

  /** Destroys old and creates new knotholder (upstream selection_changed with the ShapeEditor). */
  #selection_changed(): void {
    const selection = this._desktop.getSelection();
    this.#knotholder?.clear();
    this.#knotholder = null;
    const item = selection.singleItem();
    if (item instanceof SPBox3D) this.#knotholder = new Box3DKnotHolder(this._desktop, item);
    const persps = perspList(selection);
    // selecting a single box changes the current perspective
    if (persps.length === 1) setCurrentPersp3D(this._desktop.getDocument(), persps[0]!);
  }

  override root_handler(event: Event): boolean {
    const document = this._desktop.getDocument();
    const y_dir = document.yaxisdir();
    const selection = this._desktop.getSelection();
    const prefs = Preferences.get();
    const snaps = Math.min(Math.max(prefs.getDouble('/options/rotationsnapsperpi/value', 12.0), 0.1), 1800.0);
    this.tolerance = Math.min(Math.max(prefs.getInt('/options/dragtolerance/value', 0), 0), 100);
    let cur_persp = getCurrentPersp3D(document);
    let ret = false;

    switch (event.type) {
      case 'pointerdown': {
        const e = event as PointerEvent;
        if (e.button !== 0) break;
        const button_w = this._windowPoint(e);
        this.saveDragOrigin(button_w);
        // remember clicked box3d, *not* disregarding groups (since a 3D box is a group), honoring Alt
        this.item_to_select = this._desktop.getItemAtPoint(button_w, false);
        this.dragging = true;
        const button_dt = this.#snap(this._desktopPoint(button_w));
        this.center = button_dt;
        this.drag_origin = button_dt;
        this.drag_ptB = button_dt;
        this.drag_ptC = button_dt;
        // This can happen after saving when the last remaining perspective was purged and must be recreated.
        if (!cur_persp) {
          ensure_persp_in_defs(document);
          cur_persp = getCurrentPersp3D(document);
        }
        if (!cur_persp) break;
        // Projective preimages of clicked point under current perspective.
        const tmat = cur_persp.perspective_impl.tmat;
        this.drag_origin_proj = tmat.preimage(button_dt, 0, Proj.Axis.Z);
        this.drag_ptB_proj = this.drag_origin_proj.normalized();
        this.drag_ptC_proj = this.drag_origin_proj.normalized();
        this.drag_ptC_proj.pt[Proj.Axis.Z] = 0.25;
        this.grabCanvasEvents(e);
        ret = true;
        break;
      }
      case 'pointermove': {
        const e = event as PointerEvent;
        if (!(this.dragging && e.buttons & 1)) {
          if (!this.dragging) this._preSnap(this._desktopPoint(this._windowPoint(e)));
          break;
        }
        // Can happen if perspective is deleted while dragging, e.g. on document closure.
        if (!cur_persp) {
          ret = true;
          break;
        }
        const motion_w = this._windowPoint(e);
        if (!this.checkDragMoved(motion_w)) break;
        const motion_dt = this.#snap(this._desktopPoint(motion_w));
        const tmat = cur_persp.perspective_impl.tmat;
        this.two_dimension_dragged = !!this.box3d && mod_box3d_extrude_two(e);
        this.extruded = !!this.box3d && (mod_box3d_extrude_one(e) || mod_box3d_extrude_two(e));
        if (!this.extruded) {
          this.drag_ptB = motion_dt;
          this.drag_ptC = motion_dt;
          this.drag_ptB_proj = tmat.preimage(motion_dt, 0, Proj.Axis.Z);
          this.drag_ptC_proj = this.drag_ptB_proj.normalized();
          this.drag_ptC_proj.pt[Proj.Axis.Z] = 0.25;
        } else if (this.drag_ptB && this.drag_ptB_proj) {
          // Without Ctrl, motion of the extruded corner is constrained to the
          // perspective line from drag_ptB to vanishing point Y.
          this.drag_ptB_proj.normalize();
          if (!this.two_dimension_dragged) {
            this.drag_ptC = new PerspectiveLine(this.drag_ptB, Proj.Axis.Z, cur_persp).closest_to(motion_dt);
          } else {
            this.drag_ptC = motion_dt;
          }
          this.drag_ptC_proj = tmat.preimage(this.drag_ptC, this.drag_ptB_proj.at(Proj.Axis.X), Proj.Axis.X);
        }
        this.drag();
        ret = true;
        break;
      }
      case 'pointerup': {
        const e = event as PointerEvent;
        this.xyp = null;
        if (e.button !== 0) break;
        this.dragging = false;
        if (!this.within_tolerance) {
          // we've been dragging (or switched tools if !box3d), finish the box
          // Updating the selection will send signals to the box3d-toolbar ...
          if (this.box3d) selection.set(this.box3d);
          // .. but finishItem() will be called from the destructor too and shall NOT fire such signals!
          this.finishItem();
        } else if (this.item_to_select) {
          // no dragging, select clicked box3d if any
          if (mod_select_add_to(e)) selection.toggle(this.item_to_select);
          else selection.set(this.item_to_select);
        } else {
          // click in an empty space
          selection.clear();
        }
        this.item_to_select = null;
        ret = true;
        this.ungrabCanvasEvents(e);
        break;
      }
      case 'keydown':
        ret = this.#handleKey(event as KeyboardEvent, document, 180 / snaps, y_dir);
        break;
    }
    return ret || super.root_handler(event);
  }

  #handleKey(e: KeyboardEvent, document: SPDocument, step: number, y_dir: number): boolean {
    const selection = this._desktop.getSelection();
    const persp = getCurrentPersp3D(document);
    const rotate = (axis: Proj.Axis, angle: number) => {
      if (!persp) return;
      persp.rotate_VP(axis, angle * y_dir, mod_alt(e));
      DocumentUndo.done(document, C_('Undo', 'Change perspective (angle of PLs)'), 'draw-cuboid');
    };
    const toggle = (axis: Proj.Axis) => {
      Persp3D.toggle_VPs(perspList(selection), axis);
      this._vpdrag.updateLines(); // FIXME: Shouldn't this be done automatically?
    };
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowDown':
        // prevent the zoom field from activation
        return !mod_ctrl_only(e);
      case ']':
        rotate(Proj.Axis.X, step);
        return true;
      case '[':
        rotate(Proj.Axis.X, -step);
        return true;
      case ')':
        rotate(Proj.Axis.Y, step);
        return true;
      case '(':
        rotate(Proj.Axis.Y, -step);
        return true;
      case '}':
        rotate(Proj.Axis.Z, step);
        return true;
      case '{':
        rotate(Proj.Axis.Z, -step);
        return true;
      case 'x':
      case 'X':
        if (!mod_shift_only(e)) return false;
        toggle(Proj.Axis.X);
        return true;
      case 'y':
      case 'Y':
        if (!mod_shift_only(e)) return false;
        toggle(Proj.Axis.Y);
        return true;
      case 'z':
      case 'Z':
        if (!mod_shift_only(e)) return false;
        toggle(Proj.Axis.Z);
        return true;
      case 'Escape':
        if (!this.dragging) return false;
        this.dragging = false;
        // if drawing, cancel, otherwise pass it up for deselecting
        this.cancel();
        return true;
      case ' ':
        if (this.dragging) {
          this.ungrabCanvasEvents();
          this.dragging = false;
          if (!this.within_tolerance) {
            // we've been dragging (or switched tools if !box3d), finish the box
            if (this.box3d) selection.set(this.box3d);
            this.finishItem();
          }
        }
        // do not return true, so that space would work switching to selector
        return false;
      case 'Delete':
      case 'Backspace':
        return this.deleteSelectedDrag(mod_ctrl_only(e));
      default:
        return false;
    }
  }

  #snap(p: Point): Point {
    const m = this._desktop.getSnapManager();
    m.setup(this._desktop, true, this.box3d);
    const r = m.freeSnapReturnByRef(p, SnapSourceType.SNAPSOURCE_NODE_HANDLE);
    m.unSetup();
    return r;
  }

  drag(): void {
    if (!this.drag_origin_proj || !this.drag_ptC_proj) return;
    if (!this.box3d) {
      const layer = this.currentLayer();
      if (!layer || !have_viable_layer(this._desktop)) return;
      // Create object
      const newbox3d = SPBox3D.createBox3D(layer);
      // Set group style. This style isn't visible, since only the faces are visible.
      this._desktop.applyCurrentOrToolStyle(newbox3d.getRepr(), '/tools/shapes/3dbox', false);
      this.box3d = newbox3d;
      const use_current = Preferences.get().getString('/tools/shapes/3dbox/usecurrent', '0'); // "0", "1", or "3dbox"
      // TODO: Incorporate this in box3d-side.cpp!
      for (let i = 0; i < 6; ++i) {
        const side = Box3DSide.createBox3DSide(newbox3d);
        let [plane, front_or_rear] = Box3D.int_to_face(i);
        plane = Box3D.is_plane(plane) ? plane : Box3D.orth_plane_or_axis(plane);
        side.dir1 = Box3D.extract_first_axis_direction(plane);
        side.dir2 = Box3D.extract_second_axis_direction(plane);
        side.front_or_rear = front_or_rear;
        // Set style
        this._desktop.applyCurrentOrToolStyle(
          side.getRepr(),
          `/tools/shapes/3dbox/${side.axes_string()}`,
          true,
          use_current.length === 1 ? use_current : side.axes_string(),
        );
        side.updateRepr(); // calls Box3DSide::write() and updates, e.g., the axes string description
      }
      this.box3d.transform = layer.i2docAffine().inverse();
      this.box3d.set_z_orders();
      this.box3d.updateRepr();
    }
    this.box3d.orig_corner0 = this.drag_origin_proj.normalized();
    this.box3d.orig_corner7 = this.drag_ptC_proj.normalized();
    this.box3d.check_for_swapped_coords();
    // we need to call this from here (instead of from SPBox3D::position_set(), for example)
    // because z-order setting must not interfere with display updates during undo/redo.
    this.box3d.set_z_orders();
    this.box3d.position_set();
  }

  finishItem(): void {
    this.two_dimension_dragged = false;
    this.extruded = false;
    const box = this.box3d;
    if (!box || !this.drag_origin_proj || !this.drag_ptC_proj) return;
    const c0 = box.orig_corner0;
    const c7 = box.orig_corner7;
    // Don't allow the creation of zero sized 3d boxes
    if ([0, 1, 2].filter((i) => c0.at(i) === c7.at(i)).length >= 2) {
      this.cancel();
      return;
    }
    const doc = this._desktop.getDocument();
    if (!getCurrentPersp3D(doc)) return;
    box.orig_corner0 = this.drag_origin_proj.normalized();
    box.orig_corner7 = this.drag_ptC_proj.normalized();
    box.updateRepr();
    box.doWriteTransform(box.transform, null, true);
    box.relabel_corners();
    box.updateRepr();
    DocumentUndo.done(doc, C_('Undo', 'Create 3D box'), 'draw-cuboid');
    this.box3d = null;
  }

  cancel(): void {
    this._desktop.getSelection().clear();
    this.ungrabCanvasEvents();
    this.box3d?.deleteObject();
    this.box3d = null;
    this.within_tolerance = false;
    this.xyp = null;
    this.item_to_select = null;
    DocumentUndo.cancel(this._desktop.getDocument());
  }
}
